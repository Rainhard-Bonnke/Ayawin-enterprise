const pool = require('../db');
const { requirePermission } = require('../middleware/erpAuth');
const { rowsToCsv } = require('./csvExport');

/**
 * Registers POST /bulk/delete, POST /bulk/export, PATCH /bulk/status on an Express router.
 */
function registerMasterBulkRoutes(router, config) {
  const {
    table,
    permissionModule = 'master_data',
    bulkStatusField = 'is_active',
    beforeDelete,
    mapRow = (row) => row,
    exportFilename,
  } = config;

  router.post('/bulk/delete', requirePermission(`${permissionModule}.delete`), async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'ids array required' });
    const results = { deleted: 0, errors: [] };
    for (const id of ids) {
      try {
        const before = await pool.query(
          `SELECT * FROM ${table} WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
          [id, req.user.company_id],
        );
        if (!before.rowCount) {
          results.errors.push({ id, error: 'Not found' });
          continue;
        }
        if (beforeDelete) await beforeDelete(req, id, before.rows[0]);
        await pool.query(
          `UPDATE ${table} SET is_deleted = TRUE, updated_at = NOW(), updated_by = $3 WHERE id = $1 AND company_id = $2`,
          [id, req.user.company_id, req.user.id],
        );
        results.deleted += 1;
      } catch (err) {
        results.errors.push({ id, error: err.message });
      }
    }
    return res.json(results);
  });

  router.post('/bulk/export', requirePermission(`${permissionModule}.view`), async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    let sql = `SELECT * FROM ${table} WHERE company_id = $1 AND is_deleted = FALSE`;
    const params = [req.user.company_id];
    if (ids?.length) {
      params.push(ids);
      sql += ` AND id = ANY($2::uuid[])`;
    }
    sql += ` ORDER BY created_at DESC LIMIT 5000`;
    const result = await pool.query(sql, params);
    const csv = rowsToCsv(result.rows.map(mapRow));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename || table}-export.csv"`,
    );
    return res.send(csv);
  });

  router.patch('/bulk/status', requirePermission(`${permissionModule}.edit`), async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const active = req.body?.[bulkStatusField];
    if (!ids.length || typeof active !== 'boolean') {
      return res.status(400).json({ error: `ids and ${bulkStatusField} (boolean) required` });
    }
    const result = await pool.query(
      `UPDATE ${table} SET ${bulkStatusField} = $3, updated_at = NOW(), updated_by = $4
       WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_deleted = FALSE`,
      [req.user.company_id, ids, active, req.user.id],
    );
    return res.json({ updated: result.rowCount });
  });
}

module.exports = { registerMasterBulkRoutes };
