const express = require('express');
const { authenticateErp, requirePermission } = require('../../middleware/erpAuth');
const { listAuditLogs } = require('../../services/auditService');

const router = express.Router();
router.use(authenticateErp);

router.get('/', requirePermission('audit.view'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
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
