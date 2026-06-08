# CRUD, validation & data integrity checklist

Status as of the master-data hardening pass. **PASS** = implemented and covered by API/tests; **PARTIAL** = backend only or gaps remain; **FAIL** = not implemented.

## CRUD operations

| Check | Status | Notes |
|-------|--------|-------|
| Create — form validates, saves, ID generated, audit log | **PASS** | Generic `createCrud` in `masterData.js`: `validateBody`, INSERT RETURNING id, `logAudit` on create |
| Read — pagination, search, filter, sort | **PASS** | `parsePagination`, `q` search, `filterFields` (e.g. `is_active`), `parseSort`; count query uses same filters as list |
| Update — pre-fill, delta patch, version tracked | **PASS** | PATCH delta + `If-Match: <updated_at>`; Master Data & Customers UI send header on edit |
| Delete — soft delete only, archived | **PASS** | `is_deleted = TRUE`; no hard DELETE on master CRUD routes |
| Bulk delete / export / status | **PASS** | API + UI: items, vendors, employees (Master Data), customers (CRM) |

## Form validation

| Check | Status | Notes |
|-------|--------|-------|
| Required fields enforced | **PASS** | `validateRequiredString`, `codeField` required on create; module-specific validators |
| Email, +254 phone, KRA PIN (11 chars) | **PASS** | `validators.js` + `validatePartyBody` on customers/vendors |
| Negative stock / prices blocked | **PARTIAL** | Inventory receipts & sales lines reject negative qty/price. Master `standard_cost` / price list allow ≥ 0 |
| End date not before start date | **PASS** | Price lists, employee hire/termination via `validateDateRange` |
| Duplicate SKU, invoice, employee ID | **PARTIAL** | SKU / customer / vendor / employee codes: app check + DB UNIQUE. Invoice: DB `UNIQUE (company_id, invoice_no)` on sales |
| Character limits on text fields | **PASS** | `validateRequiredString` / `validateOptionalString` max lengths in `masterDataValidation.js` |

## Data integrity

| Check | Status | Notes |
|-------|--------|-------|
| FK — cannot delete customer with active orders | **PASS** | `crudGuards.assertCanDeleteCustomer` + E2E `master-delete-guards.test.js` |
| Cascading updates | **PARTIAL** | Relies on PostgreSQL FKs; no explicit cascade API layer |
| Orphaned records impossible | **PARTIAL** | FK constraints in migrations; not all paths audited |
| KES 2 decimal places | **PASS** | `money2()` in validators; amounts stored/rounded consistently |
| Rounding consistent in calculations | **PARTIAL** | `money2` in validators; GL/sales services use numeric types — run `npm run check:data-accuracy` |

## API reference (master data)

- List: `GET /api/v1/master/{items|customers|vendors|employees|warehouses}?page=&limit=&q=&sort=&is_active=`
- Chart of accounts list: `GET /api/v1/master/chart-of-accounts` (array)
- Update with version: `PATCH /api/v1/master-data/.../:id` + header `If-Match: <updated_at ISO>`
- Bulk (items, customers, vendors, employees, warehouses, chart-of-accounts): `POST …/bulk/delete`, `POST …/bulk/export`, `PATCH …/bulk/status`

## Tests

- `backend/test/validators-crud.test.js` — validators & CSV helper
- `npm test` — unit suite
- `npm run production:gate` — full gate including E2E

## Recommended follow-ups

1. Extend optimistic locking to sales/inventory transactional documents.
2. COA / warehouse single-record PATCH with `If-Match` in UI (bulk + create only today).
3. Server-side pagination in UI (currently loads up to 500 rows).
