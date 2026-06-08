import { Link, useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import {
  LayoutDashboard,
  ShoppingCart,
  Store,
  FileText,
  Package,
  Truck,
  Users,
  Building2,
  Wallet,
  UserCog,
  BarChart3,
  Settings,
  ShieldCheck,
  NotebookText,
  CreditCard,
  Database,
} from "lucide-react";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth";
import { navigationAllowedForRole } from "@/lib/rbac";
import { cn } from "@/lib/utils";

export const navGroups: { label: string; items: { title: string; url: string; icon: React.ComponentType<{ className?: string }> }[] }[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/", icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    items: [
      { title: "Point of Sale", url: "/pos", icon: Store },
      { title: "Sales & Orders", url: "/sales", icon: ShoppingCart },
      { title: "Invoicing", url: "/invoices", icon: FileText },
      { title: "Inventory", url: "/inventory", icon: Package },
      { title: "Procurement", url: "/procurement", icon: Building2 },
      { title: "Delivery & Logistics", url: "/delivery", icon: Truck },
    ],
  },
  {
    label: "People",
    items: [
      { title: "Customers & CRM", url: "/customers", icon: Users },
      { title: "Human Resources", url: "/hr", icon: UserCog },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Accounting", url: "/accounting", icon: Wallet },
      { title: "Accounts Payable", url: "/accounts-payable", icon: CreditCard },
      { title: "Reports & Analytics", url: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Master Data", url: "/master-data", icon: Database },
      { title: "Users & Roles", url: "/users", icon: ShieldCheck },
      { title: "Audit Logs", url: "/audit-logs", icon: NotebookText },
      { title: "System Settings", url: "/settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const { user } = useAuth();
  const { setOpen, setOpenMobile, isMobile } = useSidebar();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => (url === "/" ? path === "/" : path.startsWith(url));

  const closeSidebar = () => {
    if (isMobile) setOpenMobile(false);
    else setOpen(false);
  };

  const initials = (user?.full_name || user?.email || "U")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Sidebar
      collapsible="offcanvas"
      variant="floating"
      className="!z-[60] border-none bg-transparent [&_[data-sidebar=sidebar]]:rounded-2xl [&_[data-sidebar=sidebar]]:border [&_[data-sidebar=sidebar]]:border-sidebar-border [&_[data-sidebar=sidebar]]:bg-sidebar [&_[data-sidebar=sidebar]]:shadow-2xl [&_[data-sidebar=sidebar]]:shadow-black/25"
    >
      <SidebarHeader className="shrink-0 border-b border-sidebar-border px-5 py-5">
        <div className="flex items-center justify-between gap-2">
          <Link to="/" className="min-w-0 flex-1" onClick={closeSidebar}>
            <BrandMark inverted />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={closeSidebar}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-y-auto overscroll-contain px-3 py-3">
        {navGroups.map((g) => {
          const items = g.items.filter((item) => navigationAllowedForRole(user?.role, item.url));
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={g.label} className="mb-1 py-1">
              <SidebarGroupLabel className="px-3 font-mono-label text-sidebar-foreground/40">
                {g.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {items.map((item) => {
                    const active = isActive(item.url);
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          className={cn(
                            "h-10 rounded-lg border-l-2 border-transparent px-3 text-[13px] font-medium text-sidebar-foreground/70 transition-all duration-200",
                            "hover:bg-sidebar-accent hover:text-sidebar-foreground",
                            active && "nav-item-active bg-sidebar-accent/80 text-sidebar-foreground shadow-none",
                          )}
                        >
                          <Link to={item.url} className="flex items-center gap-3" onClick={closeSidebar}>
                            <item.icon
                              className={cn(
                                "h-[18px] w-[18px] shrink-0",
                                active ? "text-sidebar-primary" : "opacity-70",
                              )}
                            />
                            <span className="truncate">{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      {user && (
        <SidebarFooter className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/60 p-3 ring-1 ring-white/5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-sidebar-foreground">
                {user.full_name || user.email}
              </div>
              <div className="truncate font-mono-label text-sidebar-primary/80">{user.role}</div>
            </div>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
