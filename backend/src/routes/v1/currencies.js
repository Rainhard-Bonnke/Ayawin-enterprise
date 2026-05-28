const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');

const router = express.Router();
router.use(authenticateErp);

router.get('/', requirePermission('foundation.view'), async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM erp_currencies WHERE is_active = TRUE ORDER BY code',
  );
  return res.json(result.rows);
});

router.get('/exchange-rates', requirePermission('foundation.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_exchange_rates
     WHERE company_id = $1 AND is_deleted = FALSE
     ORDER BY effective_date DESC, from_currency_code`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.post('/exchange-rates', requirePermission('foundation.edit'), async (req, res) => {
  const { from_currency_code, to_currency_code, rate, effective_date, source } = req.body || {};
  if (!from_currency_code || !to_currency_code || !rate || !effective_date) {
    return res.status(400).json({ error: 'from_currency_code, to_currency_code, rate, effective_date required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO erp_exchange_rates (
         company_id, from_currency_code, to_currency_code, rate, effective_date, source, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (company_id, from_currency_code, to_currency_code, effective_date)
       DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, updated_at = NOW(), updated_by = $7
       RETURNING *`,
      [req.user.company_id, from_currency_code, to_currency_code, rate, effective_date, source, req.user.id],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unable to save exchange rate' });
  }
});

module.exports = router;
