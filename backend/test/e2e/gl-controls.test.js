const test = require("node:test");
const assert = require("node:assert/strict");
const { getTestContext, pool } = require("./helpers");
const gl = require("../../src/services/glPostingService");

test("manual journals enforce maker checker; reversals preserve the historical ledger", async () => {
  const context = await getTestContext();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accounts = await client.query(
      "SELECT id,account_code FROM erp_chart_of_accounts WHERE company_id=$1 AND account_code=ANY($2::text[]) AND is_active=TRUE AND is_postable=TRUE",
      [context.companyId,["1100","4000"]]);
    const byCode=Object.fromEntries(accounts.rows.map((row)=>[row.account_code,row.id]));
    const journal=await gl.createJournalInTransaction(client,{companyId:context.companyId,userId:context.userId,
      entryDate:"2026-11-15",description:"E2E maker-checker reversal",source:"manual",
      lines:[{account_id:byCode["1100"],debit:1000},{account_id:byCode["4000"],credit:1000}]});
    const snapshot=await client.query(
      `SELECT debit,credit,transaction_debit,transaction_credit,base_debit,base_credit,
              exchange_rate,exchange_rate_source,exchange_rate_direction,exchange_rate_id,
              exchange_rate_effective_date::text AS exchange_rate_effective_date
       FROM erp_journal_lines WHERE journal_id=$1 AND line_no=1`,[journal.id]);
    assert.equal(Number(snapshot.rows[0].transaction_debit),1000);
    assert.equal(Number(snapshot.rows[0].base_debit),1000);
    assert.equal(Number(snapshot.rows[0].exchange_rate),1);
    assert.equal(snapshot.rows[0].exchange_rate_source,"base_currency");
    assert.equal(snapshot.rows[0].exchange_rate_direction,"base_per_transaction");
    assert.equal(snapshot.rows[0].exchange_rate_id,null);
    assert.equal(snapshot.rows[0].exchange_rate_effective_date,"2026-11-15");
    await assert.rejects(gl.postJournalInTransaction(client,{journalId:journal.id,companyId:context.companyId,userId:context.userId}),/creator cannot approve their own document/);
    const approverId="9a62cc7a-fdc2-426a-9899-0b825d98c321";
    await gl.postJournalInTransaction(client,{journalId:journal.id,companyId:context.companyId,userId:approverId});
    await client.query("SAVEPOINT posted_line_guard");
    await assert.rejects(
      client.query(
        `INSERT INTO erp_journal_lines (company_id,journal_id,line_no,account_id,description,debit,credit,currency_code)
         VALUES ($1,$2,3,$3,'Attempted posted journal mutation',0,0,'KES')`,
        [context.companyId,journal.id,byCode["1100"]],
      ),
      /immutable/,
    );
    await client.query("ROLLBACK TO SAVEPOINT posted_line_guard");
    await client.query("RELEASE SAVEPOINT posted_line_guard");
    const originalLines=await client.query("SELECT account_id,debit,credit FROM erp_journal_lines WHERE journal_id=$1 ORDER BY line_no",[journal.id]);
    const reversal=await gl.createJournalInTransaction(client,{companyId:context.companyId,userId:approverId,
      entryDate:"2026-11-16",description:"E2E reversal",source:"reversal",reversalOfId:journal.id,
      lines:originalLines.rows.map((line)=>({account_id:line.account_id,debit:Number(line.credit),credit:Number(line.debit)}))});
    await gl.postJournalInTransaction(client,{journalId:reversal.id,companyId:context.companyId,userId:approverId});
    await client.query("UPDATE erp_journals SET status='reversed',reversed_by_id=$2,updated_by=$3 WHERE id=$1",[journal.id,reversal.id,approverId]);
    const saved=await client.query("SELECT status,reversal_of_id FROM erp_journals WHERE id=ANY($1::uuid[]) ORDER BY created_at",[[journal.id,reversal.id]]);
    assert.equal(saved.rows.some((row)=>row.status==="reversed"),true);
    assert.equal(saved.rows.some((row)=>row.reversal_of_id===journal.id),true);
    await assert.rejects(gl.createJournalInTransaction(client,{companyId:context.companyId,userId:context.userId,
      entryDate:"2026-11-15",currencyCode:"USD",lines:[{account_id:byCode["1100"],debit:1000},{account_id:byCode["4000"],credit:1000}]}),/approved USD accounting policy/i);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
