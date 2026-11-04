const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPeriods } = require("../src/services/fiscalYearService");

test("fiscal year setup creates twelve complete monthly periods", () => {
  const periods = buildPeriods("2027-07-01", "2028-06-30");
  assert.equal(periods.length, 12);
  assert.equal(periods[0].name, "July 2027");
  assert.equal(periods[0].start_date, "2027-07-01");
  assert.equal(periods[11].end_date, "2028-06-30");
});

test("fiscal year setup rejects incomplete fiscal year ranges", () => {
  assert.throws(() => buildPeriods("2027-07-02", "2028-06-30"), /first day/);
  assert.throws(() => buildPeriods("2027-07-01", "2028-05-31"), /twelve complete/);
});
