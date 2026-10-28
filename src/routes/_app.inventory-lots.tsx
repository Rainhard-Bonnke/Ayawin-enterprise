import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { KES } from "@/lib/format";
import { changeInventoryLotQuarantine, fetchInventoryLotEvents, fetchInventoryLots, fetchMasterItems, fetchWarehouses, reconcileOpeningLots, type BackendInventoryLot, type BackendMasterItem, type BackendWarehouse } from "@/lib/api";
import { v1Api } from "@/lib/api-v1";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/inventory-lots")({
  component: InventoryLotsPage,
  head: () => ({ meta: [{ title: "Inventory lots - Ayawin Stock Solution" }] }),
});

function InventoryLotsPage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<BackendInventoryLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showExpired, setShowExpired] = useState(true);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [openingQuantity, setOpeningQuantity] = useState(0);
  const [openingValue, setOpeningValue] = useState(0);
  const [openingNote, setOpeningNote] = useState("");
  const [openingLots, setOpeningLots] = useState([{ batch_no: "", expiry_date: "", quantity: "", unit_cost: "" }]);
  const [savingOpening, setSavingOpening] = useState(false);
  const [lotAction, setLotAction] = useState<{ lot: BackendInventoryLot; action: "quarantine" | "release" } | null>(null);
  const [actionQuantity, setActionQuantity] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const [historyLot, setHistoryLot] = useState<BackendInventoryLot | null>(null);
  const [lotEvents, setLotEvents] = useState<Awaited<ReturnType<typeof fetchInventoryLotEvents>>>([]);
  const canReconcile = user?.role === "Admin" || user?.permissions?.includes("procurement.approve");
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setRows(await fetchInventoryLots(token, showExpired)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load stock lots"); }
    finally { setLoading(false); }
  }, [token, showExpired]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!token) return;
    void Promise.all([fetchMasterItems(token, "", 2000), fetchWarehouses(token)]).then(([itemRows, warehouseRows]) => {
      setItems(itemRows.filter((item) => item.is_active));
      setWarehouses(warehouseRows.filter((warehouse) => warehouse.is_active));
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Unable to load lot reconciliation setup"));
  }, [token]);
  useEffect(() => {
    if (!token || !warehouseId || !itemId) { setOpeningQuantity(0); setOpeningValue(0); return; }
    void v1Api.inventory.stock(token, 1000, warehouseId).then((stock) => {
      const selectedStock = stock.find((row) => String(row.item_id) === itemId);
      setOpeningQuantity(Number(selectedStock?.quantity || 0));
      setOpeningValue(Number(selectedStock?.stock_value || Number(selectedStock?.quantity || 0) * Number(selectedStock?.avg_unit_cost || 0)));
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Unable to load current stock quantity"));
  }, [token, warehouseId, itemId]);

  const visible = useMemo(() => rows.filter((lot) =>
    `${lot.item_code} ${lot.item_name} ${lot.batch_no} ${lot.warehouse_name}`.toLowerCase().includes(query.toLowerCase()),
  ), [rows, query]);
  const expired = visible.filter((lot) => Number(lot.days_to_expiry) < 0);
  const expiringSoon = visible.filter((lot) => Number(lot.days_to_expiry) >= 0 && Number(lot.days_to_expiry) <= 30);
  const saveOpening = async () => {
    if (!token || !warehouseId || !itemId || openingQuantity <= 0 || !openingNote.trim() || !openingLots.length) {
      toast.error("Choose a stocked item, add a reason and enter its existing lots."); return;
    }
    const payload = openingLots.map((lot) => ({ batch_no: lot.batch_no.trim(), expiry_date: lot.expiry_date, quantity: Number(lot.quantity), unit_cost: Number(lot.unit_cost) }));
    if (payload.some((lot) => !lot.batch_no || !lot.expiry_date || !Number.isFinite(lot.quantity) || lot.quantity <= 0 || !Number.isFinite(lot.unit_cost) || lot.unit_cost < 0)
      || Math.abs(payload.reduce((sum, lot) => sum + lot.quantity, 0) - openingQuantity) > 0.00005
      || Math.abs(payload.reduce((sum, lot) => sum + lot.quantity * lot.unit_cost, 0) - openingValue) > 0.01) {
      toast.error(`Enter valid lot details; totals must equal current stock (${openingQuantity} units, ${KES(openingValue)}).`); return;
    }
    setSavingOpening(true);
    try {
      const result = await reconcileOpeningLots(token, { warehouse_id: warehouseId, item_id: itemId, notes: openingNote, lines: payload });
      toast.success(`Reconciled ${result.lot_count} opening lots for ${result.stock_quantity} units.`);
      setItemId(""); setOpeningNote(""); setOpeningLots([{ batch_no: "", expiry_date: "", quantity: "", unit_cost: "" }]); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to reconcile opening lots"); }
    finally { setSavingOpening(false); }
  };
  const openLotAction = (lot: BackendInventoryLot, action: "quarantine" | "release") => {
    setLotAction({ lot, action });
    setActionQuantity(String(action === "quarantine" ? Number(lot.quantity) - Number(lot.quarantined_quantity) : lot.quarantined_quantity));
    setActionReason("");
  };
  const saveLotAction = async () => {
    if (!token || !lotAction || !actionReason.trim() || Number(actionQuantity) <= 0) { toast.error("Enter a positive quantity and a reason."); return; }
    setSavingAction(true);
    try {
      await changeInventoryLotQuarantine(token, lotAction.lot.id, lotAction.action, Number(actionQuantity), actionReason);
      toast.success(lotAction.action === "quarantine" ? "Lot quantity quarantined." : "Quarantined quantity released.");
      setLotAction(null); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update lot quarantine"); }
    finally { setSavingAction(false); }
  };
  const showLotHistory = async (lot: BackendInventoryLot) => {
    if (!token) return;
    try { setLotEvents(await fetchInventoryLotEvents(token, lot.id)); setHistoryLot(lot); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load lot event history"); }
  };

  return <div className="space-y-6 pb-8">
    <PageHeader title="Stock lots & expiry" description="Trace each tracked batch by warehouse, quantity and expiry. Stock issues pick the earliest unexpired lot first." actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>} />
    <div className="grid gap-4 sm:grid-cols-3">
      <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Tracked lots</div><div className="mt-1 text-2xl font-semibold">{visible.length}</div></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Expiring in 30 days</div><div className="mt-1 text-2xl font-semibold">{expiringSoon.length}</div></CardContent></Card>
      <Card><CardContent className="p-4"><div className="text-sm text-muted-foreground">Expired balances to investigate</div><div className="mt-1 text-2xl font-semibold text-destructive">{expired.length}</div></CardContent></Card>
    </div>
    {canReconcile && <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-4 p-5">
      <div><h2 className="font-semibold">Reconcile existing stock into lots</h2><p className="text-sm text-muted-foreground">This assigns traceable batches to current stock without changing its quantity or value. Lot quantities must exactly match the current on-hand balance; the action enables lot tracking and is audited.</p></div>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Warehouse</Label><Select value={warehouseId} onValueChange={(value) => { setWarehouseId(value); setItemId(""); }}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={String(warehouse.id)}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Item</Label><Select value={itemId} onValueChange={setItemId}><SelectTrigger><SelectValue placeholder="Choose item" /></SelectTrigger><SelectContent>{items.filter((item) => item.is_stock_item).map((item) => <SelectItem key={item.id} value={item.id}>{item.item_code} · {item.name}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">Current on hand: {openingQuantity.toLocaleString()} · Stock value: {KES(openingValue)}</p></div></div>
      {openingLots.map((lot, index) => <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4"><div className="space-y-1"><Label>Batch</Label><Input value={lot.batch_no} onChange={(e) => setOpeningLots((rows) => rows.map((row, i) => i === index ? { ...row, batch_no: e.target.value } : row))} /></div><div className="space-y-1"><Label>Expiry</Label><Input type="date" value={lot.expiry_date} onChange={(e) => setOpeningLots((rows) => rows.map((row, i) => i === index ? { ...row, expiry_date: e.target.value } : row))} /></div><div className="space-y-1"><Label>Quantity</Label><Input type="number" min="0" step="any" value={lot.quantity} onChange={(e) => setOpeningLots((rows) => rows.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} /></div><div className="space-y-1"><Label>Unit cost (KES)</Label><Input type="number" min="0" step="any" value={lot.unit_cost} onChange={(e) => setOpeningLots((rows) => rows.map((row, i) => i === index ? { ...row, unit_cost: e.target.value } : row))} /></div></div>)}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setOpeningLots((rows) => [...rows, { batch_no: "", expiry_date: "", quantity: "", unit_cost: "" }])}>Add another lot</Button><div className="min-w-[220px] flex-1"><Textarea value={openingNote} onChange={(e) => setOpeningNote(e.target.value)} maxLength={1000} placeholder="Reconciliation evidence and approval reference" /></div><Button onClick={() => void saveOpening()} disabled={savingOpening || !canReconcile}>{savingOpening && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}Reconcile opening lots</Button></div>
    </CardContent></Card>}
    <Card className="rounded-2xl border-border/70 bg-background/70 shadow-sm"><CardContent className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><Input className="max-w-sm" placeholder="Search item, lot or warehouse" value={query} onChange={(e) => setQuery(e.target.value)} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />Show expired lots</label></div>
      {expired.length > 0 && <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><span>{expired.length} expired lot balances are visible for investigation. The system will not allocate expired lots to stock issues.</span></div>}
      <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU / item</TableHead><TableHead>Warehouse</TableHead><TableHead>Batch</TableHead><TableHead>Expiry</TableHead><TableHead className="text-right">Days left</TableHead><TableHead className="text-right">Available quantity</TableHead><TableHead className="text-right">Quarantined</TableHead><TableHead className="text-right">Unit cost</TableHead><TableHead>Status / actions</TableHead></TableRow></TableHeader><TableBody>
        {visible.map((lot) => { const days = Number(lot.days_to_expiry); const status = days < 0 ? "expired" : days <= 30 ? "expiring" : "available"; return <TableRow key={lot.id}><TableCell><div className="font-medium">{lot.item_code}</div><div className="text-xs text-muted-foreground">{lot.item_name}</div></TableCell><TableCell>{lot.warehouse_code} · {lot.warehouse_name}</TableCell><TableCell className="font-mono text-xs">{lot.batch_no}</TableCell><TableCell>{String(lot.expiry_date).slice(0, 10)}</TableCell><TableCell className="text-right tabular-nums">{days < 0 ? `${Math.abs(days)} days ago` : days}</TableCell><TableCell className="text-right tabular-nums">{Number(lot.available_quantity).toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{Number(lot.quarantined_quantity).toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{KES(Number(lot.unit_cost))}</TableCell><TableCell><div className="flex flex-wrap items-center gap-2"><StatusBadge status={Number(lot.quarantined_quantity) > 0 ? "quarantined" : status} />{(user?.role === "Admin" || user?.permissions?.includes("procurement.create")) && Number(lot.quantity) > Number(lot.quarantined_quantity) && <Button size="sm" variant="outline" onClick={() => openLotAction(lot, "quarantine")}>Hold</Button>}{canReconcile && Number(lot.quarantined_quantity) > 0 && days >= 0 && <Button size="sm" variant="outline" onClick={() => openLotAction(lot, "release")}>Release</Button>}<Button size="sm" variant="ghost" onClick={() => void showLotHistory(lot)}>History</Button></div></TableCell></TableRow>; })}
        {!loading && !visible.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No matching lot balances. Enable batch tracking on an item and receive stock with a batch number and expiry date.</TableCell></TableRow>}
        {loading && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">Loading lot balances…</TableCell></TableRow>}
      </TableBody></Table></div>
      <p className="text-xs text-muted-foreground">This register shows only items with batch tracking enabled. Existing lotless stock is not silently converted into a lot; reconcile it before enabling tracking.</p>
    </CardContent></Card>
    <Dialog open={!!lotAction} onOpenChange={(open) => !open && setLotAction(null)}><DialogContent>
      <DialogHeader><DialogTitle>{lotAction?.action === "quarantine" ? "Quarantine lot quantity" : "Release lot quantity"}</DialogTitle><DialogDescription>{lotAction?.lot.item_code} · batch {lotAction?.lot.batch_no} · expiry {lotAction?.lot.expiry_date}. Quarantined units remain in physical stock but are excluded from available-to-promise and FEFO issue allocation.</DialogDescription></DialogHeader>
      <div className="space-y-3"><div className="space-y-1"><Label>Quantity (maximum {lotAction ? (lotAction.action === "quarantine" ? Number(lotAction.lot.quantity) - Number(lotAction.lot.quarantined_quantity) : Number(lotAction.lot.quarantined_quantity)).toLocaleString() : 0})</Label><Input type="number" min="0.0001" step="any" value={actionQuantity} onChange={(event) => setActionQuantity(event.target.value)} /></div><div className="space-y-1"><Label>Reason / evidence</Label><Textarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} maxLength={1000} placeholder="Damage, expiry concern, supplier hold, inspection release reference…" /></div></div>
      <DialogFooter><Button variant="outline" onClick={() => setLotAction(null)}>Cancel</Button><Button disabled={savingAction} onClick={() => void saveLotAction()}>{savingAction && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}{lotAction?.action === "quarantine" ? "Place on hold" : "Release to available"}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={!!historyLot} onOpenChange={(open) => !open && setHistoryLot(null)}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>Lot control history</DialogTitle><DialogDescription>{historyLot?.item_code} · batch {historyLot?.batch_no}</DialogDescription></DialogHeader><div className="space-y-2">{lotEvents.map((event) => <div key={event.id} className="rounded-lg border p-3 text-sm"><div className="flex justify-between gap-3"><strong className="capitalize">{event.event_type}</strong><span>{Number(event.quantity).toLocaleString()} units</span></div><p className="mt-1 text-muted-foreground">{event.reason}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()} · {event.created_by_name || "User"}</p></div>)}{!lotEvents.length && <p className="py-6 text-center text-sm text-muted-foreground">No quarantine events recorded for this lot.</p>}</div></DialogContent></Dialog>
  </div>;
}
