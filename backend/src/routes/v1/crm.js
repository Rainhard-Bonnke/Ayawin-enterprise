const express = require('express');

const pool = require('../../db');

const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');

const { parsePagination } = require('../../lib/queryHelper');

const { getCreditLimitMode } = require('../../lib/creditLimitPolicy');

const crm = require('../../services/crmService');



const router = express.Router();

router.use(authenticateErp);



router.get('/leads', requirePermission('sales.view'), async (req, res) => {

  const { page, limit, offset } = parsePagination(req.query);

  const [countR, dataR] = await Promise.all([

    pool.query('SELECT COUNT(*)::int AS total FROM erp_leads WHERE company_id = $1 AND is_deleted = FALSE', [req.user.company_id]),

    pool.query(

      `SELECT * FROM erp_leads WHERE company_id = $1 AND is_deleted = FALSE ORDER BY created_at DESC LIMIT $2 OFFSET $3`,

      [req.user.company_id, limit, offset],

    ),

  ]);

  return res.json({ data: dataR.rows, pagination: { page, limit, total: countR.rows[0].total } });

});



router.get('/opportunities', requirePermission('sales.view'), async (req, res) => {

  const result = await pool.query(

    `SELECT o.*, c.name AS customer_name FROM erp_opportunities o

     LEFT JOIN erp_customers c ON c.id = o.customer_id

     WHERE o.company_id = $1 AND o.is_deleted = FALSE ORDER BY o.amount DESC`,

    [req.user.company_id],

  );

  return res.json(result.rows);

});



router.get('/ar-aging', requirePermission('sales.view'), async (req, res) => {

  const data = await crm.getArAging(req.user.company_id);

  return res.json(data);

});



router.get('/credit-policy', requirePermission('sales.view'), (_req, res) => {

  return res.json({ mode: getCreditLimitMode() });

});

router.get('/customer-balances', requirePermission('sales.view'), async (req, res) => {

  const balances = await crm.getCustomerBalanceMap(req.user.company_id);

  return res.json(balances);

});



router.get('/customers/:id/statement', requirePermission('sales.view'), async (req, res) => {

  const data = await crm.getCustomerStatement(req.user.company_id, req.params.id, {

    from: req.query.from || null,

    to: req.query.to || null,

  });

  if (!data) return res.status(404).json({ error: 'Customer not found' });

  return res.json(data);

});



router.get('/pipeline', requirePermission('sales.view'), async (req, res) => {

  const result = await pool.query(

    `SELECT stage, COUNT(*)::int AS count, COALESCE(SUM(amount),0) AS total_amount,

            COALESCE(SUM(amount * probability / 100),0) AS weighted_forecast

     FROM erp_opportunities

     WHERE company_id = $1 AND is_deleted = FALSE AND stage NOT IN ('won','lost')

     GROUP BY stage ORDER BY stage`,

    [req.user.company_id],

  );

  return res.json(result.rows);

});



router.post('/leads', requirePermission('sales.create'), async (req, res) => {

  const { company_name, contact_name, email, phone, source, estimated_value, status } = req.body || {};

  if (!company_name) return res.status(400).json({ error: 'company_name is required' });

  try {

    const countR = await pool.query(

      'SELECT COUNT(*)::int AS n FROM erp_leads WHERE company_id = $1',

      [req.user.company_id],

    );

    const leadNo = `LD-${new Date().getFullYear()}-${String(Number(countR.rows[0].n) + 1).padStart(4, '0')}`;

    const result = await pool.query(

      `INSERT INTO erp_leads (

         company_id, lead_no, company_name, contact_name, email, phone, source, status, estimated_value, created_by

       ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'new'),COALESCE($9,0),$10) RETURNING *`,

      [

        req.user.company_id,

        leadNo,

        company_name,

        contact_name || null,

        email || null,

        phone || null,

        source || null,

        status,

        estimated_value,

        req.user.id,

      ],

    );

    return res.status(201).json(result.rows[0]);

  } catch (err) {

    console.error(err);

    return res.status(500).json({ error: 'Unable to create lead' });

  }

});



router.post('/opportunities', requirePermission('sales.create'), async (req, res) => {

  const { name, customer_id, lead_id, stage, amount, probability, expected_close_date } = req.body || {};

  if (!name) return res.status(400).json({ error: 'name is required' });

  try {

    const countR = await pool.query(

      'SELECT COUNT(*)::int AS n FROM erp_opportunities WHERE company_id = $1',

      [req.user.company_id],

    );

    const oppNo = `OP-${new Date().getFullYear()}-${String(Number(countR.rows[0].n) + 1).padStart(4, '0')}`;

    const result = await pool.query(

      `INSERT INTO erp_opportunities (

         company_id, opportunity_no, name, customer_id, lead_id, stage, amount, probability,

         expected_close_date, created_by

       ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,'prospecting'),COALESCE($7,0),COALESCE($8,0),$9,$10) RETURNING *`,

      [

        req.user.company_id,

        oppNo,

        name,

        customer_id || null,

        lead_id || null,

        stage,

        amount,

        probability,

        expected_close_date || null,

        req.user.id,

      ],

    );

    return res.status(201).json(result.rows[0]);

  } catch (err) {

    console.error(err);

    return res.status(500).json({ error: 'Unable to create opportunity' });

  }

});



router.post('/activities', requirePermission('sales.create'), async (req, res) => {

  const { lead_id, opportunity_id, customer_id, activity_type, subject, description, activity_date } = req.body || {};

  if (!activity_type || !subject) return res.status(400).json({ error: 'activity_type and subject required' });

  const result = await pool.query(

    `INSERT INTO erp_crm_activities (

       company_id, lead_id, opportunity_id, customer_id, activity_type, subject, description,

       activity_date, assigned_to, created_by

     ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,NOW()),$9,$9) RETURNING *`,

    [req.user.company_id, lead_id, opportunity_id, customer_id, activity_type, subject, description, activity_date, req.user.id],

  );

  return res.status(201).json(result.rows[0]);

});



module.exports = router;


