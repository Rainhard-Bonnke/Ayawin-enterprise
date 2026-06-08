# Invoicing checklist status

| Check | Status | Notes |
|-------|--------|-------|
| Invoice auto-generates from order | **PASS** | `AUTO_INVOICE_ON_DELIVERY` (default on): tax invoice when SO becomes `delivered` after dispatch |
| Invoice number sequential & unique | **PASS** | `nextSequentialNo` + `UNIQUE (company_id, invoice_no)`; deleted numbers not reused |
| KRA PIN on invoice | **PASS** | PDF & verify API show `customer_tax_id` |
| VAT 16% per line | **PASS** | `taxEngine.calcLineTaxes` on each line; PDF columns |
| Excise per category | **PASS** | Beer/Spirits/Wine/Soft Drinks rates in `taxEngine.js` |
| PDF — logo, address, line items | **PASS** | `invoicePdfService.js` |
| PDF print-ready | **PASS** | A4, 48pt margins, pagination for long lines |
| Email with PDF attachment | **PASS** | `invoiceEmailService` attaches PDF; SMTP via `SMTP_*` env |
| Payment reduces outstanding | **PASS** | `recordCustomerPayment` updates `amount_paid` + status |
| Partial payment | **PASS** | Status `partial` until fully paid |
| Receipt on full payment | **PASS** | `GET .../receipt-pdf` when status `paid` |
| Proforma no ledger | **PASS** | `postCustomerInvoice` skips GL when `invoice_type = proforma` |
| Credit note reduces AR | **PASS** | Credits apply to outstanding (`amount_paid` capped by balance) |
| Overdue on due date | **PASS** | `due_date <= today` in company TZ; sync at startup, hourly, + daily midnight |

## Flow note

Checklist “confirmed order” maps to **delivered** sales orders (stock dispatched), then auto-invoice. Confirm alone does not invoice (inventory not yet issued).

## Env

- `AUTO_INVOICE_ON_DELIVERY=false` — disable auto-invoice after delivery
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — real email with PDF
- `COMPANY_TIMEZONE=Africa/Nairobi` — overdue evaluation

## Tests

- `backend/test/taxEngine.test.js`
- `backend/test/documentNumbers.test.js`
- `backend/test/e2e/sales-flow.test.js`
