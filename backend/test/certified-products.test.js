const test = require("node:test");
const assert = require("node:assert/strict");
const { readProducts, categoryCode } = require("../scripts/import-certified-products.cjs");

test("certified product workbook has unique SKUs and complete import fields", () => {
  const { products, categories } = readProducts();
  const skuSet = new Set(products.map((product) => product.item_code));

  assert.equal(products.length, 1048);
  assert.equal(skuSet.size, products.length);
  assert.equal(categories.length, 13);
  assert.ok(products.every((product) => product.name && product.country_of_origin));
  assert.ok(products.every((product) => product.product_type && product.packaging_tier));
  assert.ok(products.every((product) => product.litres_per_unit > 0 && product.retail_price > 0));
  assert.ok(products.every((product) => product.source_stock_status === "In Stock"));
});

test("category codes are stable across spacing and punctuation", () => {
  assert.equal(categoryCode("Sparkling Wine"), "CAT-SPARKLING-WINE");
  assert.equal(categoryCode("Local Spirit"), "CAT-LOCAL-SPIRIT");
});