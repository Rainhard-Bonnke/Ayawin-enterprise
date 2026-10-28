const pool = require("../db");
const gl = require("./glPostingService");

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
  let remaining = Math.max(0, Number(taxableIncome) || 0);
  let tax = 0;
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  let previousLimit = 0;

  for (const band of sorted) {
    if (remaining <= 0) break;
    const bandMax = band.max == null ? Infinity : Number(band.max);
    const width = bandMax - previousLimit;
    if (width <= 0) continue;
    const taxableInBand = Math.min(remaining, width);
    tax += (taxableInBand * band.rate) / 100;
    remaining -= taxableInBand;
    previousLimit = bandMax;
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

function calculateNssfBreakdown(pensionablePay, tier1Limit = 9000, upperLimit = 108000, rate = 6) {
  const pensionable = Math.max(0, Number(pensionablePay) || 0);
  const tier1 = round2((Math.min(pensionable, tier1Limit) * rate) / 100);
  const tier2 = round2((Math.max(0, Math.min(pensionable, upperLimit) - tier1Limit) * rate) / 100);
  return { tier1, tier2, total: round2(tier1 + tier2) };
}

function calculateNssf(pensionablePay, ceiling = 108000, tier1Limit = 9000, rate = 6) {
  const upperLimit = Math.max(0, Number(ceiling) || 0);
  return calculateNssfBreakdown(pensionablePay, Math.min(tier1Limit, upperLimit), upperLimit, rate)
    .total;
}

function calculateHousingLevy(grossPay, rate = 1.5) {
  return round2((grossPay * rate) / 100);
}

function configForPayrollMonth(config, payrollMonth) {
  const month = String(payrollMonth || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return config;

  // Year 4 took effect in February 2026; earlier periods must not inherit its higher cap.
  if (month >= "2026-02") {
    return { ...config, nssf_tier1_limit: 9000, nssf_upper_limit: 108000, nssf_ceiling: 108000 };
  }
  if (month >= "2025-02") {
    return { ...config, nssf_tier1_limit: 8000, nssf_upper_limit: 72000, nssf_ceiling: 72000 };
  }
  if (month >= "2024-02") {
    return { ...config, nssf_tier1_limit: 7000, nssf_upper_limit: 36000, nssf_ceiling: 36000 };
  }
  if (month >= "2023-02") {
    return { ...config, nssf_tier1_limit: 6000, nssf_upper_limit: 18000, nssf_ceiling: 18000 };
  }
  return config;
}

async function getPayrollConfig(companyId, payrollMonth) {
  const result = await pool.query("SELECT * FROM erp_payroll_config WHERE company_id = $1", [
    companyId,
  ]);
  const defaults = {
    paye_bands: DEFAULT_PAYE_BANDS,
    nssf_ceiling: 108000,
    nssf_tier1_limit: 9000,
    nssf_upper_limit: 108000,
    nssf_employee_rate: 6,
    nssf_employer_rate: 6,
    shif_rate: 2.75,
    shif_minimum: 300,
    housing_levy_rate: 1.5,
    personal_relief: 2400,
    insurance_relief_rate: 15,
    insurance_relief_cap: 5000,
  };
  return configForPayrollMonth(result.rowCount ? result.rows[0] : defaults, payrollMonth);
}

function computePayslip(employee, contract, config, extras = {}) {
  const basic = Number(contract?.basic_salary ?? employee.basic_salary ?? 0);
  const house = Number(contract?.house_allowance ?? 0);
  const transport = Number(contract?.transport_allowance ?? 0);
  const overtime = Number(extras.overtime ?? 0);
  const commission = Number(extras.commission ?? 0);

  const grossPay = round2(basic + house + transport + overtime + commission);
  const shifRate = Number(config.shif_rate ?? 2.75);
  const shif =
    grossPay > 0
      ? Math.max(Number(config.shif_minimum ?? 300), round2((grossPay * shifRate) / 100))
      : 0;
  const nssfEmployee = calculateNssfBreakdown(
    grossPay,
    Number(config.nssf_tier1_limit ?? 9000),
    Number(config.nssf_upper_limit ?? config.nssf_ceiling ?? 108000),
    Number(config.nssf_employee_rate ?? 6),
  );
  const nssfEmployer = calculateNssfBreakdown(
    grossPay,
    Number(config.nssf_tier1_limit ?? 9000),
    Number(config.nssf_upper_limit ?? config.nssf_ceiling ?? 108000),
    Number(config.nssf_employer_rate ?? 6),
  );
  const nssf = nssfEmployee.total;
  const housingLevy = calculateHousingLevy(grossPay, Number(config.housing_levy_rate || 1.5));
  const housingLevyEmployer = housingLevy;

  const pensionDeduction = Math.max(0, Number(extras.pension_deduction ?? 0));
  const pensionTaxDeduction = Math.min(30000, nssf + pensionDeduction);
  const medicalFundDeduction = Math.min(
    15000,
    Math.max(0, Number(extras.post_retirement_medical ?? 0)),
  );
  const mortgageInterestDeduction = Math.min(
    30000,
    Math.max(0, Number(extras.mortgage_interest ?? 0)),
  );
  const taxableIncome = round2(
    Math.max(
      0,
      grossPay -
        pensionTaxDeduction -
        medicalFundDeduction -
        mortgageInterestDeduction -
        shif -
        housingLevy,
    ),
  );
  const taxBeforeRelief = calculatePaye(taxableIncome, config.paye_bands || DEFAULT_PAYE_BANDS);
  const personalRelief =
    employee.tax_resident === false
      ? 0
      : Math.min(
          taxBeforeRelief,
          Math.max(0, Number(extras.personal_relief ?? config.personal_relief ?? 2400)),
        );
  const insurancePremiums = Math.max(0, Number(extras.insurance_premiums ?? 0));
  const insuranceRelief = Math.min(
    Math.max(0, Number(config.insurance_relief_cap ?? 5000)),
    round2((insurancePremiums * Number(config.insurance_relief_rate ?? 15)) / 100),
    Math.max(0, taxBeforeRelief - personalRelief),
  );
  const paye = round2(Math.max(0, taxBeforeRelief - personalRelief - insuranceRelief));

  const helb = round2(extras.helb ?? 0);
  const sacco = round2(extras.sacco ?? 0);
  const loan = round2(extras.loan ?? 0);
  const other = round2(extras.other ?? 0);

  const totalDeductions = round2(paye + shif + nssf + housingLevy + helb + sacco + loan + other);
  const netPay = round2(grossPay - totalDeductions);
  const employerCost = round2(grossPay + nssfEmployer.total + housingLevyEmployer);

  return {
    gross_pay: grossPay,
    paye,
    nhif: 0,
    shif,
    nssf,
    nssf_tier1: nssfEmployee.tier1,
    nssf_tier2: nssfEmployee.tier2,
    nssf_employer: nssfEmployer.total,
    housing_levy: housingLevy,
    housing_levy_employer: housingLevyEmployer,
    taxable_income: taxableIncome,
    personal_relief: personalRelief,
    insurance_relief: insuranceRelief,
    employer_cost: employerCost,
    helb,
    sacco,
    loan_deduction: loan,
    other_deductions: other,
    net_pay: netPay,
    earnings_detail: [
      { code: "BASIC", amount: basic },
      { code: "HOUSE", amount: house },
      { code: "TRANSPORT", amount: transport },
      { code: "OT", amount: overtime },
      { code: "COMM", amount: commission },
    ].filter((e) => e.amount > 0),
    deductions_detail: [
      { code: "PAYE", amount: paye },
      { code: "SHIF", amount: shif },
      { code: "NSSF_TIER_I", amount: nssfEmployee.tier1 },
      { code: "NSSF_TIER_II", amount: nssfEmployee.tier2 },
      { code: "HOUSING_LEVY", amount: housingLevy },
      { code: "HELB", amount: helb },
      { code: "SACCO", amount: sacco },
      { code: "LOAN", amount: loan },
      { code: "OTHER", amount: other },
    ].filter((d) => d.amount > 0),
  };
}

async function runPayroll({ companyId, userId, payrollMonth, employeeExtras = {} }) {
  const monthDate = payrollMonth || new Date().toISOString().slice(0, 7) + "-01";
  const config = await getPayrollConfig(companyId, monthDate);

  const employees = await pool.query(
    `SELECT e.*, ec.basic_salary, ec.house_allowance, ec.transport_allowance
     FROM erp_employees e
     LEFT JOIN erp_employee_contracts ec ON ec.employee_id = e.id AND ec.status = 'active'
     WHERE e.company_id = $1 AND e.is_active = TRUE AND e.is_deleted = FALSE`,
    [companyId],
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const runNo = `PR-${monthDate.slice(0, 7)}`;

    let runResult = await client.query(
      `INSERT INTO erp_payroll_runs (company_id, run_no, payroll_month, status, created_by)
       VALUES ($1, $2, $3::date, 'calculated', $4)
       ON CONFLICT (company_id, run_no) DO NOTHING
       RETURNING *`,
      [companyId, runNo, monthDate, userId],
    );
    if (!runResult.rowCount) {
      runResult = await client.query(
        `SELECT * FROM erp_payroll_runs WHERE company_id = $1 AND run_no = $2 FOR UPDATE`,
        [companyId, runNo],
      );
      if (["approved", "posting", "posted"].includes(runResult.rows[0]?.status)) {
        throw new Error(
          "This payroll month is approved or already posted and cannot be recalculated.",
        );
      }
      runResult = await client.query(
        `UPDATE erp_payroll_runs SET status = 'calculated', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [runResult.rows[0].id],
      );
    }
    const run = runResult.rows[0];

    await client.query("DELETE FROM erp_payslips WHERE payroll_run_id = $1", [run.id]);

    let totalGross = 0;
    let totalDed = 0;
    let totalNet = 0;
    let totalEmployerCost = 0;

    for (const emp of employees.rows) {
      const extras = employeeExtras[emp.id] || {};
      const slip = computePayslip(emp, emp, config, extras);

      await client.query(
        `INSERT INTO erp_payslips (
         company_id, payroll_run_id, employee_id, gross_pay, paye, nhif, nssf,
           housing_levy, helb, sacco, loan_deduction, other_deductions, net_pay,
           earnings_detail, deductions_detail, created_by, shif, nssf_tier1, nssf_tier2,
           nssf_employer, housing_levy_employer, taxable_income, personal_relief,
           insurance_relief, employer_cost, payroll_rules
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb)`,
        [
          companyId,
          run.id,
          emp.id,
          slip.gross_pay,
          slip.paye,
          slip.nhif,
          slip.nssf,
          slip.housing_levy,
          slip.helb,
          slip.sacco,
          slip.loan_deduction,
          slip.other_deductions,
          slip.net_pay,
          JSON.stringify(slip.earnings_detail),
          JSON.stringify(slip.deductions_detail),
          userId,
          slip.shif,
          slip.nssf_tier1,
          slip.nssf_tier2,
          slip.nssf_employer,
          slip.housing_levy_employer,
          slip.taxable_income,
          slip.personal_relief,
          slip.insurance_relief,
          slip.employer_cost,
          JSON.stringify({
            version: "KE-2026-02",
            shif_rate: Number(config.shif_rate ?? 2.75),
            nssf_tier1_limit: Number(config.nssf_tier1_limit ?? 9000),
            nssf_upper_limit: Number(config.nssf_upper_limit ?? config.nssf_ceiling ?? 108000),
            nssf_employee_rate: Number(config.nssf_employee_rate ?? 6),
            nssf_employer_rate: Number(config.nssf_employer_rate ?? 6),
            housing_levy_rate: Number(config.housing_levy_rate ?? 1.5),
            paye_bands: config.paye_bands || DEFAULT_PAYE_BANDS,
          }),
        ],
      );

      totalGross += slip.gross_pay;
      totalDed += slip.gross_pay - slip.net_pay;
      totalNet += slip.net_pay;
      totalEmployerCost += slip.employer_cost;
    }

    await client.query(
      `UPDATE erp_payroll_runs SET total_gross = $2, total_deductions = $3, total_net = $4, total_employer_cost = $5, updated_at = NOW()
       WHERE id = $1`,
      [run.id, totalGross, totalDed, totalNet, totalEmployerCost],
    );

    await client.query("COMMIT");
    return {
      run_id: run.id,
      run_no: run.run_no,
      employees: employees.rowCount,
      total_gross: totalGross,
      total_net: totalNet,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function postPayrollToGl({ companyId, userId, runId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const runResult = await client.query(
      `SELECT * FROM erp_payroll_runs WHERE id = $1 AND company_id = $2 AND status = 'calculated' FOR UPDATE`,
      [runId, companyId],
    );
    const run = runResult.rows[0];
    if (!run) throw new Error("Payroll run not found or not ready to post");
    const slips = await client.query(
      `SELECT SUM(gross_pay) AS gross, SUM(net_pay) AS net,
         SUM(paye) AS paye, SUM(shif + nhif) AS health, SUM(nssf) AS nssf_employee,
         SUM(nssf_employer) AS nssf_employer, SUM(housing_levy) AS housing_employee,
         SUM(housing_levy_employer) AS housing_employer,
         SUM(helb + sacco + loan_deduction + other_deductions) AS other_deductions
       FROM erp_payslips WHERE payroll_run_id = $1 AND company_id = $2`,
      [runId, companyId],
    );
    const totals = slips.rows[0];
    const gross = Number(totals.gross || 0);
    const net = Number(totals.net || 0);
    const paye = Number(totals.paye || 0);
    const health = Number(totals.health || 0);
    const nssfEmployee = Number(totals.nssf_employee || 0);
    const housingEmployee = Number(totals.housing_employee || 0);
    const otherDeductions = Number(totals.other_deductions || 0);
    const employerContributions = Number(totals.nssf_employer || 0) + Number(totals.housing_employer || 0);
    const accounts = await client.query(
      `SELECT id, account_code FROM erp_chart_of_accounts WHERE company_id = $1
       AND account_code IN ('6100','6000','1100','2100','2110','2120','2130','2140','2150','2160')
       AND is_active = TRUE AND is_deleted = FALSE AND is_postable = TRUE`, [companyId],
    );
    const byCode = Object.fromEntries(accounts.rows.map((account) => [account.account_code, account.id]));
    const expenseAccountId = byCode["6100"] || byCode["6000"];
    if (!expenseAccountId || !byCode["2160"] || !byCode["2100"]) {
      throw new Error("Payroll GL accounts not configured (6100 expense, 2160 net wages payable, statutory liabilities)");
    }
    const lines = [
      { account_id: expenseAccountId, debit: gross + employerContributions, credit: 0, description: "Payroll and employer statutory contributions" },
      { account_id: byCode["2160"], debit: 0, credit: net, description: "Net wages payable" },
    ];
    const addPayable = (code, amount, description) => {
      if (amount <= 0) return;
      const accountId = byCode[code] || (code === "2150" ? byCode["2100"] : null);
      if (!accountId) throw new Error(`Payroll liability account ${code} is missing`);
      lines.push({ account_id: accountId, debit: 0, credit: amount, description });
    };
    addPayable("2110", paye, "PAYE payable");
    addPayable("2120", nssfEmployee + Number(totals.nssf_employer || 0), "Employee and employer NSSF payable");
    addPayable("2130", health, "SHIF and legacy health deductions payable");
    addPayable("2140", housingEmployee + Number(totals.housing_employer || 0), "Employee and employer housing levy payable");
    addPayable("2150", otherDeductions, "Other payroll deductions payable");
    const journal = await gl.createJournalInTransaction(client, {
      companyId, userId, entryDate: run.payroll_month, journalType: "payroll",
      referenceNo: run.run_no, description: `Payroll ${run.run_no}`, lines,
    });
    await gl.postJournalInTransaction(client, { journalId: journal.id, companyId, userId });
    await client.query(
      `UPDATE erp_payroll_runs SET status = 'posted', posted_at = NOW(), journal_id = $3, updated_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [runId, companyId, journal.id],
    );
    await client.query("COMMIT");
    return { ok: true, journal_id: journal.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}


module.exports = {
  computePayslip,
  calculatePaye,
  calculateNhif,
  calculateNssf,
  calculateNssfBreakdown,
  configForPayrollMonth,
  runPayroll,
  postPayrollToGl,
  getPayrollConfig,
};
