const express = require("express");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const vatReturns = require("../../services/vatReturnService");

const router = express.Router();
router.use(authenticateErp);

router.get("/returns", requirePermission("tax.view"), async (req, res) => {
  return res.json(await vatReturns.listVatReturns(req.user.company_id));
});

router.post("/returns/prepare", requirePermission("tax.prepare"), async (req, res) => {
  try {
    const result = await vatReturns.prepareVatReturn({
      companyId: req.user.company_id,
      userId: req.user.id,
      periodId: req.body?.period_id,
    });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to prepare VAT working paper" });
  }
});

router.get("/returns/:id/export.csv", requirePermission("tax.export"), async (req, res) => {
  const vatReturn = await vatReturns.getVatReturn(req.user.company_id, req.params.id);
  if (!vatReturn) return res.status(404).json({ error: "VAT return not found" });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${vatReturn.return_no}.csv"`);
  return res.send(vatReturns.returnToCsv(vatReturn));
});

router.get("/returns/:id/export.xlsx", requirePermission("tax.export"), async (req, res) => {
  const vatReturn = await vatReturns.getVatReturn(req.user.company_id, req.params.id);
  if (!vatReturn) return res.status(404).json({ error: "VAT return not found" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${vatReturn.return_no}.xlsx"`);
  return res.send(vatReturns.returnToXlsx(vatReturn));
});

router.get("/returns/:id", requirePermission("tax.view"), async (req, res) => {
  const vatReturn = await vatReturns.getVatReturn(req.user.company_id, req.params.id);
  if (!vatReturn) return res.status(404).json({ error: "VAT return not found" });
  return res.json(vatReturn);
});

router.post("/returns/:id/approve", requirePermission("tax.approve"), async (req, res) => {
  try {
    const result = await vatReturns.approveVatReturn({
      companyId: req.user.company_id,
      userId: req.user.id,
      returnId: req.params.id,
      varianceExplanation: req.body?.variance_explanation,
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to approve VAT working paper" });
  }
});

router.post("/returns/:id/lock", requirePermission("tax.approve"), async (req, res) => {
  try {
    return res.json(await vatReturns.lockVatReturn({
      companyId: req.user.company_id,
      userId: req.user.id,
      returnId: req.params.id,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to lock VAT return" });
  }
});

router.post("/returns/:id/reopen", requirePermission("tax.approve"), async (req, res) => {
  try {
    return res.json(await vatReturns.reopenVatReturn({
      companyId: req.user.company_id,
      userId: req.user.id,
      returnId: req.params.id,
      reason: req.body?.reason,
    }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to reopen VAT return" });
  }
});

module.exports = router;