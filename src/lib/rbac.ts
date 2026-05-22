import type { User } from "./api";

export type RoleName =
  | "Admin"
  | "Manager"
  | "Accountant"
  | "HR Officer"
  | "Store Manager"
  | "Sales Rep"
  | "Warehouse"
  | "Driver";

const pathAccess: Record<string, RoleName[]> = {
  "/": ["Admin", "Manager", "Accountant", "HR Officer", "Store Manager", "Sales Rep", "Warehouse", "Driver"],
  "/sales": ["Admin", "Manager", "Sales Rep"],
  "/customers": ["Admin", "Manager", "Sales Rep", "Accountant"],
  "/invoices": ["Admin", "Manager", "Accountant", "Sales Rep"],
  "/accounting": ["Admin", "Manager", "Accountant"],
  "/inventory": ["Admin", "Manager", "Store Manager", "Warehouse"],
  "/procurement": ["Admin", "Manager", "Store Manager", "Warehouse", "Accountant"],
  "/delivery": ["Admin", "Manager", "Driver", "Warehouse"],
  "/hr": ["Admin", "Manager", "HR Officer"],
  "/reports": ["Admin", "Manager", "Accountant", "HR Officer", "Store Manager"],
  "/users": ["Admin"],
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
};

export const demoRoleAccounts: Record<string, RoleName> = {
  "admin@martin.co.ke": "Admin",
  "manager@martin.co.ke": "Manager",
  "accountant@martin.co.ke": "Accountant",
  "hr@martin.co.ke": "HR Officer",
  "store@martin.co.ke": "Store Manager",
  "sales@martin.co.ke": "Sales Rep",
  "warehouse@martin.co.ke": "Warehouse",
  "driver@martin.co.ke": "Driver",
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
  const matchedPath =
    Object.keys(pathAccess)
      .filter((candidate) => (candidate === "/" ? path === "/" : path.startsWith(candidate)))
      .sort((a, b) => b.length - a.length)[0] ?? "/";

  return pathAccess[matchedPath].includes(role);
}

export function firstAllowedPath(user: Pick<User, "role"> | null | undefined) {
  if (!user) return "/login";
  const role = normalizeRole(user.role);
  return Object.entries(pathAccess).find(([, roles]) => roles.includes(role))?.[0] ?? "/";
}

export function navigationAllowedForRole(role: string | null | undefined, url: string) {
  return canAccessPath({ role: normalizeRole(role) } as User, url);
}
