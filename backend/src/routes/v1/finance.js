const express = require('express');
const pool = require('../../db');
const { authenticateErp, requirePermission, getClientIp } = require('../../middleware/erpAuth');
const { logAudit } = require('../../services/auditService');
const gl = require('../../services/glPostingService');
const reporting = require('../../services/reportingService');
const ap = require('../../services/apService');
const bankRecon = require('../../services/bankReconService');
const monthEnd = require('../../services/monthEndService');
const accounting = require('../../services/accountingService');
const { requireReauth } = require('../../middleware/requireReauth');
const liveEvents = require('../../services/liveEventsService');
const { parsePagination } = require('../../lib/queryHelper');
const { buildVendorPaymentHash } = require('../../services/documentVerificationService');
const { renderVendorPaymentPdfBuffer } = require('../../services/vendorPaymentPdfService');

const AGING_BUCKET_LABELS = {
  current: 'Current (0–30)',
  '1-30': 'Current (0–30)',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '61+': '90+ days',
  '90+': '90+ days',
};

function aggregateAgingBuckets(rows, amountKey = 'outstanding') {
  const totals = {};
  for (const row of rows) {
    const bucket = row.bucket || 'current';
    const label = AGING_BUCKET_LABELS[bucket] || bucket;
    totals[label] = (totals[label] || 0) + Number(row[amountKey] ?? row.total_amount ?? 0);
  }
  const order = ['Current (0–30)', '31–60 days', '61–90 days', '90+ days'];
  return order
    .filter((bucket) => totals[bucket] != null)
    .map((bucket) => ({ bucket, amount: Math.round(totals[bucket]) }));
}

function mergeArApBuckets(arBuckets, apBuckets) {
  const labels = new Set([...arBuckets.map((b) => b.bucket), ...apBuckets.map((b) => b.bucket)]);
  const ordered = ['Current (0–30)', '31–60 days', '61–90 days', '90+ days'].filter((l) => labels.has(l));
  return ordered.map((bucket) => ({
    bucket,
    ar: arBuckets.find((b) => b.bucket === bucket)?.amount || 0,
    ap: apBuckets.find((b) => b.bucket === bucket)?.amount || 0,
  }));
}

const router = express.Router();
router.use(authenticateErp);

router.get('/fiscal-years', requirePermission('finance.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT fy.*, COUNT(fp.id)::int AS period_count
     FROM erp_fiscal_years fy
     LEFT JOIN erp_fiscal_periods fp ON fp.fiscal_year_id = fy.id AND fp.is_deleted = FALSE
     WHERE fy.company_id = $1 AND fy.is_deleted = FALSE
     GROUP BY fy.id ORDER BY fy.start_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get('/fiscal-periods', requirePermission('finance.view'), async (req, res) => {
  const yearId = req.query.fiscal_year_id;
  const params = [req.user.company_id];
  let filter = '';
  if (yearId) {
    filter = 'AND fp.fiscal_year_id = $2';
    params.push(yearId);
  }
  const result = await pool.query(
    `SELECT fp.* FROM erp_fiscal_periods fp
     WHERE fp.company_id = $1 AND fp.is_deleted = FALSE ${filter}
     ORDER BY fp.period_no`,
    params,
  );
  return res.json(result.rows);
});

router.post('/fiscal-periods/:id/close', requirePermission('finance.approve'), requireReauth(), async (req, res) => {
  try {
    const result = await monthEnd.executeMonthEnd({
      companyId: req.user.company_id,
      userId: req.user.id,
      periodId: req.params.id,
      force: Boolean(req.body?.force),
    });
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_fiscal_periods',
      entityId: req.params.id,
      action: 'close',
      newValues: result.period,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    liveEvents.publish(req.user.company_id, 'finance.period_closed', { period_id: req.params.id });
    return res.json(result.period);
  } catch (err) {
    if (err.code === 'MONTH_END_BLOCKED') {
      return res.status(409).json({ error: err.message, details: err.details });
    }
    return res.status(400).json({ error: err.message });
  }
});

router.get('/journals', requirePermission('finance.view'), async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const params = [req.user.company_id];
  let filter = '';
  if (status) {
    params.push(status);
    filter = `AND j.status = $${params.length}`;
  }
  params.push(limit, offset);
  const [countR, dataR] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total FROM erp_journals j
       WHERE j.company_id = $1 AND j.is_deleted = FALSE ${filter}`,
      status ? [req.user.company_id, status] : [req.user.company_id],
    ),
    pool.query(
      `SELECT j.*, fp.name AS period_name
       FROM erp_journals j
       LEFT JOIN erp_fiscal_periods fp ON fp.id = j.fiscal_period_id
       WHERE j.company_id = $1 AND j.is_deleted = FALSE ${filter}
       ORDER BY j.entry_date DESC, j.journal_no DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
  ]);
  return res.json({ data: dataR.rows, pagination: { page, limit, total: countR.rows[0].total } });
});

router.get('/journals/:id', requirePermission('finance.view'), async (req, res) => {
  const journal = await pool.query(
    `SELECT * FROM erp_journals WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
    [req.params.id, req.user.company_id],
  );
  if (!journal.rowCount) return res.status(404).json({ error: 'Not found' });
  const lines = await pool.query(
    `SELECT jl.*, a.account_code, a.account_name
     FROM erp_journal_lines jl
     JOIN erp_chart_of_accounts a ON a.id = jl.account_id
     WHERE jl.journal_id = $1 ORDER BY jl.line_no`,
    [req.params.id],
  );
  return res.json({ ...journal.rows[0], lines: lines.rows });
});

router.post('/journals', requirePermission('finance.create'), async (req, res) => {
  try {
    const journal = await gl.createJournal({
      companyId: req.user.company_id,
      userId: req.user.id,
      entryDate: req.body?.entry_date,
      journalType: req.body?.journal_type,
      referenceNo: req.body?.reference_no,
      description: req.body?.description,
      lines: req.body?.lines,
      branchId: req.body?.branch_id || req.user.default_branch_id,
      currencyCode: req.body?.currency_code,
      exchangeRate: req.body?.exchange_rate,
    });
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_journals',
      entityId: journal.id,
      action: 'create',
      newValues: journal,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json(journal);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/journals/:id/post', requirePermission('finance.approve'), async (req, res) => {
  try {
    const result = await gl.postJournal({
      journalId: req.params.id,
      companyId: req.user.company_id,
      userId: req.user.id,
    });
    await logAudit({
      companyId: req.user.company_id,
      userId: req.user.id,
      entityType: 'erp_journals',
      entityId: req.params.id,
      action: 'post',
      newValues: result,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/coa/kenya-status', requirePermission('finance.view'), async (req, res) => {
  const status = await accounting.getKenyaCoaStatus(req.user.company_id);
  return res.json(status);
});

router.get('/reports/trial-balance', requirePermission('finance.view'), async (req, res) => {
  const periodId = req.query.fiscal_period_id;
  if (!periodId) return res.status(400).json({ error: 'fiscal_period_id required' });
  const report = await accounting.getTrialBalanceReport(req.user.company_id, periodId);
  return res.json(report);
});

router.get('/reports/balance-sheet', requirePermission('finance.view'), async (req, res) => {
  const periodId = req.query.fiscal_period_id;
  if (!periodId) return res.status(400).json({ error: 'fiscal_period_id required' });
  const report = await accounting.getBalanceSheetReport(req.user.company_id, periodId);
  return res.json(report);
});

router.get('/reports/profit-loss', requirePermission('finance.view'), async (req, res) => {
  const periodId = req.query.fiscal_period_id;
  if (!periodId) return res.status(400).json({ error: 'fiscal_period_id required' });
  const report = await accounting.getProfitLossReport(req.user.company_id, periodId);
  return res.json(report);
});

router.get('/reports/vat-return', requirePermission('finance.view'), async (req, res) => {
  const report = await accounting.getVatReport(
    req.user.company_id,
    req.query.from_date,
    req.query.to_date,
  );
  return res.json(report);
});

router.get('/reports/excise-return', requirePermission('finance.view'), async (req, res) => {
  const report = await accounting.getExciseReport(
    req.user.company_id,
    req.query.from_date,
    req.query.to_date,
  );
  return res.json(report);
});

router.get('/reports/multi-period', requirePermission('finance.view'), async (req, res) => {
  const periodIds = typeof req.query.period_ids === 'string'
    ? req.query.period_ids.split(',').filter(Boolean)
    : undefined;
  const report = await accounting.getMultiPeriodReport(req.user.company_id, {
    periodIds,
    fiscalYearId: req.query.fiscal_year_id,
  });
  return res.json(report);
});

router.get('/reports/aging-summary', requirePermission('finance.view'), async (req, res) => {
  try {
    const [arData, apData] = await Promise.all([
      reporting.runStandardReport(req.user.company_id, 'ar_aging'),
      reporting.runStandardReport(req.user.company_id, 'ap_aging'),
    ]);
    const arBuckets = aggregateAgingBuckets(arData.rows, 'outstanding');
    const apBuckets = aggregateAgingBuckets(apData.rows, 'total_amount');
    return res.json({ buckets: mergeArApBuckets(arBuckets, apBuckets) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/reports/cash-flow-forecast', requirePermission('finance.view'), async (req, res) => {
  try {
    const data = await reporting.runStandardReport(req.user.company_id, 'cash_flow_forecast');
    return res.json({ weeks: data.rows });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/dimensions', requirePermission('finance.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM erp_dimensions
     WHERE company_id = $1 AND is_deleted = FALSE ORDER BY dimension_type, code`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get('/vendor-bills', requirePermission('finance.view'), async (req, res) => {
  const result = await pool.query(
    `SELECT vb.*, v.name AS vendor_name, po.po_number, g.grn_number
     FROM erp_vendor_invoices vb
     JOIN erp_vendors v ON v.id = vb.vendor_id
     LEFT JOIN erp_purchase_orders po ON po.id = vb.purchase_order_id
     LEFT JOIN erp_goods_receipts g ON g.id = vb.goods_receipt_id
     WHERE vb.company_id = $1 AND vb.is_deleted = FALSE
     ORDER BY vb.bill_date DESC`,
    [req.user.company_id],
  );
  return res.json(result.rows);
});

router.get('/vendor-bills/:id', requirePermission('finance.view'), async (req, res) => {
  const bill = await pool.query(
    `SELECT vb.*, v.name AS vendor_name, po.po_number, g.grn_number
     FROM erp_vendor_invoices vb
     JOIN erp_vendors v ON v.id = vb.vendor_id
     LEFT JOIN erp_purchase_orders po ON po.id = vb.purchase_order_id
     LEFT JOIN erp_goods_receipts g ON g.id = vb.goods_receipt_id
     WHERE vb.id = $1 AND vb.company_id = $2`,
    [req.params.id, req.user.company_id],
  );
  if (!bill.rowCount) return res.status(404).json({ error: 'Not found' });
  const lines = await pool.query(
    `SELECT vil.*, i.item_code, i.name AS item_name
     FROM erp_vendor_invoice_lines vil
     JOIN erp_items i ON i.id = vil.item_id
     WHERE vil.invoice_id = $1 ORDER BY vil.line_no`,
    [req.params.id],
  );
  return res.json({ ...bill.rows[0], lines: lines.rows });
});

router.post('/vendor-bills/from-grn', requirePermission('finance.create'), async (req, res) => {
  const { goods_receipt_id, vendor_ref, bill_date, due_date } = req.body || {};
  if (!goods_receipt_id) return res.status(400).json({ error: 'goods_receipt_id required' });
  try {
    const bill = await ap.createVendorBillFromGrn({
      companyId: req.user.company_id,
      userId: req.user.id,
      goodsReceiptId: goods_receipt_id,
      vendorRef: vendor_ref,
      billDate: bill_date,
      dueDate: due_date,
    });
    return res.status(201).json(bill);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/vendor-bills/:id/post', requirePermission('finance.approve'), async (req, res) => {
  try {
    const bill = await ap.postVendorBill({
      companyId: req.user.company_id,
      userId: req.user.id,
      billId: req.params.id,
    });
    return res.json(bill);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/vendor-bills/:id/pay', requirePermission('finance.create'), async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount required' });
  try {
    const result = await ap.recordVendorPayment({
      companyId: req.user.company_id,
      userId: req.user.id,
      invoiceId: req.params.id,
      paymentDate: req.body?.payment_date,
      amount,
      referenceNo: req.body?.reference_no,
      paymentMethod: req.body?.payment_method,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/month-end/open-period', requirePermission('finance.view'), async (req, res) => {
  const period = await monthEnd.getOpenPeriod(req.user.company_id);
  return res.json(period || null);
});

router.get('/month-end/:periodId/preview', requirePermission('finance.view'), async (req, res) => {
  try {
    const preview = await monthEnd.previewMonthEnd(req.user.company_id, req.params.periodId);
    return res.json(preview);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/month-end/:periodId/close', requirePermission('finance.approve'), requireReauth(), async (req, res) => {
  try {
    const result = await monthEnd.executeMonthEnd({
      companyId: req.user.company_id,
      userId: req.user.id,
      periodId: req.params.periodId,
      force: Boolean(req.body?.force),
    });
    liveEvents.publish(req.user.company_id, 'finance.period_closed', { period_id: req.params.periodId });
    return res.json(result);
  } catch (err) {
    if (err.code === 'MONTH_END_BLOCKED') {
      return res.status(409).json({ error: err.message, details: err.details });
    }
    return res.status(400).json({ error: err.message });
  }
});

router.get('/bank-accounts', requirePermission('finance.view'), async (req, res) => {
  const rows = await bankRecon.listBankAccounts(req.user.company_id);
  return res.json(rows);
});

router.get('/bank-recon/unmatched', requirePermission('finance.view'), async (req, res) => {
  const bankAccountId = req.query.bank_account_id;
  if (!bankAccountId) return res.status(400).json({ error: 'bank_account_id required' });
  const data = await bankRecon.getUnmatched(req.user.company_id, bankAccountId);
  const suggestions = await bankRecon.suggestMatches(req.user.company_id, bankAccountId);
  return res.json({ ...data, suggestions });
});

router.post('/bank-recon/import', requirePermission('finance.create'), async (req, res) => {
  try {
    const result = await bankRecon.importStatementLines({
      companyId: req.user.company_id,
      userId: req.user.id,
      bankAccountId: req.body.bank_account_id,
      lines: req.body.lines,
    });
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/bank-recon/match', requirePermission('finance.approve'), async (req, res) => {
  try {
    const row = await bankRecon.matchStatementLine({
      companyId: req.user.company_id,
      userId: req.user.id,
      statementLineId: req.body.statement_line_id,
      receiptId: req.body.receipt_id,
      journalId: req.body.journal_id,
    });
    return res.json(row);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/vendor-payments/:paymentNo/pdf', requirePermission('finance.view'), async (req, res) => {
  const paymentNo = String(req.params.paymentNo || '').trim();
  try {
    const buffer = await renderVendorPaymentPdfBuffer({
      companyId: req.user.company_id,
      paymentNo,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="vendor-payment-${paymentNo}.pdf"`);
    return res.send(buffer);
  } catch (err) {
    return res.status(err.message === 'Vendor payment not found' ? 404 : 500).json({ error: err.message });
  }
});

router.get('/vendor-payments/:paymentNo/verify', requirePermission('finance.view'), async (req, res) => {
  const paymentNo = String(req.params.paymentNo || '').trim();
  const provided = String(req.query?.hash || '').trim();
  const result = await pool.query(
    `SELECT p.*, v.name AS vendor_name
     FROM erp_vendor_payments p
     JOIN erp_vendors v ON v.id = p.vendor_id
     WHERE p.company_id = $1 AND p.payment_no = $2 AND p.is_deleted = FALSE`,
    [req.user.company_id, paymentNo],
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Vendor payment not found' });
  const payment = result.rows[0];
  const expected = buildVendorPaymentHash(payment);
  return res.json({
    payment_no: payment.payment_no,
    vendor_name: payment.vendor_name,
    amount: payment.amount,
    verification_hash: expected,
    valid: provided ? provided === expected : undefined,
  });
});

module.exports = router;
