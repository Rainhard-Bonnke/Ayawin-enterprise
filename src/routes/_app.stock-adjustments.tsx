import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, LoaderCircle, RefreshCw, Save, XCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchMasterItems, fetchWarehouses, type BackendMasterItem, type BackendWarehouse } from "@/lib/api";
import { v1Api } from "@/lib/api-v1";
import { useAuth } from "@/lib/auth";
import { KES } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/stock-adjustments")({ component: StockAdjustmentsPage, head: () => ({ meta: [{ title: "Stock Adjustments - Ayawin Stock Solution" }] }) });
type CountLine = { item_id: string; item_code: string; name: string; system_quantity: number; physical_quantity: string; unit_cost: number; lot_tracking_enabled: boolean; batch_no: string; expiry_date: string };

function StockAdjustmentsPage() {
  const { token, user } = useAuth();
  const [journals, setJournals] = useState<Record<string, unknown>[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [catalog, setCatalog] = useState<BackendMasterItem[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<CountLine[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const canApprove = user?.role === "Admin" || user?.permissions?.includes("procurement.approve");
  const loadRegister = useCallback(async () => {
    if (!token) return;
    try { setJournals(await v1Api.inventory.adjustmentJournals(token)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load stock adjustment journals"); }
  }, [token]);
  useEffect(() => { if (!token) return; void loadRegister(); void Promise.all([fetchWarehouses(token), fetchMasterItems(token, "", 2000)]).then(([ws, items]) => { setWarehouses(ws); setCatalog(items); }).catch(() => toast.error("Unable to load stock count setup data")); }, [token, loadRegister]);
  const loadCountSheet = async () => {
    if (!token || !warehouseId) return;
    setLoading(true);
    try {
      const stock = await v1Api.inventory.stock(token, 1000, warehouseId);
      const byItem = new Map(stock.map((row) => [String(row.item_id), row]));
      const sheet = catalog.filter((item) => item.is_active).map((item) => {
        const row = byItem.get(item.id);
        const systemQuantity = Number(row?.quantity || 0);
        return { item_id: item.id, item_code: item.item_code, name: item.name, system_quantity: systemQuantity, physical_quantity: String(systemQuantity), unit_cost: Number(row?.avg_unit_cost ?? item.standard_cost ?? 0), lot_tracking_enabled: item.lot_tracking_enabled, batch_no: "", expiry_date: "" };
      });
      setLines(sheet); setChecked([]); toast.success(`Loaded ${sheet.length} active items for physical count`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to prepare count sheet"); }
    finally { setLoading(false); }
  };
  const filtered = useMemo(() => lines.filter((line) => `${line.item_code} ${line.name}`.toLowerCase().includes(search.toLowerCase())), [lines, search]);
  const countLines = lines.filter((line) => checked.includes(line.item_id));
  const changedCount = countLines.filter((line) => Math.abs(Number(line.physical_quantity) - line.system_quantity) > 0.0001).length;

  const saveDraft = async () => {
    if (!token || !warehouseId || !reason.trim() || !countLines.length || countLines.some((line) => line.physical_quantity === "" || !Number.isFinite(Number(line.physical_quantity)) || Number(line.physical_quantity) < 0 || (Number(line.physical_quantity) > line.system_quantity && line.lot_tracking_enabled && (!line.batch_no.trim() || !line.expiry_date)))) { toast.error("Select counted items, enter valid quantities, provide a reason, and give a batch and expiry for each positive tracked variance."); return; }
    if (!changedCount) { toast.error("The selected physical counts match the system quantities."); return; }
    setSaving(true);
    try {
      const journal = await v1Api.inventory.createAdjustmentJournal(token, { warehouse_id: warehouseId, reason, lines: countLines.map((line) => ({ item_id: line.item_id, physical_quantity: Number(line.physical_quantity), unit_cost: line.unit_cost, batch_no: line.batch_no, expiry_date: line.expiry_date })) });
      toast.success(`Adjustment draft ${String(journal.adjustment_no)} saved for independent review`);
      setReason(""); await loadRegister();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save adjustment draft"); }
    finally { setSaving(false); }
  };
  const post = async (row: Record<string, unknown>) => {
    if (!token || !window.confirm(`Post ${String(row.adjustment_no)}? This will update stock and the immutable movement ledger.`)) return;
    try { await v1Api.inventory.postAdjustmentJournal(token, String(row.id)); toast.success(`Adjustment ${String(row.adjustment_no)} posted`); await loadRegister(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to post adjustment"); }
  };
  const cancel = async (row: Record<string, unknown>) => {
    if (!token || !window.confirm(`Cancel draft ${String(row.adjustment_no)}?`)) return;
    try { await v1Api.inventory.cancelAdjustmentJournal(token, String(row.id)); toast.success("Adjustment draft cancelled"); await loadRegister(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to cancel adjustment"); }
  };

  return <div className="space-y-5 pb-8">
    <PageHeader title="Stock adjustment journals" description="Count physical stock, record variances as drafts, then have a different authorized user review and post them to inventory." />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Drafts awaiting review" value={journals.filter((row) => row.status === "draft").length} /><Metric label="Posted journals" value={journals.filter((row) => row.status === "posted").length} /><Metric label="Selected variances" value={changedCount} /></div>
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-4 p-5">
      <div><h2 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" /> Prepare physical count</h2><p className="text-sm text-muted-foreground">Choose a warehouse, load expected quantities, count independently, and select items to include. The system records the expected quantity at count time and blocks posting if stock changes before approval.</p></div>
      <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]"><div className="space-y-2"><Label>Warehouse</Label><Select value={warehouseId} onValueChange={(value) => { setWarehouseId(value); setLines([]); setChecked([]); }}><SelectTrigger><SelectValue placeholder="Choose a stock warehouse" /></SelectTrigger><SelectContent>{warehouses.filter((warehouse) => (warehouse as BackendWarehouse & { location_type?: string }).location_type !== "vehicle").map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div><Button className="sm:mt-7" variant="outline" disabled={!warehouseId || loading} onClick={() => void loadCountSheet()}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Load count sheet</Button></div>
      {lines.length > 0 && <><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Adjustment reason</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the count variance or stock correction" maxLength={1000} /></div><div className="space-y-2"><Label>Find items</Label><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item code or name" /><p className="text-xs text-muted-foreground">{checked.length} selected · {changedCount} selected counts differ from system stock.</p></div></div>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[1100px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3"><input type="checkbox" aria-label="Select all visible items" checked={filtered.length > 0 && filtered.every((line) => checked.includes(line.item_id))} onChange={(event) => setChecked((current) => event.target.checked ? [...new Set([...current, ...filtered.map((line) => line.item_id)])] : current.filter((id) => !filtered.some((line) => line.item_id === id)))} /></th><th className="px-3 py-3">Item</th><th className="px-3 py-3 text-right">System quantity</th><th className="px-3 py-3 text-right">Physical count</th><th className="px-3 py-3 text-right">Variance</th><th className="px-3 py-3">Batch / expiry</th><th className="px-3 py-3 text-right">Unit cost</th></tr></thead><tbody>{filtered.map((line) => { const delta = Number(line.physical_quantity || 0) - line.system_quantity; const selected = checked.includes(line.item_id); return <tr key={line.item_id} className="border-t"><td className="px-3 py-2"><input type="checkbox" checked={selected} onChange={(event) => setChecked((current) => event.target.checked ? [...current, line.item_id] : current.filter((id) => id !== line.item_id))} aria-label={`Include ${line.name} in count`} /></td><td className="px-3 py-2"><div className="font-medium">{line.name}</div><div className="font-mono text-xs text-muted-foreground">{line.item_code}</div></td><td className="px-3 py-2 text-right tabular-nums">{line.system_quantity.toLocaleString()}</td><td className="px-3 py-2 text-right"><Input className="ml-auto w-32 text-right" type="number" min="0" step="any" value={line.physical_quantity} onChange={(event) => setLines((current) => current.map((candidate) => candidate.item_id === line.item_id ? { ...candidate, physical_quantity: event.target.value } : candidate))} aria-label={`Physical quantity for ${line.name}`} /></td><td className={`px-3 py-2 text-right tabular-nums ${delta < 0 ? "text-destructive" : delta > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>{delta > 0 ? "+" : ""}{delta.toLocaleString()}</td><td className="px-3 py-2"><div className="flex gap-2"><Input className="w-28" placeholder="Batch" disabled={!line.lot_tracking_enabled || delta <= 0} value={line.batch_no} onChange={(event) => setLines((current) => current.map((candidate) => candidate.item_id === line.item_id ? { ...candidate, batch_no: event.target.value } : candidate))} /><Input className="w-36" type="date" disabled={!line.lot_tracking_enabled || delta <= 0} value={line.expiry_date} onChange={(event) => setLines((current) => current.map((candidate) => candidate.item_id === line.item_id ? { ...candidate, expiry_date: event.target.value } : candidate))} /></div></td><td className="px-3 py-2 text-right tabular-nums">{KES(line.unit_cost)}</td></tr>; })}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3"><p className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-4 w-4" />Posting creates stock ledger movements and cannot be silently edited.</p><Button disabled={saving || !changedCount} onClick={() => void saveDraft()}>{saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save adjustment draft</Button></div></>}
    </CardContent></Card>
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Adjustment register</h2><p className="text-sm text-muted-foreground">A review history for stock corrections. The preparer cannot approve their own journal.</p></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Journal</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Warehouse</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3 text-right">Lines</th><th className="px-3 py-3 text-right">Absolute value</th><th className="px-3 py-3">Prepared by</th><th className="px-3 py-3">Status / review</th><th className="px-3 py-3">Actions</th></tr></thead><tbody>{journals.map((row) => <tr key={String(row.id)} className="border-t"><td className="px-3 py-3 font-semibold">{String(row.adjustment_no)}</td><td className="px-3 py-3">{new Date(String(row.adjustment_date)).toLocaleDateString()}</td><td className="px-3 py-3">{String(row.warehouse_name)}</td><td className="px-3 py-3 max-w-[220px] truncate" title={String(row.reason)}>{String(row.reason)}</td><td className="px-3 py-3 text-right tabular-nums">{String(row.line_count)}</td><td className="px-3 py-3 text-right tabular-nums">{KES(Number(row.adjustment_value || 0))}</td><td className="px-3 py-3">{String(row.created_by_name || "—")}</td><td className="px-3 py-3"><Badge variant={row.status === "posted" ? "secondary" : row.status === "cancelled" ? "destructive" : "outline"}>{String(row.status)}</Badge><div className="mt-1 text-xs text-muted-foreground">{row.reviewed_by_name ? `Reviewed by ${String(row.reviewed_by_name)}` : ""}</div></td><td className="px-3 py-3"><div className="flex gap-1">{row.status === "draft" && row.created_by === user?.id && <Button size="sm" variant="outline" onClick={() => void cancel(row)}><XCircle className="mr-1 h-3.5 w-3.5" />Cancel</Button>}{row.status === "draft" && canApprove && row.created_by !== user?.id && <Button size="sm" onClick={() => void post(row)}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Review & post</Button>}</div></td></tr>)}{!journals.length && <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">No adjustment journals yet.</td></tr>}</tbody></table></div></CardContent></Card>
  </div>;
}
function Metric({ label, value }: { label: string; value: number }) { return <Card className="rounded-2xl border-border/70"><CardContent className="p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString()}</div></CardContent></Card>; }
