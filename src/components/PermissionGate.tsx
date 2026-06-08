import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export function PermissionGate({
  permission,
  permissions,
  children,
  fallback = null,
}: {
  permission?: string;
  permissions?: string[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user } = useAuth();
  const codes = permissions ?? (permission ? [permission] : []);
  if (codes.length && !codes.some((code) => hasPermission(user, code))) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
