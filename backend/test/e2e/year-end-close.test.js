const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { getTestContext, pool } = require("./helpers");
const gl = require("../../src/services/glPostingService");
const fiscalYears = require("../../src/services/fiscalYearService");
const userService = require("../../src/services/userService");
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) process.env.JWT_SECRET=crypto.randomBytes(48).toString("hex");
if (!process.env.MFA_ENCRYPTION_KEY || process.env.MFA_ENCRYPTION_KEY.length < 32 || process.env.MFA_ENCRYPTION_KEY===process.env.JWT_SECRET) process.env.MFA_ENCRYPTION_KEY=crypto.randomBytes(48).toString("hex");
if (!process.env.DOC_VERIFY_SECRET || process.env.DOC_VERIFY_SECRET.length < 32) process.env.DOC_VERIFY_SECRET=crypto.randomBytes(48).toString("hex");
const tokenService=require("../../src/services/tokenService");
const { app }=require("../../src/index");

test("year-end close posts retained earnings and locks the fiscal year", async () => {
  const context=await getTestContext();
  const testYear=3000+(Date.now()%5000);
  const year=await fiscalYears.createFiscalYear({companyId:context.companyId,userId:context.userId,
    yearLabel:`E2E-YEAR-END-${testYear}`,startDate:`${testYear}-01-01`,endDate:`${testYear}-12-31`});
  const accounts=await pool.query("SELECT id,account_code FROM erp_chart_of_accounts WHERE company_id=$1 AND account_code=ANY($2::text[])",
    [context.companyId,["1100","4000"]]);
  const byCode=Object.fromEntries(accounts.rows.map((row)=>[row.account_code,row.id]));
  const source=await gl.createJournal({companyId:context.companyId,userId:context.userId,entryDate:`${testYear}-12-15`,
    source:"module",description:"Year-end fixture",lines:[{account_id:byCode["1100"],debit:1000},{account_id:byCode["4000"],credit:1000}]});
  await gl.postJournal({journalId:source.id,companyId:context.companyId,userId:context.userId});
  const user=await userService.findUserById(context.userId);
  const access=tokenService.generateAccessToken(user);
  const server=await new Promise((resolve)=>{const listener=app.listen(0,"127.0.0.1",()=>resolve(listener));});
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/finance/fiscal-years/${year.id}/close`,{
      method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${access}`},body:JSON.stringify({reason:"E2E year-end close"})});
    assert.equal(response.status,201,await response.text());
    const result=await pool.query("SELECT is_closed FROM erp_fiscal_years WHERE id=$1",[year.id]);
    assert.equal(result.rows[0].is_closed,true);
    const periods=await pool.query("SELECT status FROM erp_fiscal_periods WHERE fiscal_year_id=$1",[year.id]);
    assert.ok(periods.rows.every((period)=>period.status==="locked"));
  } finally { await new Promise((resolve)=>server.close(resolve)); }
});
