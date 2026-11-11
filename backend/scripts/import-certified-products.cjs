require("dotenv").config();

const path = require("path");
const xlsx = require("xlsx");
const pool = require("../src/db");

const EXPECTED_HEADERS = [
  "SKU_ID",
  "Category",
  "Brand_Name",
  "Package_Size",
  "Volume_ml",
  "Retail_Price_KES",
  "Country_of_Origin",
  "Product_Type",
  "Packaging_Tier",
  "Stock_Status",
];
const SOURCE_FILE = path.resolve(
  __dirname,
  "..",
  "..",
  "public",
  "Kenya_Master_Drinks_Liquor_Database_1000Plus.xlsx",
);
const CATALOG_SOURCE = path.basename(SOURCE_FILE);
const COMPANY_CODE = process.env.CERTIFIED_CATALOG_COMPANY_CODE || "MARTIN";
const RETAIL_LIST_CODE = "CERTIFIED-RETAIL-KES";

function categoryCode(category) {
  return `CAT-${category.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function readProducts(filePath = SOURCE_FILE) {
  const workbook = xlsx.readFile(filePath, { raw: true });
  const sheet = workbook.Sheets["Master Catalogue"];
  if (!sheet) throw new Error('Workbook must contain a "Master Catalogue" sheet');

  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null, raw: true });
  if (!rows.length) throw new Error("The product workbook is empty");
  const headers = Object.keys(rows[0]);
  if (EXPECTED_HEADERS.some((header) => !headers.includes(header))) {
    throw new Error(`Workbook is missing required columns: ${EXPECTED_HEADERS.filter((header) => !headers.includes(header)).join(", ")}`);
  }

  const seenSkus = new Set();
  const products = rows.map((row, index) => {
    const sku = String(row.SKU_ID ?? "").trim();
    const name = String(row.Brand_Name ?? "").trim();
    const category = String(row.Category ?? "").trim();
    const packageSize = String(row.Package_Size ?? "").trim();
    const country = String(row.Country_of_Origin ?? "").trim();
    const productType = String(row.Product_Type ?? "").trim();
    const packagingTier = String(row.Packaging_Tier ?? "").trim();
    const stockStatus = String(row.Stock_Status ?? "").trim();
    const volumeMl = Number(row.Volume_ml);
    const retailPrice = Number(row.Retail_Price_KES);

    if (!sku || !name || !category || !packageSize || !country || !productType || !packagingTier || !stockStatus) {
      throw new Error(`Row ${index + 2} is missing a required product field`);
    }
    if (seenSkus.has(sku)) throw new Error(`Duplicate SKU_ID at row ${index + 2}: ${sku}`);
    seenSkus.add(sku);
    if (!Number.isFinite(volumeMl) || volumeMl <= 0) throw new Error(`Invalid Volume_ml at row ${index + 2}`);
    if (!Number.isFinite(retailPrice) || retailPrice <= 0) throw new Error(`Invalid Retail_Price_KES at row ${index + 2}`);
    if (stockStatus.toLowerCase() !== "in stock") {
      throw new Error(`Unexpected Stock_Status at row ${index + 2}: ${stockStatus}`);
    }

    return {
      item_code: sku,
      name,
      brand: name,
      category_code: categoryCode(category),
      category_name: category,
      package_size: packageSize,
      volume_ml: volumeMl,
      litres_per_unit: volumeMl / 1000,
      retail_price: retailPrice,
      country_of_origin: country,
      product_type: productType,
      packaging_tier: packagingTier,
      source_stock_status: stockStatus,
    };
  });

  return { products, categories: [...new Map(products.map((p) => [p.category_code, p.category_name]))] };
}

async function findBlockingItemReferences(client, companyId) {
  const constraints = await client.query(
    `SELECT DISTINCT c.conrelid::regclass::text AS table_name,
            a.attname AS column_name
     FROM pg_constraint c
     CROSS JOIN LATERAL unnest(c.conkey) AS k(attnum)
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f' AND c.confrelid = 'public.erp_items'::regclass
       AND c.conrelid <> 'public.erp_price_list_items'::regclass
     ORDER BY 1, 2`,
  );
  const blockers = [];

  for (const { table_name: table, column_name: column } of constraints.rows) {
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS count
       FROM ${table} reference_row
       JOIN erp_items item ON item.id = reference_row.${column}
       WHERE item.company_id = $1`,
      [companyId],
    );
    if (Number(result.rows[0].count) > 0) {
      blockers.push({ table, column, rows: Number(result.rows[0].count) });
    }
  }

  return blockers;
}

async function importCertifiedProducts({ dryRun = false, confirm = false } = {}) {
  const { products, categories } = readProducts();
  if (!dryRun && !confirm) {
    throw new Error("Catalog replacement requires --confirm-replace-catalog");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`certified_catalog:${COMPANY_CODE}`]);
    const companyResult = await client.query(
      "SELECT id FROM erp_companies WHERE code = $1 AND is_deleted = FALSE ORDER BY created_at LIMIT 1",
      [COMPANY_CODE],
    );
    if (!companyResult.rowCount) throw new Error(`ERP company ${COMPANY_CODE} was not found`);
    const companyId = companyResult.rows[0].id;
    const eachUom = await client.query(
      "SELECT id FROM erp_uom WHERE company_id=$1 AND code='EA' AND is_deleted=FALSE LIMIT 1",
      [companyId],
    );
    if (!eachUom.rowCount) throw new Error("ERP EA unit of measure must exist before import");

    const existing = await client.query(
      "SELECT COUNT(*)::int AS count FROM erp_items WHERE company_id=$1 AND is_deleted=FALSE",
      [companyId],
    );
    const blockers = await findBlockingItemReferences(client, companyId);
    if (blockers.length) {
      throw new Error(`Cannot replace product catalog while products have transaction references: ${JSON.stringify(blockers)}`);
    }

    if (dryRun) {
      await client.query("ROLLBACK");
      return {
        dryRun: true,
        companyCode: COMPANY_CODE,
        source: CATALOG_SOURCE,
        sourceRows: products.length,
        categories: categories.length,
        currentActiveItems: existing.rows[0].count,
        blockingReferences: blockers,
        retailPriceRowsExpected: products.length,
      };
    }

    for (const [code, name] of categories) {
      await client.query(
        `INSERT INTO erp_item_categories (company_id, code, name, is_active, is_deleted)
         VALUES ($1,$2,$3,TRUE,FALSE)
         ON CONFLICT (company_id, code) DO UPDATE SET
           name=EXCLUDED.name,is_active=TRUE,is_deleted=FALSE,updated_at=NOW()`,
        [companyId, code, name],
      );
    }

    await client.query(
      `DELETE FROM erp_price_list_items
       WHERE company_id=$1 AND item_id IN (SELECT id FROM erp_items WHERE company_id=$1)`,
      [companyId],
    );
    await client.query("DELETE FROM erp_items WHERE company_id=$1", [companyId]);
    await client.query(
      `UPDATE erp_price_lists
       SET is_default=FALSE,is_active=FALSE,is_deleted=TRUE,updated_at=NOW()
       WHERE company_id=$1`,
      [companyId],
    );
    const priceList = await client.query(
      `INSERT INTO erp_price_lists (company_id,code,name,currency_code,effective_from,is_default,is_active,is_deleted)
       VALUES ($1,$2,$3,'KES',CURRENT_DATE,TRUE,TRUE,FALSE)
       ON CONFLICT (company_id,code) DO UPDATE SET
         name=EXCLUDED.name,currency_code=EXCLUDED.currency_code,effective_from=EXCLUDED.effective_from,
         is_default=TRUE,is_active=TRUE,is_deleted=FALSE,updated_at=NOW()
       RETURNING id`,
      [companyId, RETAIL_LIST_CODE, "Certified Catalog Retail Prices (KES)"],
    );
    const priceListId = priceList.rows[0].id;

    await client.query(
      `INSERT INTO erp_items (
         company_id,category_id,tax_group_id,uom_id,item_code,name,brand,
         pack_size,litres_per_unit,country_of_origin,product_type,packaging_tier,
         source_stock_status,catalog_source,is_catalog_certified,standard_cost,
         reorder_point,is_stock_item,is_purchasable,is_saleable,is_active,is_deleted
       )
      SELECT $1,category.id,NULL,$2,source.item_code,source.name,source.brand,
              source.package_size,source.litres_per_unit,source.country_of_origin,
              source.product_type,source.packaging_tier,source.source_stock_status,
              $4,TRUE,0,0,TRUE,TRUE,TRUE,TRUE,FALSE
            FROM jsonb_to_recordset($3::jsonb) AS source(
         item_code TEXT,name TEXT,brand TEXT,category_code TEXT,package_size TEXT,
         litres_per_unit NUMERIC,country_of_origin TEXT,product_type TEXT,
         packaging_tier TEXT,source_stock_status TEXT
       )
       JOIN erp_item_categories category
         ON category.company_id=$1 AND category.code=source.category_code AND category.is_deleted=FALSE`,
      [companyId, eachUom.rows[0].id, JSON.stringify(products), CATALOG_SOURCE],
    );
    await client.query(
      `INSERT INTO erp_price_list_items (company_id,price_list_id,item_id,unit_price,min_qty)
       SELECT $1,$2,item.id,source.retail_price,1
       FROM jsonb_to_recordset($3::jsonb) AS source(item_code TEXT,retail_price NUMERIC)
       JOIN erp_items item ON item.company_id=$1 AND item.item_code=source.item_code`,
      [companyId, priceListId, JSON.stringify(products)],
    );

    const verification = await client.query(
      `SELECT COUNT(*)::int AS items,
              COUNT(*) FILTER (WHERE is_catalog_certified=TRUE AND catalog_source=$2)::int AS certified_items,
              COUNT(*) FILTER (WHERE country_of_origin IS NULL OR product_type IS NULL OR packaging_tier IS NULL)::int AS incomplete
       FROM erp_items WHERE company_id=$1 AND is_deleted=FALSE`,
      [companyId, CATALOG_SOURCE],
    );
    const prices = await client.query(
      `SELECT COUNT(*)::int AS count,COALESCE(SUM(unit_price),0) AS total
       FROM erp_price_list_items WHERE company_id=$1 AND price_list_id=$2 AND is_deleted=FALSE`,
      [companyId, priceListId],
    );
    if (verification.rows[0].items !== products.length
        || verification.rows[0].certified_items !== products.length
        || verification.rows[0].incomplete !== 0
        || prices.rows[0].count !== products.length) {
      throw new Error(`Post-import validation failed: ${JSON.stringify({ items: verification.rows[0], prices: prices.rows[0] })}`);
    }

    await client.query("COMMIT");
    return {
      dryRun: false,
      companyCode: COMPANY_CODE,
      source: CATALOG_SOURCE,
      replacedItems: existing.rows[0].count,
      importedItems: verification.rows[0].items,
      certifiedItems: verification.rows[0].certified_items,
      categories: categories.length,
      retailPriceRows: prices.rows[0].count,
      retailPriceTotalKes: Number(prices.rows[0].total),
      costAndStockImported: false,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  importCertifiedProducts({
    dryRun: args.has("--dry-run"),
    confirm: args.has("--confirm-replace-catalog"),
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error("Certified product import failed", error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { importCertifiedProducts, readProducts, categoryCode };