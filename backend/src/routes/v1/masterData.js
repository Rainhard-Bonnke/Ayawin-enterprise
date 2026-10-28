const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission, getClientIp } = require("../../middleware/erpAuth");
const { logAudit } = require("../../services/auditService");
const { parsePagination, parseSort } = require("../../lib/queryHelper");

const router = express.Router();
router.use(authenticateErp);

function createCrud(config) {
  const {
    table,
    permissionModule = "master_data",
    codeField,
    searchFields = ["name"],
    sortFields = ["name", "created_at"],
    defaultSort = "name",
    maxLimit = 200,
  } = config;

  const r = express.Router();

  r.get("/", requirePermission(`${permissionModule}.view`), async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const { page, limit, offset } = parsePagination(req.query, maxLimit);
    const { sort, order } = parseSort(req.query, sortFields, defaultSort);

    try {
      let countSql = `SELECT COUNT(*)::int AS total FROM ${table} WHERE company_id = $1 AND is_deleted = FALSE`;
      let listSql = `SELECT * FROM ${table} WHERE company_id = $1 AND is_deleted = FALSE`;
      const params = [req.user.company_id];

      if (q) {
        const likeParams = searchFields.map((f) => {
          params.push(`%${q}%`);
          return `${f} ILIKE $${params.length}`;
        });
        const clause = ` AND (${likeParams.join(" OR ")})`;
        countSql += clause;
        listSql += clause;
      }

      params.push(limit, offset);
      listSql += ` ORDER BY ${sort} ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;

      const [countResult, result] = await Promise.all([
        pool.query(countSql, params.slice(0, q ? 1 + searchFields.length : 1)),
        pool.query(listSql, params),
      ]);

      return res.json({
        data: result.rows,
        pagination: { page, limit, total: countResult.rows[0].total },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
  });

  r.get("/:id", requirePermission(`${permissionModule}.view`), async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM ${table} WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Not found" });
    return res.json(result.rows[0]);
  });

  r.post("/", requirePermission(`${permissionModule}.create`), async (req, res) => {
    const body = req.body || {};
    if (table === "erp_items") {
      if (!body.tax_group_id) {
        const defaultGroup = await pool.query(
          `SELECT id FROM erp_tax_groups
           WHERE company_id = $1 AND code = 'STD-VAT' AND is_active = TRUE AND is_deleted = FALSE`,
          [req.user.company_id],
        );
        if (!defaultGroup.rowCount) return res.status(400).json({ error: "Create an active Standard VAT tax group before adding saleable items" });
        body.tax_group_id = defaultGroup.rows[0].id;
      }
      const group = await pool.query(
        `SELECT 1 FROM erp_tax_groups
         WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
        [body.tax_group_id, req.user.company_id],
      );
      if (!group.rowCount) return res.status(400).json({ error: "Select an active tax group from this company" });
    }
    const keys = Object.keys(body).filter((k) => body[k] !== undefined && k !== "id");
    if (!keys.length) return res.status(400).json({ error: "No fields provided" });
    if (codeField && !body[codeField]) {
      return res.status(400).json({ error: `${codeField} is required` });
    }

    const cols = ["company_id", ...keys, "created_by"];
    const vals = [req.user.company_id, ...keys.map((k) => body[k]), req.user.id];
    const placeholders = vals.map((_, i) => `$${i + 1}`);

    try {
      const result = await pool.query(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        vals,
      );
      await logAudit({
        companyId: req.user.company_id,
        userId: req.user.id,
        entityType: table,
        entityId: result.rows[0].id,
        action: "create",
        newValues: result.rows[0],
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
      });
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: `Unable to create ${table}` });
    }
  });

  r.patch("/:id", requirePermission(`${permissionModule}.edit`), async (req, res) => {
    const body = req.body || {};
    if (table === "erp_items" && body.tax_group_id) {
      const group = await pool.query(
        `SELECT 1 FROM erp_tax_groups
         WHERE id = $1 AND company_id = $2 AND is_active = TRUE AND is_deleted = FALSE`,
        [body.tax_group_id, req.user.company_id],
      );
      if (!group.rowCount) return res.status(400).json({ error: "Select an active tax group from this company" });
    }
    const keys = Object.keys(body).filter((k) => !["id", "company_id"].includes(k));
    if (!keys.length) return res.status(400).json({ error: "No fields to update" });

    const before = await pool.query(
      `SELECT * FROM ${table} WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );
    if (!before.rowCount) return res.status(404).json({ error: "Not found" });
    if (table === "erp_items" && body.lot_tracking_enabled === true && before.rows[0].lot_tracking_enabled !== true) {
      const legacyStock = await pool.query(
        `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM erp_stock_on_hand
         WHERE company_id = $1 AND item_id = $2 AND is_deleted = FALSE`,
        [req.user.company_id, req.params.id],
      );
      if (Number(legacyStock.rows[0].quantity) > 0.00005) {
        return res.status(409).json({ error: "Before enabling batch tracking, bring current stock to zero or reconcile every on-hand unit to batch and expiry records." });
      }
    }

    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    const vals = [req.params.id, req.user.company_id, ...keys.map((k) => body[k]), req.user.id];

    try {
      const result = await pool.query(
        `UPDATE ${table} SET ${sets.join(", ")}, updated_at = NOW(), updated_by = $${vals.length}
         WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *`,
        vals,
      );
      await logAudit({
        companyId: req.user.company_id,
        userId: req.user.id,
        entityType: table,
        entityId: req.params.id,
        action: "update",
        oldValues: before.rows[0],
        newValues: result.rows[0],
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
      });
      return res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Unable to update" });
    }
  });

  r.delete("/:id", requirePermission(`${permissionModule}.delete`), async (req, res) => {
    const before = await pool.query(
      `SELECT * FROM ${table} WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );
    if (!before.rowCount) return res.status(404).json({ error: "Not found" });

    await pool.query(
      `UPDATE ${table} SET is_deleted = TRUE, updated_at = NOW(), updated_by = $3 WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id, req.user.id],
    );
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: table,
      entityId: req.params.id,
      action: "delete",
      oldValues: before.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    return res.json({ ok: true });
  });

  return r;
}

router.use(
  "/payment-terms",
  createCrud({
    table: "erp_payment_terms",
    codeField: "code",
    searchFields: ["code", "name"],
  }),
);
router.get("/tax-rates", requirePermission("master_data.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT r.*, ARRAY_REMOVE(ARRAY_AGG(DISTINCT g.code), NULL) AS tax_groups
     FROM erp_tax_rates r
     LEFT JOIN erp_tax_group_rates gr ON gr.tax_rate_id = r.id AND gr.company_id = r.company_id AND gr.is_deleted = FALSE
     LEFT JOIN erp_tax_groups g ON g.id = gr.tax_group_id AND g.company_id = r.company_id AND g.is_deleted = FALSE
     WHERE r.company_id = $1 AND r.is_deleted = FALSE
     GROUP BY r.id ORDER BY r.code, r.effective_from DESC`,
    [req.user.company_id],
  );
  return res.json({ data: result.rows });
});

router.post("/tax-rates", requirePermission("master_data.create"), async (req, res) => {
  const { code, name, rate, tax_type = "vat", basis = "percentage", effective_from, effective_to } = req.body || {};
  const from = effective_from || new Date().toISOString().slice(0, 10);
  const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const allowedTypes = ["vat", "withholding", "excise", "other"];
  const allowedBases = ["percentage", "fixed", "per_unit"];
  if (!code || !name || !Number.isFinite(Number(rate)) || Number(rate) < 0
      || !allowedTypes.includes(tax_type) || !allowedBases.includes(basis)
      || !validDate(from) || (effective_to && !validDate(effective_to))) {
    return res.status(400).json({ error: "Provide code, name, non-negative rate, valid tax type/basis, and valid effective dates" });
  }
  if (effective_to && effective_to < from) return res.status(400).json({ error: "effective_to must be on or after effective_from" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const versions = await client.query(
      `SELECT id, effective_from, effective_to FROM erp_tax_rates
       WHERE company_id = $1 AND code = $2 AND is_deleted = FALSE ORDER BY effective_from FOR UPDATE`,
      [req.user.company_id, String(code).trim()],
    );
    const previous = versions.rows.find((version) =>
      String(version.effective_from).slice(0, 10) <= from
      && (!version.effective_to || String(version.effective_to).slice(0, 10) >= from),
    );
    if (previous && String(previous.effective_from).slice(0, 10) === from) {
      throw new Error("A rate version already starts on this effective date; choose a different date");
    }
    if (previous) {
      await client.query(
        `UPDATE erp_tax_rates SET effective_to = ($2::date - INTERVAL '1 day')::date, updated_at = NOW(), updated_by = $3
         WHERE id = $1 AND company_id = $4`,
        [previous.id, from, req.user.id, req.user.company_id],
      );
    }
    const next = versions.rows.find((version) => String(version.effective_from).slice(0, 10) > from);
    let to = effective_to || null;
    if (!to && next) to = new Date(`${String(next.effective_from).slice(0, 10)}T00:00:00Z`);
    if (to instanceof Date) {
      to.setUTCDate(to.getUTCDate() - 1);
      to = to.toISOString().slice(0, 10);
    }
    if (to && (to < from || (next && to >= String(next.effective_from).slice(0, 10)))) {
      throw new Error("The effective range overlaps another version of this tax code");
    }
    const conflict = await client.query(
      `SELECT 1 FROM erp_tax_rates
       WHERE company_id = $1 AND code = $2 AND is_deleted = FALSE
         AND effective_from <= COALESCE($4::date, DATE '9999-12-31')
         AND COALESCE(effective_to, DATE '9999-12-31') >= $3::date LIMIT 1`,
      [req.user.company_id, String(code).trim(), from, to],
    );
    if (conflict.rowCount) throw new Error("The effective range overlaps another version of this tax code");

    const created = await client.query(
      `INSERT INTO erp_tax_rates
         (company_id, code, name, rate, tax_type, basis, effective_from, effective_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.company_id, String(code).trim(), String(name).trim(), Number(rate), tax_type, basis, from, to, req.user.id],
    );
    const oldGroups = await client.query(
      `SELECT DISTINCT gr.tax_group_id FROM erp_tax_group_rates gr
       JOIN erp_tax_rates old_rate ON old_rate.id = gr.tax_rate_id AND old_rate.company_id = gr.company_id
       WHERE gr.company_id = $1 AND old_rate.code = $2 AND old_rate.id <> $3
         AND gr.is_deleted = FALSE`,
      [req.user.company_id, String(code).trim(), created.rows[0].id],
    );
    for (const group of oldGroups.rows) {
      await client.query(
        `INSERT INTO erp_tax_group_rates (company_id, tax_group_id, tax_rate_id, created_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT (tax_group_id, tax_rate_id) DO NOTHING`,
        [req.user.company_id, group.tax_group_id, created.rows[0].id, req.user.id],
      );
    }
    await logAudit({
      companyId: req.user.company_id, userId: req.user.id, entityType: "erp_tax_rates",
      entityId: created.rows[0].id, action: "create_effective_version", newValues: created.rows[0],
      ipAddress: getClientIp(req), userAgent: req.headers["user-agent"],
    });
    await client.query("COMMIT");
    return res.status(201).json(created.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err.message });
  } finally { client.release(); }
});
router.use(
  "/tax-groups",
  createCrud({
    table: "erp_tax_groups",
    codeField: "code",
    searchFields: ["code", "name"],
  }),
);
router.use(
  "/uom",
  createCrud({
    table: "erp_uom",
    codeField: "code",
    searchFields: ["code", "name"],
  }),
);
router.use(
  "/item-categories",
  createCrud({
    table: "erp_item_categories",
    codeField: "code",
    searchFields: ["code", "name"],
  }),
);
router.use(
  "/items",
  createCrud({
    table: "erp_items",
    codeField: "item_code",
    searchFields: ["item_code", "name", "barcode"],
    maxLimit: 2000,
  }),
);
router.use(
  "/customers",
  createCrud({
    table: "erp_customers",
    codeField: "customer_code",
    searchFields: ["customer_code", "name", "email", "tax_id"],
  }),
);
router.use(
  "/vendors",
  createCrud({
    table: "erp_vendors",
    codeField: "vendor_code",
    searchFields: ["vendor_code", "name", "email", "tax_id"],
  }),
);
router.use(
  "/employees",
  createCrud({
    table: "erp_employees",
    codeField: "employee_code",
    searchFields: ["employee_code", "first_name", "last_name", "email"],
    defaultSort: "employee_code",
  }),
);
router.use(
  "/warehouses",
  createCrud({
    table: "erp_warehouses",
    codeField: "code",
    searchFields: ["code", "name", "city"],
  }),
);

// Chart of accounts — tree endpoint
router.get("/chart-of-accounts", requirePermission("master_data.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM erp_chart_of_accounts
       WHERE company_id = $1 AND is_deleted = FALSE
       ORDER BY account_code`,
      [req.user.company_id],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Database error" });
  }
});

router.post("/chart-of-accounts", requirePermission("master_data.create"), async (req, res) => {
  const { parent_id, account_code, account_name, account_type, level, is_postable, currency_code } =
    req.body || {};
  if (!account_code || !account_name || !account_type) {
    return res.status(400).json({ error: "account_code, account_name, account_type required" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO erp_chart_of_accounts (
         company_id, parent_id, account_code, account_name, account_type,
         level, is_postable, currency_code, created_by
       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,1),COALESCE($7,TRUE),$8,$9) RETURNING *`,
      [
        req.user.company_id,
        parent_id,
        account_code,
        account_name,
        account_type,
        level,
        is_postable,
        currency_code || "KES",
        req.user.id,
      ],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unable to create account" });
  }
});

// Warehouse bins
router.get(
  "/warehouses/:warehouseId/bins",
  requirePermission("master_data.view"),
  async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM erp_warehouse_bins
     WHERE warehouse_id = $1 AND company_id = $2 AND is_deleted = FALSE
     ORDER BY code`,
      [req.params.warehouseId, req.user.company_id],
    );
    return res.json(result.rows);
  },
);

router.post(
  "/warehouses/:warehouseId/bins",
  requirePermission("master_data.create"),
  async (req, res) => {
    const { code, name, aisle, rack } = req.body || {};
    if (!code) return res.status(400).json({ error: "code is required" });
    const result = await pool.query(
      `INSERT INTO erp_warehouse_bins (company_id, warehouse_id, code, name, aisle, rack, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.company_id, req.params.warehouseId, code, name, aisle, rack, req.user.id],
    );
    return res.status(201).json(result.rows[0]);
  },
);

// Price lists with items
router.get("/price-lists", requirePermission("master_data.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT pl.*, COUNT(pli.id)::int AS item_count
     FROM erp_price_lists pl
     LEFT JOIN erp_price_list_items pli ON pli.price_list_id = pl.id AND pli.is_deleted = FALSE
     WHERE pl.company_id = $1 AND pl.is_deleted = FALSE
     GROUP BY pl.id ORDER BY pl.name`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get("/price-lists/:id/items", requirePermission("master_data.view"), async (req, res) => {
  const result = await pool.query(
    `SELECT pli.*, i.item_code, i.name AS item_name
     FROM erp_price_list_items pli
     JOIN erp_items i ON i.id = pli.item_id
     WHERE pli.price_list_id = $1 AND pli.company_id = $2 AND pli.is_deleted = FALSE`,
    [req.params.id, req.user.company_id],
  );
  return res.json(result.rows);
});

router.post("/price-lists", requirePermission("master_data.create"), async (req, res) => {
  const { code, name, currency_code, effective_from, effective_to, is_default } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: "code and name required" });
  const result = await pool.query(
    `INSERT INTO erp_price_lists (company_id, code, name, currency_code, effective_from, effective_to, is_default, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,COALESCE($7,FALSE),$8) RETURNING *`,
    [
      req.user.company_id,
      code,
      name,
      currency_code || "KES",
      effective_from,
      effective_to,
      is_default,
      req.user.id,
    ],
  );
  return res.status(201).json(result.rows[0]);
});

router.post("/price-lists/:id/items", requirePermission("master_data.create"), async (req, res) => {
  const { item_id, unit_price, min_qty } = req.body || {};
  if (!item_id || unit_price === undefined) {
    return res.status(400).json({ error: "item_id and unit_price required" });
  }
  const result = await pool.query(
    `INSERT INTO erp_price_list_items (company_id, price_list_id, item_id, unit_price, min_qty, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,1),$6)
     ON CONFLICT (price_list_id, item_id, min_qty) DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = NOW()
     RETURNING *`,
    [req.user.company_id, req.params.id, item_id, unit_price, min_qty, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

module.exports = router;
