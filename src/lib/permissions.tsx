import type { ReactNode } from "react";
import { hasPermission } from "./rbac";
import { useAuth } from "./auth";

export function usePermission(permission: string) {
  const { user } = useAuth();
  return hasPermission(user, permission);
}

export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(permission) ? children : fallback;
}
