import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { KES, fmtDate } from "@/lib/format";
import { monthlyRevenue, topProducts, salesByCategory, salesOrders, alerts } from "@/lib/mock-data";
import { Banknote, ShoppingCart, AlertTriangle, FileText, Wallet, Receipt } from "lucide-react";
import { QuietNote } from "@/components/QuietNote";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { fetchDashboardSummary, type DashboardSummary } from "@/lib/api";

export const Route = createFileRoute("/_app/")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard - Ayawin Enterprise ERP" }] }),
});

const COLORS = [
  "hsl(45 75% 55%)",
  "hsl(220 50% 35%)",
  "hsl(150 50% 45%)",
  "hsl(25 75% 55%)",
  "hsl(200 50% 50%)",
  "hsl(280 30% 50%)",
];

function Dashboard() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchDashboardSummary(token).then(setSummary).catch(() => setSummary(null));
  }, [token]);

  const liveMonthlyRevenue = summary?.monthlyRevenue?.length ? summary.monthlyRevenue : monthlyRevenue;
  const liveTopProducts = summary?.topProducts?.length ? summary.topProducts : topProducts;
  const liveSalesByCategory = summary?.salesByCategory?.length ? summary.salesByCategory : salesByCategory;
  const liveAlerts = summary?.alerts?.length ? summary.alerts : alerts;
  const liveTransactions = summary?.recentTransactions?.length ? summary.recentTransactions : salesOrders;
  const todaysSales = summary?.kpis ? Number(summary.kpis.todays_sales) : 1840500;
  const revenueMtd = summary?.kpis ? Number(summary.kpis.revenue_mtd) : 13800000;
  const pendingOrders = summary?.kpis ? String(summary.kpis.pending_orders) : "14";
  const stockAlerts = liveAlerts.filter((alert) => alert.type === "stock").length || 6;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of today's operations - 21/05/2026"
      />

      <div className="erp-section overflow-hidden">
        <div className="grid gap-4 p-5 lg:grid-cols-[1.5fr_1fr] lg:p-6">
          <div className="relative overflow-hidden rounded-3xl bg-navy p-6 text-navy-foreground shadow-xl">
            <div className="absolute inset-0 opacity-[0.08]" style={{
              backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
              backgroundSize: "22px 22px",
            }} />
            <div className="relative flex flex-col gap-5">
              <div>
                <div className="inline-flex rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
                  Live operations
                </div>
                <h2 className="mt-4 font-display text-3xl font-bold leading-tight sm:text-4xl">
                  Premium ERP control for Kenyan beverage distribution.
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-navy-foreground/75">
                  KRA-ready invoicing, excise duty tracking, warehouse visibility, and real-time dispatch intelligence in one screen.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["KRA status", "Compliant"],
                  ["Service worker", "Online"],
                  ["Currency", "KES"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-navy-foreground/55">{label}</div>
                    <div className="mt-1 text-sm font-semibold text-white">{value}</div>
                  </div>
                ))}
              </div>
              <div className="max-w-3xl">
                <QuietNote
                  scenario="dashboard"
                  contextKey="dashboard"
                  context={{ monthlyRevenue: liveMonthlyRevenue, topProducts: liveTopProducts, salesByCategory: liveSalesByCategory, salesOrders: liveTransactions, alerts: liveAlerts }}
                  className="border-white/10 bg-white/5 text-navy-foreground/90 backdrop-blur"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {[
              { label: "Today's Sales", value: KES(todaysSales), icon: ShoppingCart, accent: true },
              { label: "Revenue MTD", value: KES(revenueMtd), icon: Banknote },
              { label: "Pending Orders", value: pendingOrders, icon: Receipt },
              { label: "Stock Alerts", value: String(stockAlerts), icon: AlertTriangle },
            ].map((card) => (
              <KpiCard
                key={card.label}
                label={card.label}
                value={card.value}
                icon={card.icon}
                accent={card.accent}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="font-display">Monthly Revenue Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={liveMonthlyRevenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickFormatter={(v) => `${v / 1000000}M`}
                />
                <Tooltip
                  formatter={(v: number) => KES(v)}
                  contentStyle={{ borderRadius: 8, border: "1px solid var(--border)" }}
                />
                <Line type="monotone" dataKey="revenue" stroke="var(--gold)" strokeWidth={3} dot={{ fill: "var(--navy)", r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display">Sales by Category</CardTitle>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={liveSalesByCategory} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {liveSalesByCategory.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => KES(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Top 10 Selling Products</CardTitle>
          </CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={liveTopProducts} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis
                  type="category"
                  dataKey="name"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={11}
                  width={110}
                />
                <Tooltip contentStyle={{ borderRadius: 8 }} />
                <Bar dataKey="units" fill="var(--navy)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="erp-section">
          <CardHeader>
            <CardTitle className="font-display">Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {liveAlerts.map((a, i) => (
              <div key={i} className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/60 p-3">
                <AlertTriangle
                  className={`mt-0.5 h-4 w-4 shrink-0 ${a.severity === "high" ? "text-destructive" : "text-warning"}`}
                />
                <div className="text-xs text-foreground">{a.message}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-display">Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Sales Rep</TableHead>
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
                  <TableCell className="text-muted-foreground">{o.rep || "Unassigned"}</TableCell>
                  <TableCell className="text-right font-medium">{KES(o.total)}</TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Compliance Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>KRA PIN on invoices</span>
              <span className="text-success">Enabled</span>
            </div>
            <div className="flex justify-between">
              <span>ETR / TIMS field</span>
              <span className="text-success">Enabled</span>
            </div>
            <div className="flex justify-between">
              <span>VAT rate</span>
              <span>16%</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Operational Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div>Warehouse transfers pending: 3</div>
            <div>Drivers on route: 2</div>
            <div>Payroll due: 28/05/2026</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Offline Readiness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div>Dashboard shell cached by service worker</div>
            <div>Key views: home, login, reports</div>
            <div>Last sync: 21/05/2026 08:30 EAT</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-base">Currency</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div>Default: KES</div>
            <div>Date format: DD/MM/YYYY</div>
            <div>Locale: en-KE</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
