import type { User } from "./api";

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

export function canPerformSalesAction(user: Pick<User, "role" | "permissions"> | null | undefined, permission: SalesPermission) {
  if (!user) return false;
  if (normalizeRole(user.role) === "Admin") return true;
  return user.permissions?.includes(permission) ?? false;
}

export type RoleName =
  | "Admin"
  | "Manager"
  | "Accountant"
  | "HR Officer"
  | "Store Manager"
  | "Sales Rep"
  | "Warehouse"
  | "Driver"
  | "POS Operator";

const pathAccess: Record<string, RoleName[]> = {
  "/": [
    "Admin",
    "Manager",
    "Accountant",
    "HR Officer",
    "Store Manager",
    "Sales Rep",
    "Warehouse",
    "Driver",
  ],
  "/sales": ["Admin", "Manager", "Sales Rep"],
  "/pos": ["POS Operator"],
  "/customers": ["Admin", "Manager", "Sales Rep", "Accountant"],
  "/customer-credit-notes": ["Admin", "Manager", "Sales Rep", "Accountant"],
  "/invoices": ["Admin", "Manager", "Accountant", "Sales Rep"],
  "/accounting": ["Admin", "Manager", "Accountant"],
  "/bank-reconciliation": ["Admin", "Manager", "Accountant"],
  "/inventory": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/inventory-master": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/material-requisitions": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/material-issues": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/material-returns": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/stock-analysis": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/stock-adjustments": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/driver-stock": ["Admin", "Manager", "Store Manager", "Warehouse", "Driver"],
  "/inventory-lots": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/procurement": ["Admin", "Manager", "Store Manager", "Warehouse", "Accountant"],
  "/delivery": ["Admin", "Manager", "Driver", "Warehouse"],
  "/route-closures": ["Admin", "Manager", "Driver", "Warehouse", "Sales Rep", "Accountant"],
  "/goods-received": ["Admin", "Manager", "Store Manager", "Warehouse", "Accountant"],
  "/suppliers": ["Admin", "Manager", "Store Manager", "Warehouse", "Accountant"],
  "/stock-movements": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/quarantine": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/transfers": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/reorder-alerts": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/accounts-receivable": ["Admin", "Manager", "Accountant"],
  "/accounts-payable": ["Admin", "Manager", "Accountant"],
  "/supplier-credit-notes": ["Admin", "Manager", "Accountant"],
  "/hr": ["Admin", "Manager", "HR Officer"],
  "/leave-attendance": ["Admin", "Manager", "HR Officer"],
  "/payroll": ["Admin", "Manager", "HR Officer", "Accountant"],
  "/assets": ["Admin", "Manager", "Accountant"],
  "/depreciation": ["Admin", "Manager", "Accountant"],
  "/reports": ["Admin", "Manager", "Accountant", "HR Officer", "Store Manager"],
  "/users": ["Admin"],
  "/master-data": ["Admin", "Manager", "Store Manager"],
  "/audit-logs": ["Admin"],
  "/settings": ["Admin"],
};

export const roleLabels: Record<RoleName, string> = {
  Admin: "Full access",
  Manager: "Operational oversight",
  Accountant: "Financial data, invoices, taxes and reports",
  "HR Officer": "Employee records, payroll, attendance and leave",
  "Store Manager": "Inventory, warehouse and procurement operations",
  "Sales Rep": "Customers, orders and sales workflows",
  Warehouse: "Stock, warehouse and delivery support",
  Driver: "Delivery execution and proof of delivery",
  "POS Operator": "Point-of-sale checkout and receipts",
};

export function normalizeRole(role?: string | null): RoleName {
  if (role === "Human Resources" || role === "HR") return "HR Officer";
  if (role === "Store" || role === "Inventory Manager") return "Store Manager";
  if (role && role in roleLabels) return role as RoleName;
  return "Admin";
}

export function canAccessPath(user: Pick<User, "role"> | null | undefined, path: string) {
  if (!user) return false;
  const role = normalizeRole(user.role);
  const matchedPath = Object.keys(pathAccess)
    .filter((candidate) => (candidate === "/" ? path === "/" : path.startsWith(candidate)))
    .sort((a, b) => b.length - a.length)[0];

  if (!matchedPath) return false;
  return pathAccess[matchedPath].includes(role);
}

export function firstAllowedPath(user: Pick<User, "role"> | null | undefined) {
  if (!user) return "/login";
  const role = normalizeRole(user.role);
  return role === "POS Operator"
    ? "/pos"
    : (Object.entries(pathAccess).find(([, roles]) => roles.includes(role))?.[0] ?? "/");
}

export function navigationAllowedForRole(role: string | null | undefined, url: string) {
  return canAccessPath({ role: normalizeRole(role) } as User, url);
}
