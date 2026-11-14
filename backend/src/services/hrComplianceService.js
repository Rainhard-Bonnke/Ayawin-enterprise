const pool = require("../db");
const { logAudit } = require("./auditService");

const SCHEDULED_EMPLOYEE_FIELDS = new Set(["department", "job_title", "email", "phone", "branch_id"]);

async function applyDueFutureEffectiveEvents({ limit = 50, companyId = null, eventIds = null } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const safeEventIds = Array.isArray(eventIds) && eventIds.length ? eventIds : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const due = await client.query(
      `SELECT * FROM erp_hr_future_effective_events
       WHERE status='scheduled' AND effective_from <= CURRENT_DATE
         AND ($1::uuid IS NULL OR company_id=$1)
         AND ($2::uuid[] IS NULL OR id=ANY($2))
       ORDER BY effective_from,created_at
       FOR UPDATE SKIP LOCKED LIMIT $3`,
      [companyId, safeEventIds, safeLimit],
    );
    const summary = { processed: due.rowCount, applied: 0, cancelled: 0 };

    for (const event of due.rows) {
      if (event.entity_type !== "erp_employees" || !SCHEDULED_EMPLOYEE_FIELDS.has(event.field_name)) {
        await client.query(
          `UPDATE erp_hr_future_effective_events
           SET status='cancelled',updated_at=NOW() WHERE id=$1`,
          [event.id],
        );
        summary.cancelled += 1;
        continue;
      }

      const employee = await client.query(
        `SELECT ${event.field_name} AS current_value FROM erp_employees
         WHERE id=$1 AND company_id=$2 AND is_deleted=FALSE FOR UPDATE`,
        [event.entity_id, event.company_id],
      );
      const currentValue = employee.rows[0]?.current_value ?? null;
      if (!employee.rowCount || JSON.stringify(currentValue) !== JSON.stringify(event.old_value)) {
        await client.query(
          `UPDATE erp_hr_future_effective_events
           SET status='cancelled',updated_at=NOW() WHERE id=$1`,
          [event.id],
        );
        await logAudit({
          client,
          companyId: event.company_id,
          userId: null,
          entityType: "erp_hr_future_effective_events",
          entityId: event.id,
          action: "hr_future_event_cancelled_stale",
          oldValues: { expected_value: event.old_value },
          newValues: { actual_value: currentValue },
        });
        summary.cancelled += 1;
        continue;
      }

      await client.query(
        `UPDATE erp_employees
         SET ${event.field_name}=$1${event.field_name === "branch_id" ? "::uuid" : ""},
             updated_by=$2,updated_at=NOW()
         WHERE id=$3 AND company_id=$4`,
        [event.new_value, event.created_by, event.entity_id, event.company_id],
      );
      await client.query(
        `UPDATE erp_hr_future_effective_events
         SET status='applied',applied_at=NOW(),updated_at=NOW() WHERE id=$1`,
        [event.id],
      );
      await logAudit({
        client,
        companyId: event.company_id,
        userId: null,
        entityType: "erp_hr_future_effective_events",
        entityId: event.id,
        action: "hr_future_event_applied",
        oldValues: { field_name: event.field_name, value: currentValue },
        newValues: { field_name: event.field_name, value: event.new_value, effective_from: event.effective_from },
      });
      summary.applied += 1;
    }

    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { applyDueFutureEffectiveEvents, SCHEDULED_EMPLOYEE_FIELDS };