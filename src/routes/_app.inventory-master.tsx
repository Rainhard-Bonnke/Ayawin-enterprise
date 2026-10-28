import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Boxes, PackagePlus, Search, ArrowRight, Barcode } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { fetchMasterItems, type BackendMasterItem } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/inventory-master")({
  component: InventoryMasterPage,
  head: () => ({ meta: [{ title: "Inventory Master - Ayawin Stock Solution" }] }),
});

function InventoryMasterPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!token) return;
    let active = true;
    fetchMasterItems(token, "", 2000).then((rows) => { if (active) setItems(rows); })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "Unable to load item master"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => !q || `${item.item_code} ${item.name} ${item.barcode || ""}`.toLowerCase().includes(q));
  }, [items, query]);
  const activeCount = items.filter((item) => item.is_active).length;
  const reorderConfigured = items.filter((item) => Number(item.reorder_point) > 0).length;

  return <div className="space-y-5 pb-8">
    <PageHeader title="Inventory master" description="The controlled catalogue of stocked products, identifiers, costing defaults and replenishment settings." actions={<Button asChild><Link to="/master-data" hash="items"><PackagePlus className="mr-2 h-4 w-4" /> Manage item records <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>} />
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Item records" value={items.length} icon={<Boxes className="h-4 w-4" />} />
      <Stat label="Active items" value={activeCount} />
      <Stat label="Reorder points configured" value={reorderConfigured} />
    </div>
    <Card className="rounded-2xl border-border/70 shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div><h2 className="font-semibold">Stocked product catalogue</h2><p className="text-sm text-muted-foreground">Items with inactive status remain visible for audit history.</p></div>
          <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search item code, barcode or name" className="pl-9" /></div>
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Item code</th><th className="px-4 py-3">Product</th><th className="px-4 py-3">Barcode</th><th className="px-4 py-3 text-right">Standard cost</th><th className="px-4 py-3 text-right">Reorder point</th><th className="px-4 py-3">Status</th></tr></thead><tbody>
            {filtered.map((item) => <tr key={item.id} className="border-t"><td className="px-4 py-3 font-mono text-xs">{item.item_code}</td><td className="px-4 py-3 font-medium">{item.name}</td><td className="px-4 py-3 text-muted-foreground">{item.barcode ? <span className="inline-flex items-center gap-1"><Barcode className="h-3.5 w-3.5" />{item.barcode}</span> : "—"}</td><td className="px-4 py-3 text-right tabular-nums">{Number(item.standard_cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td className="px-4 py-3 text-right tabular-nums">{Number(item.reorder_point).toLocaleString()}</td><td className="px-4 py-3"><Badge variant={item.is_active ? "secondary" : "outline"}>{item.is_active ? "Active" : "Inactive"}</Badge></td></tr>)}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No stocked items match this search.</td></tr>}
            {loading && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Loading item master…</td></tr>}
          </tbody></table>
        </div>
      </CardContent>
    </Card>
  </div>;
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return <Card className="rounded-2xl border-border/70"><CardContent className="flex items-center justify-between p-4"><div><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value}</div></div><span className="text-primary">{icon || <Boxes className="h-4 w-4" />}</span></CardContent></Card>;
}
