const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission, getClientIp } = require('../../middleware/erpAuth');
const { logAudit } = require('../../services/auditService');
const { parsePagination, parseSort } = require('../../lib/queryHelper');
const { validateKraPin, validateDateRange, validatePositiveAmount, validateCode } = require('../../lib/validators');
const { validatePartyBody, validateItemBody, validateEmployeeBody } = require('../../lib/masterDataValidation');
const {
  assertCanDeleteCustomer,
  assertCanDeleteItem,
  assertCanDeleteEmployee,
  assertCanDeleteVendor,
  assertCanDeleteWarehouse,
  assertCanDeleteChartAccount,
} = require('../../lib/crudGuards');
const piiCrypto = require('../../lib/piiCrypto');
const { registerMasterBulkRoutes } = require('../../lib/masterBulkRoutes');
const { assertDuplicateCustomer } = require('../../services/crmService');

async function assertUniqueCode(poolOrClient, companyId, code, table, codeField, excludeId) {
  if (!code) return;
  const db = poolOrClient.query ? poolOrClient : pool;
  const params = [companyId, code];
  let exclude = '';
  if (excludeId) {
    params.push(excludeId);
    exclude = ` AND id <> $${params.length}`;
  }
  const dup = await db.query(
    `SELECT id FROM ${table} WHERE company_id = $1 AND ${codeField} = $2 AND is_deleted = FALSE${exclude} LIMIT 1`,
    params,
  );
  if (dup.rowCount) {
    const err = new Error(`A record with this ${codeField.replace(/_/g, ' ')} already exists`);
    err.code = 'DUPLICATE_CODE';
    throw err;
  }
}

async function assertUniqueTaxId(poolOrClient, companyId, taxId, table, excludeId) {
  if (!taxId) return;
  const db = poolOrClient.query ? poolOrClient : pool;
  const params = [companyId, taxId];
  let exclude = '';
  if (excludeId) {
    params.push(excludeId);
    exclude = ` AND id <> $${params.length}`;
  }
  const dup = await db.query(
    `SELECT id FROM ${table} WHERE company_id = $1 AND tax_id = $2 AND is_deleted = FALSE${exclude} LIMIT 1`,
    params,
  );
  if (dup.rowCount) {
    const err = new Error('A record with this KRA PIN already exists');
    err.code = 'DUPLICATE_TAX_ID';
    throw err;
  }
}

const router = express.Router();
router.use(authenticateErp);

function createCrud(config) {
  const {
    table,
    permissionModule = 'master_data',
    codeField,
    searchFields = ['name'],
    sortFields = ['name', 'created_at'],
    defaultSort = 'name',
    validateBody,
    beforeCreate,
    beforeUpdate,
    beforeDelete,
    transformRow,
    bulkStatusField = 'is_active',
    filterFields = [],
  } = config;
  const mapRow = transformRow || ((row) => row);

  const r = express.Router();

  r.get('/', requirePermission(`${permissionModule}.view`), async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const { page, limit, offset } = parsePagination(req.query);
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
        const clause = ` AND (${likeParams.join(' OR ')})`;
        countSql += clause;
        listSql += clause;
      }

      for (const field of filterFields) {
        const val = req.query[field];
        if (val !== undefined && val !== '') {
          params.push(val === 'true' || val === true);
          const clause = ` AND ${field} = $${params.length}`;
          countSql += clause;
          listSql += clause;
        }
      }

      const countParams = [...params];
      params.push(limit, offset);
      listSql += ` ORDER BY ${sort} ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;

      const [countResult, result] = await Promise.all([
        pool.query(countSql, countParams),
        pool.query(listSql, params),
      ]);

      return res.json({
        data: result.rows.map(mapRow),
        pagination: { page, limit, total: countResult.rows[0].total },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
  });

  r.get('/:id', requirePermission(`${permissionModule}.view`), async (req, res) => {
    const result = await pool.query(
      `SELECT * FROM ${table} WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Not found' });
    return res.json(mapRow(result.rows[0]));
  });

  r.post('/', requirePermission(`${permissionModule}.create`), async (req, res) => {
    let body = req.body || {};
    if (validateBody) {
      const checked = validateBody(body);
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      body = checked.body || body;
    }
    const keys = Object.keys(body).filter((k) => body[k] !== undefined && k !== 'id');
    if (!keys.length) return res.status(400).json({ error: 'No fields provided' });
    if (codeField && !body[codeField]) {
      return res.status(400).json({ error: `${codeField} is required` });
    }

    if (beforeCreate) {
      try {
        await beforeCreate(req, body);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const cols = ['company_id', ...keys, 'created_by'];
    const vals = [req.user.company_id, ...keys.map((k) => body[k]), req.user.id];
    const placeholders = vals.map((_, i) => `$${i + 1}`);

    try {
      const result = await pool.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        vals,
      );
      await logAudit({
        companyId: req.user.company_id,
        userId: req.user.id,
        entityType: table,
        entityId: result.rows[0].id,
        action: 'create',
        newValues: result.rows[0],
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505' || err.code === 'DUPLICATE_TAX_ID' || err.code === 'DUPLICATE_CODE') {
        return res.status(409).json({ error: err.message || 'Duplicate record' });
      }
      console.error(err);
      return res.status(500).json({ error: `Unable to create ${table}` });
    }
  });

  r.patch('/:id', requirePermission(`${permissionModule}.edit`), async (req, res) => {
    let body = req.body || {};
    if (validateBody) {
      const checked = validateBody(body);
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      body = checked.body || body;
    }
    const keys = Object.keys(body).filter((k) => !['id', 'company_id'].includes(k));
    if (!keys.length) return res.status(400).json({ error: 'No fields to update' });

    const before = await pool.query(
      `SELECT * FROM ${table} WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );
    if (!before.rowCount) return res.status(404).json({ error: 'Not found' });

    const ifMatch = req.headers['if-match'];
    if (ifMatch) {
      const expected = new Date(ifMatch).getTime();
      const current = new Date(before.rows[0].updated_at).getTime();
      if (Number.isNaN(expected) || expected !== current) {
        return res.status(409).json({
          error: 'Record was modified by another user. Refresh and try again.',
          version: before.rows[0].updated_at,
        });
      }
    }

    if (beforeUpdate) {
      try {
        await beforeUpdate(req, body, req.params.id);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    const vals = [req.params.id, req.user.company_id, ...keys.map((k) => body[k]), req.user.id];

    try {
      const result = await pool.query(
        `UPDATE ${table} SET ${sets.join(', ')}, updated_at = NOW(), updated_by = $${vals.length}
         WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE RETURNING *`,
        vals,
      );
      await logAudit({
        companyId: req.user.company_id,
        userId: req.user.id,
        entityType: table,
        entityId: req.params.id,
        action: 'update',
        oldValues: before.rows[0],
        newValues: result.rows[0],
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'],
      });
      return res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505' || err.code === 'DUPLICATE_TAX_ID' || err.code === 'DUPLICATE_CODE') {
        return res.status(409).json({ error: err.message || 'Duplicate record' });
      }
      console.error(err);
      return res.status(500).json({ error: 'Unable to update' });
    }
  });

  r.delete('/:id', requirePermission(`${permissionModule}.delete`), async (req, res) => {
    const before = await pool.query(
      `SELECT * FROM ${table} WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );
    if (!before.rowCount) return res.status(404).json({ error: 'Not found' });

    if (beforeDelete) {
      try {
        await beforeDelete(req, req.params.id, before.rows[0]);
      } catch (err) {
        return res.status(409).json({ error: err.message });
      }
    }

    await pool.query(
      `UPDATE ${table} SET is_deleted = TRUE, updated_at = NOW(), updated_by = $3 WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.company_id, req.user.id],
    );
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: table,
      entityId: req.params.id,
      action: 'delete',
      oldValues: before.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.json({ ok: true });
  });

  registerMasterBulkRoutes(r, {
    table,
    permissionModule,
    bulkStatusField,
    beforeDelete,
    mapRow,
    exportFilename: table,
  });

  return r;
}

router.use('/payment-terms', createCrud({
  table: 'erp_payment_terms',
  codeField: 'code',
  searchFields: ['code', 'name'],
}));
router.use('/tax-rates', createCrud({
  table: 'erp_tax_rates',
  codeField: 'code',
  searchFields: ['code', 'name'],
}));
router.use('/tax-groups', createCrud({
  table: 'erp_tax_groups',
  codeField: 'code',
  searchFields: ['code', 'name'],
}));
router.use('/uom', createCrud({
  table: 'erp_uom',
  codeField: 'code',
  searchFields: ['code', 'name'],
}));
router.use('/item-categories', createCrud({
  table: 'erp_item_categories',
  codeField: 'code',
  searchFields: ['code', 'name'],
}));
router.use('/items', createCrud({
  table: 'erp_items',
  codeField: 'item_code',
  searchFields: ['item_code', 'name', 'barcode'],
  validateBody: validateItemBody,
  filterFields: ['is_active'],
  beforeCreate: async (req, body) => {
    await assertUniqueCode(pool, req.user.company_id, body.item_code, 'erp_items', 'item_code');
  },
  beforeUpdate: async (req, body, id) => {
    if (body.item_code) {
      await assertUniqueCode(pool, req.user.company_id, body.item_code, 'erp_items', 'item_code', id);
    }
  },
  beforeDelete: async (req, id) => {
    await assertCanDeleteItem(req.user.company_id, id);
  },
}));
router.use('/customers', createCrud({
  table: 'erp_customers',
  codeField: 'customer_code',
  searchFields: ['customer_code', 'name', 'email', 'tax_id'],
  validateBody: (body) => validatePartyBody(body, { isCustomer: true }),
  beforeCreate: async (req, body) => {
    await assertUniqueCode(pool, req.user.company_id, body.customer_code, 'erp_customers', 'customer_code');
    await assertUniqueTaxId(pool, req.user.company_id, body.tax_id, 'erp_customers');
    await assertDuplicateCustomer(pool, req.user.company_id, { name: body.name, taxId: body.tax_id });
    Object.assign(body, piiCrypto.protectPartyFields(body));
  },
  beforeUpdate: async (req, body, id) => {
    if (body.customer_code) {
      await assertUniqueCode(pool, req.user.company_id, body.customer_code, 'erp_customers', 'customer_code', id);
    }
    if (body.tax_id) await assertUniqueTaxId(pool, req.user.company_id, body.tax_id, 'erp_customers', id);
    if (body.name && body.tax_id) {
      await assertDuplicateCustomer(pool, req.user.company_id, { name: body.name, taxId: body.tax_id }, id);
    }
    Object.assign(body, piiCrypto.protectPartyFields(body));
  },
  transformRow: piiCrypto.mergeDecryptedRow,
  filterFields: ['is_active'],
  beforeDelete: async (req, id) => {
    await assertCanDeleteCustomer(req.user.company_id, id);
  },
}));
router.use('/vendors', createCrud({
  table: 'erp_vendors',
  codeField: 'vendor_code',
  searchFields: ['vendor_code', 'name', 'email', 'tax_id'],
  validateBody: (body) => validatePartyBody(body, { isCustomer: false }),
  beforeCreate: async (req, body) => {
    await assertUniqueCode(pool, req.user.company_id, body.vendor_code, 'erp_vendors', 'vendor_code');
    await assertUniqueTaxId(pool, req.user.company_id, body.tax_id, 'erp_vendors');
    Object.assign(body, piiCrypto.protectPartyFields(body));
  },
  beforeUpdate: async (req, body, id) => {
    if (body.vendor_code) {
      await assertUniqueCode(pool, req.user.company_id, body.vendor_code, 'erp_vendors', 'vendor_code', id);
    }
    if (body.tax_id) await assertUniqueTaxId(pool, req.user.company_id, body.tax_id, 'erp_vendors', id);
    Object.assign(body, piiCrypto.protectPartyFields(body));
  },
  transformRow: piiCrypto.mergeDecryptedRow,
  filterFields: ['is_active'],
  beforeDelete: async (req, id) => {
    await assertCanDeleteVendor(req.user.company_id, id);
  },
}));
router.use('/employees', createCrud({
  table: 'erp_employees',
  codeField: 'employee_code',
  searchFields: ['employee_code', 'first_name', 'last_name', 'email'],
  defaultSort: 'employee_code',
  validateBody: (body) => validateEmployeeBody(body),
  filterFields: ['is_active'],
  beforeCreate: async (req, body) => {
    const checked = validateEmployeeBody(body, { forCreate: true });
    if (!checked.ok) throw new Error(checked.error);
    Object.assign(body, checked.body);
    Object.assign(body, piiCrypto.protectSalaryFields(body));
    await assertUniqueCode(pool, req.user.company_id, body.employee_code, 'erp_employees', 'employee_code');
  },
  beforeUpdate: async (req, body, id) => {
    if (body.employee_code) {
      await assertUniqueCode(pool, req.user.company_id, body.employee_code, 'erp_employees', 'employee_code', id);
    }
    Object.assign(body, piiCrypto.protectSalaryFields(body));
  },
  transformRow: piiCrypto.mergeEmployeeRow,
  beforeDelete: async (req, id) => {
    await assertCanDeleteEmployee(req.user.company_id, id);
  },
}));
router.use('/warehouses', createCrud({
  table: 'erp_warehouses',
  codeField: 'code',
  searchFields: ['code', 'name', 'city'],
  filterFields: ['is_active'],
  beforeDelete: async (req, id) => {
    await assertCanDeleteWarehouse(req.user.company_id, id);
  },
}));

const chartOfAccountsRouter = express.Router();
registerMasterBulkRoutes(chartOfAccountsRouter, {
  table: 'erp_chart_of_accounts',
  beforeDelete: async (req, id) => {
    await assertCanDeleteChartAccount(req.user.company_id, id);
  },
  exportFilename: 'chart-of-accounts',
});

chartOfAccountsRouter.get('/', requirePermission('master_data.view'), async (req, res) => {
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
    return res.status(500).json({ error: 'Database error' });
  }
});

chartOfAccountsRouter.post('/', requirePermission('master_data.create'), async (req, res) => {
  const {
    parent_id, account_code, account_name, account_type, level, is_postable, currency_code,
  } = req.body || {};
  if (!account_code || !account_name || !account_type) {
    return res.status(400).json({ error: 'account_code, account_name, account_type required' });
  }
  const codeCheck = validateCode(account_code, 'Account code');
  if (!codeCheck.ok) return res.status(400).json({ error: codeCheck.error });
  const allowed = ['asset', 'liability', 'equity', 'income', 'expense'];
  if (!allowed.includes(String(account_type).toLowerCase())) {
    return res.status(400).json({ error: 'account_type must be asset, liability, equity, income, or expense' });
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
        codeCheck.value,
        account_name,
        String(account_type).toLowerCase(),
        level,
        is_postable,
        currency_code || 'KES',
        req.user.id,
      ],
    );
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_chart_of_accounts',
      entityId: result.rows[0].id,
      action: 'create',
      newValues: result.rows[0],
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Account code already exists' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Unable to create account' });
  }
});

router.use('/chart-of-accounts', chartOfAccountsRouter);

// Warehouse bins
router.get('/warehouses/:warehouseId/bins', requirePermission('master_data.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_warehouse_bins
     WHERE warehouse_id = $1 AND company_id = $2 AND is_deleted = FALSE
     ORDER BY code`,
    [req.params.warehouseId, req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/warehouses/:warehouseId/bins', requirePermission('master_data.create'), async (req, res) => {
  const { code, name, aisle, rack } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });
  const result = await pool.query(
    `INSERT INTO erp_warehouse_bins (company_id, warehouse_id, code, name, aisle, rack, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.company_id, req.params.warehouseId, code, name, aisle, rack, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

// Price lists with items
router.get('/price-lists', requirePermission('master_data.view'), async (req, res) => {
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

router.get('/price-lists/:id/items', requirePermission('master_data.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT pli.*, i.item_code, i.name AS item_name
     FROM erp_price_list_items pli
     JOIN erp_items i ON i.id = pli.item_id
     WHERE pli.price_list_id = $1 AND pli.company_id = $2 AND pli.is_deleted = FALSE`,
    [req.params.id, req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/price-lists', requirePermission('master_data.create'), async (req, res) => {
  const { code, name, currency_code, effective_from, effective_to, is_default } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  const codeCheck = validateCode(code, 'Price list code');
  if (!codeCheck.ok) return res.status(400).json({ error: codeCheck.error });
  const dr = validateDateRange(effective_from, effective_to, {
    startLabel: 'Effective from',
    endLabel: 'Effective to',
  });
  if (!dr.ok) return res.status(400).json({ error: dr.error });
  const result = await pool.query(
    `INSERT INTO erp_price_lists (company_id, code, name, currency_code, effective_from, effective_to, is_default, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,COALESCE($7,FALSE),$8) RETURNING *`,
    [req.user.company_id, code, name, currency_code || 'KES', effective_from, effective_to, is_default, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

router.post('/price-lists/:id/items', requirePermission('master_data.create'), async (req, res) => {
  const { item_id, unit_price, min_qty } = req.body || {};
  if (!item_id || unit_price === undefined) {
    return res.status(400).json({ error: 'item_id and unit_price required' });
  }
  const price = validatePositiveAmount(unit_price, 'Unit price');
  if (!price.ok) return res.status(400).json({ error: price.error });
  const result = await pool.query(
    `INSERT INTO erp_price_list_items (company_id, price_list_id, item_id, unit_price, min_qty, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,1),$6)
     ON CONFLICT (price_list_id, item_id, min_qty) DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = NOW()
     RETURNING *`,
    [req.user.company_id, req.params.id, item_id, price.value, min_qty, req.user.id],
  );
  return res.status(201).json(result.rows[0]);
});

module.exports = router;
