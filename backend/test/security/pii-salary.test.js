const test = require('node:test');
const assert = require('node:assert/strict');

const prev = process.env.PII_ENCRYPTION_KEY;
process.env.PII_ENCRYPTION_KEY = 'test_salary_encryption_key_32_chars!!';

const pii = require('../../src/lib/piiCrypto');

test('protectSalaryFields encrypts and zeroes numeric columns', () => {
  const body = pii.protectSalaryFields({
    basic_salary: 85000,
    house_allowance: 12000,
    transport_allowance: 3000,
  });
  assert.ok(body.basic_salary_enc?.startsWith('enc:v1:'));
  assert.equal(body.basic_salary, 0);
  assert.equal(body.house_allowance, 0);
});

test('mergePayrollEmployeeRow restores salary for payroll', () => {
  const protectedBody = pii.protectSalaryFields({ basic_salary: 50000, house_allowance: 5000, transport_allowance: 2000 });
  const row = pii.mergePayrollEmployeeRow({
    id: '1',
    basic_salary: protectedBody.basic_salary,
    basic_salary_enc: protectedBody.basic_salary_enc,
    house_allowance: protectedBody.house_allowance,
    house_allowance_enc: protectedBody.house_allowance_enc,
    transport_allowance: protectedBody.transport_allowance,
    transport_allowance_enc: protectedBody.transport_allowance_enc,
    employee_basic_salary_enc: null,
  });
  assert.equal(row.basic_salary, 50000);
  assert.equal(row.house_allowance, 5000);
  assert.equal(row.transport_allowance, 2000);
});

test.after(() => {
  if (prev === undefined) delete process.env.PII_ENCRYPTION_KEY;
  else process.env.PII_ENCRYPTION_KEY = prev;
});
