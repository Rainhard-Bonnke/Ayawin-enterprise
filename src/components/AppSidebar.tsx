import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ShoppingCart,
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
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth";
import { navigationAllowedForRole } from "@/lib/rbac";

const groups: { label: string; items: { title: string; url: string; icon: React.ComponentType<{ className?: string }> }[] }[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/", icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    items: [
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
      { title: "Customers (CRM)", url: "/customers", icon: Users },
      { title: "Human Resources", url: "/hr", icon: UserCog },
    ],
  },
  {
    label: "Finance & Insights",
    items: [
      { title: "Accounting", url: "/accounting", icon: Wallet },
      { title: "Reports & Analytics", url: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Users & Roles", url: "/users", icon: ShieldCheck },
      { title: "Audit Logs", url: "/audit-logs", icon: NotebookText },
      { title: "System Settings", url: "/settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const { user } = useAuth();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => (url === "/" ? path === "/" : path.startsWith(url));

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar/95 backdrop-blur">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        <Link to="/" className="block px-1 py-1">
          <BrandMark compact={collapsed} />
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-1 px-2 py-4">
        {groups.map((g) => {
          const items = g.items.filter((item) => navigationAllowedForRole(user?.role, item.url));
          if (items.length === 0) return null;
          return (
          <SidebarGroup key={g.label} className="mb-2">
            {!collapsed && (
              <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {g.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      className="h-11 rounded-lg px-3 text-sm transition-all duration-200 hover:bg-sidebar-accent data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-sm"
                    >
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
