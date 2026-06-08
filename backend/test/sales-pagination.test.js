const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parsePagination } = require('../src/lib/queryHelper');

describe('sales list pagination helper', () => {
  it('caps limit at 200', () => {
    const { limit, offset, page } = parsePagination({ page: '2', limit: '500' });
    assert.equal(limit, 200);
    assert.equal(page, 2);
    assert.equal(offset, 200);
  });

  it('defaults page 1 limit 25', () => {
    const { page, limit } = parsePagination({});
    assert.equal(page, 1);
    assert.equal(limit, 25);
  });
});
