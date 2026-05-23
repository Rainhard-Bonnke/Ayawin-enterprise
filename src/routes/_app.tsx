import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Bell, Search, UserCircle2, LogOut } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";
import { canAccessPath, firstAllowedPath, roleLabels } from "@/lib/rbac";
import { useRouterState } from "@tanstack/react-router";

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
      <div className="relative flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="relative flex flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur">
            <SidebarTrigger />
            <div className="hidden md:block">
              <BrandMark compact />
            </div>
            <div className="relative hidden flex-1 max-w-md md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search orders, products, customers..." className="h-9 pl-9" />
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-border bg-success/10 px-3 py-1 text-xs font-medium text-success md:flex">
                Online
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
              </div>
              <ThemeToggle />
              <button
                className="relative rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
              </button>
              <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
                <UserCircle2 className="h-5 w-5 text-navy" />
                <div className="hidden text-xs leading-tight sm:block">
                  <div className="font-medium text-foreground">{user?.full_name ?? user?.username ?? "Guest"}</div>
                  <div className="text-muted-foreground" title={user?.role ? roleLabels[user.role as keyof typeof roleLabels] : undefined}>
                    {user?.role ?? "Visitor"}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={logout} className="hidden sm:inline-flex">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </Button>
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6 lg:p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
