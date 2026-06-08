import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Bell, LogOut, Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { canAccessPath, firstAllowedPath } from "@/lib/rbac";
import { useRouterState } from "@tanstack/react-router";
import { AppSidebar, navGroups } from "@/components/AppSidebar";
import { BrandMark } from "@/components/BrandMark";
import { AiShellBackground } from "@/components/AiShellBackground";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { LiveConnectivityBadge } from "@/components/LiveConnectivityBadge";
import { LiveNotificationCenter } from "@/components/LiveNotificationCenter";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function pageTitle(path: string) {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.url === "/" ? path === "/" : path.startsWith(item.url)) {
        return item.title;
      }
    }
  }
  return "Workspace";
}

function AppLayoutShell() {
  const navigate = useNavigate();
  const { user, loading, logout } = useAuth();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const { open, setOpen, setOpenMobile, isMobile } = useSidebar();
  const title = pageTitle(path);

  const initials = (user?.full_name || user?.email || "U")
    .split(" ")
    .map((p) => p[0])
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

  const prevPath = useRef(path);
  useEffect(() => {
    if (prevPath.current !== path) {
      setOpen(false);
      prevPath.current = path;
    }
  }, [path, setOpen]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <AiShellBackground />

      {open && !isMobile && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
        />
      )}

      <AppSidebar />

      <SidebarInset className="relative min-h-svh w-full bg-transparent">
        <header className="surface-header sticky top-0 z-30 flex h-[3.25rem] shrink-0 items-center gap-3 px-4 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg"
            aria-label="Open menu"
            onClick={() => {
              if (isMobile) setOpenMobile(true);
              else setOpen(true);
            }}
          >
            <Menu className="h-[18px] w-[18px]" />
          </Button>

          <div className="hidden min-w-0 sm:block">
            <BrandMark compact />
          </div>

          <div className="hidden h-5 w-px bg-border md:block" />

          <div className="min-w-0 flex-1">
            <p className="font-mono-label text-muted-foreground">Module</p>
            <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">{title}</h1>
          </div>

          <LiveConnectivityBadge />

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search"
              className="hidden h-9 w-9 rounded-lg sm:inline-flex"
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Notifications" className="relative h-9 w-9 rounded-lg">
              <Bell className="h-4 w-4" />
              <LiveNotificationCenter />
            </Button>
            <ThemeToggle />
            <div className="mx-1 hidden h-6 w-px bg-border lg:block" />
            <div className="hidden items-center gap-2.5 rounded-lg border border-border/80 bg-card/50 px-2.5 py-1.5 lg:flex">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-primary-foreground">
                {initials}
              </div>
              <div className="min-w-0 pr-0.5">
                <div className="max-w-[130px] truncate text-xs font-medium">{user?.full_name || user?.email}</div>
                <div className="max-w-[130px] truncate font-mono-label text-muted-foreground">{user?.role}</div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={logout} className="h-9 rounded-lg px-2.5 text-muted-foreground">
              <LogOut className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full min-w-0 max-w-[1680px] flex-1 overflow-x-clip px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <Outlet />
        </main>
      </SidebarInset>
    </>
  );
}

function AppLayout() {
  return (
    <SidebarProvider defaultOpen={false}>
      <AppLayoutShell />
    </SidebarProvider>
  );
}
