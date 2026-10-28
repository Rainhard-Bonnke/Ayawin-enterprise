import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Plus, Send, Check, X, LoaderCircle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchMasterItems, fetchWarehouses, type BackendMasterItem, type BackendWarehouse } from "@/lib/api";
import { v1Api } from "@/lib/api-v1";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/material-requisitions")({
  component: MaterialRequisitionsPage,
  head: () => ({ meta: [{ title: "Material Requisitions - Ayawin Stock Solution" }] }),
});

type RequestRow = Record<string, unknown>;
type RequestLine = { item_id: string; quantity: string; notes: string };

function MaterialRequisitionsPage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [department, setDepartment] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [lines, setLines] = useState<RequestLine[]>([{ item_id: "", quantity: "1", notes: "" }]);
  const canApprove = user?.role === "Admin" || user?.permissions?.includes("procurement.approve");
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setRows(await v1Api.inventory.materialRequisitions(token)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load material requisitions"); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!token) return;
    void Promise.all([fetchMasterItems(token, "", 2000), fetchWarehouses(token)])
      .then(([catalog, locations]) => { setItems(catalog); setWarehouses(locations); })
      .catch(() => { setItems([]); setWarehouses([]); });
  }, [token]);

  const reset = () => { setWarehouseId(""); setDepartment(""); setRequiredDate(""); setPurpose(""); setLines([{ item_id: "", quantity: "1", notes: "" }]); };
  const create = async () => {
    if (!token || !warehouseId || !purpose.trim() || lines.some((line) => !line.item_id || Number(line.quantity) <= 0)) { toast.error("Choose a warehouse, state the purpose, and enter valid item quantities."); return; }
    setSaving(true);
    try {
      await v1Api.inventory.createMaterialRequisition(token, {
        warehouse_id: warehouseId, department, required_date: requiredDate || null, purpose,
        lines: lines.map((line) => ({ item_id: line.item_id, quantity: Number(line.quantity), notes: line.notes })),
      });
      toast.success("Draft material requisition created"); setOpen(false); reset(); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create requisition"); }
    finally { setSaving(false); }
  };
  const submit = async (id: string) => {
    if (!token) return;
    try { await v1Api.inventory.submitMaterialRequisition(token, id); toast.success("Requisition submitted for approval"); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not submit requisition"); }
  };
  const review = async (id: string, decision: "approve" | "reject") => {
    if (!token) return;
    try { await v1Api.inventory.reviewMaterialRequisition(token, id, decision); toast.success(decision === "approve" ? "Requisition approved" : "Requisition rejected"); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not review requisition"); }
  };

  return <div className="space-y-5 pb-8">
    <PageHeader title="Material requisitions" description="Request stock for internal use by a department, route or operating team. Approved requests can be issued in part or in full." actions={<Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" /> New requisition</Button>} />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Awaiting approval" value={rows.filter((row) => row.status === "submitted").length} /><Metric label="Approved to issue" value={rows.filter((row) => ["approved", "partially_issued"].includes(String(row.status))).length} /><Metric label="Issued this register" value={rows.filter((row) => row.status === "issued").length} /></div>
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Request</th><th className="px-4 py-3">Requesting department</th><th className="px-4 py-3">Stock location</th><th className="px-4 py-3">Required date</th><th className="px-4 py-3 text-right">Lines / units</th><th className="px-4 py-3 text-right">Issued</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Workflow</th></tr></thead><tbody>
      {rows.map((row) => <tr key={String(row.id)} className="border-t"><td className="px-4 py-3"><div className="font-semibold">{String(row.request_no)}</div><div className="text-xs text-muted-foreground">{String(row.requester_name || "")} · {new Date(String(row.created_at)).toLocaleDateString()}</div><div className="mt-1 max-w-[300px] truncate text-xs text-muted-foreground" title={String(row.purpose)}>{String(row.purpose)}</div></td><td className="px-4 py-3">{String(row.requesting_department || "—")}</td><td className="px-4 py-3">{String(row.warehouse_name || "—")}</td><td className="px-4 py-3">{row.required_date ? new Date(String(row.required_date)).toLocaleDateString() : "—"}</td><td className="px-4 py-3 text-right tabular-nums">{String(row.line_count)} / {Number(row.requested_units).toLocaleString()}</td><td className="px-4 py-3 text-right tabular-nums">{Number(row.issued_units).toLocaleString()}</td><td className="px-4 py-3"><Status status={String(row.status)} /></td><td className="px-4 py-3"><div className="flex gap-1">{row.status === "draft" && row.requested_by === user?.id && <Button size="sm" variant="outline" onClick={() => void submit(String(row.id))}><Send className="mr-1.5 h-3.5 w-3.5" />Submit</Button>}{row.status === "submitted" && canApprove && <><Button size="sm" onClick={() => void review(String(row.id), "approve")}><Check className="mr-1.5 h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="outline" onClick={() => void review(String(row.id), "reject")}><X className="mr-1.5 h-3.5 w-3.5" />Reject</Button></>}</div></td></tr>)}
      {!loading && !rows.length && <tr><td colSpan={8} className="px-4 py-14 text-center text-muted-foreground"><ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-50" />No material requisitions yet. Create a request for stock that will be consumed internally.</td></tr>}
      {loading && <tr><td colSpan={8} className="px-4 py-14 text-center text-muted-foreground">Loading requisitions…</td></tr>}
    </tbody></table></div></CardContent></Card>

    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>New material requisition</DialogTitle><DialogDescription>This requests existing stock for internal consumption. Supplier purchases belong in Procurement.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2"><Label>Issue from warehouse</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{warehouses.filter((warehouse) => (warehouse as BackendWarehouse & { location_type?: string }).location_type !== "vehicle").map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-2"><Label>Requesting department</Label><Input value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="e.g. Sales, Events, Maintenance" /></div>
      <div className="space-y-2"><Label>Required date</Label><Input type="date" value={requiredDate} onChange={(event) => setRequiredDate(event.target.value)} /></div>
      <div className="space-y-2 sm:col-span-2"><Label>Purpose / job reference</Label><Textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Explain what these materials will be used for" maxLength={1000} /></div>
    </div><div className="space-y-2"><div className="flex items-center justify-between"><Label>Requested items</Label><Button size="sm" variant="outline" onClick={() => setLines((current) => [...current, { item_id: "", quantity: "1", notes: "" }])}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button></div>{lines.map((line, index) => <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_120px_1fr_auto]"><Select value={line.item_id} onValueChange={(item_id) => setLines((current) => current.map((candidate, i) => i === index ? { ...candidate, item_id } : candidate))}><SelectTrigger><SelectValue placeholder="Choose stocked item" /></SelectTrigger><SelectContent>{items.filter((item) => item.is_active).map((item) => <SelectItem key={item.id} value={item.id}>{item.item_code} · {item.name}</SelectItem>)}</SelectContent></Select><Input type="number" min="0.0001" step="any" value={line.quantity} onChange={(event) => setLines((current) => current.map((candidate, i) => i === index ? { ...candidate, quantity: event.target.value } : candidate))} aria-label="Requested quantity" /><Input value={line.notes} onChange={(event) => setLines((current) => current.map((candidate, i) => i === index ? { ...candidate, notes: event.target.value } : candidate))} placeholder="Line notes" />{lines.length > 1 && <Button variant="ghost" size="icon" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} aria-label="Remove line"><X className="h-4 w-4" /></Button>}</div>)}</div><DialogFooter><Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button><Button disabled={saving || !items.length || !warehouses.length} onClick={() => void create()}>{saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}Save draft</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <Card className="rounded-2xl border-border/70"><CardContent className="p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value}</div></CardContent></Card>; }
function Status({ status }: { status: string }) { return <Badge variant={status === "rejected" || status === "cancelled" ? "destructive" : status === "submitted" ? "outline" : "secondary"}>{status.replaceAll("_", " ")}</Badge>; }
