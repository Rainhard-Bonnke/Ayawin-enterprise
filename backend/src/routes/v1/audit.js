const express = require("express");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const { listAuditLogs } = require("../../services/auditService");

const router = express.Router();
router.use(authenticateErp);

function createEventHandler(writeAudit) {
  return async (req, res, next) => {
    const action = typeof req.body?.action === "string" ? req.body.action.trim() : "";
    if (!action || action.length > 120) {
      return res.status(400).json({ error: "action must be between 1 and 120 characters" });
    }

    const entityType = typeof req.body?.entityType === "string" ? req.body.entityType.trim().slice(0, 120) : "user_event";
    const entityId = typeof req.body?.entityId === "string" ? req.body.entityId.trim().slice(0, 160) : null;
    const details = req.body?.details && typeof req.body.details === "object" && !Array.isArray(req.body.details)
      ? req.body.details
      : {};

    try {
      await writeAudit({
        companyId: req.user.company_id,
        userId: req.user.id,
        entityType,
        entityId,
        action,
        newValues: {
          details,
          scenario: typeof req.body?.scenario === "string" ? req.body.scenario.slice(0, 120) : null,
          context: req.body?.context && typeof req.body.context === "object" ? req.body.context : {},
        },
        ipAddress: req.clientIp || null,
        userAgent: req.get("user-agent") || null,
      });
      return res.status(201).json({ ok: true, audited: true, insight: null, confidence: 0 });
    } catch (error) {
      return next(error);
    }
  };
}

router.post("/events", createEventHandler(require("../../services/auditService").logAudit));

router.get("/", requirePermission("audit.view"), async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Number(req.query.limit) || 50;
  const offset = Number(req.query.offset) || 0;
  const rows = await listAuditLogs({
    companyId: req.user.company_id,
    q,
    limit,
    offset,
  });
  return res.json(rows);
});

module.exports = router;
module.exports.createEventHandler = createEventHandler;
