import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Bell, Search, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { canAccessPath, firstAllowedPath } from "@/lib/rbac";
import { useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { LiveConnectivityBadge } from "@/components/LiveConnectivityBadge";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const { user, loading, logout } = useAuth();
  const path = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", replace: true });
      return;
    }

    if (!loading && user && !canAccessPath(user, path)) {
      navigate({ to: firstAllowedPath(user), replace: true });
    }
  }, [loading, user, path, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="rounded-xl border border-border bg-muted p-8 text-center">
          <div className="text-sm font-semibold text-foreground">Loading secure session...</div>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-h-svh">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
          <SidebarTrigger />
          <LiveConnectivityBadge />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Search">
              <Search className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive" />
            </Button>

            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
