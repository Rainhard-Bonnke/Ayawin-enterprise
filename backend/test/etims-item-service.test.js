const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCodeClassName, validateItemForEtims } = require("../src/services/etimsItemService");

const item = {
  etims_item_classification_code: "5059690800",
  etims_item_code: "KE1NTXU0000001",
  etims_item_type_code: "2",
  etims_origin_country_code: "KE",
  etims_packaging_unit_code: "NT",
  etims_package_quantity: 1,
  etims_quantity_unit_code: "U",
  etims_tax_type_code: "B",
};

test("KRA code-list class names normalize without assuming provider class IDs", () => {
  assert.equal(normalizeCodeClassName("Taxation Type"), "tax_type");
  assert.equal(normalizeCodeClassName("Nation"), "country");
  assert.equal(normalizeCodeClassName("PackagingUnit"), "packaging_unit");
  assert.equal(normalizeCodeClassName("Unit of Quantity"), "quantity_unit");
  assert.equal(normalizeCodeClassName("Product Type"), "product_type");
});

test("item registration validation accepts active synchronized mappings and rejects unresolved codes", () => {
  const codeLists = new Map([
    "product_type:2", "country:KE", "packaging_unit:NT", "quantity_unit:U", "tax_type:B",
  ].map((key) => [key, { is_active: true }]));
  const classifications = new Map([["5059690800", { is_active: true, tax_type_code: "B" }]]);
  assert.deepEqual(validateItemForEtims(item, { codeLists, classifications }), []);
  const unresolved = validateItemForEtims({ ...item, etims_origin_country_code: "ZZ" }, { codeLists, classifications });
  assert.ok(unresolved.some((message) => message.includes("origin country code ZZ")));
  const conflict = validateItemForEtims({ ...item, etims_tax_type_code: "A" }, { codeLists, classifications });
  assert.ok(conflict.some((message) => message.includes("conflicts with KRA classification")));
});