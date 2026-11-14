import type { User } from "./api-types";

export type SalesPermission =
  | "sales.order.create"
  | "sales.order.approve"
  | "sales.delivery.post"
  | "sales.invoice.create"
  | "sales.invoice.post"
  | "sales.receipt.create"
  | "sales.receipt.approve"
  | "sales.credit_note.create"
  | "sales.credit_note.approve"
  | "sales.price_override"
  | "sales.discount_approve"
  | "sales.credit_override";

type PermissionUser = Pick<User, "permissions"> | null | undefined;

const pathPermissions: Record<string, readonly string[]> = {
  "/my-work": ["hr.view", "sales.view", "finance.view", "fleet.view"],
  "/": [
    "sales.view",
    "finance.view",
    "procurement.view",
    "hr.view",
    "reports.view",
    "foundation.view",
    "fleet.view",
  ],
  "/sales": [
    "sales.view",
    "sales.order.create",
    "sales.invoice.create",
    "sales.order.approve",
    "sales.discount_approve",
    "sales.credit_override",
  ],
  "/crm": ["sales.view", "sales.create", "sales.target.manage"],
  "/pos": ["sales.view", "sales.receipt.create", "sales.invoice.create"],
  "/customers": ["sales.view"],
  "/customer-credit-notes": ["sales.view", "sales.credit_note.create", "sales.credit_note.approve"],
  "/invoices": ["sales.view", "sales.invoice.create", "sales.invoice.post"],
  "/accounting": ["finance.view"],
  "/cash-bank": ["finance.view"],
  "/budget-forecasting": ["finance.view"],
  "/tax-management": ["finance.view"],
  "/expenses-management": ["finance.view"],
  "/financial-reporting": ["finance.view"],
  "/bank-reconciliation": ["finance.view"],
  "/inventory": ["procurement.view"],
  "/inventory-master": ["procurement.view"],
  "/inventory-valuation": ["procurement.view"],
  "/material-requisitions": ["procurement.view"],
  "/material-issues": ["procurement.view"],
  "/material-returns": ["procurement.view"],
  "/stock-analysis": ["procurement.view"],
  "/stock-adjustments": ["procurement.view"],
  "/driver-stock": ["fleet.view", "fleet.load", "fleet.count"],
  "/inventory-lots": ["procurement.view", "procurement.approve"],
  "/procurement": ["procurement.view", "procurement.create", "procurement.approve"],
  "/purchase-requisitions": ["procurement.view", "procurement.create"],
  "/delivery": ["sales.delivery.post", "sales.view"],
  "/route-closures": ["fleet.view", "fleet.count", "fleet.approve", "sales.view", "sales.approve"],
  "/goods-received": ["procurement.view"],
  "/suppliers": ["procurement.view"],
  "/stock-movements": ["procurement.view"],
  "/quarantine": ["procurement.view"],
  "/transfers": ["procurement.view"],
  "/reorder-alerts": ["procurement.view"],
  "/accounts-receivable": ["finance.view", "sales.view"],
  "/accounts-payable": ["finance.view", "procurement.view"],
  "/supplier-credit-notes": ["finance.view", "procurement.view"],
  "/hr": ["hr.view"],
  "/leave-attendance": ["hr.view"],
  "/payroll": ["hr.view", "finance.view"],
  "/fixed-assets": ["finance.view"],
  "/assets": ["finance.view"],
  "/depreciation": ["finance.view"],
  "/reports": ["reports.view", "finance.view"],
  "/users": ["users.view", "users.edit", "users.create"],
  "/master-data": ["master_data.view"],
  "/audit-logs": ["audit.view"],
  "/settings": ["foundation.view"],
};

export function hasPermission(user: PermissionUser, permission: string) {
  return user?.permissions?.includes(permission) ?? false;
}

export function canPerformSalesAction(user: PermissionUser, permission: SalesPermission) {
  return hasPermission(user, permission);
}

function permissionsForPath(path: string) {
  const matchedPath = Object.keys(pathPermissions)
    .filter((candidate) => (candidate === "/" ? path === "/" : path.startsWith(candidate)))
    .sort((a, b) => b.length - a.length)[0];
  return matchedPath ? pathPermissions[matchedPath] : undefined;
}

export function canAccessPath(user: PermissionUser, path: string) {
  const required = permissionsForPath(path);
  return Boolean(required && required.some((permission) => hasPermission(user, permission)));
}

export function firstAllowedPath(user: PermissionUser) {
  return Object.keys(pathPermissions).find((path) => canAccessPath(user, path)) ?? "/login";
}

export function navigationAllowedForUser(user: PermissionUser, url: string) {
  return canAccessPath(user, url);
}
