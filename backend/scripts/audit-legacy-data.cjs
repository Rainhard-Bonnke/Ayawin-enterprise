require("dotenv").config();

const pool = require("../src/db");

const LEGACY_TABLES = [
  "roles", "users", "categories", "products", "warehouses", "customers", "suppliers",
  "stock_movements", "sales_orders", "sales_order_items", "invoices", "invoice_items",
  "payments", "purchase_orders", "purchase_order_items", "grns", "deliveries",
  "employees", "payroll", "accounts", "journal_entries", "taxes", "audit_logs",
];

async function auditLegacyData() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const database = (await client.query("SELECT current_database() AS name")).rows[0].name;
    const present = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [LEGACY_TABLES],
    );
    const counts = [];
    for (const { table_name: table } of present.rows) {
      const count = await client.query(`SELECT COUNT(*)::bigint AS rows FROM public."${table}"`);
      counts.push({ table, rows: Number(count.rows[0].rows) });
    }

    const summary = {};
    const legacyPresent = new Set(present.rows.map((row) => row.table_name));
    const companyResult = await client.query(
      "SELECT id FROM erp_companies WHERE code = $1 AND is_deleted = FALSE LIMIT 1",
      ["MARTIN"],
    );
    const companyId = companyResult.rows[0]?.id || null;

    if (companyId && LEGACY_TABLES.every((table) => legacyPresent.has(table))) {
      summary.customerBalances = (await client.query(
        "SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(balance), 0) AS balance_total FROM customers",
      )).rows[0];
      summary.supplierBalances = (await client.query(
        "SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(balance), 0) AS balance_total FROM suppliers",
      )).rows[0];
      summary.legacyStockMovements = (await client.query(
        `SELECT movement_type, COUNT(*)::bigint AS rows, COALESCE(SUM(quantity), 0) AS quantity_total
         FROM stock_movements GROUP BY movement_type ORDER BY movement_type`,
      )).rows;
      summary.salesOrders = (await client.query(
        `SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(total_amount), 0) AS total_amount,
                COUNT(*) FILTER (WHERE NOT EXISTS (
                  SELECT 1 FROM sales_order_items line WHERE line.sales_order_id = so.id
                ))::bigint AS without_lines
         FROM sales_orders so`,
      )).rows[0];
      summary.invoices = (await client.query(
        `SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(total_amount), 0) AS total_amount,
                COUNT(*) FILTER (WHERE NOT EXISTS (
                  SELECT 1 FROM invoice_items line WHERE line.invoice_id = inv.id
                ))::bigint AS without_lines
         FROM invoices inv`,
      )).rows[0];
      summary.purchaseOrders = (await client.query(
        `SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(total_amount), 0) AS total_amount,
                COUNT(*) FILTER (WHERE NOT EXISTS (
                  SELECT 1 FROM purchase_order_items line WHERE line.purchase_order_id = po.id
                ))::bigint AS without_lines
         FROM purchase_orders po`,
      )).rows[0];
      summary.payroll = (await client.query(
        `SELECT COUNT(*)::bigint AS payslip_rows, COALESCE(SUM(gross_pay), 0) AS gross_total,
                COALESCE(SUM(net_pay), 0) AS net_total FROM payroll`,
      )).rows[0];
      summary.journalTotals = (await client.query(
        `SELECT COUNT(*)::bigint AS rows, COALESCE(SUM(debit), 0) AS debit_total,
                COALESCE(SUM(credit), 0) AS credit_total FROM journal_entries`,
      )).rows[0];
      summary.legacyToErpMatches = (await client.query(
        `SELECT
           (SELECT COUNT(*) FROM customers l JOIN erp_customers e
             ON e.company_id = $1 AND LOWER(TRIM(e.name)) = LOWER(TRIM(l.name)) AND e.is_deleted = FALSE) AS customer_names,
           (SELECT COUNT(*) FROM suppliers l JOIN erp_vendors e
             ON e.company_id = $1 AND LOWER(TRIM(e.name)) = LOWER(TRIM(l.name)) AND e.is_deleted = FALSE) AS supplier_names,
           (SELECT COUNT(*) FROM products l JOIN erp_items e
             ON e.company_id = $1 AND (LOWER(TRIM(e.name)) = LOWER(TRIM(l.name)) OR e.item_code = l.sku)
             AND e.is_deleted = FALSE) AS product_keys,
           (SELECT COUNT(*) FROM sales_orders l JOIN erp_sales_orders e
             ON e.company_id = $1 AND e.order_no = l.order_number AND e.is_deleted = FALSE) AS sales_order_numbers,
           (SELECT COUNT(*) FROM invoices l JOIN erp_customer_invoices e
             ON e.company_id = $1 AND e.invoice_no = l.invoice_number AND e.is_deleted = FALSE) AS invoice_numbers,
           (SELECT COUNT(*) FROM purchase_orders l JOIN erp_purchase_orders e
             ON e.company_id = $1 AND e.po_number = l.po_number AND e.is_deleted = FALSE) AS purchase_order_numbers`,
        [companyId],
      )).rows[0];
      summary.matchedDocumentAmountDeltas = (await client.query(
        `SELECT
           (SELECT COALESCE(SUM(ABS(l.total_amount - e.total_amount)), 0)
              FROM sales_orders l JOIN erp_sales_orders e
                ON e.company_id = $1 AND e.order_no = l.order_number AND e.is_deleted = FALSE) AS sales_orders,
           (SELECT COALESCE(SUM(ABS(l.total_amount - e.total_amount)), 0)
              FROM purchase_orders l JOIN erp_purchase_orders e
                ON e.company_id = $1 AND e.po_number = l.po_number AND e.is_deleted = FALSE) AS purchase_orders`,
        [companyId],
      )).rows[0];
      summary.erpStockOnHand = (await client.query(
        `SELECT COUNT(*)::bigint AS rows,
                COUNT(*) FILTER (WHERE quantity < 0)::bigint AS negative_rows,
                COALESCE(SUM(quantity), 0) AS quantity_total,
                COALESCE(SUM(quantity * avg_unit_cost), 0) AS value_total
         FROM erp_stock_on_hand WHERE company_id = $1 AND is_deleted = FALSE`,
        [companyId],
      )).rows[0];
    }

    await client.query("COMMIT");
    return {
      database,
      mode: "read-only",
      legacyTablesPresent: present.rows.length,
      legacyTableCounts: counts,
      erpCompanyFound: Boolean(companyId),
      reconciliationSummary: summary,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  auditLegacyData()
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error("Legacy data audit failed", error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { auditLegacyData };