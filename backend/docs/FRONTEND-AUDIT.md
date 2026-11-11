# Frontend Audit

Audit date: 2026-11-09. Scope: every route source under `src/routes`, shared API/data modules, mock/demo paths, form validation, and route-to-v1 endpoint availability. This document includes the route-by-route baseline audit and the implementation update below; baseline route rows should be read with that update because migrations have continued since the inventory was first recorded.

## Implementation Update

Completed after the initial inventory:

- Root `QueryClientProvider` is installed. `ResourceRegisterPage`, audit logs, inventory master, users, and customers use React Query; the new custom-register queries have user-scoped keys, cancellation, and retry states.
- Login uses a Zod schema and React Hook Form. Bank statement imports validate date range, balances, transaction descriptions, and mutually exclusive debit/credit amounts with Zod.
- Direct v1 route calls now cover suppliers, customers, users, inventory master, settings warehouse lookup, stock analysis warehouse lookup, material requisitions, stock adjustments, transfers, inventory lots setup lists, delivery list, invoice list, dashboard summary/integration retries, accounting/period close, bank reconciliation, HR employee/payroll-run reads, and reports. Other specialized writes and artifacts may still use the facade.
- Refresh tokens are HttpOnly cookies and are no longer returned in JSON or persisted in browser storage. Access tokens are memory-only; refresh is single-flight and uses a readable CSRF cookie/header. Credentialed CORS is enabled, with built-in development origins disabled in production.
- CI now runs the frontend production build and provides an independent test-only integration encryption key. Backend unit and E2E tests were run after the authentication change: 94 unit tests passed; E2E had 40 passes, no failures, and 3 environment/data-dependent skips.

Still open:

- Runtime legacy-facade workflows are now concentrated in coordinated POS and sales mutations. Accounts payable, HR, invoice, master-data, inventory, procurement, and several other remaining `api.ts` imports are type-only. Preserve the tested multi-endpoint POS/sales orchestration until it is moved behind equivalent tested v1 workflow methods.
- React Query coverage is still partial. The largest transactional screens still use local request state; shared schemas/RHF, field-level server errors, and consistent idempotency are not standardized across money-moving and inventory mutations. Login and bank statement import are the first Zod/RHF validation slices.
- Add frontend behavior tests and accessibility coverage. CI now builds the frontend but does not yet run browser-level frontend tests or accessibility checks.
- Decide and verify the deployment target and deep-link behavior before removing the current Start/Nitro/Cloudflare components.
- External KRA/Safaricom approvals, current statutory templates, unresolved fiscal mappings, and production certification remain release gates. Do not invent filing formats or certify production without provider confirmation and acceptance evidence.

## Route Inventory

`api.ts` is the legacy facade. Some functions in that facade internally call `apiV1Fetch`, but the route remains coupled to the facade and several paths still have mock fallback behavior. `api-v1.ts` imports are direct authenticated v1 calls, though they are also generally wrapped in component `useEffect` and local `useState`.

| Route file | API module / data source | Fetch and form behavior | Mock/demo | Size |
| --- | --- | --- | --- | ---: |
| `login.tsx` | auth context -> legacy `loginRequest` facade -> v1 login | submit handler, local field/error state; browser required validation only | No | 170 |
| `__root.tsx` | none | root shell and route outlet | No | 100 |
| `_app.tsx` | auth context, RBAC | session restore in effect; sidebar/layout | No | 200 |
| `_app.index.tsx` | `api.ts` dashboard summary | manual effect, local loading/error state; retry action | No | 663 |
| `_app.accounting.tsx` | `api.ts` finance workspace/close APIs | manual effects and local state | No | 653 |
| `_app.accounts-payable.tsx` | `api.ts` supplier bill/payment APIs | manual effects; 2 forms; HTML/client validation | No | 773 |
| `_app.accounts-receivable.tsx` | `api-v1.ts` | manual effect/state; collection activity actions | No | under 400 |
| `_app.assets.tsx` | `api-v1.ts` | manual effect/state; asset form | No | under 400 |
| `_app.audit-logs.tsx` | `api.ts` audit facade | manual effect/state | No | under 400 |
| `_app.bank-reconciliation.tsx` | `api.ts` bank reconciliation facade | manual effect/state; reconciliation form | No | under 400 |
| `_app.customer-credit-notes.tsx` | `api-v1.ts` sales endpoints | manual effects/state; credit-note form | No | under 400 |
| `_app.customers.tsx` | `api.ts` facade | manual effects/state; mock fallback remains possible | Yes, legacy fallback | 599 |
| `_app.delivery.tsx` | `api.ts` delivery facade | manual effects/state; delivery detail/proof workflow | Yes, legacy fallback | under 400 |
| `_app.depreciation.tsx` | `api-v1.ts` fixed-assets API | manual request through shared resource page | No | under 400 |
| `_app.driver-stock.tsx` | `api-v1.ts` plus raw v1 fetch | manual effects/state; explicit `demo:` early return | Demo branch remains | 812 |
| `_app.goods-received.tsx` | `api.ts` goods receipt facade | shared resource page loader | No | under 400 |
| `_app.hr.tsx` | `api.ts` HR/payroll facade | manual effects/state | No | 637 |
| `_app.inventory-lots.tsx` | mixed `api.ts` and `api-v1.ts` | manual effects/state and mutation handlers | No | under 400 |
| `_app.inventory-master.tsx` | `api.ts` master-item facade | manual effect/state | No | under 400 |
| `_app.inventory.tsx` | mixed `api.ts` and `api-v1.ts` | manual effect/state; explicit `demo:` early return | Demo branch remains | 703 |
| `_app.invoices.tsx` | `api.ts` invoice/customer/item facade | manual effects/state; invoice form | Legacy mock fallback possible | 987 |
| `_app.leave-attendance.tsx` | `api.ts` leave facade | shared resource page loader | No | under 400 |
| `_app.master-data.tsx` | `api.ts` master-data facade | manual effects/state; multiple CRUD forms | No | 1087 |
| `_app.material-issues.tsx` | `api-v1.ts` | manual effects/state; issue/post actions | No | under 400 |
| `_app.material-requisitions.tsx` | mixed `api.ts` master lists and `api-v1.ts` requisitions | manual effects/state; requisition form | No | under 400 |
| `_app.material-returns.tsx` | `api-v1.ts` | manual effects/state; return/post actions | No | under 400 |
| `_app.payroll.tsx` | `api.ts` payroll facade | shared resource page loader | No | under 400 |
| `_app.pos.tsx` | `api.ts` sales/customer/item facade | manual effects/state; POS workflow form controls | Legacy demo fallback path possible | 429 |
| `_app.procurement.tsx` | `api.ts` PO/GRN/supplier facade | manual effects/state; mutation handlers | Legacy fallback possible | 848 |
| `_app.quarantine.tsx` | `api-v1.ts` | manual effects/state; disposition form and approval | No | under 400 |
| `_app.reorder-alerts.tsx` | `api.ts` inventory facade | shared resource page loader | No | under 400 |
| `_app.reports.tsx` | mixed `api.ts` report facade and `api-v1.ts` | manual effects/state; URL state not consistently used | No | under 400 |
| `_app.route-closures.tsx` | `api-v1.ts` plus raw v1 fetch | manual effects/state; explicit `demo:` early return | Demo branch remains | 408 |
| `_app.sales.tsx` | `api.ts` sales/customer/item facade | manual effects/state; order/invoice forms | Legacy fallback possible | 894 |
| `_app.settings.tsx` | `api.ts` warehouse facade plus settings calls | manual effects/state | No | under 400 |
| `_app.stock-adjustments.tsx` | mixed `api.ts` master lists and `api-v1.ts` mutations | manual effects/state; adjustment form | No | under 400 |
| `_app.stock-analysis.tsx` | mixed `api.ts` warehouse and `api-v1.ts` analysis | manual effects/state | No | under 400 |
| `_app.stock-movements.tsx` | `api.ts` movement facade | shared resource page loader | No | under 400 |
| `_app.supplier-credit-notes.tsx` | `api-v1.ts` | manual effects/state; supplier credit form | No | under 400 |
| `_app.suppliers.tsx` | `api.ts` supplier facade | shared resource page loader | Legacy fallback possible | under 400 |
| `_app.transfers.tsx` | mixed `api.ts` master lists and `api-v1.ts` transfer APIs | manual effects/state; transfer form | No | under 400 |
| `_app.users.tsx` | `api.ts` user/role facade | manual effects/state; user form | No | 410 |

## Cross-Cutting Findings

- Route screens overwhelmingly use `useEffect`, `useState`, and ad-hoc request state. No route uses `useQuery` or `useMutation`; root provider has no `QueryClientProvider`.
- Six routes contain native forms (`login`, AP, assets, bank reconciliation, sales, supplier credit notes). Other workflows use dialogs or button-driven local forms. No shared Zod schemas or `zodResolver` use was found.
- No route uses URL search params consistently for pagination, filters, and sorting. Tables typically filter/sort/page in local component state.
- Tokens are persisted by `api-v1.ts`/`auth.tsx` in localStorage. The refresh token is returned in JSON by the backend; there is no HttpOnly cookie or CSRF protection.
- Mock/fabricated fallback data is exposed through `api.ts` importing `mock-data.ts`, `smartSignals.ts` directly imports mock fixtures, and demo-token checks remain in driver stock, inventory, and route closures. Other API facade routes can return fixtures when v1 is disabled.
- Existing shared components include `PageHeader`, `StatusBadge`, `ResourceRegisterPage`, confirmation/dialog primitives, and Radix UI. Tables/forms are not yet standardized through a typed data layer.
- Routes over 400 lines: accounting, accounts payable, customers, driver stock, HR, dashboard, inventory, invoices, master data, POS, procurement, route closures, sales, and users. Split these into domain feature folders during migration.

## Route-to-API Coverage

The backend v1 router currently mounts auth, companies, currencies, roles, users, settings, audit, master, finance, procurement, inventory, CRM, sales, HR, payroll, reports, platform/integrations, intelligence, assets, and tax. Most screen workflows have a corresponding route family. The v1 endpoint gaps found during the first audit pass are:

| Screen/workflow | Needed operation | Audit status |
| --- | --- | --- |
| Dashboard operational exception panel | `GET /reports/dashboard/summary` plus integration exception list | Summary exists; integration exceptions endpoint was added during Phase 5 at `/platform/integrations/exceptions`. |
| Supplier bill evidence | verify and review eTIMS evidence | `POST /procurement/supplier-bills/:id/verify-evidence` exists. |
| Integration administration | provider settings/certification, item registration, exception retry | Platform endpoints exist; typed frontend client methods are incomplete and should be migrated into `api-v1.ts`. |
| Payroll filing artifacts | P9/P10 statutory output | No confirmed official layouts; backend docs explicitly block generation pending official templates. Do not invent files. |
| Employee NSSF/SHA identifiers | statutory export validation inputs | Current employee model/API must be checked and extended only as part of the validated statutory export design. |
| Report schedule history/download | schedule run history and retained artifact download | Backend endpoints exist; frontend client/UI exposure is not yet complete. |
| Integrations settings screen | company provider settings and integration exception controls | Platform endpoints exist; no dedicated frontend route/tabs currently use them. |

No new backend endpoint was added solely to cover a route during this audit. Before frontend migration, reconcile the endpoint inventory against the concrete requests in `api.ts`/`api-v1.ts`; the wrappers include older/demo compatibility paths that are not suitable as production contracts.

## Form Validation Inventory

Current validation is primarily HTML `required`, numeric checks in submit handlers, and server-side validation after submission. No shared client schema layer was found. Prioritize shared schemas for login, customer/supplier PIN, phone, money/quantity, invoice/order, supplier bill/payment, bank reconciliation, payroll, and stock movement. Server responses are not consistently mapped back to field-level errors. Idempotency headers are not uniformly used for money-moving operations.

## Recommended Migration Order

1. Establish root `QueryClientProvider`, endpoint-specific typed `api-v1.ts` functions, query-key factories, shared error policy, and permission helpers.
2. Migrate read-only/simple routes first, remove mock fallbacks, and add URL-backed search/filter/page state.
3. Migrate transactional forms with shared Zod schemas, React Hook Form, field-level server errors, and idempotency keys.
4. Move session refresh to HttpOnly cookies with CSRF protection and update CORS.
5. Split routes over 400 lines into domain features; add RTL/MSW and Playwright coverage.
6. Select a static-only deployment target, remove unused SSR/Cloudflare/Nitro components only after proving deep-link fallback, then audit/upgrade dependencies and run accessibility checks.
