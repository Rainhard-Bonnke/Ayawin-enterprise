/** Sequential document numbers per company/year (never reuse deleted numbers). */

async function nextSequentialNo(client, { companyId, table, column, prefix }) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
    `${companyId}:${table}:${prefix}`,
  ]);
  const year = new Date().getFullYear();
  const pattern = `${prefix}-${year}-%`;
  const result = await client.query(
    `SELECT ${column} AS doc_no FROM ${table}
     WHERE company_id = $1 AND ${column} LIKE $2
     ORDER BY ${column} DESC
     LIMIT 1
     FOR UPDATE`,
    [companyId, pattern],
  );
  let seq = 1;
  if (result.rowCount) {
    const match = String(result.rows[0].doc_no || '').match(/-(\d+)$/);
    if (match) seq = Number(match[1]) + 1;
  }
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

module.exports = { nextSequentialNo };
