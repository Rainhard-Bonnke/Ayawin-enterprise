import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Building2,
  Wallet,
  UserCog,
  Settings,
  ShieldCheck,
  NotebookText,
  Database,
  ChevronDown,
  BriefcaseBusiness,
  Truck,
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
    label: "SALES",
    items: [
      {
        title: "Sales orders",
        url: "/sales",
        icon: ShoppingCart,
        subItems: [
          { title: "Customers", url: "/customers" },
          { title: "Invoices", url: "/invoices" },
          { title: "Customer returns & credits", url: "/customer-credit-notes" },
          { title: "Delivery & logistics", url: "/delivery" },
        ],
      },
    ],
  },
  {
    label: "PURCHASES",
    items: [
      {
        title: "Procurement",
        url: "/procurement",
        icon: Building2,
        subItems: [
          { title: "Goods received", url: "/goods-received" },
          { title: "Suppliers", url: "/suppliers" },
        ],
      },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      {
        title: "Inventory",
        url: "/inventory",
        icon: Package,
        subItems: [
          { title: "Inventory master", url: "/inventory-master" },
          { title: "Material requisitions", url: "/material-requisitions" },
          { title: "Material issues", url: "/material-issues" },
          { title: "Material returns", url: "/material-returns" },
          { title: "Stock analysis", url: "/stock-analysis" },
          { title: "Stock adjustments", url: "/stock-adjustments" },
          { title: "Stock movements", url: "/stock-movements" },
          { title: "Warehouse transfers", url: "/transfers" },
          { title: "Lots & expiry", url: "/inventory-lots" },
          { title: "Quarantine disposition", url: "/quarantine" },
          { title: "Reorder alerts", url: "/reorder-alerts" },
        ],
      },
    ],
  },
  {
    label: "FLEET",
    items: [{ title: "Driver stock & counts", url: "/driver-stock", icon: Truck }],
  },
  {
    label: "FINANCE",
    items: [
      {
        title: "Accounting",
        url: "/accounting",
        icon: Wallet,
        subItems: [
          { title: "Accounts receivable", url: "/accounts-receivable" },
          { title: "Accounts payable", url: "/accounts-payable" },
          { title: "Supplier credit notes", url: "/supplier-credit-notes" },
          { title: "Bank reconciliation", url: "/bank-reconciliation" },
          { title: "Reports & analytics", url: "/reports" },
        ],
      },
    ],
  },
  {
    label: "HUMAN RESOURCE",
    items: [
      {
        title: "Human Resources",
        url: "/hr",
        icon: UserCog,
        subItems: [
          { title: "Leave & attendance", url: "/leave-attendance" },
          { title: "Payroll", url: "/payroll" },
        ],
      },
    ],
  },
  {
    label: "ASSETS",
    items: [
      {
        title: "Asset Register",
        url: "/assets",
        icon: BriefcaseBusiness,
        subItems: [{ title: "Depreciation", url: "/depreciation" }],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        title: "Master Data",
        url: "/master-data",
        icon: Database,
      },
      {
        title: "Users & Roles",
        url: "/users",
        icon: ShieldCheck,
      },
      {
        title: "Audit Logs",
        url: "/audit-logs",
        icon: NotebookText,
      },
      {
        title: "System Settings",
        url: "/settings",
        icon: Settings,
      },
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
            <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.label}</div>
            <div className="grid gap-1">
              {items.map((item) => (
                <Collapsible
                  key={item.url}
                  defaultOpen={
                    isActive(item.url) || Boolean(item.subItems?.some((sub) => sub.url === path))
                  }
                >
                  <div className="flex items-center gap-1">
                    <Link
                      to={item.url}
                      onClick={onNavigate}
                      className={[
                        "flex h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-sm transition-colors",
                        "hover:bg-muted",
                        isActive(item.url) ||
                        Boolean(item.subItems?.some((sub) => sub.url === path))
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground",
                      ].join(" ")}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.title}</span>
                    </Link>
                    {item.subItems && (
                      <CollapsibleTrigger
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Expand ${item.title}`}
                      >
                        <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                    )}
                  </div>
                  {item.subItems && (
                    <CollapsibleContent className="ml-6 mt-1 grid gap-1 border-l border-border pl-3">
                      {item.subItems.map((subItem) => (
                        <Link
                          key={`${item.url}-${subItem.title}`}
                          to={subItem.url}
                          hash={subItem.hash}
                          onClick={onNavigate}
                          className={`rounded-md px-2 py-2 text-xs ${path === subItem.url ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}
                        >
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
    <Sidebar collapsible="icon" className="erp-sidebar border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="shrink-0 border-b border-sidebar-border/80 px-3 py-3">
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
                <SidebarGroupLabel className="px-2 text-[10px] font-bold tracking-[0.18em] text-cyan-100/55">
                  {g.label}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu className="gap-1">
                  {items.map((item) => (
                    <Collapsible
                      key={item.url}
                      defaultOpen={
                        isActive(item.url) ||
                        Boolean(item.subItems?.some((sub) => sub.url === path))
                      }
                      asChild
                    >
                      <SidebarMenuItem>
                        <div className="flex items-center gap-1">
                          <SidebarMenuButton
                            asChild
                            isActive={
                              isActive(item.url) ||
                              Boolean(item.subItems?.some((sub) => sub.url === path))
                            }
                            className="h-10 min-w-0 flex-1 rounded-xl px-3 text-sm transition-all data-[active=true]:shadow-md data-[active=true]:shadow-cyan-950/20"
                          >
                            <Link to={item.url} className="flex items-center gap-2">
                              <item.icon className="h-4 w-4 shrink-0" />
                              {!collapsed && <span className="truncate">{item.title}</span>}
                            </Link>
                          </SidebarMenuButton>
                          {!collapsed && item.subItems && (
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                                aria-label={`Expand ${item.title}`}
                              >
                                <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
                              </button>
                            </CollapsibleTrigger>
                          )}
                        </div>
                        {!collapsed && item.subItems && (
                          <CollapsibleContent className="ml-6 mt-1 grid gap-1 border-l border-sidebar-border pl-3">
                            {item.subItems.map((subItem) => (
                              <Link
                                key={`${item.url}-${subItem.title}`}
                                to={subItem.url}
                                hash={subItem.hash}
                                className={`rounded-lg px-2.5 py-2 text-xs transition-colors ${path === subItem.url ? "bg-cyan-300/15 font-semibold text-cyan-100" : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"}`}
                              >
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
