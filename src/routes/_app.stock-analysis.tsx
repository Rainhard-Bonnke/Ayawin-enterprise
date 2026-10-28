import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, PackageSearch, RefreshCw, Search, Warehouse as WarehouseIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchWarehouses, type BackendWarehouse } from "@/lib/api";
import { v1Api } from "@/lib/api-v1";
import { useAuth } from "@/lib/auth";
import { KES } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/stock-analysis")({
  component: StockAnalysisPage,
  head: () => ({ meta: [{ title: "Stock Analysis - Ayawin Stock Solution" }] }),
});

type AnalysisRow = {
  item_id: string; item_code: string; item_name: string; category: string;
  warehouse_id: string; warehouse_code: string; warehouse_name: string;
  quantity: number; reorder_point: number; avg_unit_cost: number; stock_value: number;
  units_out_period: number; estimated_days_cover: number | null; last_movement_at: string | null;
  analysis_status: "stockout" | "below_reorder" | "no_recent_movement" | "healthy";
};

function StockAnalysisPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [days, setDays] = useState(30);
  const [warehouseId, setWarehouseId] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await v1Api.inventory.analysis(token, days, warehouseId === "all" ? "" : warehouseId);
      setRows(response.rows as AnalysisRow[]);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to analyze stock"); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!token) return; void fetchWarehouses(token).then(setWarehouses).catch(() => setWarehouses([])); }, [token]);
  useEffect(() => { void load(); }, [token, days, warehouseId]);
  const counts = useMemo(() => ({
    stockout: rows.filter((row) => row.analysis_status === "stockout").length,
    reorder: rows.filter((row) => row.analysis_status === "below_reorder").length,
    stale: rows.filter((row) => row.analysis_status === "no_recent_movement").length,
    value: rows.reduce((sum, row) => sum + Number(row.stock_value || 0), 0),
  }), [rows]);
  const categories = Array.from(new Set(rows.map((row) => row.category))).sort();
  const visible = rows.filter((row) =>
    (status === "all" || row.analysis_status === status) &&
    (category === "all" || row.category === category) &&
    `${row.item_code} ${row.item_name} ${row.warehouse_name}`.toLowerCase().includes(query.toLowerCase()),
  );

  return <div className="space-y-5 pb-8">
    <PageHeader title="Stock analysis" description={`On-hand value, movement velocity, estimated cover and replenishment risk over the last ${days} days.`} actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh analysis</Button>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Stock value" value={KES(counts.value)} icon={<PackageSearch className="h-4 w-4" />} />
      <Metric label="Stockout locations" value={counts.stockout} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />
      <Metric label="At/below reorder" value={counts.reorder} tone="warning" icon={<Activity className="h-4 w-4" />} />
      <Metric label="No movement ≥90d" value={counts.stale} icon={<Clock3 className="h-4 w-4" />} />
    </div>
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="180">Last 180 days</SelectItem><SelectItem value="365">Last 12 months</SelectItem></SelectContent></Select>
        <Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger className="w-64"><WarehouseIcon className="mr-2 h-4 w-4" /><SelectValue placeholder="All warehouses" /></SelectTrigger><SelectContent><SelectItem value="all">All warehouses</SelectItem>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={String(warehouse.id)}>{warehouse.name}</SelectItem>)}</SelectContent></Select>
        <Select value={category} onValueChange={setCategory}><SelectTrigger className="w-52"><SelectValue placeholder="All product groups" /></SelectTrigger><SelectContent><SelectItem value="all">All product groups</SelectItem>{categories.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>
        <div className="relative w-full sm:max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find item or warehouse" className="pl-9" /></div>
        <div className="ml-auto flex flex-wrap gap-1">{[["all", "All"], ["stockout", "Stockouts"], ["below_reorder", "Reorder"], ["no_recent_movement", "No movement"], ["healthy", "Healthy"]].map(([value, label]) => <Button key={value} size="sm" variant={status === value ? "default" : "outline"} onClick={() => setStatus(value)}>{label}</Button>)}</div>
      </div>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Item</th><th className="px-3 py-3">Warehouse</th><th className="px-3 py-3 text-right">On hand</th><th className="px-3 py-3 text-right">Reorder at</th><th className="px-3 py-3 text-right">Out ({days}d)</th><th className="px-3 py-3 text-right">Days cover*</th><th className="px-3 py-3 text-right">Value</th><th className="px-3 py-3">Last movement</th><th className="px-3 py-3">Finding</th></tr></thead><tbody>
        {visible.map((row) => <tr key={`${row.item_id}-${row.warehouse_id}`} className="border-t"><td className="px-3 py-3"><div className="font-medium">{row.item_name}</div><div className="font-mono text-xs text-muted-foreground">{row.item_code} · {row.category}</div></td><td className="px-3 py-3">{row.warehouse_name}</td><td className="px-3 py-3 text-right tabular-nums">{Number(row.quantity).toLocaleString()}</td><td className="px-3 py-3 text-right tabular-nums">{Number(row.reorder_point).toLocaleString()}</td><td className="px-3 py-3 text-right tabular-nums">{Number(row.units_out_period).toLocaleString()}</td><td className="px-3 py-3 text-right tabular-nums">{row.estimated_days_cover == null ? "—" : Number(row.estimated_days_cover).toFixed(1)}</td><td className="px-3 py-3 text-right tabular-nums">{KES(Number(row.stock_value))}</td><td className="px-3 py-3 text-muted-foreground">{row.last_movement_at ? new Date(row.last_movement_at).toLocaleDateString() : "No movement"}</td><td className="px-3 py-3"><Badge variant={row.analysis_status === "stockout" ? "destructive" : row.analysis_status === "below_reorder" ? "outline" : "secondary"}>{row.analysis_status.replaceAll("_", " ")}</Badge></td></tr>)}
        {!loading && !visible.length && <tr><td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">No stock lines match this analysis filter.</td></tr>}
        {loading && <tr><td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">Calculating stock analysis…</td></tr>}
      </tbody></table></div>
      <p className="text-xs text-muted-foreground">* Estimated days cover uses historical issues and sales evenly spread across the selected period. It is a planning indicator, not a purchase commitment. Stock valuation uses the ERP’s current average unit cost.</p>
    </CardContent></Card>
  </div>;
}

function Metric({ label, value, icon, tone = "" }: { label: string; value: string | number; icon: React.ReactNode; tone?: string }) {
  return <Card className="rounded-2xl border-border/70"><CardContent className="flex items-center justify-between p-4"><div><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "danger" ? "text-destructive" : tone === "warning" ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</div></div><span className="text-primary">{icon}</span></CardContent></Card>;
}
