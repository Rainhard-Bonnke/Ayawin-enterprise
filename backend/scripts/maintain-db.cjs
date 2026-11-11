require("dotenv").config();

const pool = require("../src/db");

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

async function maintainDatabase() {
  await pool.query("ANALYZE");
  const candidates = await pool.query(
    `SELECT schemaname, relname, n_live_tup, n_dead_tup,
            pg_total_relation_size(relid) AS total_bytes
     FROM pg_stat_user_tables
     WHERE relname LIKE 'erp\\_%' ESCAPE '\\'
       AND n_dead_tup >= 50
       AND n_dead_tup::numeric / GREATEST(n_live_tup + n_dead_tup, 1) >= 0.15
       AND pg_total_relation_size(relid) >= 131072
     ORDER BY n_dead_tup DESC, relname`,
  );

  for (const table of candidates.rows) {
    await pool.query(
      `VACUUM (ANALYZE) ${quoteIdentifier(table.schemaname)}.${quoteIdentifier(table.relname)}`,
    );
  }

  return candidates.rows.map((table) => ({
    table: `${table.schemaname}.${table.relname}`,
    estimated_live_rows: Number(table.n_live_tup),
    estimated_dead_rows_before_vacuum: Number(table.n_dead_tup),
    total_bytes: Number(table.total_bytes),
  }));
}

if (require.main === module) {
  maintainDatabase()
    .then((vacuumed) => console.log(JSON.stringify({ analyzed: true, vacuumed }, null, 2)))
    .catch((error) => {
      console.error("Database maintenance failed", error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { maintainDatabase, quoteIdentifier };