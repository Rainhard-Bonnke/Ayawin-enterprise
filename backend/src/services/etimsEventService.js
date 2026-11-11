const pool = require("../db");
const { getEtimsProvider } = require("./etimsProvider");
const { sumMoney, lineMoney, roundMoney } = require("../lib/money");

const TAX_TYPES = ["A", "B", "C", "D", "E"];

async function nextEventNumber(client, companyId, eventKind) {
  const result = await client.query(
    `INSERT INTO erp_etims_event_sequences (company_id,event_kind,next_number)
     VALUES ($1,$2,2)
     ON CONFLICT (company_id,event_kind) DO UPDATE
       SET next_number=erp_etims_event_sequences.next_number+1,updated_at=NOW()
     RETURNING next_number-1 AS event_number`,
    [companyId, eventKind],
  );
  return Number(result.rows[0].event_number);
}

async function enqueueEvent(client, { companyId, userId, eventKind, sourceType, sourceId, payload, status = "pending", error = null }) {
  const idempotencyKey = `etims:${eventKind}:${companyId}:${sourceType}:${sourceId}`;
  const result = await client.query(
    `INSERT INTO erp_etims_event_submissions
       (company_id,event_kind,source_type,source_id,idempotency_key,status,payload,last_error,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     ON CONFLICT (company_id,event_kind,source_type,source_id) DO UPDATE SET
       status=EXCLUDED.status,payload=EXCLUDED.payload,last_error=EXCLUDED.last_error,
       next_attempt_at=NOW(),completed_at=NULL,updated_at=NOW()
     WHERE erp_etims_event_submissions.status IN ('failed','rejected')
     RETURNING id,status`,
    [companyId,eventKind,sourceType,sourceId,idempotencyKey,status,JSON.stringify(payload || {}),error,userId],
  );
  return result.rows[0] || null;
}

function taxRatesByType(codeRows) {
  const rates = {};
  for (const row of codeRows) {
    if (TAX_TYPES.includes(row.code)) rates[row.code] = Number(row.user_defined_code_1 || 0);
  }
  return rates;
}

async function buildPurchasePayload(client, { companyId, billId, policy }) {
  const billResult = await client.query(
    `SELECT bill.*,vendor.name AS supplier_name,vendor.tax_id AS supplier_pin
     FROM erp_supplier_bills bill JOIN erp_vendors vendor
       ON vendor.id=bill.vendor_id AND vendor.company_id=bill.company_id
     WHERE bill.id=$1 AND bill.company_id=$2 AND bill.status='posted' AND bill.is_deleted=FALSE`,
    [billId,companyId],
  );
  const bill = billResult.rows[0];
  if (!bill) throw new Error("Supplier bill must be posted before eTIMS purchase submission");
  if (bill.evidence_status !== "verified" || !bill.etims_invoice_no || !bill.etims_receipt_signature) {
    throw new Error("Supplier KRA invoice evidence must be verified before purchase submission");
  }
  if (!bill.goods_receipt_id) throw new Error("eTIMS purchase submission requires a bill matched to a posted goods receipt");
  if (!/^[AP]\d{9}[A-Z]$/.test(String(bill.supplier_pin || "").toUpperCase())) {
    throw new Error("Supplier PIN is missing or invalid for KRA purchase submission");
  }
  const linesResult = await client.query(
    `SELECT bill_line.*,item.etims_item_code,item.etims_item_classification_code,item.name AS item_name,
            item.etims_packaging_unit_code,item.etims_package_quantity,item.etims_quantity_unit_code,
            item.etims_tax_type_code,item.barcode
     FROM erp_supplier_bill_lines bill_line
     JOIN erp_goods_receipt_lines receipt_line ON receipt_line.id=bill_line.goods_receipt_line_id
       AND receipt_line.company_id=bill_line.company_id AND receipt_line.goods_receipt_id=$3
     JOIN erp_items item ON item.id=receipt_line.item_id AND item.company_id=receipt_line.company_id
     WHERE bill_line.bill_id=$1 AND bill_line.company_id=$2 ORDER BY bill_line.line_no`,
    [billId,companyId,bill.goods_receipt_id],
  );
  if (!linesResult.rowCount) throw new Error("Verified purchase has no receipt-linked lines for KRA item registration");
  const codeRows = await client.query(
    `SELECT code,user_defined_code_1 FROM erp_etims_code_lists
     WHERE company_id=$1 AND code_class='tax_type' AND is_active=TRUE`, [companyId],
  );
  const rates = taxRatesByType(codeRows.rows);
  const sums = Object.fromEntries(TAX_TYPES.map((code) => [code,{ taxable: [], tax: [] }]));
  const itemList = linesResult.rows.map((line,index) => {
    const code = String(line.etims_tax_type_code || "");
    if (!TAX_TYPES.includes(code) || rates[code] === undefined || !line.etims_item_code || !line.etims_item_classification_code
      || !line.etims_packaging_unit_code || !line.etims_quantity_unit_code || !line.etims_package_quantity) {
      throw new Error(`Receipt item ${line.item_name} is missing active KRA item/tax mappings`);
    }
    const taxable = Number(line.net_amount);
    const tax = Number(line.tax_amount);
    sums[code].taxable.push(taxable);
    sums[code].tax.push(tax);
    return {
      itemSeq:index+1,itemCd:line.etims_item_code,itemClsCd:line.etims_item_classification_code,
      itemNm:String(line.item_name || line.description).slice(0,200),bcd:line.barcode || null,
      pkgUnitCd:line.etims_packaging_unit_code,pkg:Number(line.etims_package_quantity),
      qtyUnitCd:line.etims_quantity_unit_code,qty:Number(line.quantity),prc:Number(line.unit_price),
      splyAmt:lineMoney(line.quantity,line.unit_price),dcRt:0,dcAmt:sumMoney([lineMoney(line.quantity,line.unit_price),-taxable]),
      taxblAmt:taxable,taxTyCd:code,taxAmt:tax,totAmt:sumMoney([taxable,tax]),itemExprDt:null,
    };
  });
  const taxbl = Object.fromEntries(TAX_TYPES.map((code) => [`taxblAmt${code}`,sumMoney(sums[code].taxable)]));
  const taxAmt = Object.fromEntries(TAX_TYPES.map((code) => [`taxAmt${code}`,sumMoney(sums[code].tax)]));
  const totalTaxable = sumMoney(Object.values(taxbl));
  const totalTax = sumMoney(Object.values(taxAmt));
  if (Math.round(totalTaxable*100)!==Math.round(Number(bill.subtotal)*100)
    || Math.round(totalTax*100)!==Math.round(Number(bill.tax_amount)*100)
    || Math.round(sumMoney([totalTaxable,totalTax])*100)!==Math.round(Number(bill.total_amount)*100)) {
    throw new Error("KRA purchase taxable/VAT totals do not reconcile to the posted supplier bill");
  }
  const requiredCodes = [policy.kra_registration_type_code,policy.kra_purchase_type_code,
    policy.kra_purchase_receipt_type_code,policy.kra_purchase_status_code,policy.kra_payment_type_code];
  if (requiredCodes.some((value) => !value)) throw new Error("Configure synchronized KRA purchase transaction codes before submitting supplier bills");
  const allCodes = await client.query(
    `SELECT code_class,code FROM erp_etims_code_lists WHERE company_id=$1 AND is_active=TRUE`, [companyId],
  );
  const active = new Set(allCodes.rows.map((row) => `${row.code_class}:${row.code}`));
  const configured = [
    ["registration_type",policy.kra_registration_type_code], ["transaction_type",policy.kra_purchase_type_code],
    ["purchase_receipt_type",policy.kra_purchase_receipt_type_code], ["transaction_progress",policy.kra_purchase_status_code],
    ["payment_type",policy.kra_payment_type_code],
  ];
  for (const [type,code] of configured) if (!active.has(`${type}:${code}`)) throw new Error(`KRA ${type} code ${code} is not active in synchronized code lists`);
  const number=await nextEventNumber(client,companyId,"purchase");
  const d=String(bill.bill_date).slice(0,10).replace(/-/g,"");
  const stamp=`${d}000000`;
  return {
    invcNo:number,orgInvcNo:0,spplrTin:String(bill.supplier_pin).toUpperCase(),spplrBhfId:null,
    spplrNm:String(bill.supplier_name).slice(0,60),spplrInvcNo:/^\d+$/.test(String(bill.etims_invoice_no))?Number(bill.etims_invoice_no):null,
    regTyCd:policy.kra_registration_type_code,pchsTyCd:policy.kra_purchase_type_code,
    rcptTyCd:policy.kra_purchase_receipt_type_code,pmtTyCd:policy.kra_payment_type_code,
    pchsSttsCd:policy.kra_purchase_status_code,cfmDt:stamp,pchsDt:d,wrhsDt:stamp,
    cnclReqDt:"",cnclDt:"",rfdDt:"",totItemCnt:itemList.length,
    ...taxbl,...Object.fromEntries(TAX_TYPES.map((code)=>[`taxRt${code}`,rates[code]])),...taxAmt,
    totTaxblAmt:totalTaxable,totTaxAmt:totalTax,totAmt:sumMoney([totalTaxable,totalTax]),
    remark:`ERP bill ${bill.bill_no}`,regrId:"AYAWIN-ERP",regrNm:"Ayawin ERP",
    modrId:"AYAWIN-ERP",modrNm:"Ayawin ERP",itemList,
  };
}

async function queueEtimsPurchaseInTransaction(client,{companyId,userId,billId}) {
  try {
    const config=await require("./integrationSettingsService").getProviderRuntimeConfig({companyId,provider:"etims"});
    if(config.provider_mode==="disabled")return {queued:false,status:"disabled"};
    const payload=await buildPurchasePayload(client,{companyId,billId,policy:config.policy||{}});
    const queued=await enqueueEvent(client,{companyId,userId,eventKind:"purchase",sourceType:"supplier_bill",sourceId:billId,payload});
    return {queued:Boolean(queued),status:queued?.status||"existing"};
  } catch(error) {
    const queued=await enqueueEvent(client,{companyId,userId,eventKind:"purchase",sourceType:"supplier_bill",sourceId:billId,
      payload:{source_id:billId},status:"failed",error:String(error.message||"KRA purchase mapping failed").slice(0,2000)});
    return {queued:Boolean(queued),status:"failed",error:error.message};
  }
}

async function queueEtimsStockMovementInTransaction(client,{companyId,userId,sourceType,sourceId,eventType,occurredDate,lines,policy={}}) {
  try {
    const config=await require("./integrationSettingsService").getProviderRuntimeConfig({companyId,provider:"etims"});
    if(config.provider_mode==="disabled")return {queued:false,status:"disabled"};
    policy=config.policy||policy;
    const movementCode=policy.kra_stock_movement_codes?.[eventType];
    if(!movementCode)throw new Error(`Configure a synchronized KRA stock movement code for ${eventType}`);
    const mapped=await client.query(
      `SELECT item.id,item.item_code,item.name,item.barcode,item.etims_item_code,item.etims_item_classification_code,
              item.etims_packaging_unit_code,item.etims_package_quantity,item.etims_quantity_unit_code,item.etims_tax_type_code
              ,item.etims_sync_status
       FROM erp_items item WHERE item.company_id=$1 AND item.id=ANY($2::uuid[])`,
      [companyId,lines.map((line)=>line.item_id)],
    );
    const itemById=new Map(mapped.rows.map((item)=>[item.id,item]));
    const codes=await client.query(`SELECT code,user_defined_code_1 FROM erp_etims_code_lists WHERE company_id=$1 AND code_class='tax_type' AND is_active=TRUE`,[companyId]);
    const rates=taxRatesByType(codes.rows);
    const totals=Object.fromEntries(TAX_TYPES.map((code)=>[code,{taxable:[],tax:[]} ]));
    const itemList=lines.map((line,index)=>{
      const item=itemById.get(line.item_id);const code=String(item?.etims_tax_type_code||"");
      if(!item||item.etims_sync_status!=="synced"||!item.etims_item_code||!item.etims_item_classification_code||!TAX_TYPES.includes(code)||rates[code]===undefined)throw new Error(`Stock item ${item?.item_code||line.item_id} is not KRA registered or tax mapped`);
      const quantity=Math.abs(Number(line.quantity));const unitPrice=Number(line.unit_cost||line.unit_price||0);const taxable=lineMoney(quantity,unitPrice);const tax=roundMoney(taxable*rates[code]/100);
      totals[code].taxable.push(taxable);totals[code].tax.push(tax);
      return {itemSeq:index+1,itemCd:item.etims_item_code,itemClsCd:item.etims_item_classification_code,itemNm:String(item.name).slice(0,200),
        bcd:item.barcode||null,pkgUnitCd:item.etims_packaging_unit_code,pkg:Number(item.etims_package_quantity||1),
        qtyUnitCd:item.etims_quantity_unit_code,qty:quantity,itemExprDt:null,prc:unitPrice,splyAmt:taxable,totDcAmt:0,
        taxblAmt:taxable,taxTyCd:code,taxAmt:tax,totAmt:sumMoney([taxable,tax])};
    });
    const taxbl=Object.fromEntries(TAX_TYPES.map((code)=>[`taxblAmt${code}`,sumMoney(totals[code].taxable)]));
    const taxAmt=Object.fromEntries(TAX_TYPES.map((code)=>[`taxAmt${code}`,sumMoney(totals[code].tax)]));
    const totalTaxable=sumMoney(Object.values(taxbl));const totalTax=sumMoney(Object.values(taxAmt));
    const number=await nextEventNumber(client,companyId,"stock_movement");const date=String(occurredDate).slice(0,10).replace(/-/g,"");
    const payload={sarNo:number,orgSarNo:number,regTyCd:policy.kra_registration_type_code||"M",sarTyCd:movementCode,
      ocrnDt:date,totItemCnt:itemList.length,totTaxblAmt:totalTaxable,totTaxAmt:totalTax,totAmt:sumMoney([totalTaxable,totalTax]),
      remark:`ERP ${eventType} ${sourceType} ${sourceId}`,regrId:"AYAWIN-ERP",regrNm:"Ayawin ERP",modrId:"AYAWIN-ERP",modrNm:"Ayawin ERP",itemList};
    const valid=await client.query(`SELECT 1 FROM erp_etims_code_lists WHERE company_id=$1 AND code_class='stock_movement' AND code=$2 AND is_active=TRUE`,[companyId,movementCode]);
    if(!valid.rowCount)throw new Error(`KRA stock movement code ${movementCode} is not active in synchronized codes`);
    const queued=await enqueueEvent(client,{companyId,userId,eventKind:"stock_movement",sourceType,sourceId,payload});
    return {queued:Boolean(queued),status:queued?.status||"existing"};
  } catch(error) {
    const queued=await enqueueEvent(client,{companyId,userId,eventKind:"stock_movement",sourceType,sourceId,
      payload:{event_type:eventType,source_id:sourceId,lines},status:"failed",error:String(error.message||"KRA stock mapping failed").slice(0,2000)});
    return {queued:Boolean(queued),status:"failed",error:error.message};
  }
}

async function claimEvents(limit,{companyId=null}={}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const result=await client.query(
      `WITH due AS (SELECT id FROM erp_etims_event_submissions
       WHERE ((status IN ('pending','retry') AND next_attempt_at<=NOW()) OR (status='processing' AND updated_at<NOW()-INTERVAL '5 minutes'))
         AND ($2::uuid IS NULL OR company_id=$2) ORDER BY next_attempt_at,created_at FOR UPDATE SKIP LOCKED LIMIT $1)
       UPDATE erp_etims_event_submissions job SET status='processing',attempt_count=attempt_count+1,updated_at=NOW()
       FROM due WHERE job.id=due.id RETURNING job.*`,[Math.max(1,Math.min(100,Number(limit)||20)),companyId]);
    await client.query("COMMIT");return result.rows;
  } catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

async function runEtimsEventBatch({adapter,limit=20,maxAttempts=8,companyId=null}={}) {
  if(!adapter)return {configured:false,processed:0,synced:0,retrying:0,rejected:0,failed:0};
  const jobs=await claimEvents(limit,{companyId});const summary={configured:true,processed:jobs.length,synced:0,retrying:0,rejected:0,failed:0};
  for(const job of jobs){
    try{
      const method=job.event_kind==="purchase"?adapter.savePurchase:adapter.saveStockItems;
      if(typeof method!=="function")throw new Error(`Provider does not implement ${job.event_kind} submission`);
      if(job.event_kind==="purchase"&&(!job.payload?.spplrTin||!job.payload?.invcNo||!Array.isArray(job.payload?.itemList))) {
        throw Object.assign(new Error(job.last_error||"Supplier purchase payload must be remapped from its source bill before dispatch"),{terminal:true});
      }
      if(job.event_kind==="stock_movement"&&(!job.payload?.sarNo||!job.payload?.orgSarNo||!Array.isArray(job.payload?.itemList))) {
        throw Object.assign(new Error(job.last_error||"Stock movement payload must be remapped from its source event before dispatch"),{terminal:true});
      }
      const result=await method.call(adapter,{companyId:job.company_id,payload:job.payload,idempotencyKey:job.idempotency_key});
      if(result?.accepted!==true)throw Object.assign(new Error(result?.message||"KRA rejected event"),{rejected:result?.retryable!==true});
      await pool.query(`UPDATE erp_etims_event_submissions SET status='synced',response_payload=$3::jsonb,last_error=NULL,completed_at=NOW(),updated_at=NOW() WHERE id=$1 AND company_id=$2`,[job.id,job.company_id,JSON.stringify(result)]);
      summary.synced++;
    }catch(error){
      const rejected=error.rejected===true;const terminal=error.terminal===true||rejected||job.attempt_count>=maxAttempts;const status=rejected?"rejected":terminal?"failed":"retry";
      await pool.query(`UPDATE erp_etims_event_submissions SET status=$3,last_error=$4,next_attempt_at=CASE WHEN $5::int IS NULL THEN next_attempt_at ELSE NOW()+($5::int*INTERVAL '1 second') END,completed_at=CASE WHEN $6 THEN NOW() ELSE completed_at END,updated_at=NOW() WHERE id=$1 AND company_id=$2`,[job.id,job.company_id,status,String(error.message||"KRA event submission failed").slice(0,2000),terminal?null:Math.min(60*(2**(job.attempt_count-1)),86400),terminal]);
      summary[rejected?"rejected":terminal?"failed":"retrying"]++;
    }
  }
  return summary;
}

async function listEtimsEventExceptions({companyId,limit=100}) {
  const result=await pool.query(`SELECT id,event_kind,source_type,source_id,status,attempt_count,next_attempt_at,last_error,created_at,
    GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-created_at))))::int AS age_seconds
    FROM erp_etims_event_submissions WHERE company_id=$1 AND status IN ('pending','retry','rejected','failed')
    ORDER BY created_at LIMIT $2`,[companyId,Math.max(1,Math.min(200,Number(limit)||100))]);
  return result.rows;
}

module.exports={
  buildPurchasePayload,
  queueEtimsPurchaseInTransaction,
  queueEtimsStockMovementInTransaction,
  listEtimsEventExceptions,
  runEtimsEventBatch,
};
