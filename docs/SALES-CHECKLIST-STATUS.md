# Sales & Orders checklist status

| Check | Status | Notes |
|-------|--------|-------|
| Customer dropdown — active only | **PASS** | `fetchActiveCustomers` filters `is_active=true` |
| Product search — name, SKU, barcode | **PASS** | `SalesProductSearch` + master items `q` search |
| Quantity enforces available stock | **PASS** | UI max + ATP check on submit |
| Discount respects role cap | **PASS** | `discountPolicy` + UI max from `/sales/discount-cap` |
| Price tier by customer type | **PASS** | `salesPricing.js` → RETAIL / WHOLESALE / DIST lists |
| Totals incl. VAT & excise | **PASS** | `taxEngine` + live preview via `/sales/preview-totals` |
| Status transitions | **PASS** | Draft → Confirmed → Delivered (dispatch) → Invoiced |
| Cannot skip workflow steps | **PASS** | `orderWorkflow.js` guards; UI advances one step only |
| Cancel → stock reversal | **PASS** | Reverses posted deliveries via `recordReceipt` |
| Sales rep on orders & reports | **PASS** | `sales_rep_id` + list shows `sales_rep_name` |
| Quotation → order | **PASS** | `convertQuotationToOrder` copies lines & discounts |
| Return → credit note + stock | **PASS** | Returns tab → `createCreditNote` + stock receipt |

## API

- `GET /api/v1/sales/discount-cap`
- `POST /api/v1/sales/preview-totals`
- `GET /api/v1/sales/pricing?customer_id=&item_id=`
- `POST /api/v1/sales/atp-check`

## Migration

Run `025_sales_order_workflow.sql` for `sales_rep_id`, line `discount_percent`, and tiered price lists.

## Tests

- `backend/test/orderWorkflow.test.js`
- `backend/test/e2e/sales-flow.test.js`
