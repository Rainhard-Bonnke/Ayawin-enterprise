import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Banknote, CheckCircle2, MessageSquarePlus, RefreshCw, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { v1Api } from "@/lib/api-v1";
import { KES } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/accounts-receivable")({
  component: AccountsReceivablePage,
  head: () => ({ meta: [{ title: "Accounts Receivable - Ayawin Stock Solution" }] }),
});

type Invoice = Record<string, unknown> & { id: string };
type CollectionActivity = Record<string, unknown> & { id: string };
type ActivityType = "call" | "email" | "visit" | "promise_to_pay" | "dispute" | "other";
const buckets = ["all", "current", "1-30 days", "31-60 days", "61-90 days", "over 90 days"];

function AccountsReceivablePage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [activities, setActivities] = useState<CollectionActivity[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [asOf, setAsOf] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState("all");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [activityTarget, setActivityTarget] = useState<Invoice | null>(null);
  const [activityType, setActivityType] = useState<ActivityType>("call");
  const [activitySummary, setActivitySummary] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [promisedDate, setPromisedDate] = useState("");
  const [promisedAmount, setPromisedAmount] = useState("");
  const canCollect = user?.role === "Admin" || user?.permissions?.includes("sales.create");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [data, activityRows] = await Promise.all([
        v1Api.sales.receivablesAging(token), v1Api.sales.collectionActivities(token),
      ]);
      setRows(data.rows as Invoice[]);
      setActivities(activityRows as CollectionActivity[]);
      setTotals(data.totals);
      setAsOf(data.as_of);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load customer balances");
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => rows.filter((row) =>
    (bucket === "all" || row.ageing_bucket === bucket) &&
    `${row.invoice_no} ${row.customer_name}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), [rows, bucket, query]);

  const collect = async () => {
    if (!token || !selected) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > Number(selected.outstanding)) {
      toast.error("Enter a payment greater than zero and no more than the open balance."); return;
    }
    setSaving(true);
    try {
      const result = await v1Api.sales.payInvoice(token, selected.id, {
        amount: value, payment_date: paymentDate, reference_no: reference.trim(),
      });
      toast.success(`Receipt ${result.payment_no} recorded`);
      if (result.gl_warning) toast.warning(`Receipt saved, but its accounting journal needs attention: ${result.gl_warning}`);
      setSelected(null); setAmount(""); setReference(""); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to record customer receipt"); }
    finally { setSaving(false); }
  };

  const saveActivity = async () => {
    if (!token || !activityTarget) return;
    if (!activitySummary.trim()) { toast.error("Add a short note describing the customer contact or next step."); return; }
    setSaving(true);
    try {
      await v1Api.sales.createCollectionActivity(token, {
        invoice_id: activityTarget.id, activity_type: activityType, summary: activitySummary,
        next_action_date: nextActionDate || null,
        promised_date: activityType === "promise_to_pay" ? promisedDate : null,
        promised_amount: activityType === "promise_to_pay" ? Number(promisedAmount) : null,
      });
      toast.success("Collection follow-up saved");
      setActivityTarget(null); setActivitySummary(""); setNextActionDate(""); setPromisedDate(""); setPromisedAmount("");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save collection follow-up"); }
    finally { setSaving(false); }
  };

  const completeActivity = async (activity: CollectionActivity) => {
    if (!token) return;
    try {
      await v1Api.sales.completeCollectionActivity(token, activity.id);
      toast.success("Follow-up marked complete");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to complete follow-up"); }
  };

  return <div className="space-y-5 pb-8">
    <PageHeader title="Accounts receivable" description="See who owes the business, how long balances have been due, and record collections against the right invoice." actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>} />
    <p className="text-xs text-muted-foreground">Balance snapshot as of {asOf || "today"}. Age is counted from the due date; invoices without a due date use the invoice date.</p>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Metric label="Total open" value={KES(totals.outstanding || 0)} />
      <Metric label="Not yet overdue" value={KES(totals.current || 0)} />
      <Metric label="1–30 days overdue" value={KES(totals.days_1_30 || 0)} />
      <Metric label="31–60 days overdue" value={KES(totals.days_31_60 || 0)} />
      <Metric label="61–90 days overdue" value={KES(totals.days_61_90 || 0)} />
      <Metric label="Over 90 days overdue" value={KES(totals.days_over_90 || 0)} tone="danger" />
    </div>

    {activityTarget && <Card className="rounded-2xl border-primary/30 shadow-sm"><CardContent className="space-y-4 p-5">
      <div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold">Log customer follow-up</h2><p className="text-sm text-muted-foreground">{String(activityTarget.customer_name)} · {String(activityTarget.invoice_no)} · Open {KES(Number(activityTarget.outstanding))}</p></div><Button variant="ghost" onClick={() => setActivityTarget(null)}>Cancel</Button></div>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Contact type</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={activityType} onChange={(event) => setActivityType(event.target.value as ActivityType)}><option value="call">Phone call</option><option value="email">Email</option><option value="visit">Visit</option><option value="promise_to_pay">Promise to pay</option><option value="dispute">Dispute</option><option value="other">Other</option></select></div><div className="space-y-2"><Label>Next follow-up date</Label><Input type="date" value={nextActionDate} onChange={(event) => setNextActionDate(event.target.value)} /></div></div>
      {activityType === "promise_to_pay" && <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Promised amount (KES)</Label><Input type="number" min="0.01" max={Number(activityTarget.outstanding)} step="0.01" value={promisedAmount} onChange={(event) => setPromisedAmount(event.target.value)} /></div><div className="space-y-2"><Label>Promise date</Label><Input type="date" value={promisedDate} onChange={(event) => setPromisedDate(event.target.value)} /></div></div>}
      <div className="space-y-2"><Label>Contact notes and outcome</Label><Textarea maxLength={2000} rows={3} value={activitySummary} onChange={(event) => setActivitySummary(event.target.value)} placeholder="Who did you speak with? What did they confirm? Record the next step." /></div>
      <Button onClick={() => void saveActivity()} disabled={saving}>{saving ? "Saving..." : "Save follow-up"}</Button>
    </CardContent></Card>}

    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Open collection follow-ups</h2><p className="text-sm text-muted-foreground">Promises and next actions stay linked to the customer invoice and audit history.</p></div><div className="overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>Next action</TableHead><TableHead>Customer / invoice</TableHead><TableHead>Contact</TableHead><TableHead>Notes</TableHead><TableHead>Promise</TableHead><TableHead>Owner</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>
      {activities.map((activity) => <TableRow key={activity.id}><TableCell>{activity.next_action_date ? String(activity.next_action_date).slice(0, 10) : "No date"}</TableCell><TableCell className="font-medium">{String(activity.customer_name)}<div className="text-xs text-muted-foreground">{String(activity.invoice_no)}</div></TableCell><TableCell><Badge variant="outline">{String(activity.activity_type).replaceAll("_", " ")}</Badge></TableCell><TableCell className="max-w-xs whitespace-normal">{String(activity.summary)}</TableCell><TableCell>{activity.promised_amount ? <>{KES(Number(activity.promised_amount))}<div className="text-xs text-muted-foreground">{String(activity.promised_date).slice(0, 10)}</div></> : "—"}</TableCell><TableCell>{String(activity.created_by_name || "—")}</TableCell><TableCell>{canCollect && <Button size="sm" variant="outline" onClick={() => void completeActivity(activity)}><CheckCircle2 className="mr-1 h-4 w-4" />Complete</Button>}</TableCell></TableRow>)}
      {!activities.length && <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground">No open follow-ups. Log a call, promise, dispute, or next action from an invoice below.</TableCell></TableRow>}
    </TableBody></Table></div></CardContent></Card>

    {selected && <Card className="rounded-2xl border-primary/30 shadow-sm"><CardContent className="space-y-4 p-5">
      <div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold">Record customer receipt · {String(selected.invoice_no)}</h2><p className="text-sm text-muted-foreground">{String(selected.customer_name)} · Outstanding {KES(Number(selected.outstanding))}</p></div><Button variant="ghost" onClick={() => setSelected(null)}>Cancel</Button></div>
      <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><Label>Amount received (KES)</Label><Input type="number" min="0.01" max={Number(selected.outstanding)} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></div><div className="space-y-2"><Label>Receipt date</Label><Input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></div><div className="space-y-2"><Label>Bank transfer reference</Label><Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bank transaction reference" maxLength={100} /></div></div>
      <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />This records a receipt against this invoice. Bank statement reconciliation is a separate finance workflow and is still on the ERP roadmap.</div>
      <Button onClick={() => void collect()} disabled={saving}>{saving ? "Saving receipt..." : "Save receipt"}</Button>
    </CardContent></Card>}

    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2"><div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search customer or invoice" value={query} onChange={(event) => setQuery(event.target.value)} /></div><select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={bucket} onChange={(event) => setBucket(event.target.value)} aria-label="Filter by ageing period">{buckets.map((value) => <option key={value} value={value}>{value === "all" ? "All ageing periods" : value}</option>)}</select><Badge variant="secondary">{visible.length} open invoices</Badge></div>
      <div className="overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Customer</TableHead><TableHead>Invoice date</TableHead><TableHead>Due date</TableHead><TableHead>Age</TableHead><TableHead className="text-right">Invoice total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Collection</TableHead></TableRow></TableHeader><TableBody>
        {visible.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{String(row.invoice_no)}</TableCell><TableCell>{String(row.customer_name)}</TableCell><TableCell>{String(row.invoice_date).slice(0,10)}</TableCell><TableCell>{String(row.due_date || row.invoice_date).slice(0,10)}</TableCell><TableCell><Badge variant={Number(row.days_overdue) > 30 ? "destructive" : Number(row.days_overdue) > 0 ? "outline" : "secondary"}>{String(row.ageing_bucket)}{Number(row.days_overdue) > 0 ? ` · ${String(row.days_overdue)}d` : ""}</Badge></TableCell><TableCell className="text-right tabular-nums">{KES(Number(row.total_amount))}</TableCell><TableCell className="text-right tabular-nums">{KES(Number(row.amount_paid))}</TableCell><TableCell className="text-right font-semibold tabular-nums">{KES(Number(row.outstanding))}</TableCell><TableCell><div className="flex gap-1">{canCollect && <><Button size="sm" variant="outline" onClick={() => { setSelected(row); setAmount(String(row.outstanding)); }}><Banknote className="mr-1 h-4 w-4" />Record</Button><Button size="sm" variant="ghost" aria-label={`Log follow-up for ${String(row.invoice_no)}`} onClick={() => { setActivityTarget(row); setActivityType("call"); }}><MessageSquarePlus className="h-4 w-4" /></Button></>}</div></TableCell></TableRow>)}
        {!loading && visible.length === 0 && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No open invoices match this filter.</TableCell></TableRow>}
        {loading && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">Loading receivables...</TableCell></TableRow>}
      </TableBody></Table></div>
    </CardContent></Card>
  </div>;
}

function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <Card className="rounded-2xl border-border/70"><CardContent className="p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "danger" ? "text-destructive" : ""}`}>{value}</div></CardContent></Card>;
}
