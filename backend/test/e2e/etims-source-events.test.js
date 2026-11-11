const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getVendorId, getItemId, pool } = require("./helpers");
const procurement = require("../../src/services/procurementService");
const integrationSettings = require("../../src/services/integrationSettingsService");
const etimsItems = require("../../src/services/etimsItemService");
const { MockEtimsProvider } = require("../../src/services/etimsProvider");
const { runEtimsEventBatch } = require("../../src/services/etimsEventService");
const integration = require("../../src/services/integrationService");

test("E2E posted goods receipt creates a durable idempotent KRA stock event", async () => {
  const ctx = await getTestContext();
  const vendorId = await getVendorId(ctx.companyId);
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const itemBefore = await pool.query("SELECT * FROM erp_items WHERE id=$1 AND company_id=$2", [itemId,ctx.companyId]);
  const settingsBefore = await pool.query(
    "SELECT * FROM erp_integration_settings WHERE company_id=$1 AND provider='etims'", [ctx.companyId],
  );
  const originalItem = itemBefore.rows[0];
  const mock = new MockEtimsProvider();
  let eventId;
  try {
    await integrationSettings.saveIntegrationSettings({
      companyId:ctx.companyId,userId:ctx.userId,provider:"etims",providerMode:"mock",environment:"sandbox",
      publicConfig:{bhfId:"00",sdcId:"MOCK-CU"},
      secrets:{tin:"A123456789Z",communicationKey:"mock-key",deviceSerial:"device-stock-e2e"},
      policy:{kra_stock_movement_codes:{goods_receipt:"02"}},
    });
    const classes=[
      ["ProductType",[{cd:"2",cdNm:"Finished product",useYn:"Y"}]],
      ["Nation",[{cd:"KE",cdNm:"Kenya",useYn:"Y"}]],
      ["PackagingUnit",[{cd:"NT",cdNm:"Net",useYn:"Y"}]],
      ["Unit of Quantity",[{cd:"U",cdNm:"Unit",useYn:"Y"}]],
      ["TaxationType",[{cd:"B",cdNm:"B-16.00%",userDfnCd1:"16",useYn:"Y"}]],
      ["StockMovementType",[{cd:"02",cdNm:"Purchase",useYn:"Y"}]],
    ].map(([cdClsNm,dtlList],index)=>({cdCls:String(index+1).padStart(2,"0"),cdClsNm,dtlList}));
    await etimsItems.refreshEtimsReferenceData({companyId:ctx.companyId,provider:{
      selectCodeList:async()=>({resultCd:"000",data:{clsList:classes}}),
      selectItemClassList:async()=>({resultCd:"000",data:{itemClsList:[
        {itemClsCd:"5059690800",itemClsNm:"Beverage",itemClsLvl:5,taxTyCd:"B",useYn:"Y"},
      ]}}),
    }});
    await pool.query(
      `UPDATE erp_items SET etims_item_classification_code='5059690800',etims_item_code=$3,
         etims_item_type_code='2',etims_origin_country_code='KE',etims_packaging_unit_code='NT',
         etims_package_quantity=1,etims_quantity_unit_code='U',etims_tax_type_code='B',etims_sync_status='synced'
       WHERE id=$1 AND company_id=$2`,[itemId,ctx.companyId,`KE1MOVE${Date.now()}`]);
    const po=await procurement.createPurchaseOrder({companyId:ctx.companyId,userId:ctx.userId,vendorId,
      warehouseId:ctx.warehouseId,lines:[{item_id:itemId,quantity:3,unit_cost:40}]});
    await procurement.approvePurchaseOrder({companyId:ctx.companyId,userId:ctx.userId,poId:po.id});
    const poLine=await pool.query("SELECT id FROM erp_purchase_order_lines WHERE purchase_order_id=$1 LIMIT 1",[po.id]);
    const grn=await procurement.createAndPostGrn({companyId:ctx.companyId,userId:ctx.userId,purchaseOrderId:po.id,
      warehouseId:ctx.warehouseId,lines:[{po_line_id:poLine.rows[0].id,item_id:itemId,quantity:3,unit_cost:40}]});
    assert.equal(grn.ok,true);
    const event=await pool.query(
      `SELECT id,status,event_kind,source_type,source_id,idempotency_key,payload,last_error
       FROM erp_etims_event_submissions WHERE company_id=$1 AND event_kind='stock_movement'
         AND source_type='goods_receipt' AND source_id=$2`,[ctx.companyId,grn.grn_id]);
    assert.equal(event.rowCount,1);
    eventId=event.rows[0].id;
    assert.equal(event.rows[0].status,'pending',event.rows[0].last_error||JSON.stringify(event.rows[0].payload));
    assert.equal(event.rows[0].payload.sarTyCd,'02');
    const processed=await runEtimsEventBatch({adapter:mock,companyId:ctx.companyId,limit:10});
    assert.equal(processed.synced,1);
    const synced=await pool.query("SELECT status FROM erp_etims_event_submissions WHERE id=$1",[eventId]);
    assert.equal(synced.rows[0].status,'synced');
    await pool.query("UPDATE erp_etims_event_submissions SET status='failed',last_error='mock failure' WHERE id=$1",[eventId]);
    const exceptions=await integration.getEtimsExceptions({companyId:ctx.companyId});
    assert.ok(exceptions.some((row)=>row.id===eventId&&row.type==='etims_stock_movement'&&row.manually_retryable));
    const retry=await integration.retryEtimsEvent({companyId:ctx.companyId,eventId,userId:ctx.userId});
    assert.equal(retry.status,'pending');
    const retried=await runEtimsEventBatch({adapter:mock,companyId:ctx.companyId,limit:10});
    assert.equal(retried.synced,1);
  } finally {
    if(eventId) await pool.query("DELETE FROM erp_etims_event_submissions WHERE id=$1 AND company_id=$2",[eventId,ctx.companyId]);
    await pool.query(
      `UPDATE erp_items SET etims_item_classification_code=$3,etims_item_code=$4,etims_item_type_code=$5,
         etims_origin_country_code=$6,etims_packaging_unit_code=$7,etims_package_quantity=$8,
         etims_quantity_unit_code=$9,etims_tax_type_code=$10,etims_sync_status=$11,etims_synced_at=$12,
         etims_last_error=$13 WHERE id=$1 AND company_id=$2`,
      [itemId,ctx.companyId,originalItem.etims_item_classification_code,originalItem.etims_item_code,
        originalItem.etims_item_type_code,originalItem.etims_origin_country_code,originalItem.etims_packaging_unit_code,
        originalItem.etims_package_quantity,originalItem.etims_quantity_unit_code,originalItem.etims_tax_type_code,
        originalItem.etims_sync_status,originalItem.etims_synced_at,originalItem.etims_last_error]);
    await pool.query("DELETE FROM erp_etims_code_lists WHERE company_id=$1",[ctx.companyId]);
    await pool.query("DELETE FROM erp_etims_item_classifications WHERE company_id=$1",[ctx.companyId]);
    await pool.query("DELETE FROM erp_integration_settings WHERE company_id=$1 AND provider='etims'",[ctx.companyId]);
    for(const setting of settingsBefore.rows){
      await pool.query(`INSERT INTO erp_integration_settings
        (id,company_id,branch_id,provider,provider_mode,environment,public_config,secret_payload_encrypted,policy,updated_by,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12)`,
        [setting.id,setting.company_id,setting.branch_id,setting.provider,setting.provider_mode,setting.environment,
          JSON.stringify(setting.public_config),setting.secret_payload_encrypted,JSON.stringify(setting.policy),setting.updated_by,
          setting.created_at,setting.updated_at]);
    }
  }
});