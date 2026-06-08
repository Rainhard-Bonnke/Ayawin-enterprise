/** Kenya beverage excise (KES per litre) + VAT 16% on (subtotal + excise). */

const VAT_RATE = 0.16;

const EXCISE_RATES = {
  Beer: 121.85,
  'Low-Alcohol Beer': 121.85,
  Cider: 121.85,
  Spirits: 356.28,
  Wine: 229.85,
  'Soft Drinks': 10.68,
  Water: 0,
  Juice: 10.68,
  'Mineral Water': 0,
  Energy: 10.68,
  Other: 0,
};

const CATEGORY_CODE_MAP = {
  BEER: 'Beer',
  LAGER: 'Beer',
  CIDER: 'Cider',
  SPIRITS: 'Spirits',
  GIN: 'Spirits',
  WHISKY: 'Spirits',
  WINE: 'Wine',
  SOFT: 'Soft Drinks',
  SODA: 'Soft Drinks',
  WATER: 'Water',
  JUICE: 'Juice',
  ENERGY: 'Energy',
};

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function beverageCategoryFromItem(row) {
  if (row?.beverage_category) return row.beverage_category;
  const code = String(row?.category_code || '').toUpperCase();
  if (CATEGORY_CODE_MAP[code]) return CATEGORY_CODE_MAP[code];
  const name = String(row?.category_name || '');
  if (EXCISE_RATES[name] != null) return name;
  return 'Other';
}

function exciseRateForCategory(category) {
  return EXCISE_RATES[category] ?? 0;
}

function calcLineTaxes({ quantity, unitPrice, category, litresPerUnit, discountPercent = 0 }) {
  const qty = Number(quantity);
  const price = Number(unitPrice);
  const disc = Number(discountPercent || 0) / 100;
  const lineSubtotal = money(qty * price * (1 - disc));
  const litres = qty * Number(litresPerUnit || 0);
  const lineExcise = money(litres * exciseRateForCategory(category));
  const lineVat = money((lineSubtotal + lineExcise) * VAT_RATE);
  const lineTotal = money(lineSubtotal + lineExcise + lineVat);
  return { lineSubtotal, lineExcise, lineVat, lineTotal, litres };
}

function aggregateLines(lineResults) {
  const subtotal = money(lineResults.reduce((s, l) => s + l.lineSubtotal, 0));
  const exciseAmount = money(lineResults.reduce((s, l) => s + l.lineExcise, 0));
  const taxAmount = money(lineResults.reduce((s, l) => s + l.lineVat, 0));
  const total = money(subtotal + exciseAmount + taxAmount);
  return { subtotal, exciseAmount, taxAmount, total };
}

async function loadItemTaxMeta(client, companyId, itemIds) {
  const ids = Array.isArray(itemIds) ? itemIds.map((id) => String(id).trim()).filter(Boolean) : [];
  if (!ids.length) return new Map();
  const db = client?.query ? client : require('../db');
  let result;
  if (ids.length === 1) {
    result = await db.query(
      `SELECT i.id, i.item_code, i.litres_per_unit,
              ic.code AS category_code, ic.name AS category_name
       FROM erp_items i
       LEFT JOIN erp_item_categories ic ON ic.id = i.category_id
       WHERE i.company_id = $1::uuid AND i.id = $2::uuid`,
      [companyId, ids[0]],
    );
  } else {
    result = await db.query(
      `SELECT i.id, i.item_code, i.litres_per_unit,
              ic.code AS category_code, ic.name AS category_name
       FROM erp_items i
       LEFT JOIN erp_item_categories ic ON ic.id = i.category_id
       WHERE i.company_id = $1::uuid AND i.id = ANY($2::uuid[])`,
      [companyId, ids],
    );
  }
  const map = new Map();
  for (const row of result.rows) {
    map.set(row.id, {
      ...row,
      beverage_category: beverageCategoryFromItem(row),
      litres_per_unit: Number(row.litres_per_unit || 0),
    });
  }
  return map;
}

function computeDocumentLines(lines, itemMetaMap) {
  const computed = lines.map((line) => {
    const meta = itemMetaMap.get(line.item_id) || {};
    const taxes = calcLineTaxes({
      quantity: line.quantity,
      unitPrice: line.unit_price,
      discountPercent: line.discount_percent,
      category: meta.beverage_category || 'Other',
      litresPerUnit: meta.litres_per_unit,
    });
    return { ...line, ...taxes, item_meta: meta };
  });
  const totals = aggregateLines(computed);
  return { lines: computed, ...totals };
}

module.exports = {
  VAT_RATE,
  EXCISE_RATES,
  money,
  beverageCategoryFromItem,
  exciseRateForCategory,
  calcLineTaxes,
  aggregateLines,
  loadItemTaxMeta,
  computeDocumentLines,
};
