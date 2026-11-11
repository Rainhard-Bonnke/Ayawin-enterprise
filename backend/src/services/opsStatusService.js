const pool = require("../db");

async function getQueueSummary(companyId = null) {
  const query = `
    SELECT 'notification_outbox' AS queue_name, status, COUNT(*)::int AS count
    FROM erp_notification_outbox
    WHERE ($1::uuid IS NULL OR company_id = $1)
    GROUP BY status
    UNION ALL
    SELECT 'etims_submissions' AS queue_name, status, COUNT(*)::int AS count
    FROM erp_etims_submissions
    WHERE ($1::uuid IS NULL OR company_id = $1)
    GROUP BY status
    UNION ALL
    SELECT 'mpesa_requests' AS queue_name, status, COUNT(*)::int AS count
    FROM erp_mpesa_payment_requests
    WHERE ($1::uuid IS NULL OR company_id = $1)
    GROUP BY status
    UNION ALL
    SELECT 'background_jobs' AS queue_name, status, COUNT(*)::int AS count
    FROM erp_background_jobs
    WHERE ($1::uuid IS NULL OR company_id = $1)
    GROUP BY status
  `;

  const result = await pool.query(query, [companyId]);
  return result.rows.map((row) => ({
    queue: row.queue_name,
    status: row.status,
    count: Number(row.count || 0),
  }));
}

async function getIntegrationHealth(companyId = null) {
  const query = `
    SELECT provider,
           MAX(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
           MAX(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
           MAX(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
           MAX(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM (
      SELECT provider, status
      FROM erp_integration_logs
      WHERE ($1::uuid IS NULL OR company_id = $1)
      ORDER BY created_at DESC
    ) recent
    GROUP BY provider
    LIMIT 20
  `;

  const result = await pool.query(query, [companyId]);
  return result.rows.map((row) => ({
    provider: row.provider,
    pending: Number(row.pending || 0),
    accepted: Number(row.accepted || 0),
    rejected: Number(row.rejected || 0),
    failed: Number(row.failed || 0),
  }));
}

async function getOpsStatus({ companyId = null } = {}) {
  const ready = await pool.query("SELECT 1 AS ready");
  const queueSummary = await getQueueSummary(companyId);
  const integrationHealth = await getIntegrationHealth(companyId);

  return {
    status: ready.rowCount > 0 ? "ok" : "degraded",
    company_id: companyId,
    summary: {
      total_queues: queueSummary.length,
      pending_items: queueSummary.filter((row) => row.status === "pending" || row.status === "retry").reduce((sum, row) => sum + row.count, 0),
      failed_items: queueSummary.filter((row) => row.status === "failed").reduce((sum, row) => sum + row.count, 0),
    },
    queue_summary: queueSummary,
    integration_health: integrationHealth,
    generated_at: new Date().toISOString(),
  };
}

module.exports = { getOpsStatus, getQueueSummary, getIntegrationHealth };
