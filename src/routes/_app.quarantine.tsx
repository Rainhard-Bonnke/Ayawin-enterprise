import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { v1Api } from "@/lib/api-v1";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/quarantine")({ component: QuarantineDispositionPage, head: () => ({ meta: [{ title: "Quarantine Disposition - Ayawin Stock Solution" }] }) });

type QuarantineRow = { source_id: string; source_type: "lot" | "item"; lot_id: string | null; company_id: string; warehouse_id: string; item_id: string; batch_no: string | null; expiry_date: string | null; quantity: number; unit_cost: number; item_code: string; item_name: string; warehouse_code: string; warehouse_name: string };
type Disposition = Record<string, unknown> & { id: string; disposition_no: string; disposition_type: string; status: string; created_by: string; quantity: number; value: number };
type Setup = { vendors: Array<{ id: string; vendor_code: string; name: string }>; accounts: Array<{ id: string; account_code: string; account_name: string; account_type: string }> };
type Action = "release" | "write_off" | "supplier_return";
const units = (value: unknown) => Number(value || 0).toLocaleString("en-KE", { maximumFractionDigits: 3 });

function QuarantineDispositionPage() {
  const { token, user } = useAuth();
  const [stock, setStock] = useState<QuarantineRow[]>([]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [setup, setSetup] = useState<Setup>({ vendors: [], accounts: [] });
  const [selected, setSelected] = useState<QuarantineRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ action: "release" as Action, quantity: "", reason: "", vendor_id: "", reference_no: "", offset_account_id: "" });
  const canCreate = user?.role === "Admin" || user?.permissions?.includes("procurement.create");
  const canApprove = user?.role === "Admin" || user?.permissions?.includes("procurement.approve");
  const accounts = useMemo(() => setup.accounts.filter((account) => account.account_type === (form.action === "write_off" ? "expense" : "asset")), [setup.accounts, form.action]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [heldRows, dispositionRows, dispositionSetup] = await Promise.all([
        v1Api.inventory.quarantine(token), v1Api.inventory.dispositions(token), v1Api.inventory.quarantineSetup(token),
      ]);
      setStock(heldRows as unknown as QuarantineRow[]);
      setDispositions(dispositionRows as Disposition[]);
      setSetup(dispositionSetup as Setup);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load quarantine register"); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const begin = (row: QuarantineRow) => {
    setSelected(row);
    setForm({ action: "release", quantity: String(row.quantity), reason: "", vendor_id: "", reference_no: "", offset_account_id: "" });
    setOpen(true);
  };

  const save = async () => {
    if (!token || !selected || !form.reason.trim() || Number(form.quantity) <= 0 || Number(form.quantity) > Number(selected.quantity)) {
      toast.error("Enter a reason and a quantity within the quarantined balance."); return;
    }
    if (form.action === "supplier_return" && !form.vendor_id) { toast.error("Select the supplier receiving the goods."); return; }
    if (form.action !== "release" && !form.offset_account_id) { toast.error("Select the GL account to offset the inventory value."); return; }
    setSaving(true);
    try {
      await v1Api.inventory.createDisposition(token, {
        disposition_type: form.action, warehouse_id: selected.warehouse_id, item_id: selected.item_id,
        lot_id: selected.lot_id || undefined, quantity: Number(form.quantity), reason: form.reason,
        vendor_id: form.action === "supplier_return" ? form.vendor_id : undefined,
        reference_no: form.reference_no || undefined,
        offset_account_id: form.action === "release" ? undefined : form.offset_account_id,
      });
      toast.success("Disposition draft created. Stock changes only after a different approver posts it.");
      setOpen(false); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to prepare stock disposition"); }
    finally { setSaving(false); }
  };

  const post = async (row: Disposition) => {
    if (!token) return;
    setSaving(true);
    try {
      await v1Api.inventory.postDisposition(token, row.id);
      toast.success(`${row.disposition_no} posted.`); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to post disposition"); }
    finally { setSaving(false); }
  };

  return <div className="space-y-5 pb-8">
    <PageHeader title="Quarantine disposition" description="Review held stock and prepare a controlled release, supplier return or write-off. A different authorized user posts every disposition." actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>} />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Held lines" value={stock.length} /><Metric label="Units on hold" value={stock.reduce((sum, row) => sum + Number(row.quantity), 0)} /><Metric label="Drafts awaiting approval" value={dispositions.filter((row) => row.status === "draft").length} /></div>
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Quarantined physical stock</h2><p className="text-sm text-muted-foreground">Held units remain in physical on-hand, but are excluded from sales availability and stock issues. Expired stock cannot be released.</p></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[880px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Item / batch</th><th className="px-3 py-3">Warehouse</th><th className="px-3 py-3">Expiry</th><th className="px-3 py-3 text-right">Held</th><th className="px-3 py-3 text-right">Unit cost</th><th className="px-3 py-3">Action</th></tr></thead><tbody>{stock.map((row) => <tr key={row.source_id} className="border-t"><td className="px-3 py-3 font-medium">{row.item_code} · {row.item_name}<div className="text-xs font-mono text-muted-foreground">{row.batch_no ? `Batch ${row.batch_no}` : "Untracked quarantine"}</div></td><td className="px-3 py-3">{row.warehouse_code} · {row.warehouse_name}</td><td className="px-3 py-3">{row.expiry_date ? String(row.expiry_date).slice(0, 10) : "—"}</td><td className="px-3 py-3 text-right tabular-nums">{units(row.quantity)}</td><td className="px-3 py-3 text-right tabular-nums">KES {Number(row.unit_cost).toLocaleString("en-KE", { maximumFractionDigits: 2 })}</td><td className="px-3 py-3">{canCreate ? <Button size="sm" variant="outline" onClick={() => begin(row)}><ShieldAlert className="mr-1.5 h-3.5 w-3.5" />Prepare disposition</Button> : <Badge variant="secondary">Held</Badge>}</td></tr>)}{!loading && !stock.length && <tr><td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">No quarantined stock needs disposition.</td></tr>}</tbody></table>{loading && <div className="p-8 text-center text-sm text-muted-foreground">Loading quarantine balances…</div>}</div></CardContent></Card>

    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Disposition register</h2><p className="text-sm text-muted-foreground">Write-offs credit inventory and debit the selected expense account. Supplier returns credit inventory and debit the selected supplier-claim asset account for later credit-note reconciliation.</p></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[1000px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Reference</th><th className="px-3 py-3">Item</th><th className="px-3 py-3">Disposition</th><th className="px-3 py-3">Supplier / account</th><th className="px-3 py-3 text-right">Quantity</th><th className="px-3 py-3 text-right">Value</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Action</th></tr></thead><tbody>{dispositions.map((row) => { const isPreparer = String(row.created_by) === String(user?.id); const counterparty = row.disposition_type === "supplier_return" ? String(row.vendor_name || "Supplier") : String(row.offset_account_code ? `${row.offset_account_code} · ${row.offset_account_name}` : "—"); return <tr key={row.id} className="border-t"><td className="px-3 py-3 font-semibold">{row.disposition_no}<div className="text-xs font-normal text-muted-foreground">{String(row.created_by_name || "")}</div></td><td className="px-3 py-3">{String(row.item_code)} · {String(row.item_name)}<div className="text-xs text-muted-foreground">{String(row.warehouse_name)}{row.batch_no ? ` · ${String(row.batch_no)}` : ""}</div></td><td className="px-3 py-3 capitalize">{String(row.disposition_type).replaceAll("_", " ")}<div className="text-xs text-muted-foreground">{String(row.reason)}</div></td><td className="px-3 py-3">{counterparty}{row.reference_no ? <div className="text-xs text-muted-foreground">Ref {String(row.reference_no)}</div> : null}</td><td className="px-3 py-3 text-right tabular-nums">{units(row.quantity)}</td><td className="px-3 py-3 text-right tabular-nums">KES {Number(row.value || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}</td><td className="px-3 py-3"><Badge variant={row.status === "draft" ? "secondary" : row.status === "posted" ? "default" : "outline"}>{String(row.status)}</Badge>{row.journal_no ? <div className="mt-1 text-xs text-muted-foreground">{String(row.journal_no)}</div> : null}</td><td className="px-3 py-3">{row.status === "draft" && canApprove && !isPreparer ? <Button size="sm" disabled={saving} onClick={() => void post(row)}>{saving ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}Approve & post</Button> : <span className="text-xs text-muted-foreground">{row.status === "draft" ? "Awaiting another approver" : "—"}</span>}</td></tr>; })}{!loading && !dispositions.length && <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">No quarantine dispositions have been prepared yet.</td></tr>}</tbody></table></div></CardContent></Card>

    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Prepare quarantine disposition</DialogTitle><DialogDescription>{selected?.item_code} · {selected?.item_name} · {selected?.warehouse_name}{selected?.batch_no ? ` · Batch ${selected.batch_no}` : " · Untracked stock"}. Available on hold: {units(selected?.quantity)}.</DialogDescription></DialogHeader><div className="space-y-3"><div className="space-y-2"><Label>Action</Label><Select value={form.action} onValueChange={(action: Action) => setForm((current) => ({ ...current, action, offset_account_id: "" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="release">Release to usable stock</SelectItem><SelectItem value="supplier_return">Return to supplier</SelectItem><SelectItem value="write_off">Write off / destroy</SelectItem></SelectContent></Select></div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Quantity</Label><Input type="number" min="0.0001" max={selected?.quantity} step="any" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></div>{form.action === "supplier_return" && <div className="space-y-2"><Label>Supplier</Label><Select value={form.vendor_id} onValueChange={(vendor_id) => setForm((current) => ({ ...current, vendor_id }))}><SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger><SelectContent>{setup.vendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.vendor_code} · {vendor.name}</SelectItem>)}</SelectContent></Select></div>}</div>{form.action !== "release" && <><div className="space-y-2"><Label>{form.action === "write_off" ? "Write-off expense account" : "Supplier claim / receivable account"}</Label><Select value={form.offset_account_id} onValueChange={(offset_account_id) => setForm((current) => ({ ...current, offset_account_id }))}><SelectTrigger><SelectValue placeholder="Select postable account" /></SelectTrigger><SelectContent>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.account_code} · {account.account_name}</SelectItem>)}</SelectContent></Select></div>{form.action === "supplier_return" && <div className="space-y-2"><Label>Supplier return / claim reference</Label><Input value={form.reference_no} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, reference_no: event.target.value }))} placeholder="Supplier RMA or collection reference" /></div>}</>}<div className="space-y-2"><Label>Reason and evidence</Label><Textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} maxLength={1000} placeholder="Inspection outcome, damage report, supplier authorization, or destruction evidence" /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>{saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}Create disposition draft</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <Card className="rounded-2xl border-border/70"><CardContent className="p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString("en-KE", { maximumFractionDigits: 3 })}</div></CardContent></Card>; }
