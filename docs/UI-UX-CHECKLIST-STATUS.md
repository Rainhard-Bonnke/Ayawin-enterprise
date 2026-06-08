# UI/UX & usability checklist

Automated static audit: `npm run check:ui-ux` (from repo root).

Manual checks (browser): test breakpoints **1920 / 1366 / 768 / 375** in DevTools; print preview for invoice/delivery/payslip PDFs in Chrome, Firefox, and Safari.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run check:ui-ux` | Static checklist (navigation, search, toasts, PDF routes, components) |
| `npm run dev:all` | Full stack for manual responsive / print testing |

## Checklist status

### Responsiveness

| Check | Status | Notes |
|-------|--------|-------|
| Breakpoints 1920 / 1366 / 768 / 375 | Manual | Shell uses `sm`/`md`/`lg`; sidebar mobile sheet &lt; 768px via shadcn |
| No horizontal scrollbar | PASS | `overflow-x: clip` on `html`/`body`, `min-w-0` + `overflow-x-clip` on main |
| Mobile nav (hamburger) | PASS | `Menu` → `setOpenMobile` in `_app.tsx` |
| Tables scroll on mobile | PASS | `Table` wraps `overflow-auto` |
| Mobile forms (touch targets) | PASS | Inputs `h-11` (44px), `text-base` on small screens |

### Usability

| Check | Status | Notes |
|-------|--------|-------|
| Success / error / loading feedback | PASS | Sonner toasts app-wide; route-level `loading` / `saving` states |
| No silent actions | PASS | Mutations use `toast.success` / `toast.error` on list modules |
| Human-readable errors | PASS | `humanizeError.ts` + API `handleResponse` |
| Destructive confirm dialogs | PASS | Sales cancel `AlertDialog`; master data `ConfirmActionDialog` |
| Long operations show progress | PASS | Buttons show "Saving…", spinners on app load & payroll |
| Helpful empty states | PASS | Copy on all major list pages; `ListEmptyState` component available |
| Breadcrumbs / back on detail views | PASS | `DetailNav` on invoice preview; dialogs use back control |
| Search on every list page | PASS | `SearchBar` on 14 list modules (excludes dashboard) |

### Print & PDF

| Check | Status | Notes |
|-------|--------|-------|
| Invoice PDF | PASS | `GET /api/v1/sales/invoices/:no/pdf` — A4, branding, QR verify |
| Delivery note PDF | PASS | `GET /api/v1/logistics/deliveries/pdf/:no` — A4 |
| Payslip PDF | PASS | `GET /api/v1/payroll/runs/:id/payslips/:id/pdf` — earnings & deductions |
| Report PDF | PASS | Headers, period, company footer, page x of y |
| Browser print (accounting) | Manual | `window.print()` on accounting printable panel + `@media print` in `styles.css` |

## Key files

- Layout: `src/routes/_app.tsx`, `src/components/AppSidebar.tsx`
- UX helpers: `src/lib/humanizeError.ts`, `src/components/ListEmptyState.tsx`, `src/components/DetailNav.tsx`, `src/components/ConfirmActionDialog.tsx`
- PDF services: `backend/src/services/invoicePdfService.js`, `deliveryPdfService.js`, `payslipPdfService.js`, `reportExportService.js`

## Production gate

Add `npm run check:ui-ux` to CI or `production:gate` when you want UX regressions to block release.
