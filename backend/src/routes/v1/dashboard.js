const express = require('express');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const dashboardService = require('../../services/dashboardService');

const router = express.Router();

router.use(authenticateErp);

router.get('/summary', requirePermission('reports.view'), async (req, res) => {
  try {
    const summary = await dashboardService.getDashboardSummary(req.user.company_id, req.query);
    return res.json(summary);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unable to load dashboard summary' });
  }
});

module.exports = router;
