const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, getItemId, pool } = require("./helpers");
const integrationSettings = require("../../src/services/integrationSettingsService");
const etimsItems = require("../../src/services/etimsItemService");
const { MockEtimsProvider } = require("../../src/services/etimsProvider");

test("E2E eTIMS item registration synchronizes KRA codes, dry-runs, queues and marks synced", async () => {
  const ctx = await getTestContext();
  const itemId = await getItemId(ctx.companyId, "COKE-500");
  const codeClasses = [
    ["ProductType", [{ cd: "2", cdNm: "Finished product", useYn: "Y" }]],
    ["Nation", [{ cd: "KE", cdNm: "Kenya", useYn: "Y" }]],
    ["PackagingUnit", [{ cd: "NT", cdNm: "Net", useYn: "Y" }]],
    ["Unit of Quantity", [{ cd: "U", cdNm: "Unit", useYn: "Y" }]],
    ["TaxationType", [{ cd: "B", cdNm: "B-16.00%", useYn: "Y" }]],
  ].map(([cdClsNm, dtlList], index) => ({ cdCls: String(index + 1).padStart(2, "0"), cdClsNm, dtlList }));
  const itemClassCode = "5059690800";
  const etimsItemCode = `KE1E2E${Date.now()}`;
  const previous = await pool.query("SELECT * FROM erp_items WHERE id=$1 AND company_id=$2", [itemId, ctx.companyId]);
  const previousSettings = await pool.query("SELECT * FROM erp_integration_settings WHERE company_id=$1 AND provider='etims'", [ctx.companyId]);
  try {
    await integrationSettings.saveIntegrationSettings({
      companyId: ctx.companyId,
      userId: ctx.userId,
      provider: "etims",
      providerMode: "mock",
      environment: "sandbox",
      publicConfig: { bhfId: "00", sdcId: "MOCK-CU" },
      secrets: { tin: "A123456789Z", communicationKey: "mock-key", deviceSerial: "device-e2e" },
      policy: {},
    });
    const refresh = await etimsItems.refreshEtimsReferenceData({
      companyId: ctx.companyId,
      provider: {
        selectCodeList: async () => ({ resultCd: "000", data: { clsList: codeClasses } }),
        selectItemClassList: async () => ({ resultCd: "000", data: { itemClsList: [
          { itemClsCd: itemClassCode, itemClsNm: "Beverages", itemClsLvl: 5, taxTyCd: "B", useYn: "Y" },
        ] } }),
      },
    });
    assert.equal(refresh.code_count, 5);
    await pool.query(
      `UPDATE erp_items SET etims_item_classification_code=$3,etims_item_code=$4,
         etims_item_type_code='2',etims_origin_country_code='KE',etims_packaging_unit_code='NT',
         etims_package_quantity=1,etims_quantity_unit_code='U',etims_tax_type_code='B',
         etims_sync_status='unmapped',etims_last_error=NULL
       WHERE id=$1 AND company_id=$2`,
      [itemId, ctx.companyId, itemClassCode, etimsItemCode],
    );
    const preview = await etimsItems.enqueueEtimsItemRegistrations({
      companyId: ctx.companyId, userId: ctx.userId, itemIds: [itemId], dryRun: true,
    });
    assert.equal(preview.eligible, 1);
    assert.equal(preview.blocked, 0);
    const queued = await etimsItems.enqueueEtimsItemRegistrations({
      companyId: ctx.companyId, userId: ctx.userId, itemIds: [itemId],
    });
    assert.equal(queued.queued, 1);
    const provider = new MockEtimsProvider();
    const result = await etimsItems.runEtimsItemRegistrationBatch({
      companyId: ctx.companyId, provider, limit: 5,
    });
    assert.equal(result.synced, 1);
    const synced = await pool.query(
      `SELECT item.etims_sync_status,registration.status AS registration_status,
              registration.attempt_count,registration.payload
       FROM erp_items item JOIN erp_etims_item_registrations registration
         ON registration.item_id=item.id AND registration.company_id=item.company_id
       WHERE item.id=$1 AND item.company_id=$2`, [itemId, ctx.companyId],
    );
    assert.equal(synced.rows[0].etims_sync_status, "synced");
    assert.equal(synced.rows[0].registration_status, "synced");
    assert.equal(synced.rows[0].payload.itemCd, etimsItemCode);
  } finally {
    await pool.query("DELETE FROM erp_etims_item_registrations WHERE company_id=$1 AND item_id=$2", [ctx.companyId, itemId]);
    await pool.query("DELETE FROM erp_etims_code_lists WHERE company_id=$1", [ctx.companyId]);
    await pool.query("DELETE FROM erp_etims_item_classifications WHERE company_id=$1", [ctx.companyId]);
    await pool.query(
      `UPDATE erp_items SET etims_item_classification_code=$3,etims_item_code=$4,
         etims_item_type_code=$5,etims_origin_country_code=$6,etims_packaging_unit_code=$7,
         etims_package_quantity=$8,etims_quantity_unit_code=$9,etims_tax_type_code=$10,
         etims_sync_status=$11,etims_synced_at=$12,etims_last_error=$13
       WHERE id=$1 AND company_id=$2`,
      [itemId, ctx.companyId, previous.rows[0].etims_item_classification_code, previous.rows[0].etims_item_code,
        previous.rows[0].etims_item_type_code, previous.rows[0].etims_origin_country_code,
        previous.rows[0].etims_packaging_unit_code, previous.rows[0].etims_package_quantity,
        previous.rows[0].etims_quantity_unit_code, previous.rows[0].etims_tax_type_code,
        previous.rows[0].etims_sync_status, previous.rows[0].etims_synced_at, previous.rows[0].etims_last_error],
    );
    await pool.query("DELETE FROM erp_integration_settings WHERE company_id=$1 AND provider='etims'", [ctx.companyId]);
    for (const setting of previousSettings.rows) {
      await pool.query(
        `INSERT INTO erp_integration_settings
           (id,company_id,branch_id,provider,provider_mode,environment,public_config,secret_payload_encrypted,policy,
            updated_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12)`,
        [setting.id, setting.company_id, setting.branch_id, setting.provider, setting.provider_mode,
          setting.environment, JSON.stringify(setting.public_config), setting.secret_payload_encrypted,
          JSON.stringify(setting.policy), setting.updated_by, setting.created_at, setting.updated_at],
      );
    }
  }
});