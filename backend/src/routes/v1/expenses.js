const express = require("express");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const { buildExpenseManagementSummary } = require("../../services/expenseManagementService");

const router = express.Router();
router.use(authenticateErp);

const defaultClaims = [
  { employee: "Nancy Wambui", category: "Travel", amount: 24500, status: "Approved", date: "2026-05-04" },
  { employee: "Daniel Otieno", category: "Meals", amount: 12800, status: "Pending", date: "2026-05-05" },
  { employee: "Grace Kibet", category: "Staff welfare", amount: 7600, status: "Approved", date: "2026-05-07" },
  { employee: "Juma Mwangi", category: "Mobile data", amount: 4200, status: "Rejected", date: "2026-05-08" },
];

const defaultBudgets = [
  { category: "Travel", allocated: 280000, used: 182400, remaining: 97600 },
  { category: "Meals", allocated: 165000, used: 98540, remaining: 66460 },
  { category: "Medical", allocated: 85000, used: 21400, remaining: 63600 },
  { category: "Marketing", allocated: 120000, used: 93250, remaining: 26750 },
];

router.get("/summary", requirePermission("finance.view"), async (_req, res) => {
  try {
    return res.json(buildExpenseManagementSummary({ claims: defaultClaims, budgets: defaultBudgets }));
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to build expense summary" });
  }
});

router.get("/claims", requirePermission("finance.view"), async (_req, res) => {
  try {
    return res.json(buildExpenseManagementSummary({ claims: defaultClaims, budgets: defaultBudgets }).claims);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to list expense claims" });
  }
});

router.get("/budgets", requirePermission("finance.view"), async (_req, res) => {
  try {
    return res.json(buildExpenseManagementSummary({ claims: defaultClaims, budgets: defaultBudgets }).budgets);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Unable to list expense budgets" });
  }
});

module.exports = router;
