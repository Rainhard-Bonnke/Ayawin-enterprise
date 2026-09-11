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
  Database,
  ChevronDown,
} from "lucide-react";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/lib/auth";
import { navigationAllowedForRole } from "@/lib/rbac";

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  subItems?: { title: string; url: string; hash?: string }[];
};

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/", icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    items: [
      { title: "Sales & Orders", url: "/sales", icon: ShoppingCart, subItems: [{ title: "Sales orders", url: "/sales", hash: "orders" }, { title: "Customer credit", url: "/sales", hash: "credit" }, { title: "Order fulfilment", url: "/sales", hash: "orders" }] },
      { title: "Invoicing", url: "/invoices", icon: FileText, subItems: [{ title: "Invoices", url: "/invoices", hash: "invoices" }, { title: "Payments", url: "/invoices", hash: "payments" }, { title: "Tax documents", url: "/invoices", hash: "tax" }] },
      { title: "Inventory", url: "/inventory", icon: Package, subItems: [{ title: "Stock on hand", url: "/inventory" }, { title: "Stock movements", url: "/inventory" }, { title: "Transfers & adjustments", url: "/inventory" }, { title: "Reorder alerts", url: "/inventory" }] },
      { title: "Procurement", url: "/procurement", icon: Building2, subItems: [{ title: "Purchase requisitions", url: "/procurement", hash: "purchase-orders" }, { title: "Purchase orders", url: "/procurement", hash: "purchase-orders" }, { title: "Goods received", url: "/procurement", hash: "receipts" }, { title: "Supplier spend", url: "/procurement", hash: "suppliers" }] },
      { title: "Delivery & Logistics", url: "/delivery", icon: Truck, subItems: [{ title: "Dispatch board", url: "/delivery" }, { title: "Routes & drivers", url: "/delivery" }, { title: "Proof of delivery", url: "/delivery" }] },
    ],
  },
  {
    label: "People",
    items: [
      { title: "Customers (CRM)", url: "/customers", icon: Users, subItems: [{ title: "Customers", url: "/customers" }, { title: "Leads & opportunities", url: "/customers" }, { title: "Activities", url: "/customers" }] },
      { title: "Human Resources", url: "/hr", icon: UserCog, subItems: [{ title: "Employees", url: "/hr", hash: "employees" }, { title: "Leave & attendance", url: "/hr", hash: "leave" }, { title: "Payroll", url: "/hr", hash: "payroll" }] },
    ],
  },
  {
    label: "Finance & Insights",
    items: [
      { title: "Accounting", url: "/accounting", icon: Wallet, subItems: [{ title: "General ledger", url: "/accounting", hash: "ledger" }, { title: "Accounts receivable", url: "/accounting", hash: "aging" }, { title: "Accounts payable", url: "/accounting", hash: "aging" }, { title: "Tax & statutory", url: "/accounting", hash: "vat" }] },
      { title: "Reports & Analytics", url: "/reports", icon: BarChart3, subItems: [{ title: "Management reports", url: "/reports" }, { title: "Dashboards", url: "/reports" }, { title: "Export centre", url: "/reports" }] },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Master Data", url: "/master-data", icon: Database, subItems: [{ title: "Products & items", url: "/master-data", hash: "items" }, { title: "Customers & suppliers", url: "/master-data", hash: "customers" }, { title: "Chart of accounts", url: "/master-data", hash: "items" }, { title: "Warehouses", url: "/master-data", hash: "warehouses" }] },
      { title: "Users & Roles", url: "/users", icon: ShieldCheck, subItems: [{ title: "Users", url: "/users" }, { title: "Roles & permissions", url: "/users" }, { title: "MFA & access", url: "/users" }] },
      { title: "Audit Logs", url: "/audit-logs", icon: NotebookText, subItems: [{ title: "Activity log", url: "/audit-logs" }, { title: "Security events", url: "/audit-logs" }] },
      { title: "System Settings", url: "/settings", icon: Settings, subItems: [{ title: "Company setup", url: "/settings", hash: "company" }, { title: "Integrations", url: "/settings", hash: "security" }, { title: "Notifications", url: "/settings", hash: "notifications" }] },
    ],
  },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => (url === "/" ? path === "/" : path.startsWith(url));

  return (
    <nav className="px-2 py-4">
      {navGroups.map((g) => {
        const items = g.items.filter((item) => navigationAllowedForRole(user?.role, item.url));
        if (items.length === 0) return null;
        return (
          <div key={g.label} className="mb-3">
            <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">
              {g.label}
            </div>
            <div className="grid gap-1">
              {items.map((item) => (
                <Collapsible key={item.url} defaultOpen={isActive(item.url)}>
                  <div className="flex items-center gap-1">
                    <Link
                      to={item.url}
                      onClick={onNavigate}
                      className={[
                        "flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-sm transition-colors",
                        "hover:bg-muted",
                        isActive(item.url) ? "bg-primary text-primary-foreground" : "text-foreground",
                      ].join(" ")}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.title}</span>
                    </Link>
                    {item.subItems && (
                      <CollapsibleTrigger className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Expand ${item.title}`}>
                        <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                    )}
                  </div>
                  {item.subItems && (
                    <CollapsibleContent className="ml-6 mt-1 grid gap-1 border-l border-border pl-3">
                      {item.subItems.map((subItem) => (
                        <Link key={`${item.url}-${subItem.title}`} to={subItem.url} hash={subItem.hash} onClick={onNavigate} className="rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                          {subItem.title}
                        </Link>
                      ))}
                    </CollapsibleContent>
                  )}
                </Collapsible>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const { user } = useAuth();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => (url === "/" ? path === "/" : path.startsWith(url));

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="shrink-0 border-b border-sidebar-border px-3 py-3">
        <Link to="/" className="block px-1">
          <BrandMark compact={collapsed} />
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-1 overflow-y-auto overscroll-contain px-2 py-4">
        {navGroups.map((g) => {
          const items = g.items.filter((item) => navigationAllowedForRole(user?.role, item.url));
          if (items.length === 0) return null;
          return (
          <SidebarGroup key={g.label} className="mb-2">
            {!collapsed && (
              <SidebarGroupLabel className="px-2 text-xs font-medium text-muted-foreground">
                {g.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {items.map((item) => (
                  <Collapsible key={item.url} defaultOpen={isActive(item.url)} asChild>
                    <SidebarMenuItem>
                      <div className="flex items-center gap-1">
                        <SidebarMenuButton asChild isActive={isActive(item.url)} className="h-9 min-w-0 flex-1 px-3 text-sm">
                          <Link to={item.url} className="flex items-center gap-2">
                            <item.icon className="h-4 w-4 shrink-0" />
                            {!collapsed && <span className="truncate">{item.title}</span>}
                          </Link>
                        </SidebarMenuButton>
                        {!collapsed && item.subItems && (
                          <CollapsibleTrigger asChild>
                            <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" aria-label={`Expand ${item.title}`}>
                              <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
                            </button>
                          </CollapsibleTrigger>
                        )}
                      </div>
                      {!collapsed && item.subItems && (
                        <CollapsibleContent className="ml-6 mt-1 grid gap-1 border-l border-sidebar-border pl-3">
                          {item.subItems.map((subItem) => (
                            <Link key={`${item.url}-${subItem.title}`} to={subItem.url} hash={subItem.hash} className="rounded-md px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                              {subItem.title}
                            </Link>
                          ))}
                        </CollapsibleContent>
                      )}
                    </SidebarMenuItem>
                  </Collapsible>
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
