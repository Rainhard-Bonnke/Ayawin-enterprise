import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { KES, fmtDate } from "@/lib/format";
import { Banknote, ShoppingCart, AlertTriangle, FileText, Wallet, Receipt } from "lucide-react";
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
import { toast } from "sonner";

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
    fetchDashboardSummary(token)
      .then(setSummary)
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Unable to load dashboard summary");
        setSummary(null);
      });
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

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Summary for today" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Today's sales", value: KES(todaysSales), icon: ShoppingCart },
          { label: "Revenue MTD", value: KES(revenueMtd), icon: Banknote },
          { label: "Pending orders", value: pendingOrders, icon: Receipt },
          { label: "Stock alerts", value: String(stockAlerts), icon: AlertTriangle },
        ].map((card) => (
          <KpiCard key={card.label} label={card.label} value={card.value} icon={card.icon} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Monthly revenue</CardTitle>
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
                <Line type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sales by category</CardTitle>
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
            <CardTitle>Top products</CardTitle>
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
                <Bar dataKey="units" fill="var(--primary)" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {liveAlerts.map((a, i) => (
              <div key={i} className="flex items-start gap-2 border-b border-border py-2 last:border-0">
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
          <CardTitle>Recent orders</CardTitle>
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

    </div>
  );
}
