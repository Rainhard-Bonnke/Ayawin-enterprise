/** Enforced sales order status transitions (ERP v1). */

const NEXT_STATUS = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['partial', 'delivered', 'cancelled'],
  partial: ['delivered', 'cancelled'],
  delivered: ['invoiced', 'cancelled'],
  invoiced: [],
  cancelled: [],
};

function assertCanTransition(fromStatus, toStatus) {
  const from = String(fromStatus || '').toLowerCase();
  const to = String(toStatus || '').toLowerCase();
  const allowed = NEXT_STATUS[from];
  if (!allowed || !allowed.includes(to)) {
    const err = new Error(`Cannot move order from ${from} to ${to}`);
    err.code = 'INVALID_WORKFLOW';
    return err;
  }
  return null;
}

function assertDispatchAllowed(orderStatus) {
  const s = String(orderStatus || '').toLowerCase();
  if (!['confirmed', 'partial'].includes(s)) {
    const err = new Error('Order must be confirmed before dispatch');
    err.code = 'INVALID_WORKFLOW';
    throw err;
  }
}

function assertInvoiceFromOrderAllowed(orderStatus) {
  const s = String(orderStatus || '').toLowerCase();
  if (!['delivered', 'partial'].includes(s)) {
    const err = new Error('Order must be delivered before invoicing');
    err.code = 'INVALID_WORKFLOW';
    throw err;
  }
}

function assertCancelAllowed(orderStatus) {
  const s = String(orderStatus || '').toLowerCase();
  if (s === 'invoiced') {
    const err = new Error('Invoiced orders cannot be cancelled — issue a credit note instead');
    err.code = 'INVALID_WORKFLOW';
    throw err;
  }
  if (s === 'cancelled') return;
  if (!['draft', 'confirmed', 'partial', 'delivered'].includes(s)) {
    const err = new Error(`Cannot cancel order in status ${s}`);
    err.code = 'INVALID_WORKFLOW';
    throw err;
  }
}

module.exports = {
  NEXT_STATUS,
  assertCanTransition,
  assertDispatchAllowed,
  assertInvoiceFromOrderAllowed,
  assertCancelAllowed,
};
