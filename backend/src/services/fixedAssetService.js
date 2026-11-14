function toNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeAssetStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeDepreciationDate(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return new Date().toISOString().slice(0, 10);
  }

  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid fixed-asset depreciation date.");
  }

  return parsed.toISOString().slice(0, 10);
}

function calculateMonthlyDepreciation(asset) {
  const cost = toNumber(asset.acquisition_cost);
  const residual = toNumber(asset.residual_value);
  const usefulLife = Math.max(1, Number.parseInt(String(asset.useful_life_months ?? 1), 10) || 1);
  return Math.max(0, cost - residual) / usefulLife;
}

function calculateDisposalImpact(asset) {
  const cost = toNumber(asset.acquisition_cost);
  const residual = toNumber(asset.residual_value);
  const usefulLifeMonths = Math.max(1, Number.parseInt(String(asset.useful_life_months ?? 1), 10) || 1);
  const acquisitionDate = asset.acquisition_date
    ? new Date(`${String(asset.acquisition_date).slice(0, 10)}T00:00:00Z`)
    : null;
  const disposalDate = asset.disposal_date
    ? new Date(`${String(asset.disposal_date).slice(0, 10)}T00:00:00Z`)
    : null;

  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error("Asset acquisition cost must be a non-negative number.");
  }

  if (!Number.isFinite(residual) || residual < 0) {
    throw new Error("Residual value must be a non-negative number.");
  }

  if (!Number.isFinite(usefulLifeMonths) || usefulLifeMonths < 1) {
    throw new Error("Useful life months must be at least 1.");
  }

  const disposalValue = toNumber(asset.disposal_value);
  if (!Number.isFinite(disposalValue) || disposalValue < 0) {
    throw new Error("Disposal value must be a non-negative number.");
  }

  const disposalType = String(asset.disposal_type || "sale").trim().toLowerCase();
  if (!["sale", "scrap", "write_off", "transfer"].includes(disposalType)) {
    throw new Error("Invalid fixed-asset disposal type.");
  }

  const monthsHeldRaw = acquisitionDate && disposalDate
    ? (disposalDate.getTime() - acquisitionDate.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)
    : 12;
  const monthsHeld = Number.isFinite(monthsHeldRaw) && monthsHeldRaw >= 0
    ? Math.max(0, monthsHeldRaw)
    : 12;
  const depreciationPerMonth = Math.max(0, cost - residual) / usefulLifeMonths;
  const netBookValue = Math.max(residual, cost - (depreciationPerMonth * monthsHeld));
  const gainOrLoss = disposalValue - netBookValue;

  return {
    type: disposalType,
    disposal_value: disposalValue,
    net_book_value: netBookValue,
    gain_or_loss: gainOrLoss,
    months_held: Number(monthsHeld.toFixed(2)),
    monthly_depreciation: depreciationPerMonth,
  };
}

function validateAssetDelete(asset) {
  if (!asset || typeof asset !== "object") {
    throw new Error("Asset record is required to validate deletion.");
  }

  const status = String(asset.status || "").trim().toLowerCase();

  if (!["active", "disposed"].includes(status)) {
    throw new Error("Invalid fixed-asset status for deletion validation.");
  }

  if (status === "active") {
    throw new Error(
      "Active assets cannot be deleted. Dispose or retire the asset before removing it from the register.",
    );
  }

  return { status, canDelete: true };
}

function buildAssetDepreciationSchedule(assets, asOfDate) {
  const items = Array.isArray(assets) ? assets : [];
  const scheduleDate = normalizeDepreciationDate(asOfDate);

  const rows = items
    .filter((asset) => normalizeAssetStatus(asset.status) === "active")
    .map((asset) => {
      const monthlyDepreciation = calculateMonthlyDepreciation(asset);
      return {
        id: String(asset.id ?? asset.asset_code ?? `${asset.name ?? "asset"}-${asset.category ?? "general"}`),
        asset_code: String(asset.asset_code || ""),
        name: String(asset.name || ""),
        category: String(asset.category || "General"),
        acquisition_date: String(asset.acquisition_date || scheduleDate),
        acquisition_cost: toNumber(asset.acquisition_cost),
        residual_value: toNumber(asset.residual_value),
        useful_life_months: Math.max(1, Number.parseInt(String(asset.useful_life_months ?? 1), 10) || 1),
        monthly_depreciation: monthlyDepreciation,
        status: "active",
      };
    });

  return {
    asOfDate: scheduleDate,
    activeAssets: rows.length,
    totalMonthlyDepreciation: rows.reduce((sum, asset) => sum + asset.monthly_depreciation, 0),
    rows,
  };
}

module.exports = {
  validateAssetDelete,
  calculateMonthlyDepreciation,
  calculateDisposalImpact,
  normalizeDepreciationDate,
  buildAssetDepreciationSchedule,
};
