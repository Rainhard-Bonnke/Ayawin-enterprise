const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const { parsePagination } = require("../../lib/queryHelper");
const crmSalesService = require("../../services/crmSalesService");
const salesPerformance = require("../../services/salesPerformanceService");

const router = express.Router();
router.use(authenticateErp);

router.get("/leads", requirePermission("sales.view"), async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  try {
    const result = await crmSalesService.listLeads({
      companyId: req.user.company_id,
      q: req.query.q || "",
      status: req.query.status || null,
      limit,
      offset,
    });
    return res.json({ ...result, pagination: { page, limit, total: result.pagination.total } });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/leads/:id", requirePermission("sales.view"), async (req, res) => {
  try {
    const lead = await pool.query(
      `SELECT * FROM erp_leads WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );
    if (!lead.rowCount) return res.status(404).json({ error: "Lead not found" });
    return res.json(lead.rows[0]);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/leads", requirePermission("sales.create"), async (req, res) => {
  try {
    const lead = await crmSalesService.createLead({
      companyId: req.user.company_id,
      userId: req.user.id,
      payload: req.body || {},
    });
    return res.status(201).json(lead);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.put("/leads/:id", requirePermission("sales.create"), async (req, res) => {
  try {
    const lead = await crmSalesService.updateLead({
      companyId: req.user.company_id,
      userId: req.user.id,
      leadId: req.params.id,
      payload: req.body || {},
    });
    return res.json(lead);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.delete("/leads/:id", requirePermission("sales.create"), async (req, res) => {
  try {
    const lead = await crmSalesService.archiveLead({
      companyId: req.user.company_id,
      userId: req.user.id,
      leadId: req.params.id,
    });
    return res.json(lead);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/leads/:id/convert", requirePermission("sales.create"), async (req, res) => {
  try {
    const result = await crmSalesService.convertLeadToCustomerAndOpportunity({
      companyId: req.user.company_id,
      userId: req.user.id,
      leadId: req.params.id,
      opportunityName: req.body?.opportunity_name || req.body?.opportunityName,
      customerTaxId: req.body?.tax_id || req.body?.taxId,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/opportunities", requirePermission("sales.view"), async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  try {
    const result = await crmSalesService.listOpportunities({
      companyId: req.user.company_id,
      q: req.query.q || "",
      stage: req.query.stage || null,
      limit,
      offset,
    });
    return res.json({ ...result, pagination: { page, limit, total: result.pagination.total } });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/opportunities/:id", requirePermission("sales.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, c.name AS customer_name FROM erp_opportunities o
       LEFT JOIN erp_customers c ON c.id = o.customer_id
       WHERE o.id = $1 AND o.company_id = $2 AND o.is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Opportunity not found" });
    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/opportunities", requirePermission("sales.create"), async (req, res) => {
  try {
    const opportunity = await crmSalesService.createOpportunity({
      companyId: req.user.company_id,
      userId: req.user.id,
      payload: req.body || {},
    });
    return res.status(201).json(opportunity);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.put("/opportunities/:id", requirePermission("sales.create"), async (req, res) => {
  try {
    const opportunity = await crmSalesService.updateOpportunity({
      companyId: req.user.company_id,
      userId: req.user.id,
      opportunityId: req.params.id,
      payload: req.body || {},
    });
    return res.json(opportunity);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.delete("/opportunities/:id", requirePermission("sales.create"), async (req, res) => {
  try {
    const opportunity = await crmSalesService.archiveOpportunity({
      companyId: req.user.company_id,
      userId: req.user.id,
      opportunityId: req.params.id,
    });
    return res.json(opportunity);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/activities", requirePermission("sales.view"), async (req, res) => {
  try {
    const activities = await crmSalesService.listActivities({
      companyId: req.user.company_id,
      leadId: req.query.lead_id || req.query.leadId || null,
      opportunityId: req.query.opportunity_id || req.query.opportunityId || null,
      customerId: req.query.customer_id || req.query.customerId || null,
      q: req.query.q || "",
    });
    return res.json(activities);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/quotes", requirePermission("sales.view"), async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  try {
    const result = await crmSalesService.listQuotes({
      companyId: req.user.company_id,
      status: req.query.status || null,
      q: req.query.q || "",
      limit,
      offset,
    });
    return res.json({ ...result, pagination: { page, limit, total: result.pagination.total } });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/quotes/:id", requirePermission("sales.view"), async (req, res) => {
  try {
    return res.json(await crmSalesService.getQuote({ companyId: req.user.company_id, quoteId: req.params.id }));
  } catch (error) {
    return res.status(404).json({ error: error.message });
  }
});

router.post("/quotes", requirePermission("sales.create"), async (req, res) => {
  try {
    const quote = await crmSalesService.createQuote({
      companyId: req.user.company_id,
      userId: req.user.id,
      payload: req.body || {},
      permissions: req.user.permissions,
    });
    return res.status(201).json(quote);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/quotes/:id/send", requirePermission("sales.create"), async (req, res) => {
  try {
    return res.json(await crmSalesService.updateQuoteStatus({
      companyId: req.user.company_id,
      userId: req.user.id,
      quoteId: req.params.id,
      status: "sent",
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/quotes/:id/reject", requirePermission("sales.create"), async (req, res) => {
  try {
    return res.json(await crmSalesService.updateQuoteStatus({
      companyId: req.user.company_id,
      userId: req.user.id,
      quoteId: req.params.id,
      status: "rejected",
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/quotes/:id/accept", requirePermission("sales.create"), async (req, res) => {
  try {
    const quote = await crmSalesService.acceptQuote({
      companyId: req.user.company_id,
      userId: req.user.id,
      quoteId: req.params.id,
    });
    return res.json(quote);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/quotes/:id/convert-order", requirePermission("sales.order.create"), async (req, res) => {
  try {
    const result = await crmSalesService.convertQuoteToSalesOrder({
      companyId: req.user.company_id,
      userId: req.user.id,
      quoteId: req.params.id,
      warehouseId: req.body?.warehouse_id || req.body?.warehouseId || null,
      requiredDate: req.body?.required_date || req.body?.requiredDate,
      permissions: req.user.permissions,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/sales-representatives", requirePermission("sales.target.manage"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, full_name, email FROM erp_users
       WHERE company_id=$1 AND status='active' AND is_deleted=FALSE
       ORDER BY full_name NULLS LAST, username`,
      [req.user.company_id],
    );
    return res.json(result.rows);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/sales-targets", requirePermission("sales.target.manage"), async (req, res) => {
  try {
    const target = await salesPerformance.saveSalesTarget({
      companyId: req.user.company_id,
      userId: req.user.id,
      salesRepId: req.body?.sales_rep_id,
      periodStart: req.body?.period_start,
      periodEnd: req.body?.period_end,
      targetAmount: req.body?.target_amount,
    });
    return res.status(201).json(target);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/commission-plans", requirePermission("sales.target.manage"), async (req, res) => {
  try {
    const plan = await salesPerformance.createCommissionPlan({
      companyId: req.user.company_id,
      userId: req.user.id,
      code: req.body?.code,
      name: req.body?.name,
      ratePercent: req.body?.rate_percent,
      effectiveFrom: req.body?.effective_from,
      effectiveTo: req.body?.effective_to || null,
    });
    return res.status(201).json(plan);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get("/pipeline", requirePermission("sales.view"), async (req, res) => {
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

router.post("/activities", requirePermission("sales.create"), async (req, res) => {
  try {
    const activity = await crmSalesService.createActivity({
      companyId: req.user.company_id,
      userId: req.user.id,
      payload: req.body || {},
    });
    return res.status(201).json(activity);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

module.exports = router;
