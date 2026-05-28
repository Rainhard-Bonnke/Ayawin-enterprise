# Module 2: Master Data Management

## Endpoints (base `/api/v1/master`)

| Resource | Path |
|----------|------|
| Payment terms | `/payment-terms` |
| Tax rates | `/tax-rates` |
| Tax groups | `/tax-groups` |
| Chart of accounts | `/chart-of-accounts` |
| Units of measure | `/uom` |
| Item categories | `/item-categories` |
| Items | `/items` |
| Customers | `/customers` |
| Vendors | `/vendors` |
| Employees | `/employees` |
| Warehouses | `/warehouses` |
| Warehouse bins | `/warehouses/:id/bins` |
| Price lists | `/price-lists` |
| Price list items | `/price-lists/:id/items` |

All list endpoints support: `?q=search&page=1&limit=25&sort=name&order=asc`

Standard CRUD: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` (soft delete)

Permission: `master_data.view|create|edit|delete`

## Seed data (company MARTIN)

- 4 payment terms, 4 tax rates, 3 tax groups
- 11 COA accounts (hierarchical)
- 5 items, 3 customers, 3 vendors, 20 employees
- 3 warehouses with bins, retail price list

## Migrate

```bash
cd backend
npm run db:migrate
```
