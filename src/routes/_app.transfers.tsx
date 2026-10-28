import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, LoaderCircle, RefreshCw, Truck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchMasterItems, fetchWarehouses, type BackendMasterItem, type BackendWarehouse } from "@/lib/api";
import { v1Api } from "@/lib/api-v1";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/transfers")({ component: WarehouseTransfersPage, head: () => ({ meta: [{ title: "Warehouse Transfers - Ayawin Stock Solution" }] }) });

type TransferLine = {
  id: string; item_id: string; item_code: string; item_name: string; quantity: number;
  received_quantity: number; damaged_quantity: number; short_quantity: number;
  receipt_complete: boolean; batch_no?: string | null; expiry_date?: string | null; unit_cost: number;
};
type Transfer = Record<string, unknown> & { id: string; transfer_no: string; status: string; lines?: TransferLine[] };
type ReceiptInput = { transfer_line_id: string; received_quantity: string; damaged_quantity: string; complete: boolean };
const quantity = (value: unknown) => Number(value || 0).toLocaleString("en-KE", { maximumFractionDigits: 3 });

function WarehouseTransfersPage() {
  const { token, user } = useAuth();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [selected, setSelected] = useState<Transfer | null>(null);
  const [receipt, setReceipt] = useState<ReceiptInput[]>([]);
  const [receiptNotes, setReceiptNotes] = useState("");
  const [dispatchForm, setDispatchForm] = useState({ from: "", to: "", item: "", quantity: "", notes: "" });
  const canDispatch = user?.role === "Admin" || user?.permissions?.includes("procurement.create");
  const canReceive = user?.role === "Admin" || user?.permissions?.includes("procurement.approve");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [rows, locations, catalog] = await Promise.all([
        v1Api.inventory.transfers(token), fetchWarehouses(token), fetchMasterItems(token, "", 2000),
      ]);
      setTransfers(rows as Transfer[]);
      setWarehouses(locations.filter((row) => row.is_active));
      setItems(catalog.filter((row) => row.is_active && row.is_stock_item));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load warehouse transfers"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  const summary = useMemo(() => ({
    transit: transfers.filter((row) => ["in_transit", "partially_received"].includes(row.status)).length,
    variance: transfers.filter((row) => row.status === "received_with_variance").length,
    received: transfers.filter((row) => ["received", "received_with_variance"].includes(row.status)).length,
  }), [transfers]);

  const dispatch = async () => {
    if (!token || !dispatchForm.from || !dispatchForm.to || !dispatchForm.item || Number(dispatchForm.quantity) <= 0) {
      toast.error("Choose source, destination, item and a positive quantity."); return;
    }
    if (dispatchForm.from === dispatchForm.to) { toast.error("Source and destination must be different."); return; }
    setSaving(true);
    try {
      const result = await v1Api.inventory.dispatchTransfer(token, {
        from_warehouse_id: dispatchForm.from, to_warehouse_id: dispatchForm.to,
        lines: [{ item_id: dispatchForm.item, quantity: Number(dispatchForm.quantity) }], notes: dispatchForm.notes,
      });
      toast.success(`${String(result.transfer_no)} dispatched. Destination must confirm receipt.`);
      setDispatchOpen(false); setDispatchForm({ from: "", to: "", item: "", quantity: "", notes: "" }); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to dispatch transfer"); }
    finally { setSaving(false); }
  };

  const openReceipt = async (row: Transfer) => {
    if (!token) return;
    try {
      const detail = await v1Api.inventory.transferDetail(token, row.id) as unknown as Transfer;
      const openLines = (detail.lines || []).filter((line) => !line.receipt_complete);
      setSelected(detail);
      setReceipt(openLines.map((line) => ({ transfer_line_id: line.id, received_quantity: "0", damaged_quantity: "0", complete: true })));
      setReceiptNotes(""); setReceiveOpen(true);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load transfer details"); }
  };

  const receive = async () => {
    if (!token || !selected) return;
    const entries = receipt.filter((row) => Number(row.received_quantity) > 0 || Number(row.damaged_quantity) > 0 || row.complete);
    const lineById = new Map((selected.lines || []).map((line) => [line.id, line]));
    const needsNote = entries.some((entry) => {
      const line = lineById.get(entry.transfer_line_id);
      const remaining = Number(line?.quantity || 0) - Number(line?.received_quantity || 0) - Number(line?.damaged_quantity || 0) - Number(line?.short_quantity || 0);
      return Number(entry.damaged_quantity) > 0 || (entry.complete && Number(entry.received_quantity) < remaining);
    });
    if (needsNote && !receiptNotes.trim()) { toast.error("Explain the damage or short quantity before closing the receipt."); return; }
    setSaving(true);
    try {
      const result = await v1Api.inventory.receiveTransfer(token, selected.id, {
        lines: entries.map((entry) => ({ transfer_line_id: entry.transfer_line_id, received_quantity: Number(entry.received_quantity), damaged_quantity: Number(entry.damaged_quantity), complete: entry.complete })),
        notes: receiptNotes,
      });
      toast.success(`Receipt recorded · ${String(result.status).replaceAll("_", " ")}`);
      setReceiveOpen(false); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to record destination receipt"); }
    finally { setSaving(false); }
  };

  return <div className="space-y-5 pb-8">
    <PageHeader title="Warehouse transfers" description="Dispatch stock between warehouses or vehicles, keep it in transit, then have a different authorized user record the destination count and any damage or shortage." actions={<><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>{canDispatch && <Button onClick={() => { setDispatchForm({ from: warehouses[0]?.id.toString() || "", to: warehouses[1]?.id.toString() || "", item: items[0]?.id || "", quantity: "", notes: "" }); setDispatchOpen(true); }}><ArrowUpFromLine className="mr-2 h-4 w-4" />Dispatch stock</Button>}</>} />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="In transit / partial" value={summary.transit} /><Metric label="Received" value={summary.received} /><Metric label="Received with variance" value={summary.variance} /></div>
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Transfer register</h2><p className="text-sm text-muted-foreground">Source stock leaves on dispatch; destination stock increases only for good quantities confirmed at receipt. In-transit units remain visible here until the destination closes the count.</p></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[1040px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Transfer</th><th className="px-3 py-3">From</th><th className="px-3 py-3">To</th><th className="px-3 py-3 text-right">Dispatched</th><th className="px-3 py-3 text-right">Good received</th><th className="px-3 py-3 text-right">In transit</th><th className="px-3 py-3 text-right">Damage / short</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Action</th></tr></thead><tbody>{transfers.map((row) => { const discrepancy = Number(row.damaged_quantity || 0) + Number(row.short_quantity || 0); const awaiting = ["in_transit", "partially_received"].includes(row.status); return <tr key={row.id} className="border-t"><td className="px-3 py-3 font-semibold">{row.transfer_no}<div className="text-xs font-normal text-muted-foreground">{String(row.line_count)} lot/item lines</div></td><td className="px-3 py-3">{String(row.from_warehouse_code)} · {String(row.from_warehouse_name)}</td><td className="px-3 py-3">{String(row.to_warehouse_code)} · {String(row.to_warehouse_name)}</td><td className="px-3 py-3 text-right tabular-nums">{quantity(row.quantity)}</td><td className="px-3 py-3 text-right tabular-nums">{quantity(row.received_quantity)}</td><td className="px-3 py-3 text-right tabular-nums">{quantity(row.in_transit_quantity)}</td><td className="px-3 py-3 text-right tabular-nums">{quantity(discrepancy)}</td><td className="px-3 py-3"><Badge variant={discrepancy ? "destructive" : awaiting ? "secondary" : "default"}>{row.status.replaceAll("_", " ")}</Badge></td><td className="px-3 py-3">{awaiting && canReceive ? <Button size="sm" variant="outline" onClick={() => void openReceipt(row)}><ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />Receive / count</Button> : <span className="text-xs text-muted-foreground">{row.receipt_notes ? String(row.receipt_notes) : "—"}</span>}</td></tr>; })}{!loading && !transfers.length && <tr><td colSpan={9} className="px-3 py-12 text-center text-muted-foreground">No warehouse transfers recorded yet.</td></tr>}</tbody></table>{loading && <div className="p-8 text-center text-sm text-muted-foreground">Loading transfers…</div>}</div></CardContent></Card>

    <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Dispatch warehouse transfer</DialogTitle><DialogDescription>Dispatch immediately reduces source stock and records batch detail. Destination stock stays unchanged until a receiver confirms it.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Source location</Label><Select value={dispatchForm.from} onValueChange={(from) => setDispatchForm((row) => ({ ...row, from }))}><SelectTrigger><SelectValue placeholder="Choose source" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={String(warehouse.id)}>{warehouse.code} · {warehouse.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Destination location</Label><Select value={dispatchForm.to} onValueChange={(to) => setDispatchForm((row) => ({ ...row, to }))}><SelectTrigger><SelectValue placeholder="Choose destination" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={String(warehouse.id)}>{warehouse.code} · {warehouse.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2 sm:col-span-2"><Label>Stock item</Label><Select value={dispatchForm.item} onValueChange={(item) => setDispatchForm((row) => ({ ...row, item }))}><SelectTrigger><SelectValue placeholder="Choose item" /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id}>{item.item_code} · {item.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Quantity</Label><Input type="number" min="0.0001" step="any" value={dispatchForm.quantity} onChange={(event) => setDispatchForm((row) => ({ ...row, quantity: event.target.value }))} /></div><div className="space-y-2"><Label>Dispatch notes</Label><Input value={dispatchForm.notes} maxLength={1000} onChange={(event) => setDispatchForm((row) => ({ ...row, notes: event.target.value }))} placeholder="Route, vehicle, reference" /></div></div><DialogFooter><Button variant="outline" onClick={() => setDispatchOpen(false)}>Cancel</Button><Button disabled={saving || !items.length || warehouses.length < 2} onClick={() => void dispatch()}>{saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}Dispatch to transit</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Receive {selected?.transfer_no}</DialogTitle><DialogDescription>Enter the physical count received at the destination. Damaged goods and unresolved shortages stay out of destination stock. A different user than the dispatcher must confirm receipt.</DialogDescription></DialogHeader><div className="space-y-3">{(selected?.lines || []).filter((line) => !line.receipt_complete).map((line) => { const entry = receipt.find((row) => row.transfer_line_id === line.id); const remaining = Number(line.quantity) - Number(line.received_quantity) - Number(line.damaged_quantity) - Number(line.short_quantity); return <div key={line.id} className="space-y-3 rounded-xl border p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-medium">{line.item_code} · {line.item_name}</div><div className="text-xs text-muted-foreground">Dispatched {quantity(line.quantity)} · Still in transit {quantity(remaining)}{line.batch_no ? ` · Batch ${line.batch_no} · Exp ${String(line.expiry_date).slice(0, 10)}` : ""}</div></div><Badge variant="secondary">{line.receipt_complete ? "complete" : "open"}</Badge></div><div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><div className="space-y-1"><Label>Physically received</Label><Input type="number" min="0" max={remaining} step="any" value={entry?.received_quantity || "0"} onChange={(event) => setReceipt((rows) => rows.map((row) => row.transfer_line_id === line.id ? { ...row, received_quantity: event.target.value } : row))} /></div><div className="space-y-1"><Label>Of that, damaged</Label><Input type="number" min="0" max={remaining} step="any" value={entry?.damaged_quantity || "0"} onChange={(event) => setReceipt((rows) => rows.map((row) => row.transfer_line_id === line.id ? { ...row, damaged_quantity: event.target.value } : row))} /></div><label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={entry?.complete ?? true} onChange={(event) => setReceipt((rows) => rows.map((row) => row.transfer_line_id === line.id ? { ...row, complete: event.target.checked } : row))} />Close line</label></div></div>; })}<div className="space-y-2"><Label>Receipt notes / damage or shortage explanation</Label><Textarea value={receiptNotes} onChange={(event) => setReceiptNotes(event.target.value)} maxLength={1000} placeholder="Required when goods are damaged or a short line is closed" /></div></div><DialogFooter><Button variant="outline" onClick={() => setReceiveOpen(false)}>Cancel</Button><Button disabled={saving || !receipt.length} onClick={() => void receive()}>{saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}Confirm destination count</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <Card className="rounded-2xl border-border/70"><CardContent className="p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString()}</div></CardContent></Card>; }
