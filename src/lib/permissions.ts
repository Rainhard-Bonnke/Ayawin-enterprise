import type { User } from "./api";

const pathPermission: Record<string, string> = {
  "/": "reports.view",
  "/pos": "sales.create",
  "/sales": "sales.view",
  "/customers": "sales.view",
  "/invoices": "finance.view",
  "/accounting": "finance.view",
  "/accounts-payable": "finance.view",
  "/inventory": "master_data.view",
  "/procurement": "procurement.view",
  "/delivery": "sales.view",
  "/hr": "hr.view",
  "/reports": "reports.view",
  "/users": "users.view",
  "/master-data": "master_data.view",
  "/audit-logs": "audit.view",
  "/settings": "foundation.view",
};

export function userPermissions(user: Pick<User, "permissions"> | null | undefined): string[] {
  return user?.permissions ?? [];
}

export function hasPermission(user: Pick<User, "permissions"> | null | undefined, code: string): boolean {
  const perms = userPermissions(user);
  if (!perms.length) return false;
  if (perms.includes("foundation.edit")) return true;
  return perms.includes(code);
}

export function hasAnyPermission(
  user: Pick<User, "permissions"> | null | undefined,
  codes: string[],
): boolean {
  if (!codes.length) return true;
  return codes.some((code) => hasPermission(user, code));
}

export function canAccessPathWithPermissions(
  user: Pick<User, "permissions" | "role"> | null | undefined,
  path: string,
): boolean | null {
  const perms = userPermissions(user);
  if (!perms.length) return false;

  const matchedPath =
    Object.keys(pathPermission)
      .filter((candidate) => (candidate === "/" ? path === "/" : path.startsWith(candidate)))
      .sort((a, b) => b.length - a.length)[0] ?? "/";

  const required = pathPermission[matchedPath];
  return required ? hasPermission(user, required) : true;
}
