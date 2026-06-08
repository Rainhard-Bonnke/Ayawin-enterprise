import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { subscribeLiveEvents } from "@/hooks/useLiveEvents";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { KES, fmtDate } from "@/lib/format";
import { Banknote, ShoppingCart, AlertTriangle, FileText, Receipt } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import {
  fetchDashboardSummary,
  type DashboardSummary,
  type DashboardDatePreset,
} from "@/lib/api";
import { AiInsightStrip } from "@/components/AiInsightStrip";
import { PageHeader } from "@/components/PageHeader";
import { ChartEmptyState } from "@/components/charts/ChartEmptyState";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard - Ayawin Stock Solutions ERP" }] }),
});

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-1)",
];

const DATE_PRESETS: { value: DashboardDatePreset; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "mtd", label: "Month to date" },
  { value: "6m", label: "Last 6 months" },
  { value: "ytd", label: "Year to date" },
];

function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-10 w-64 rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-lg bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-[320px] rounded-lg bg-muted" />
        <div className="h-[320px] rounded-lg bg-muted" />
      </div>
    </div>
  );
}

function Dashboard() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<DashboardDatePreset>("6m");

  const loadSummary = useCallback(
    (opts?: { silent?: boolean }) => {
      if (!token) return Promise.resolve();
      if (!opts?.silent) setLoading(true);
      return fetchDashboardSummary(token, { preset })
        .then(setSummary)
        .catch((err) => {
          if (!opts?.silent) {
            toast.error(err instanceof Error ? err.message : "Unable to load dashboard summary");
            setSummary(null);
          }
        })
        .finally(() => {
          if (!opts?.silent) setLoading(false);
        });
    },
    [token, preset],
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useRealtimeSync(() => loadSummary({ silent: true }), { enabled: Boolean(token) });

  useEffect(() => {
    return subscribeLiveEvents((ev) => {
      if (
        ev.type === "invoice.updated" ||
        ev.type === "payment.received" ||
        ev.type === "inventory.updated" ||
        ev.type === "stock.low" ||
        ev.type === "sales_order.confirmed" ||
        ev.type === "delivery.updated" ||
        ev.type === "finance.period_closed"
      ) {
        void loadSummary({ silent: true });
      }
    });
  }, [loadSummary]);

  if (loading && !summary) {
    return <DashboardSkeleton />;
  }

  const liveMonthlyRevenue = summary?.monthlyRevenue ?? [];
  const liveTopProducts = summary?.topProducts ?? [];
  const liveSalesByCategory = summary?.salesByCategory ?? [];
  const liveAlerts = summary?.alerts ?? [];
  const liveTransactions = summary?.recentTransactions ?? [];
  const todaysSales = summary?.kpis ? Number(summary.kpis.todays_sales) : 0;
  const revenuePeriod = summary?.kpis
    ? Number(summary.kpis.revenue_in_range ?? summary.kpis.revenue_mtd)
    : 0;
  const pendingOrders = summary?.kpis ? String(summary.kpis.pending_orders) : "0";
  const arOutstanding = summary?.kpis ? Number(summary.kpis.outstanding_invoices) : 0;
  const pipelineForecast = summary?.kpis ? Number(summary.kpis.pipeline_forecast || 0) : 0;
  const stockAlerts = liveAlerts.filter((alert) => alert.type === "stock").length;
  const revenueMax = Math.max(...liveMonthlyRevenue.map((m) => m.revenue), 0);
  const pieTotal = liveSalesByCategory.reduce((s, c) => s + c.value, 0);

  const periodLabel = DATE_PRESETS.find((p) => p.value === preset)?.label ?? "Selected period";

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        title="Dashboard"
        description="Live overview of sales, inventory, and finance across your operation."
        compact
        actions={
          <Select value={preset} onValueChange={(v) => setPreset(v as DashboardDatePreset)}>
            <SelectTrigger className="w-full min-w-[160px] sm:w-[200px]">
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              {DATE_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {summary?.range && (
        <p className="text-xs text-muted-foreground">
          Showing data from {fmtDate(summary.range.from)} to {fmtDate(summary.range.to)} ({periodLabel})
        </p>
      )}

      <AiInsightStrip
        message={
          stockAlerts > 0
            ? `${stockAlerts} stock signal${stockAlerts > 1 ? "s" : ""} detected — review inventory before peak demand.`
            : `Revenue ${periodLabel.toLowerCase()} ${KES(revenuePeriod)} · AR outstanding ${KES(arOutstanding)} · CRM pipeline ${KES(pipelineForecast)}.`
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Today's sales", value: KES(todaysSales), icon: ShoppingCart },
          { label: `Revenue (${periodLabel})`, value: KES(revenuePeriod), icon: Banknote },
          { label: "Pending orders", value: pendingOrders, icon: Receipt },
          { label: "AR outstanding", value: KES(arOutstanding), icon: FileText },
        ].map((card, i) => (
          <KpiCard key={card.label} label={card.label} value={card.value} icon={card.icon} accentIndex={i} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Monthly revenue</CardTitle>
          </CardHeader>
          <CardContent className="h-[min(280px,50vw)] min-h-[220px] sm:h-[280px]">
            {liveMonthlyRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={liveMonthlyRevenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                  <XAxis dataKey="month" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    tickLine={false}
                    fontSize={12}
                    tickFormatter={(v) => (revenueMax > 1_000_000 ? `${v / 1_000_000}M` : `${v / 1000}k`)}
                  />
                  <Tooltip
                    formatter={(v: number) => KES(v)}
                    contentStyle={{ borderRadius: 8, border: "1px solid var(--border)" }}
                  />
                  <Line type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmptyState message="No revenue in this period — post invoices to see trends." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sales by category</CardTitle>
          </CardHeader>
          <CardContent className="h-[min(280px,50vw)] min-h-[220px] sm:h-[280px]">
            {pieTotal > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={liveSalesByCategory}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="40%"
                    outerRadius="70%"
                    paddingAngle={2}
                  >
                    {liveSalesByCategory.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => KES(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmptyState message="No category breakdown for this period." />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
          </CardHeader>
          <CardContent className="h-[min(320px,55vw)] min-h-[240px] sm:h-[320px]">
            {liveTopProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={liveTopProducts} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
                  <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="var(--muted-foreground)"
                    tickLine={false}
                    fontSize={11}
                    width={90}
                  />
                  <Tooltip contentStyle={{ borderRadius: 8 }} />
                  <Bar dataKey="units" fill="var(--primary)" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmptyState message="No product sales in this period." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[320px] space-y-2 overflow-y-auto">
            {liveAlerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No stock or overdue alerts.</p>
            ) : (
              liveAlerts.map((a, i) => {
                const inner = (
                  <>
                    <AlertTriangle
                      className={`mt-0.5 h-4 w-4 shrink-0 ${a.severity === "high" ? "text-destructive" : "text-warning"}`}
                    />
                    <div className="text-xs text-foreground">{a.message}</div>
                  </>
                );
                const linkSearch =
                  a.type === "stock" && a.item_code
                    ? { q: a.item_code }
                    : a.type === "invoice" && a.invoice_no
                      ? { q: a.invoice_no }
                      : null;
                const linkTo = a.type === "stock" ? "/inventory" : a.type === "invoice" ? "/invoices" : null;
                return linkTo && linkSearch ? (
                  <Link
                    key={`${a.type}-${i}`}
                    to={linkTo}
                    search={linkSearch}
                    className="flex items-start gap-2 rounded-md border border-transparent py-2 transition-colors hover:border-border hover:bg-muted/50"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={i} className="flex items-start gap-2 border-b border-border py-2 last:border-0">
                    {inner}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent orders</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="hidden sm:table-cell">Sales Rep</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liveTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No recent orders.
                  </TableCell>
                </TableRow>
              ) : (
                liveTransactions.slice(0, 6).map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.id}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(o.date)}</TableCell>
                    <TableCell>{o.customer}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{o.rep || "Unassigned"}</TableCell>
                    <TableCell className="text-right font-medium">{KES(o.total)}</TableCell>
                    <TableCell>
                      <StatusBadge status={o.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
