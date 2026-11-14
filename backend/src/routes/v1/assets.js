const express = require("express");
const pool = require("../../db");
const { authenticateErp, requirePermission } = require("../../middleware/erpAuth");
const {
  validateAssetDelete,
  buildAssetDepreciationSchedule,
  calculateDisposalImpact,
} = require("../../services/fixedAssetService");
const { postFixedAssetDepreciationRun } = require("../../services/fixedAssetDepreciationRunService");

const router = express.Router();
router.use(authenticateErp);

const cleanText = (value, max = 180) => (typeof value === "string" ? value.trim().slice(0, max) : "");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, asset_code, name, category, acquisition_date, acquisition_cost,
              residual_value, useful_life_months, location, serial_number, status, notes,
              created_at, updated_at
       FROM erp_fixed_assets
       WHERE company_id = $1 AND is_deleted = FALSE
       ORDER BY acquisition_date DESC, asset_code`,
      [req.user.company_id],
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unable to load fixed assets" });
  }
});

router.get("/depreciation", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, asset_code, name, category, acquisition_date, acquisition_cost,
              residual_value, useful_life_months, location, serial_number, status, notes
       FROM erp_fixed_assets
       WHERE company_id = $1 AND is_deleted = FALSE
       ORDER BY acquisition_date DESC, asset_code`,
      [req.user.company_id],
    );

    const summary = buildAssetDepreciationSchedule(result.rows, req.query.as_of_date);
    return res.json(summary);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unable to calculate depreciation summary" });
  }
});

router.get("/depreciation-runs", async (req, res) => {
  try {
    const result = await pool.query(
            `SELECT id, period_start, period_end, status, total_depreciation, journal_id,
              notes, created_at, posted_at
       FROM erp_fixed_asset_depreciation_runs
       WHERE company_id = $1 AND is_deleted = FALSE
       ORDER BY period_end DESC, created_at DESC`,
      [req.user.company_id],
    );
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ error: "Unable to load depreciation runs" });
  }
});

router.post("/depreciation-runs", requirePermission("finance.approve"), async (req, res) => {
  try {
    const result = await postFixedAssetDepreciationRun({
      companyId: req.user.company_id,
      userId: req.user.id,
      periodStart: req.body?.period_start,
      periodEnd: req.body?.period_end,
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "A depreciation run already exists for this period" });
    }
    return res.status(400).json({ error: error.message });
  }
});

router.post("/", async (req, res) => {
  const body = req.body || {};
  const assetCode = cleanText(body.asset_code, 64);
  const name = cleanText(body.name, 180);
  const category = cleanText(body.category, 100) || "General";
  const acquisitionDate = cleanText(body.acquisition_date, 10);
  const cost = Number(body.acquisition_cost);
  const residualValue = Number(body.residual_value || 0);
  const usefulLife = Number(body.useful_life_months || 60);
  if (!assetCode || !name || !/^\d{4}-\d{2}-\d{2}$/.test(acquisitionDate) || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(residualValue) || residualValue < 0 || !Number.isInteger(usefulLife) || usefulLife < 1) {
    return res.status(400).json({ error: "Enter an asset code, name, valid date, cost, residual value, and useful life" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO erp_fixed_assets (
         company_id, asset_code, name, category, acquisition_date, acquisition_cost,
         residual_value, useful_life_months, location, serial_number, notes, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [req.user.company_id, assetCode, name, category, acquisitionDate, cost, residualValue,
        usefulLife, cleanText(body.location, 180), cleanText(body.serial_number, 120),
        cleanText(body.notes, 2000), req.user.id],
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "That asset code is already in use" });
    console.error(err);
    return res.status(500).json({ error: "Unable to create asset" });
  }
});

router.patch("/:id", async (req, res) => {
  const status = req.body?.status === "disposed" ? "disposed" : "active";
  try {
    const result = await pool.query(
      `UPDATE erp_fixed_assets
       SET status = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3 AND company_id = $4 AND is_deleted = FALSE
       RETURNING *`,
      [status, req.user.id, req.params.id, req.user.company_id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Asset not found" });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unable to update asset" });
  }
});

router.patch("/:id/dispose", async (req, res) => {
  try {
    const lookup = await pool.query(
      `SELECT * FROM erp_fixed_assets
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );

    if (!lookup.rowCount) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const asset = lookup.rows[0];
    if (asset.status !== "active") {
      return res.status(409).json({ error: "Only active assets can be disposed." });
    }

    const disposalDate = String(req.body?.disposal_date || new Date().toISOString().slice(0, 10));
    const payload = {
      ...asset,
      disposal_date: disposalDate,
      disposal_value: req.body?.disposal_value ?? 0,
      disposal_type: req.body?.disposal_type ?? "sale",
    };

    const impact = calculateDisposalImpact(payload);
    const note = `Disposal: ${impact.type} on ${disposalDate}; proceeds ${impact.disposal_value}; net book value ${impact.net_book_value}; gain/loss ${impact.gain_or_loss}.`;

    const updated = await pool.query(
      `UPDATE erp_fixed_assets
       SET status = 'disposed', notes = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3 AND company_id = $4 AND is_deleted = FALSE
       RETURNING *`,
      [asset.notes ? `${asset.notes}\n${note}` : note, req.user.id, req.params.id, req.user.company_id],
    );

    return res.json({ asset: updated.rows[0], impact, note });
  } catch (error) {
    console.error(error);
    return res.status(400).json({ error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const lookup = await pool.query(
      `SELECT id, status FROM erp_fixed_assets
       WHERE id = $1 AND company_id = $2 AND is_deleted = FALSE`,
      [req.params.id, req.user.company_id],
    );

    if (!lookup.rowCount) {
      return res.status(404).json({ error: "Asset not found" });
    }

    try {
      validateAssetDelete({ status: lookup.rows[0].status });
    } catch (error) {
      return res.status(409).json({ error: error.message });
    }

    const result = await pool.query(
      `UPDATE erp_fixed_assets SET is_deleted = TRUE, updated_by = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3 AND is_deleted = FALSE RETURNING id`,
      [req.user.id, req.params.id, req.user.company_id],
    );
    if (!result.rowCount) return res.status(404).json({ error: "Asset not found" });
    return res.status(204).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Unable to remove asset" });
  }
});

module.exports = router;
