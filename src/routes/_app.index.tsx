import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { KES, fmtDate } from "@/lib/format";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Building2,
  PackagePlus,
  Receipt,
  ShoppingCart,
  UserCog,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { fetchDashboardSummary, type DashboardSummary } from "@/lib/api";
import { toast } from "sonner";
import { canAccessPath } from "@/lib/rbac";

export const Route = createFileRoute("/_app/")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard - Ayawin Stock Solution" }] }),
});

const quickModules = [
  {
    title: "Sales",
    detail: "Orders & customers",
    url: "/sales",
    icon: ShoppingCart,
    colors: "from-[#fff0ef] to-[#ffe3e7] text-[#b93453] border-rose-200",
  },
  {
    title: "Inventory",
    detail: "Stock & movement",
    url: "/inventory",
    icon: PackagePlus,
    colors: "from-[#e9fbfb] to-[#d5f3f2] text-[#087f90] border-cyan-200",
  },
  {
    title: "Procurement",
    detail: "Purchases & supply",
    url: "/procurement",
    icon: Building2,
    colors: "from-[#fff7e5] to-[#ffedc3] text-[#9c6817] border-amber-200",
  },
  {
    title: "Finance",
    detail: "Accounts & reports",
    url: "/accounting",
    icon: Banknote,
    colors: "from-[#f1efff] to-[#e6e1ff] text-[#5b63bd] border-violet-200",
  },
  {
    title: "People",
    detail: "HR & payroll",
    url: "/hr",
    icon: UserCog,
    colors: "from-[#ecf8ed] to-[#d9f0dc] text-[#27814d] border-green-200",
  },
  {
    title: "Reports",
    detail: "Business insights",
    url: "/reports",
    icon: Activity,
    colors: "from-[#edf4ff] to-[#dceaff] text-[#28598d] border-blue-200",
  },
] as const;

function Dashboard() {
  const chartPalette = ["#e76d7a", "#3785c2", "#d49b2a", "#7d69d8", "#18a487", "#e68748"];
  const { token, user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setLoadError(false);
    let active = true;
    const timeout = window.setTimeout(() => {
      if (!active) return;
      setLoading(false);
      setLoadError(true);
      toast.error("Dashboard request timed out. Check the API connection and retry.");
    }, 12000);
    fetchDashboardSummary(token)
      .then((data) => {
        if (!active) return;
        window.clearTimeout(timeout);
        setSummary(data);
        setLoadError(false);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        window.clearTimeout(timeout);
        toast.error(err instanceof Error ? err.message : "Unable to load dashboard summary");
        setSummary(null);
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [token]);

  const liveMonthlyRevenue = summary?.monthlyRevenue ?? [];
  const liveTopProducts = summary?.topProducts ?? [];
  const liveSalesByCategory = summary?.salesByCategory ?? [];
  const liveAlerts = summary?.alerts ?? [];
  const liveTransactions = summary?.recentTransactions ?? [];
  const todaysSales = summary?.kpis ? Number(summary.kpis.todays_sales) : 0;
  const revenueMtd = summary?.kpis ? Number(summary.kpis.revenue_mtd) : 0;
  const pendingOrders = summary?.kpis ? String(summary.kpis.pending_orders) : "0";
  const stockAlerts = liveAlerts.filter((alert) => alert.type === "stock").length;
  const metricValue = (value: string) => (loading ? "Loading" : loadError ? "Unavailable" : value);
  const firstName = user?.full_name?.trim().split(/\s+/)[0] || user?.username || "there";
  const greeting =
    new Date().getHours() < 12
      ? "Good morning"
      : new Date().getHours() < 17
        ? "Good afternoon"
        : "Good evening";

  const maxRevenue = Math.max(1, ...liveMonthlyRevenue.map((point) => point.revenue));
  const revenuePoints = liveMonthlyRevenue
    .map((point, index) => {
      const x =
        liveMonthlyRevenue.length < 2 ? 50 : (index / (liveMonthlyRevenue.length - 1)) * 100;
      const y = 88 - (point.revenue / maxRevenue) * 78;
      return `${x},${y}`;
    })
    .join(" ");
  const maxCategorySales = Math.max(1, ...liveSalesByCategory.map((row) => row.value));
  const maxProductUnits = Math.max(1, ...liveTopProducts.map((row) => row.units));

  return (
    <div className="dashboard-page space-y-6 pb-8">
      <PageHeader
        className="dashboard-welcome"
        title={`${greeting}, ${firstName}`}
        description="Sales, receivables, orders, and stock exceptions across your business."
        actions={
          <>
            <Button
              asChild
              variant="outline"
              className="rounded-xl border-white/50 bg-white/95 text-[#234d78] shadow-sm hover:bg-white"
            >
              <Link to="/sales">
                <ShoppingCart className="mr-2 h-4 w-4" />
                New sale
              </Link>
            </Button>
            <Button
              asChild
              className="rounded-xl bg-[#00a9c9] text-white shadow-lg shadow-cyan-950/15 hover:bg-[#008eae]"
            >
              <Link to="/inventory">
                <PackagePlus className="mr-2 h-4 w-4" />
                Receive stock
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Invoiced today",
            value: metricValue(KES(todaysSales)),
            note: "Posted invoices",
            icon: ShoppingCart,
            tone: "text-emerald-700 dark:text-emerald-300",
            surface:
              "border-rose-200 bg-gradient-to-br from-[#fff0ef] via-white to-white dark:border-rose-950/60 dark:from-rose-950/30 dark:via-slate-900 dark:to-slate-900",
            iconSurface: "bg-rose-100 text-[#d94c65] dark:bg-rose-950/60 dark:text-rose-300",
          },
          {
            label: "Revenue MTD",
            value: metricValue(KES(revenueMtd)),
            note: "Current month so far",
            icon: Banknote,
            tone: "text-amber-700 dark:text-amber-300",
            surface:
              "border-amber-200 bg-gradient-to-br from-[#fff7e5] via-white to-white dark:border-amber-950/60 dark:from-amber-950/30 dark:via-slate-900 dark:to-slate-900",
            iconSurface: "bg-amber-100 text-[#b87910] dark:bg-amber-950/60 dark:text-amber-300",
          },
          {
            label: "Pending orders",
            value: metricValue(pendingOrders),
            note: "Draft, confirmed, or partial",
            icon: Receipt,
            tone: "text-sky-700 dark:text-sky-300",
            surface:
              "border-blue-200 bg-gradient-to-br from-[#eaf5ff] via-white to-white dark:border-blue-950/60 dark:from-blue-950/30 dark:via-slate-900 dark:to-slate-900",
            iconSurface: "bg-blue-100 text-[#3675ba] dark:bg-blue-950/60 dark:text-blue-300",
          },
          {
            label: "Stock alerts",
            value: metricValue(String(stockAlerts)),
            note: loading
              ? "Loading live alerts"
              : loadError
                ? "Could not load alerts"
                : stockAlerts
                  ? "Review replenishment"
                  : "No reorder alerts",
            icon: AlertTriangle,
            tone: stockAlerts
              ? "text-red-700 dark:text-red-300"
              : "text-emerald-700 dark:text-emerald-300",
            surface:
              "border-cyan-200 bg-gradient-to-br from-[#e9fbfb] via-white to-white dark:border-cyan-950/60 dark:from-cyan-950/30 dark:via-slate-900 dark:to-slate-900",
            iconSurface: "bg-cyan-100 text-[#078b94] dark:bg-cyan-950/60 dark:text-cyan-300",
          },
        ].map(({ label, value, note, icon: Icon, tone, surface, iconSurface }) => (
          <Card
            key={label}
            className={`overflow-hidden rounded-2xl border shadow-[0_14px_32px_-24px_rgba(27,62,97,0.38)] transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${surface}`}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                    {value}
                  </p>
                </div>
                <div className={`rounded-2xl p-3 shadow-sm ${iconSurface}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className={`mt-4 flex items-center gap-1.5 text-xs ${tone} opacity-90`}>
                <Activity className="h-3.5 w-3.5" />
                {note}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <section aria-labelledby="quick-modules-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div>
            <h2
              id="quick-modules-title"
              className="text-base font-bold tracking-tight text-[#193958] dark:text-foreground"
            >
              Move through your workspace
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Open a module and continue where your team works.
            </p>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Quick access
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {quickModules
            .filter((module) => canAccessPath(user, module.url))
            .map(({ title, detail, url, icon: Icon, colors }) => (
              <Link
                key={title}
                to={url}
                className={`group relative flex min-h-28 flex-col justify-between overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${colors}`}
              >
                <span className="pointer-events-none absolute -bottom-8 -right-7 h-24 w-24 rounded-full border-[12px] border-current opacity-[0.08] transition-transform duration-300 group-hover:scale-110" />
                <div className="relative flex items-start justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/75 shadow-sm ring-1 ring-black/5">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowUpRight className="h-4 w-4 opacity-45 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
                </div>
                <div className="relative mt-3">
                  <div className="text-sm font-bold text-[#193958] dark:text-slate-900">
                    {title}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-600">{detail}</div>
                </div>
              </Link>
            ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
        <Card className="rounded-2xl border-border/70 bg-background/65 shadow-sm lg:col-span-1">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardTitle>Revenue performance</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Six-month trading view</p>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="rounded-lg text-xs text-muted-foreground"
            >
              <Link to="/reports">
                View report <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="min-h-70">
            {loading ? (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                Loading revenue history…
              </div>
            ) : loadError ? (
              <div className="flex h-56 items-center justify-center text-sm text-destructive">
                Revenue data could not be loaded. Refresh to retry.
              </div>
            ) : liveMonthlyRevenue.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                No posted invoice history yet.
              </div>
            ) : (
              <div className="flex h-56 flex-col justify-between">
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="h-40 w-full overflow-visible"
                  role="img"
                  aria-label="Revenue by month"
                >
                  {[25, 50, 75].map((y) => (
                    <line
                      key={y}
                      x1="0"
                      x2="100"
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      className="text-border"
                      strokeDasharray="1 2"
                    />
                  ))}
                  <defs>
                    <linearGradient id="revenue-area" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#00a9c9" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#00a9c9" stopOpacity="0.01" />
                    </linearGradient>
                  </defs>
                  {liveMonthlyRevenue.length > 1 && (
                    <polygon points={`${revenuePoints} 100,100 0,100`} fill="url(#revenue-area)" />
                  )}
                  <polyline
                    points={revenuePoints}
                    fill="none"
                    stroke="#078eae"
                    strokeWidth="2.2"
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {liveMonthlyRevenue.map((point, index) => {
                    const x =
                      liveMonthlyRevenue.length < 2
                        ? 50
                        : (index / (liveMonthlyRevenue.length - 1)) * 100;
                    const y = 88 - (point.revenue / maxRevenue) * 78;
                    return (
                      <circle
                        key={`${point.month}-${index}`}
                        cx={x}
                        cy={y}
                        r="1.8"
                        fill="#fff"
                        stroke="#078eae"
                        strokeWidth="1.6"
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>
                          {point.month}: {KES(point.revenue)}
                        </title>
                      </circle>
                    );
                  })}
                </svg>
                <div className="flex justify-between text-xs text-muted-foreground">
                  {liveMonthlyRevenue.map((point, index) => (
                    <span key={`${point.month}-${index}`}>{point.month}</span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 bg-background/65 shadow-sm">
          <CardHeader>
            <CardTitle>Sales mix</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Contribution by category</p>
          </CardHeader>
          <CardContent className="min-h-70">
            {loading ? (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                Loading sales mix…
              </div>
            ) : loadError ? (
              <div className="flex h-56 items-center justify-center text-sm text-destructive">
                Sales mix could not be loaded.
              </div>
            ) : liveSalesByCategory.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                No category sales recorded this month.
              </div>
            ) : (
              <div className="space-y-5 pt-4">
                {liveSalesByCategory.map((row, index) => (
                  <div key={row.name} className="space-y-2">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="truncate">{row.name}</span>
                      <span className="shrink-0 font-medium tabular-nums">{KES(row.value)}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted/80">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(2, (row.value / maxCategorySales) * 100)}%`,
                          backgroundColor: chartPalette[index % chartPalette.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <Card className="rounded-2xl border-border/70 bg-background/65 shadow-sm">
          <CardHeader>
            <CardTitle>Top products</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Units moving fastest</p>
          </CardHeader>
          <CardContent className="min-h-80">
            {loading ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                Loading product sales…
              </div>
            ) : loadError ? (
              <div className="flex h-64 items-center justify-center text-sm text-destructive">
                Product sales could not be loaded.
              </div>
            ) : liveTopProducts.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                No invoiced product sales yet.
              </div>
            ) : (
              <div className="space-y-5 pt-3">
                {liveTopProducts.map((row, index) => (
                  <div key={row.name} className="space-y-2">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="truncate">{row.name}</span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {row.units.toLocaleString()} units
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-muted/80">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(2, (row.units / maxProductUnits) * 100)}%`,
                          backgroundColor: chartPalette[(index + 1) % chartPalette.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 bg-background/65 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Attention needed</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">Exceptions across operations</p>
            </div>
            <span className="rounded-full bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300">
              {liveAlerts.length} open
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
                Loading operational alerts…
              </div>
            ) : loadError ? (
              <div className="flex min-h-32 items-center justify-center text-sm text-destructive">
                Operational alerts could not be loaded.
              </div>
            ) : liveAlerts.length ? (
              liveAlerts.map((a, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 border-b border-border py-2 last:border-0"
                >
                  <AlertTriangle
                    className={`mt-0.5 h-4 w-4 shrink-0 ${a.severity === "high" ? "text-destructive" : "text-warning"}`}
                  />
                  <div className="text-xs text-foreground">{a.message}</div>
                </div>
              ))
            ) : (
              <div className="flex min-h-32 flex-col items-center justify-center text-center">
                <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300">
                  <Activity className="h-5 w-5" />
                </div>
                <p className="mt-3 text-sm font-medium">Everything is on track</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No operational exceptions reported.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 rounded-2xl border-border/70 bg-background/65 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Recent invoices</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Latest invoices recorded in the system
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="rounded-lg">
            <Link to="/sales">
              Open sales <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liveTransactions.slice(0, 6).map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.id}</TableCell>
                  <TableCell>{fmtDate(o.date)}</TableCell>
                  <TableCell>{o.customer}</TableCell>
                  <TableCell className="text-right font-medium">{KES(o.total)}</TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && liveTransactions.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {loadError
                      ? "Recent invoices could not be loaded."
                      : "No invoices have been created yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
