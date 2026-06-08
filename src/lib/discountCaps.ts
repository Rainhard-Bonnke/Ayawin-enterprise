/** Client-side discount caps (must match backend discountPolicy.js). */

export function maxDiscountPercentForRole(roleName?: string | null, permissions?: string[]): number {
  const role = String(roleName || "");
  if (/administrator/i.test(role)) return 100;
  if (/managing director/i.test(role)) return 25;
  if (/operations manager/i.test(role)) return 15;
  if (/sales manager/i.test(role)) return 15;
  if (/sales/i.test(role)) return 5;
  if (permissions?.includes("sales.approve") || permissions?.includes("foundation.edit")) return 15;
  return 5;
}
