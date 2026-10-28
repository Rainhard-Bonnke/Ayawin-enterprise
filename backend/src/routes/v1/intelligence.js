const express = require("express");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const {
  analyzeInventory,
  listInventoryFindings,
  reviewInventoryFinding,
} = require("../../services/aiAnalysisService");
const { analyzeBusiness } = require("../../services/aiAssistantService");

const router = express.Router();
router.use(authenticateErp);

router.post("/assistant/analyze", requirePermission("reports.view"), async (req, res) => {
  if (!ensureIntelligenceEnabled(res)) return;
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (question.length > 1000) return res.status(400).json({ error: "Question must be 1,000 characters or fewer" });
  try {
    const result = await analyzeBusiness({ companyId: req.user.company_id, user: req.user, question });
    return res.json(result);
  } catch (err) {
    console.error("Business intelligence request failed:", err.message);
    return res.status(500).json({ error: "Unable to analyze the available ERP data" });
  }
});

function ensureIntelligenceEnabled(res) {
  if (process.env.INTELLIGENCE_ENABLED === "false") {
    res.status(503).json({ error: "Backend intelligence is disabled" });
    return false;
  }
  return true;
}

router.get("/inventory/findings", requirePermission("procurement.view"), async (req, res) => {
  if (!ensureIntelligenceEnabled(res)) return;
  try {
    const findings = await listInventoryFindings(req.user.company_id, {
      status: typeof req.query.status === "string" ? req.query.status : "open",
      limit: req.query.limit,
    });
    return res.json(findings);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unable to load inventory intelligence findings" });
  }
});

router.post("/inventory/analyze", requirePermission("procurement.view"), async (req, res) => {
  if (!ensureIntelligenceEnabled(res)) return;
  try {
    const result = await analyzeInventory({ companyId: req.user.company_id, userId: req.user.id });
    return res.status(201).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unable to analyze inventory" });
  }
});

router.patch(
  "/inventory/findings/:findingId/review",
  requirePermission("procurement.view"),
  async (req, res) => {
    if (!ensureIntelligenceEnabled(res)) return;
    try {
      const finding = await reviewInventoryFinding(
        req.user.company_id,
        req.params.findingId,
        req.user.id,
        req.body?.status,
      );
      return res.json(finding);
    } catch (err) {
      const status = err.message === "Open inventory finding not found" ? 404 : 400;
      return res.status(status).json({ error: err.message || "Unable to review finding" });
    }
  },
);

module.exports = router;
