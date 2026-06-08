function normalizeDateOnly(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  return s.length >= 10 ? s.slice(0, 10) : null;
}

function normalizeQuotationLines(lines) {
  if (!Array.isArray(lines) || !lines.length) {
    throw new Error('lines are required');
  }
  return lines.map((line, index) => {
    const item_id = line?.item_id ?? line?.itemId;
    if (!item_id || !String(item_id).trim()) {
      throw new Error(`Line ${index + 1}: item_id is required`);
    }
    const quantity = Number(line.quantity);
    const unit_price = Number(line.unit_price ?? line.unitPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Line ${index + 1}: quantity must be greater than zero`);
    }
    if (!Number.isFinite(unit_price) || unit_price <= 0) {
      throw new Error(`Line ${index + 1}: unit_price must be greater than zero`);
    }
    return {
      item_id: String(item_id).trim(),
      quantity,
      unit_price,
      discount_percent: Number(line.discount_percent ?? line.discountPercent ?? 0) || 0,
    };
  });
}

module.exports = { normalizeDateOnly, normalizeQuotationLines };
