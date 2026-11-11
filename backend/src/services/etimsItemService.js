const pool = require("../db");
const { getEtimsProvider } = require("./etimsProvider");

const CODE_CLASS_ALIASES = Object.freeze([
  ["tax_type", /taxation.?type|tax.?type/i],
  ["payment_type", /payment.?method/i],
  ["credit_note_reason", /credit.?note.?reason/i],
  ["registration_type", /registration.?type/i],
  ["transaction_type", /transaction.?type/i],
  ["purchase_receipt_type", /purchase.?receipt.?type/i],
  ["transaction_progress", /transaction.?progress/i],
  ["stock_movement", /stock.?movement.?type|stock.?in.?out/i],
  ["country", /nation|country/i],
  ["packaging_unit", /packaging.?unit/i],
  ["quantity_unit", /unit.?of.?quantity|quantity.?unit/i],
  ["product_type", /product.?type/i],
]);

function normalizedCode(value) {
  return String(value || "").trim();
}

function normalizeCodeClassName(value) {
  const name = normalizedCode(value).replace(/[^a-z]/gi, "");
  return CODE_CLASS_ALIASES.find(([, pattern]) => pattern.test(name))?.[0] || normalizedCode(value);
}

function validateItemForEtims(item, { codeLists, classifications }) {
  const errors = [];
  const classCode = normalizedCode(item.etims_item_classification_code);
  const itemCode = normalizedCode(item.etims_item_code);
  if (!classCode || !itemCode) errors.push("KRA item classification and item code are required");
  const classification = classifications.get(classCode);
  if (!classification?.is_active) errors.push("KRA item classification is missing or inactive in the latest synced list");
  const checks = [
    ["item_type_code", item.etims_item_type_code, "product_type", "item type"],
    ["origin_country_code", item.etims_origin_country_code, "country", "origin country"],
    ["packaging_unit_code", item.etims_packaging_unit_code, "packaging_unit", "packaging unit"],
    ["quantity_unit_code", item.etims_quantity_unit_code, "quantity_unit", "quantity unit"],
    ["tax_type_code", item.etims_tax_type_code, "tax_type", "tax type"],
  ];
  for (const [, value, codeClass, label] of checks) {
    const code = normalizedCode(value);
    if (!code) {
      errors.push(`${label} code is required`);
    } else if (!codeLists.has(`${codeClass}:${code}`)) {
      errors.push(`${label} code ${code} is not active in the latest synced list`);
    }
  }
  if (classification?.tax_type_code && normalizedCode(item.etims_tax_type_code)
    && classification.tax_type_code !== item.etims_tax_type_code) {
    errors.push(`Tax type ${item.etims_tax_type_code} conflicts with KRA classification tax type ${classification.tax_type_code}`);
  }
  if (!Number.isFinite(Number(item.etims_package_quantity)) || Number(item.etims_package_quantity) <= 0) {
    errors.push("Package quantity must be greater than zero");
  }
  return errors;
}

async function loadReferenceData(companyId) {
  const [codes, classes] = await Promise.all([
    pool.query(
      `SELECT code_class,code,is_active,synced_at FROM erp_etims_code_lists WHERE company_id=$1`,
      [companyId],
    ),
    pool.query(
      `SELECT item_class_code,tax_type_code,is_active,synced_at
       FROM erp_etims_item_classifications WHERE company_id=$1`,
      [companyId],
    ),
  ]);
  return {
    codeLists: new Map(codes.rows.map((row) => [`${row.code_class}:${row.code}`, row])),
    classifications: new Map(classes.rows.map((row) => [row.item_class_code, row])),
  };
}

async function refreshEtimsReferenceData({ companyId, branchId = null, provider = null, lastReqDt = null }) {
  const adapter = provider || await getEtimsProvider({ companyId, branchId });
  if (typeof adapter.selectCodeList !== "function" || typeof adapter.selectItemClassList !== "function") {
    throw new Error("Configured eTIMS provider does not support reference-code synchronization");
  }
  const since = lastReqDt || new Date(0).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const [codeResponse, classResponse] = await Promise.all([
    adapter.selectCodeList({ lastReqDt: since }),
    adapter.selectItemClassList({ lastReqDt: since }),
  ]);
  const codeClasses = codeResponse?.data?.clsList;
  const itemClasses = classResponse?.data?.itemClsList;
  if (!Array.isArray(codeClasses) || !Array.isArray(itemClasses)) {
    throw new Error("KRA code-list response is missing clsList or itemClsList");
  }
  const syncedAt = new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const codeClass of codeClasses) {
      const codeClassId = normalizeCodeClassName(codeClass.cdClsNm);
      if (!codeClassId) continue;
      for (const code of codeClass.dtlList || []) {
        if (!code.cd) continue;
        await client.query(
          `INSERT INTO erp_etims_code_lists
             (company_id,code_class,code,code_name,code_description,sort_order,user_defined_code_1,
              user_defined_code_2,user_defined_code_3,is_active,synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (company_id,code_class,code) DO UPDATE SET
             code_name=EXCLUDED.code_name,code_description=EXCLUDED.code_description,
             sort_order=EXCLUDED.sort_order,user_defined_code_1=EXCLUDED.user_defined_code_1,
             user_defined_code_2=EXCLUDED.user_defined_code_2,user_defined_code_3=EXCLUDED.user_defined_code_3,
             is_active=EXCLUDED.is_active,synced_at=EXCLUDED.synced_at`,
          [companyId, codeClassId, normalizedCode(code.cd), code.cdNm || null, code.cdDesc || null,
            code.srtOrd == null ? null : Number(code.srtOrd), code.userDfnCd1 || null, code.userDfnCd2 || null,
            code.userDfnCd3 || null, code.useYn === "Y", syncedAt],
        );
      }
      await client.query(
        `UPDATE erp_etims_code_lists SET is_active=FALSE,synced_at=$3
         WHERE company_id=$1 AND code_class=$2 AND synced_at < $3`,
        [companyId, codeClassId, syncedAt],
      );
    }
    for (const itemClass of itemClasses) {
      if (!itemClass.itemClsCd) continue;
      await client.query(
        `INSERT INTO erp_etims_item_classifications
           (company_id,item_class_code,item_class_name,item_class_level,tax_type_code,major_target,is_active,synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (company_id,item_class_code) DO UPDATE SET
           item_class_name=EXCLUDED.item_class_name,item_class_level=EXCLUDED.item_class_level,
           tax_type_code=EXCLUDED.tax_type_code,major_target=EXCLUDED.major_target,
           is_active=EXCLUDED.is_active,synced_at=EXCLUDED.synced_at`,
        [companyId, normalizedCode(itemClass.itemClsCd), String(itemClass.itemClsNm || "").slice(0, 200),
          itemClass.itemClsLvl == null ? null : Number(itemClass.itemClsLvl), itemClass.taxTyCd || null,
          itemClass.mjrTgYn === "Y", itemClass.useYn === "Y", syncedAt],
      );
    }
    await client.query(
      `UPDATE erp_etims_item_classifications SET is_active=FALSE,synced_at=$2
       WHERE company_id=$1 AND synced_at < $2`,
      [companyId, syncedAt],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  return { synced_at: syncedAt.toISOString(), code_class_count: codeClasses.length,
    code_count: codeClasses.reduce((total, entry) => total + (entry.dtlList || []).length, 0),
    item_class_count: itemClasses.length };
}

async function buildItemRegistrationPayload({ item, config }) {
  const name = String(item.name || "").trim();
  const payload = {
    itemCd: normalizedCode(item.etims_item_code),
    itemClsCd: normalizedCode(item.etims_item_classification_code),
    itemTyCd: normalizedCode(item.etims_item_type_code),
    itemNm: name.slice(0, 200),
    itemStdNm: null,
    orgnNatCd: normalizedCode(item.etims_origin_country_code),
    pkgUnitCd: normalizedCode(item.etims_packaging_unit_code),
    qtyUnitCd: normalizedCode(item.etims_quantity_unit_code),
    taxTyCd: normalizedCode(item.etims_tax_type_code),
    btchNo: null,
    bcd: item.barcode || null,
    dftPrc: Number(item.default_sale_price || 0),
    grpPrcL1: null, grpPrcL2: null, grpPrcL3: null, grpPrcL4: null, grpPrcL5: null,
    addInfo: null,
    sftyQty: Number(item.reorder_point || 0),
    isrcAplcbYn: "N",
    useYn: item.is_active ? "Y" : "N",
    regrId: "AYAWIN-ERP",
    regrNm: "Ayawin ERP",
    modrId: "AYAWIN-ERP",
    modrNm: "Ayawin ERP",
  };
  return payload;
}

async function listEtimsItems({ companyId, itemIds = null }) {
  const result = await pool.query(
    `SELECT item.id,item.item_code,item.name,item.description,item.barcode,item.is_active,item.is_saleable,
            item.is_stock_item,item.reorder_point,item.etims_item_classification_code,item.etims_item_code,
            item.etims_item_type_code,item.etims_origin_country_code,item.etims_packaging_unit_code,
            item.etims_package_quantity,item.etims_quantity_unit_code,item.etims_tax_type_code,
            item.etims_sync_status,item.etims_synced_at,item.etims_last_error,
            price.unit_price AS default_sale_price
     FROM erp_items item
     LEFT JOIN LATERAL (
       SELECT unit_price FROM erp_price_list_items WHERE company_id=item.company_id AND item_id=item.id
         AND is_deleted=FALSE ORDER BY min_qty ASC LIMIT 1
     ) price ON TRUE
     WHERE item.company_id=$1 AND item.is_deleted=FALSE AND item.is_active=TRUE AND item.is_saleable=TRUE
       AND ($2::uuid[] IS NULL OR item.id=ANY($2::uuid[]))
     ORDER BY item.item_code`,
    [companyId, itemIds],
  );
  return result.rows;
}

async function previewEtimsItemRegistration({ companyId, itemIds = null }) {
  const items = await listEtimsItems({ companyId, itemIds });
  const references = await loadReferenceData(companyId);
  return items.map((item) => {
    const errors = validateItemForEtims(item, references);
    return { item_id: item.id, item_code: item.item_code, item_name: item.name,
      current_status: item.etims_sync_status, eligible: errors.length === 0, errors };
  });
}

async function enqueueEtimsItemRegistrations({ companyId, userId, itemIds = null, dryRun = false }) {
  const report = await previewEtimsItemRegistration({ companyId, itemIds });
  if (dryRun) return { dry_run: true, eligible: report.filter((item) => item.eligible).length,
    blocked: report.filter((item) => !item.eligible).length, items: report };
  const eligible = report.filter((item) => item.eligible);
  const client = await pool.connect();
  let queued = 0;
  try {
    await client.query("BEGIN");
    const config = await require("./integrationSettingsService").getProviderRuntimeConfig({ companyId, provider: "etims" });
    if (config.provider_mode === "disabled" || !config.secrets.tin || !config.secrets.communicationKey || !config.public_config.bhfId) {
      throw new Error("Configure and initialize the eTIMS provider before registering items");
    }
    for (const entry of eligible) {
      const item = (await listEtimsItems({ companyId, itemIds: [entry.item_id] }))[0];
      const payload = await buildItemRegistrationPayload({ item, config });
      const idempotencyKey = `etims-item:${companyId}:${item.id}`;
      await client.query(
        `INSERT INTO erp_etims_item_registrations (company_id,item_id,idempotency_key,status,payload,created_by)
         VALUES ($1,$2,$3,'pending',$4::jsonb,$5)
         ON CONFLICT (company_id,item_id) DO UPDATE SET
           idempotency_key=EXCLUDED.idempotency_key,status='pending',payload=EXCLUDED.payload,
           next_attempt_at=NOW(),last_error=NULL,updated_at=NOW()
         WHERE erp_etims_item_registrations.status <> 'synced'`,
        [companyId, item.id, idempotencyKey, JSON.stringify(payload), userId],
      );
      await client.query(
        `UPDATE erp_items SET etims_sync_status='pending',etims_last_error=NULL,updated_by=$3,updated_at=NOW()
         WHERE id=$1 AND company_id=$2`, [item.id, companyId, userId],
      );
      queued += 1;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  return { dry_run: false, queued, blocked: report.filter((item) => !item.eligible).length, items: report };
}

async function runEtimsItemRegistrationBatch({ companyId = null, provider = null, limit = 20 } = {}) {
  const adapter = provider || (companyId ? await getEtimsProvider({ companyId }) : null);
  if (!adapter || typeof adapter.saveItem !== "function") return { configured: false, processed: 0, synced: 0, retrying: 0, failed: 0 };
  const client = await pool.connect();
  let jobs;
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `WITH due AS (
         SELECT id FROM erp_etims_item_registrations WHERE status IN ('pending')
           AND next_attempt_at <= NOW() AND ($2::uuid IS NULL OR company_id=$2)
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
       ) UPDATE erp_etims_item_registrations registration
         SET status='processing',attempt_count=attempt_count+1,updated_at=NOW()
         FROM due WHERE registration.id=due.id RETURNING registration.*`,
      [Math.max(1, Math.min(100, Number(limit) || 20)), companyId],
    );
    jobs = claimed.rows;
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  const summary = { configured: true, processed: jobs.length, synced: 0, retrying: 0, failed: 0 };
  for (const job of jobs) {
    try {
      const response = await adapter.saveItem({ companyId: job.company_id, payload: job.payload, idempotencyKey: job.idempotency_key });
      if (response?.accepted !== true) throw new Error(response?.message || "KRA did not confirm item registration");
      await pool.query(
        `UPDATE erp_etims_item_registrations SET status='synced',response_payload=$3::jsonb,last_error=NULL,updated_at=NOW()
         WHERE id=$1 AND company_id=$2 AND status='processing'`, [job.id, job.company_id, JSON.stringify(response)],
      );
      await pool.query(
        `UPDATE erp_items SET etims_sync_status='synced',etims_synced_at=NOW(),etims_last_error=NULL,updated_at=NOW()
         WHERE id=$1 AND company_id=$2`, [job.item_id, job.company_id],
      );
      summary.synced += 1;
    } catch (error) {
      const terminal = job.attempt_count >= 8;
      await pool.query(
        `UPDATE erp_etims_item_registrations SET status=$3,last_error=$4,
           next_attempt_at=CASE WHEN $5::int IS NULL THEN next_attempt_at ELSE NOW()+($5::int*INTERVAL '1 second') END,
           updated_at=NOW() WHERE id=$1 AND company_id=$2`,
        [job.id, job.company_id, terminal ? "failed" : "pending", String(error.message || "Item registration failed").slice(0,2000),
          terminal ? null : Math.min(60 * (2 ** (job.attempt_count - 1)), 86400)],
      );
      await pool.query(
        `UPDATE erp_items SET etims_sync_status=$3,etims_last_error=$4,updated_at=NOW()
         WHERE id=$1 AND company_id=$2`,
        [job.item_id, job.company_id, terminal ? "failed" : "pending", String(error.message || "Item registration failed").slice(0,2000)],
      );
      summary[terminal ? "failed" : "retrying"] += 1;
    }
  }
  return summary;
}

async function listEtimsReferenceSyncStatus({ companyId }) {
  const result = await pool.query(
    `SELECT 'code_list'::text AS type,code_class AS code,
            MAX(synced_at) AS last_synced_at,COUNT(*)::int AS row_count
     FROM erp_etims_code_lists WHERE company_id=$1 GROUP BY code_class
     UNION ALL
     SELECT 'item_classification',NULL,MAX(synced_at),COUNT(*)::int
     FROM erp_etims_item_classifications WHERE company_id=$1`, [companyId],
  );
  return result.rows;
}

module.exports = {
  enqueueEtimsItemRegistrations,
  listEtimsReferenceSyncStatus,
  normalizeCodeClassName,
  previewEtimsItemRegistration,
  refreshEtimsReferenceData,
  runEtimsItemRegistrationBatch,
  validateItemForEtims,
};