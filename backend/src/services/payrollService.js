const pool = require('../db');
const piiCrypto = require('../lib/piiCrypto');
const gl = require('./glPostingService');
const liveEvents = require('./liveEventsService');

const DEFAULT_PAYE_BANDS = [
  { min: 0, max: 24000, rate: 10 },
  { min: 24001, max: 32333, rate: 25 },
  { min: 32334, max: 500000, rate: 30 },
  { min: 500001, max: 800000, rate: 32.5 },
  { min: 800001, max: null, rate: 35 },
];

const DEFAULT_NHIF = [
  { min: 0, max: 5999, amount: 150 },
  { min: 6000, max: 7999, amount: 300 },
  { min: 8000, max: 11999, amount: 400 },
  { min: 12000, max: 14999, amount: 500 },
  { min: 15000, max: 19999, amount: 600 },
  { min: 20000, max: 24999, amount: 750 },
  { min: 25000, max: 29999, amount: 850 },
  { min: 30000, max: 34999, amount: 900 },
  { min: 35000, max: 39999, amount: 950 },
  { min: 40000, max: 44999, amount: 1000 },
  { min: 45000, max: 49999, amount: 1100 },
  { min: 50000, max: 59999, amount: 1200 },
  { min: 60000, max: 69999, amount: 1300 },
  { min: 70000, max: 79999, amount: 1400 },
  { min: 80000, max: 89999, amount: 1500 },
  { min: 90000, max: 99999, amount: 1600 },
  { min: 100000, max: null, amount: 1700 },
];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function calculatePaye(taxableIncome, bands) {
  let remaining = taxableIncome;
  let tax = 0;
  const sorted = [...bands].sort((a, b) => a.min - b.min);

  for (const band of sorted) {
    if (remaining <= 0) break;
    const bandMin = band.min;
    const bandMax = band.max == null ? Infinity : band.max;
    const width = bandMax - bandMin + (bandMin === 0 ? 0 : 1);
    const taxableInBand = Math.min(remaining, width);
    tax += (taxableInBand * band.rate) / 100;
    remaining -= taxableInBand;
  }
  return round2(tax);
}

function calculateNhif(grossPay, brackets = DEFAULT_NHIF) {
  for (const b of brackets) {
    const max = b.max == null ? Infinity : b.max;
    if (grossPay >= b.min && grossPay <= max) return b.amount;
  }
  return 1700;
}

const NSSF_TIER_I_LIMIT = 7000;
const NSSF_TIER_II_LIMIT = 36000;
const NSSF_RATE = 0.06;

function calculateNssf(pensionablePay) {
  const pay = Number(pensionablePay || 0);
  const tier1Base = Math.min(pay, NSSF_TIER_I_LIMIT);
  const tier1 = round2(tier1Base * NSSF_RATE);
  const tier2Base = Math.min(Math.max(pay - NSSF_TIER_I_LIMIT, 0), NSSF_TIER_II_LIMIT - NSSF_TIER_I_LIMIT);
  const tier2 = round2(tier2Base * NSSF_RATE);
  return { tier1, tier2, total: round2(tier1 + tier2) };
}

function calculateHousingLevy(grossPay, rate = 1.5) {
  return round2((grossPay * rate) / 100);
}

async function getPayrollConfig(companyId) {
  const result = await pool.query('SELECT * FROM erp_payroll_config WHERE company_id = $1', [companyId]);
  if (result.rowCount) return result.rows[0];
  return {
    paye_bands: DEFAULT_PAYE_BANDS,
    nhif_brackets: DEFAULT_NHIF,
    nssf_ceiling: 4320,
    housing_levy_rate: 1.5,
  };
}

function computePayslip(employee, contract, config, extras = {}) {
  const basic = Number(contract?.basic_salary ?? employee.basic_salary ?? 0);
  const house = Number(contract?.house_allowance ?? 0);
  const transport = Number(contract?.transport_allowance ?? 0);
  const overtime = Number(extras.overtime ?? 0);
  const commission = Number(extras.commission ?? 0);

  const grossPay = round2(basic + house + transport + overtime + commission);
  const nhif = calculateNhif(grossPay, config.nhif_brackets || DEFAULT_NHIF);
  const nssfBreakdown = calculateNssf(grossPay);
  const nssf = nssfBreakdown.total;
  const housingLevy = calculateHousingLevy(grossPay, Number(config.housing_levy_rate || 1.5));

  const taxableIncome = round2(grossPay - nssf);
  const paye = calculatePaye(taxableIncome, config.paye_bands || DEFAULT_PAYE_BANDS);

  const helb = round2(extras.helb ?? 0);
  const sacco = round2(extras.sacco ?? 0);
  const loan = round2(extras.loan ?? 0);
  const other = round2(extras.other ?? 0);

  const totalDeductions = round2(paye + nhif + nssf + housingLevy + helb + sacco + loan + other);
  const netPay = round2(grossPay - totalDeductions);

  return {
    gross_pay: grossPay,
    paye,
    nhif,
    nssf,
    housing_levy: housingLevy,
    helb,
    sacco,
    loan_deduction: loan,
    other_deductions: other,
    net_pay: netPay,
    earnings_detail: [
      { code: 'BASIC', amount: basic },
      { code: 'HOUSE', amount: house },
      { code: 'TRANSPORT', amount: transport },
      { code: 'OT', amount: overtime },
      { code: 'COMM', amount: commission },
    ].filter((e) => e.amount > 0),
    nssf_tier1: nssfBreakdown.tier1,
    nssf_tier2: nssfBreakdown.tier2,
    deductions_detail: [
      { code: 'PAYE', amount: paye },
      { code: 'NHIF', amount: nhif },
      { code: 'NSSF_TIER_I', amount: nssfBreakdown.tier1 },
      { code: 'NSSF_TIER_II', amount: nssfBreakdown.tier2 },
      { code: 'NSSF', amount: nssf },
      { code: 'HOUSING_LEVY', amount: housingLevy },
      { code: 'HELB', amount: helb },
      { code: 'SACCO', amount: sacco },
      { code: 'LOAN', amount: loan },
      { code: 'OTHER', amount: other },
    ].filter((d) => d.amount > 0),
  };
}

async function runPayroll({ companyId, userId, payrollMonth, employeeExtras = {} }) {
  const config = await getPayrollConfig(companyId);
  const monthDate = payrollMonth || new Date().toISOString().slice(0, 7) + '-01';

  const employees = await pool.query(
    `SELECT e.*, ec.basic_salary, ec.house_allowance, ec.transport_allowance,
            ec.basic_salary_enc, ec.house_allowance_enc, ec.transport_allowance_enc,
            e.basic_salary_enc AS employee_basic_salary_enc
     FROM erp_employees e
     LEFT JOIN erp_employee_contracts ec ON ec.employee_id = e.id AND ec.status = 'active'
     WHERE e.company_id = $1 AND e.is_active = TRUE AND e.is_deleted = FALSE`,
    [companyId],
  );
  employees.rows = employees.rows.map((row) => piiCrypto.mergePayrollEmployeeRow(row));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const runNo = `PR-${monthDate.slice(0, 7)}`;

    const existingRun = await client.query(
      `SELECT id, status FROM erp_payroll_runs WHERE company_id = $1 AND run_no = $2`,
      [companyId, runNo],
    );
    if (existingRun.rowCount && existingRun.rows[0].status === 'posted') {
      throw new Error('Payroll for this period is already posted and cannot be recalculated');
    }

    const postedMonth = await client.query(
      `SELECT id FROM erp_payroll_runs
       WHERE company_id = $1 AND date_trunc('month', payroll_month) = date_trunc('month', $2::date)
         AND status = 'posted' AND is_deleted = FALSE`,
      [companyId, monthDate],
    );
    if (postedMonth.rowCount) {
      throw new Error('Payroll for this calendar month is already posted');
    }

    const runResult = await client.query(
      `INSERT INTO erp_payroll_runs (company_id, run_no, payroll_month, status, created_by)
       VALUES ($1, $2, $3::date, 'calculated', $4)
       ON CONFLICT (company_id, run_no) DO UPDATE SET status = 'calculated', updated_at = NOW()
       RETURNING *`,
      [companyId, runNo, monthDate, userId],
    );
    const run = runResult.rows[0];

    await client.query('DELETE FROM erp_payslips WHERE payroll_run_id = $1', [run.id]);

    let totalGross = 0;
    let totalDed = 0;
    let totalNet = 0;

    for (const emp of employees.rows) {
      const dupEmp = await client.query(
        `SELECT pr.run_no FROM erp_payslips ps
         JOIN erp_payroll_runs pr ON pr.id = ps.payroll_run_id
         WHERE ps.company_id = $1 AND ps.employee_id = $2
           AND date_trunc('month', pr.payroll_month) = date_trunc('month', $3::date)
           AND pr.status = 'posted'`,
        [companyId, emp.id, monthDate],
      );
      if (dupEmp.rowCount) {
        throw new Error(`Employee ${emp.employee_code} already has posted payroll for this month (${dupEmp.rows[0].run_no})`);
      }

      const extras = employeeExtras[emp.id] || {};
      const slip = computePayslip(emp, emp, config, extras);

      await client.query(
        `INSERT INTO erp_payslips (
           company_id, payroll_run_id, employee_id, gross_pay, paye, nhif, nssf,
           housing_levy, helb, sacco, loan_deduction, other_deductions, net_pay,
           earnings_detail, deductions_detail, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16)`,
        [
          companyId, run.id, emp.id, slip.gross_pay, slip.paye, slip.nhif, slip.nssf,
          slip.housing_levy, slip.helb, slip.sacco, slip.loan_deduction, slip.other_deductions,
          slip.net_pay, JSON.stringify(slip.earnings_detail), JSON.stringify(slip.deductions_detail), userId,
        ],
      );

      totalGross += slip.gross_pay;
      totalDed += slip.gross_pay - slip.net_pay;
      totalNet += slip.net_pay;
    }

    await client.query(
      `UPDATE erp_payroll_runs SET total_gross = $2, total_deductions = $3, total_net = $4, updated_at = NOW()
       WHERE id = $1`,
      [run.id, totalGross, totalDed, totalNet],
    );

    await client.query('COMMIT');
    return { run_id: run.id, run_no: run.run_no, employees: employees.rowCount, total_gross: totalGross, total_net: totalNet };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postPayrollToGl({ companyId, userId, runId }) {
  const runResult = await pool.query(
    `SELECT * FROM erp_payroll_runs WHERE id = $1 AND company_id = $2 AND status IN ('calculated', 'approved')`,
    [runId, companyId],
  );
  const run = runResult.rows[0];
  if (!run) throw new Error('Payroll run not found or not ready to post');

  const slips = await pool.query('SELECT SUM(gross_pay) AS gross, SUM(net_pay) AS net, SUM(paye) AS paye, SUM(nssf) AS nssf FROM erp_payslips WHERE payroll_run_id = $1', [runId]);
  const s = slips.rows[0];
  const gross = Number(s.gross);
  const net = Number(s.net);
  const paye = Number(s.paye);
  const nssf = Number(s.nssf);
  const otherDed = gross - net - paye - nssf;

  const accounts = await pool.query(
    `SELECT id, account_code FROM erp_chart_of_accounts WHERE company_id = $1 AND account_code IN ('6100','6000','1100','2100')`,
    [companyId],
  );
  const byCode = Object.fromEntries(accounts.rows.map((a) => [a.account_code, a.id]));
  const expenseAccountId = byCode['6100'] || byCode['6000'];
  if (!expenseAccountId || !byCode['1100']) throw new Error('Payroll GL accounts not configured (6100/6000, 1100)');

  const lines = [
    { account_id: expenseAccountId, debit: gross, credit: 0, description: 'Payroll expense' },
    { account_id: byCode['1100'], debit: 0, credit: net, description: 'Net pay payable' },
  ];
  if (byCode['2100']) {
    if (paye > 0) lines.push({ account_id: byCode['2100'], debit: 0, credit: paye, description: 'PAYE payable' });
    if (nssf + otherDed > 0) lines.push({ account_id: byCode['2100'], debit: 0, credit: nssf + otherDed, description: 'Statutory deductions' });
  }

  const journal = await gl.createJournal({
    companyId,
    userId,
    entryDate: run.payroll_month,
    journalType: 'payroll',
    referenceNo: run.run_no,
    description: `Payroll ${run.run_no}`,
    lines,
  });
  await gl.postJournal({ journalId: journal.id, companyId, userId });

  await pool.query(
    `UPDATE erp_payroll_runs SET status = 'posted', posted_at = NOW(), journal_id = $3, updated_at = NOW()
     WHERE id = $1 AND company_id = $2`,
    [runId, companyId, journal.id],
  );

  liveEvents.publish(companyId, 'payroll.posted', { run_id: runId });

  return { ok: true, journal_id: journal.id };
}

async function approvePayrollRun({ companyId, userId, runId }) {
  const result = await pool.query(
    `UPDATE erp_payroll_runs
     SET status = 'approved', updated_at = NOW(), updated_by = $3
     WHERE id = $1 AND company_id = $2 AND status = 'calculated'
     RETURNING *`,
    [runId, companyId, userId],
  );
  if (!result.rowCount) throw new Error('Payroll run not found or not ready for approval');
  return result.rows[0];
}

function exportPayrollBankFile(payslips) {
  const header = 'employee_code,employee_name,bank_account,net_pay,reference';
  const lines = [header];
  for (const row of payslips) {
    const name = `${row.first_name || ''} ${row.last_name || ''}`.trim();
    const acct = row.bank_account_no || row.bank_account || '';
    const net = Number(row.net_pay || 0).toFixed(2);
    const ref = row.employee_code || row.id;
    lines.push([ref, `"${name.replace(/"/g, '""')}"`, acct, net, `PAY-${ref}`].join(','));
  }
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

async function buildPayrollBankExport(companyId, runId) {
  const slips = await pool.query(
    `SELECT ps.net_pay, e.employee_code, e.first_name, e.last_name, e.bank_account_no AS bank_account_no
     FROM erp_payslips ps
     JOIN erp_employees e ON e.id = ps.employee_id
     WHERE ps.payroll_run_id = $1 AND ps.company_id = $2
     ORDER BY e.last_name`,
    [runId, companyId],
  );
  if (!slips.rowCount) throw new Error('No payslips on this payroll run');
  return { buffer: exportPayrollBankFile(slips.rows), rows: slips.rowCount };
}

module.exports = {
  computePayslip,
  calculatePaye,
  calculateNhif,
  calculateNssf,
  runPayroll,
  approvePayrollRun,
  postPayrollToGl,
  buildPayrollBankExport,
  exportPayrollBankFile,
  getPayrollConfig,
};
