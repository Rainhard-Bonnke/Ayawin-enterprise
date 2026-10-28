const express = require("express");
const pool = require("../../db");
const { authenticateErp } = require("../../middleware/erpAuth");

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

router.delete("/:id", async (req, res) => {
  try {
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
