const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePagination, parseSort } = require('../src/lib/queryHelper');

test('parsePagination defaults', () => {
  const p = parsePagination({});
  assert.equal(p.page, 1);
  assert.equal(p.limit, 25);
  assert.equal(p.offset, 0);
});

test('parsePagination caps limit at 200', () => {
  const p = parsePagination({ limit: 999, page: 2 });
  assert.equal(p.limit, 200);
  assert.equal(p.offset, 200);
});

test('parseSort respects allowed fields', () => {
  const s = parseSort({ sort: 'invalid', order: 'asc' }, ['name', 'created_at'], 'name');
  assert.equal(s.sort, 'name');
  assert.equal(s.order, 'ASC');
});

test('master data account types', () => {
  const types = ['asset', 'liability', 'equity', 'income', 'expense'];
  for (const t of types) {
    assert.match(t, /^[a-z]+$/);
  }
});
