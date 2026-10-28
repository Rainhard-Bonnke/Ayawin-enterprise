import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Bell, Search, LogOut, ChevronRight, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { canAccessPath, firstAllowedPath } from "@/lib/rbac";
import { useRouterState } from "@tanstack/react-router";
import { AppSidebar, navGroups } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function workspaceForPath(path: string) {
  if (
    ["/sales", "/pos", "/customers", "/invoices", "/delivery"].some((route) =>
      path.startsWith(route),
    )
  )
    return "sales";
  if (["/procurement", "/goods-received", "/suppliers"].some((route) => path.startsWith(route)))
    return "supply";
  if (["/inventory", "/inventory-master", "/material-requisitions", "/material-issues", "/material-returns", "/stock-analysis", "/stock-adjustments", "/stock-movements", "/transfers", "/quarantine", "/reorder-alerts", "/driver-stock"].some((route) => path.startsWith(route)))
    return "inventory";
  if (
    [
      "/accounting",
      "/accounts-receivable",
      "/accounts-payable",
      "/supplier-credit-notes",
      "/reports",
      "/assets",
      "/depreciation",
    ].some((route) => path.startsWith(route))
  )
    return "finance";
  if (["/hr", "/leave-attendance", "/payroll"].some((route) => path.startsWith(route)))
    return "people";
  if (
    ["/master-data", "/users", "/audit-logs", "/settings"].some((route) => path.startsWith(route))
  )
    return "admin";
  return "overview";
}

function AppLayout() {
  const navigate = useNavigate();
  const { user, loading, logout } = useAuth();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const isPos = path.startsWith("/pos");
  const activeItem = navGroups
    .flatMap((group) => group.items)
    .find((item) => (item.url === "/" ? path === "/" : path.startsWith(item.url)));
  const activeSubItem = navGroups
    .flatMap((group) => group.items)
    .flatMap((item) => item.subItems ?? [])
    .find((item) => item.url !== "/" && path.startsWith(item.url));
  const pageTitle = isPos
    ? "Point of Sale"
    : (activeSubItem?.title ?? activeItem?.title ?? "Workspace");
  const userName = user?.full_name || user?.username || "User";
  const initials = userName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", replace: true });
      return;
    }

    if (!loading && user && !canAccessPath(user, path)) {
      navigate({ to: firstAllowedPath(user), replace: true });
    }
  }, [loading, user, path, navigate]);

  useEffect(() => {
    document.body.dataset.erpWorkspace = workspaceForPath(path);
    return () => {
      delete document.body.dataset.erpWorkspace;
    };
  }, [path]);

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
      {!isPos && <AppSidebar />}
      <SidebarInset className="min-h-svh">
        <header className="erp-topbar sticky top-0 z-20 flex h-[68px] shrink-0 items-center gap-3 px-4 sm:px-6">
          {!isPos && (
            <SidebarTrigger className="rounded-md border border-border bg-background hover:bg-muted" />
          )}
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#a0183c] text-sm font-bold text-white shadow-sm sm:flex">
              A
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#a0183c]">
                <span>Ayawin Stock Solution</span>
                <ChevronRight className="h-3 w-3" />
                <span className="truncate text-[#28598d]">{pageTitle}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">Business workspace</div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search"
              className="hidden rounded-md border border-border/70 bg-background/70 hover:bg-muted sm:inline-flex"
            >
              <Search className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Help and support"
              className="hidden rounded-md border border-border/70 bg-background/70 hover:bg-muted sm:inline-flex"
              asChild
            >
              <a href="mailto:support@netrixbiz.com">
                <CircleHelp className="h-4 w-4" />
              </a>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Notifications"
              className="relative rounded-md border border-border/70 bg-background/70 hover:bg-muted"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              className="rounded-md border border-border/70 bg-background/70 hover:bg-muted sm:hidden"
            >
              <LogOut className="h-4 w-4" />
            </Button>
            <ThemeToggle />
            <div className="hidden h-9 items-center gap-2 border-l border-border pl-3 sm:flex">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#a0183c] to-[#28598d] text-[11px] font-bold text-white shadow-md shadow-blue-950/20">
                {initials}
              </div>
              <div className="max-w-32 leading-tight">
                <div className="truncate text-xs font-semibold text-foreground">{userName}</div>
                <div className="truncate text-[10px] capitalize text-muted-foreground">
                  {user?.role || "Staff"}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={logout}
                aria-label="Sign out"
                title="Sign out"
                className="ml-1 h-8 w-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main
          className="anchor-workspace flex-1 p-4 sm:p-6 lg:p-7"
          data-workspace={workspaceForPath(path)}
        >
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
