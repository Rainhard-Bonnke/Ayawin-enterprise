const test = require('node:test');
const assert = require('node:assert/strict');
const liveEvents = require('../src/services/liveEventsService');

test('publish broadcasts JSON to subscribed sockets', () => {
  const received = [];
  const mockWs = {
    readyState: 1,
    on: (event, fn) => {
      if (event === 'close') mockWs._close = fn;
    },
    send: (payload) => received.push(JSON.parse(payload)),
  };

  liveEvents.addClient('company-1', mockWs);
  liveEvents.publish('company-1', 'inventory.updated', { item_id: 'x' });

  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'inventory.updated');
  assert.equal(received[0].data.item_id, 'x');
  assert.ok(received[0].ts);
});

test('publish does not leak across companies', () => {
  const a = [];
  const b = [];
  const wsA = { readyState: 1, on: (e, fn) => { if (e === 'close') wsA._close = fn; }, send: (p) => a.push(p) };
  const wsB = { readyState: 1, on: (e, fn) => { if (e === 'close') wsB._close = fn; }, send: (p) => b.push(p) };

  liveEvents.addClient('co-a', wsA);
  liveEvents.addClient('co-b', wsB);
  liveEvents.publish('co-a', 'sales_order.confirmed', { order_no: 'SO-1' });

  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
});
