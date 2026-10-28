import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FilePlus2, LoaderCircle, RefreshCw, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";
import { KES } from "@/lib/format";
import { v1Api } from "@/lib/api-v1";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/customer-credit-notes")({
  component: CustomerCreditNotesPage,
  head: () => ({ meta: [{ title: "Customer Credit Notes - Ayawin Stock Solution" }] }),
});

type Invoice = Record<string, unknown> & { id: string };
type ReturnSource = Record<string, unknown> & {
  invoice_line_id: string; delivery_note_line_id: string; source_layer_id: string | null;
  item_name: string; item_code: string; returnable_quantity: number;
};
type CreditNote = Record<string, unknown> & { id: string };
type DraftLine = ReturnSource & { quantity: string; condition: "good" | "damaged" };
const dateToday = () => new Date().toISOString().slice(0, 10);
const sourceKey = (line: ReturnSource) => `${line.invoice_line_id}|${line.delivery_note_line_id}|${line.source_layer_id || "legacy"}|${line.batch_no || ""}|${line.expiry_date || ""}`;

function CustomerCreditNotesPage() {
  const { token, user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [creditDate, setCreditDate] = useState(dateToday());
  const [reason, setReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundAccountId, setRefundAccountId] = useState("");
  const [refundReference, setRefundReference] = useState("");
  const [refundAccounts, setRefundAccounts] = useState<Record<string, unknown>[]>([]);
  const [courtDate, setCourtDate] = useState("");
  const [courtReference, setCourtReference] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const canCreate = user?.role === "Admin" || user?.permissions?.includes("sales.create");
  const canPost = user?.role === "Admin" || user?.permissions?.includes("sales.approve");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await v1Api.sales.customerCreditNoteSetup(token);
      setInvoices(data.invoices as Invoice[]);
      setNotes(data.notes as CreditNote[]);
      setRefundAccounts(data.refundAccounts || []);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load customer credit notes"); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const startCredit = async (invoice: Invoice) => {
    if (!token) return;
    setLoadingInvoice(true);
    try {
      const result = await v1Api.sales.customerReturnOptions(token, invoice.id);
      const sources = result.lines as ReturnSource[];
      setSelectedInvoice(invoice);
      setDraftLines(sources.map((line) => ({ ...line, quantity: "", condition: "good" })));
      setCreditDate(dateToday()); setReason(""); setCourtDate(""); setCourtReference("");
      setRefundAmount(""); setRefundAccountId(""); setRefundReference("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load original delivered items"); }
    finally { setLoadingInvoice(false); }
  };

  const totals = useMemo(() => draftLines.reduce((sum, line) => {
    const qty = Number(line.quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) return sum;
    return { net: sum.net + qty * Number(line.unit_price), tax: sum.tax + (Number(line.original_tax_amount) * qty / Number(line.invoice_quantity)) };
  }, { net: 0, tax: 0 }), [draftLines]);

  const saveDraft = async () => {
    if (!token || !selectedInvoice) return;
    const lines = draftLines.filter((line) => Number(line.quantity) > 0);
    const total = totals.net + totals.tax;
    const refund = Number(refundAmount || 0);
    if (!reason.trim() || !lines.length || lines.some((line) => Number(line.quantity) > Number(line.returnable_quantity) + 0.00005)) {
      toast.error("Enter a reason and return quantities within each invoice and batch balance."); return;
    }
    if (!Number.isFinite(refund) || refund < 0 || refund > total + 0.005
      || (refund > 0 && (!refundAccountId || !refundReference.trim()))
      || total - refund > Number(selectedInvoice.creditable_balance) + 0.005) {
      toast.error("The applied credit must fit the invoice balance. Enter a valid bank refund for any excess."); return;
    }
    setSaving(true);
    try {
      const note = await v1Api.sales.createCustomerCreditNote(token, {
        invoice_id: selectedInvoice.id, credit_date: creditDate, reason,
        refund_amount: refund, refund_bank_account_id: refund > 0 ? refundAccountId : undefined,
        refund_reference_no: refund > 0 ? refundReference : undefined,
        court_dispute_determined_on: courtDate || null, court_case_reference: courtReference || null,
        lines: lines.map((line) => ({ invoice_line_id: line.invoice_line_id,
          delivery_note_line_id: line.delivery_note_line_id, source_layer_id: line.source_layer_id,
          batch_no: line.batch_no, expiry_date: line.expiry_date, quantity: Number(line.quantity), condition: line.condition })),
      });
      toast.success(`Draft credit note ${String(note.credit_note_no)} saved`);
      setSelectedInvoice(null); setDraftLines([]); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to prepare customer credit note"); }
    finally { setSaving(false); }
  };

  const postNote = async (note: CreditNote) => {
    if (!token) return;
    setSaving(true);
    try {
      const result = await v1Api.sales.postCustomerCreditNote(token, note.id);
      toast.success(`Credit note ${String(result.credit_note_no)} posted`); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to post customer credit note"); }
    finally { setSaving(false); }
  };

  const cancelNote = async (note: CreditNote) => {
    if (!token) return;
    try { await v1Api.sales.cancelCustomerCreditNote(token, note.id); toast.success("Draft credit note cancelled"); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to cancel draft"); }
  };

  return <div className="space-y-5 pb-8">
    <PageHeader title="Customer returns & credit notes" description="Receive goods against a posted delivery and prepare a credit note linked to its original tax invoice." actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>} />
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-muted-foreground">Credit notes reverse the original invoice values and VAT snapshots. This ERP records and posts the internal credit note; certified KRA eTIMS submission is not connected.</div>

    {selectedInvoice && <Card className="rounded-2xl border-primary/30 shadow-sm"><CardContent className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Prepare credit for {String(selectedInvoice.invoice_no)}</h2><p className="text-sm text-muted-foreground">{String(selectedInvoice.customer_name)} · Delivery {String(selectedInvoice.delivery_no)} · Creditable balance {KES(Number(selectedInvoice.creditable_balance))}</p></div><Button variant="ghost" onClick={() => setSelectedInvoice(null)}>Cancel</Button></div>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Credit note date</Label><Input type="date" value={creditDate} onChange={(event) => setCreditDate(event.target.value)} /></div><div className="space-y-2"><Label>Reason for returned goods</Label><Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="Returned, damaged, pricing adjustment" /></div></div>
      <div className="rounded-lg border p-3"><div className="font-medium">Customer refund (optional)</div><p className="mb-3 text-xs text-muted-foreground">Credit applied to the invoice reduces what the customer owes. Refund only the excess through a recorded bank or cash account.</p><div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><Label>Cash refund amount</Label><Input type="number" min="0" step="0.01" max={totals.net + totals.tax} value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} /></div>{Number(refundAmount) > 0 && <><div className="space-y-2"><Label>Refund paid from</Label><select value={refundAccountId} onChange={(event) => setRefundAccountId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Choose bank/cash account</option>{refundAccounts.map((account) => <option key={String(account.id)} value={String(account.id)}>{String(account.account_code)} - {String(account.account_name)}</option>)}</select></div><div className="space-y-2"><Label>Payment reference</Label><Input value={refundReference} onChange={(event) => setRefundReference(event.target.value)} maxLength={100} /></div></>}</div></div>
      <div className="rounded-lg border p-3"><div className="mb-2 font-medium">Court price dispute exception (only if applicable)</div><div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Determination date</Label><Input type="date" value={courtDate} onChange={(event) => setCourtDate(event.target.value)} /></div><div className="space-y-2"><Label>Court case reference</Label><Input value={courtReference} onChange={(event) => setCourtReference(event.target.value)} maxLength={100} /></div></div><p className="mt-2 text-xs text-muted-foreground">For a note issued later than six months after the invoice, enter both fields; the note must be issued within 30 days of determination.</p></div>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[850px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Invoice item / batch</th><th className="px-3 py-3">Returnable</th><th className="px-3 py-3">Quantity</th><th className="px-3 py-3">Condition</th><th className="px-3 py-3 text-right">Net credit</th></tr></thead><tbody>
        {draftLines.map((line) => <tr key={sourceKey(line)} className="border-t"><td className="px-3 py-3 font-medium">{line.item_name}<div className="text-xs text-muted-foreground">{line.item_code}{line.batch_no ? ` · Batch ${String(line.batch_no)} · Exp ${String(line.expiry_date).slice(0,10)}` : " · Untracked"}</div></td><td className="px-3 py-3">{Number(line.returnable_quantity).toLocaleString()}</td><td className="px-3 py-3"><Input className="w-28" type="number" min="0" max={Number(line.returnable_quantity)} step="any" value={line.quantity} onChange={(event) => setDraftLines((current) => current.map((candidate) => sourceKey(candidate) === sourceKey(line) ? { ...candidate, quantity: event.target.value } : candidate))} aria-label={`Returned quantity ${line.item_name}`} /></td><td className="px-3 py-3"><select className="h-9 rounded-md border border-input bg-background px-2" value={line.condition} onChange={(event) => setDraftLines((current) => current.map((candidate) => sourceKey(candidate) === sourceKey(line) ? { ...candidate, condition: event.target.value as "good" | "damaged" } : candidate))}><option value="good">Good · restock</option><option value="damaged">Damaged · quarantine</option></select></td><td className="px-3 py-3 text-right tabular-nums">{KES(Number(line.quantity || 0) * Number(line.unit_price))}</td></tr>)}
        {!draftLines.length && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No unreturned delivered quantities are available on this invoice.</td></tr>}
      </tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-sm"><span className="text-muted-foreground">Estimated credit: </span><strong>{KES(totals.net + totals.tax)}</strong><span className="ml-2 text-muted-foreground">(VAT {KES(totals.tax)})</span></div><Button onClick={() => void saveDraft()} disabled={saving || !draftLines.length}>{saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-2 h-4 w-4" />}Save draft</Button></div>
    </CardContent></Card>}

    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Invoices with returnable delivered stock</h2><p className="text-sm text-muted-foreground">Draft credits reserve invoice and delivered quantities until cancelled or posted.</p></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[750px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Invoice</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Customer</th><th className="px-3 py-3">Delivery</th><th className="px-3 py-3 text-right">Open balance</th><th className="px-3 py-3">Action</th></tr></thead><tbody>
      {invoices.map((invoice) => <tr key={invoice.id} className="border-t"><td className="px-3 py-3 font-semibold">{String(invoice.invoice_no)}</td><td className="px-3 py-3">{String(invoice.invoice_date).slice(0,10)}</td><td className="px-3 py-3">{String(invoice.customer_name)}</td><td className="px-3 py-3">{String(invoice.delivery_no)}</td><td className="px-3 py-3 text-right tabular-nums">{KES(Number(invoice.creditable_balance))}</td><td className="px-3 py-3"><Button size="sm" variant="outline" disabled={loadingInvoice || !canCreate} onClick={() => void startCredit(invoice)}><Undo2 className="mr-1.5 h-4 w-4" />Prepare return</Button></td></tr>)}
      {!loading && !invoices.length && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No posted-delivery invoices have an open balance available for a credit note.</td></tr>}
    </tbody></table></div></CardContent></Card>

    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Credit note register</h2><p className="text-sm text-muted-foreground">Posting is maker-checker controlled and records stock receipt, quarantine where needed, customer balance reduction, VAT reversal, and the GL journal atomically.</p></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[850px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Credit note</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Invoice / customer</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Action</th></tr></thead><tbody>
      {notes.map((note) => <tr key={note.id} className="border-t"><td className="px-3 py-3 font-semibold">{String(note.credit_note_no)}</td><td className="px-3 py-3">{String(note.credit_date).slice(0,10)}</td><td className="px-3 py-3">{String(note.invoice_no)}<div className="text-xs text-muted-foreground">{String(note.customer_name)}</div></td><td className="px-3 py-3">{String(note.reason)}{Number(note.refund_amount || 0) > 0 && <div className="text-xs text-muted-foreground">Refund {KES(Number(note.refund_amount))} · {String(note.refund_reference_no || "")}</div>}</td><td className="px-3 py-3 text-right tabular-nums">{KES(Number(note.total_amount))}</td><td className="px-3 py-3"><Badge variant={note.status === "posted" ? "default" : note.status === "cancelled" ? "secondary" : "outline"}>{String(note.status)}</Badge></td><td className="px-3 py-3"><div className="flex gap-1">{note.status === "draft" && canPost && String(note.created_by) !== String(user?.id) && <Button size="sm" onClick={() => void postNote(note)} disabled={saving}><Check className="mr-1 h-4 w-4" />Post</Button>}{note.status === "draft" && String(note.created_by) === String(user?.id) && <Button size="sm" variant="outline" onClick={() => void cancelNote(note)}>Cancel draft</Button>}</div></td></tr>)}
      {!loading && !notes.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No customer credit notes recorded yet.</td></tr>}
    </tbody></table></div></CardContent></Card>
  </div>;
}
