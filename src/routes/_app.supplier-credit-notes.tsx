import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FilePlus2, LoaderCircle, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { KES } from "@/lib/format";
import { v1Api } from "@/lib/api-v1";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/supplier-credit-notes")({
  component: SupplierCreditNotesPage,
  head: () => ({ meta: [{ title: "Supplier Credit Notes - Ayawin Stock Solution" }] }),
});

type Claim = {
  disposition_id: string; disposition_no: string; vendor_id: string; vendor_code: string; vendor_name: string;
  item_code: string; item_name: string; quantity: number; claim_account_code: string; claim_account_name: string;
  claim_value: number; reserved_value: number;
};
type Bill = { id: string; bill_no: string; supplier_invoice_no: string; vendor_id: string; currency_code: string; balance_due: number };
type SourceLine = {
  disposition_id: string; source_bill_line_id: string; bill_id: string; vendor_id: string; bill_no: string;
  supplier_invoice_no: string; bill_date: string; description: string; billed_quantity: number;
  batch_no: string | null; expiry_date: string | null; receipt_lot_id: string | null;
  net_amount: number; tax_amount: number; tax_rate: number; item_code: string; item_name: string;
  available_return_quantity: number; available_vat: number;
};
type Account = { id: string; account_code: string; account_name: string };
type Setup = { claims: Claim[]; bills: Bill[]; sourceLines: SourceLine[]; accounts: Account[] };
type Credit = Record<string, unknown> & {
  id: string; credit_note_no: string; status: string; created_by: string; amount: number;
  journal_no?: string | null; vendor_name?: string | null; reference_no?: string | null;
  disposition_no?: string | null; bill_numbers?: string | null; supplier_invoice_no?: string | null;
  inventory_claim_amount?: number; vat_amount?: number; allocated_amount?: number;
  refund_amount?: number; unapplied_amount?: number; received_date?: string;
};
type Allocation = { bill_id: string; amount: string };
const n = (value: unknown) => Number(value || 0);
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function SupplierCreditNotesPage() {
  const { token, user } = useAuth();
  const [setup, setSetup] = useState<Setup>({ claims: [], bills: [], sourceLines: [], accounts: [] });
  const [credits, setCredits] = useState<Credit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [claimId, setClaimId] = useState("");
  const [sourceBillLineId, setSourceBillLineId] = useState("");
  const [creditNoteNo, setCreditNoteNo] = useState("");
  const [creditDate, setCreditDate] = useState(today());
  const [receivedDate, setReceivedDate] = useState(today());
  const [referenceNo, setReferenceNo] = useState("");
  const [returnedQuantity, setReturnedQuantity] = useState("");
  const [principal, setPrincipal] = useState("");
  const [vatAmount, setVatAmount] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundBankAccountId, setRefundBankAccountId] = useState("");
  const [refundReferenceNo, setRefundReferenceNo] = useState("");
  const [unappliedAmount, setUnappliedAmount] = useState("");
  const [unappliedAccountId, setUnappliedAccountId] = useState("");
  const [courtDisputeDeterminedOn, setCourtDisputeDeterminedOn] = useState("");
  const [courtCaseReference, setCourtCaseReference] = useState("");
  const [allocations, setAllocations] = useState<Allocation[]>([{ bill_id: "", amount: "" }]);
  const canCreate = user?.role === "Admin" || user?.permissions?.includes("procurement.create");
  const canApprove = user?.role === "Admin" || user?.permissions?.includes("procurement.approve");
  const selectedClaim = setup.claims.find((claim) => claim.disposition_id === claimId);
  const remainingClaim = selectedClaim ? n(selectedClaim.claim_value) - n(selectedClaim.reserved_value) : 0;
  const sourceOptions = useMemo(() => setup.sourceLines.filter((line) => line.disposition_id === claimId), [setup.sourceLines, claimId]);
  const source = sourceOptions.find((line) => line.source_bill_line_id === sourceBillLineId);
  const supplierBills = useMemo(() => setup.bills.filter((bill) => bill.vendor_id === selectedClaim?.vendor_id && bill.currency_code === "KES"), [setup.bills, selectedClaim?.vendor_id]);
  const bankAccounts = setup.accounts.filter((account) => account.account_code.startsWith("11"));
  const unappliedAccounts = setup.accounts.filter((account) => !["1100", "1200", "1300", "1400"].includes(account.account_code) && !account.account_code.startsWith("11"));
  const allocationTotal = allocations.reduce((sum, row) => sum + (row.bill_id ? n(row.amount) : 0), 0);
  const grossTotal = n(principal) + n(vatAmount);
  const settlementTotal = allocationTotal + n(refundAmount) + n(unappliedAmount);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [setupData, rows] = await Promise.all([v1Api.procurement.supplierReturnCreditSetup(token), v1Api.procurement.supplierReturnCredits(token)]);
      setSetup(setupData as unknown as Setup);
      setCredits(rows as Credit[]);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load supplier return credits"); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const resetForm = () => {
    setClaimId(""); setSourceBillLineId(""); setCreditNoteNo(""); setCreditDate(today()); setReceivedDate(today());
    setReferenceNo(""); setReturnedQuantity(""); setPrincipal(""); setVatAmount(""); setRefundAmount("");
    setRefundBankAccountId(""); setRefundReferenceNo(""); setUnappliedAmount(""); setUnappliedAccountId("");
    setCourtDisputeDeterminedOn(""); setCourtCaseReference(""); setAllocations([{ bill_id: "", amount: "" }]);
  };
  const addAllocation = () => setAllocations((rows) => [...rows, { bill_id: "", amount: "" }]);
  const updateAllocation = (index: number, patch: Partial<Allocation>) => setAllocations((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const createDraft = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !selectedClaim || !source) { toast.error("Choose the posted supplier-return claim and its original invoice line."); return; }
    const clean = allocations.filter((row) => row.bill_id && n(row.amount) > 0).map((row) => ({ bill_id: row.bill_id, amount: n(row.amount) }));
    if (Math.abs(settlementTotal - grossTotal) > 0.005 || grossTotal <= 0) { toast.error("Bill allocations, cash refund and unapplied credit must equal the full gross note value."); return; }
    if (n(principal) > remainingClaim + 0.005) { toast.error("Inventory credit exceeds the uncredited return claim."); return; }
    if (n(vatAmount) > n(source.available_vat) + 0.005) { toast.error("VAT reversal exceeds the remaining tax on the original invoice line."); return; }
    if (n(refundAmount) > 0 && (!refundBankAccountId || !refundReferenceNo.trim())) { toast.error("Select the receiving bank/cash account and enter the refund reference."); return; }
    if (n(unappliedAmount) > 0 && !unappliedAccountId) { toast.error("Choose an account for the unapplied supplier credit."); return; }
    setSaving(true);
    try {
      await v1Api.procurement.createSupplierReturnCredit(token, {
        disposition_id: claimId, source_bill_line_id: sourceBillLineId, credit_note_no: creditNoteNo,
        credit_date: creditDate, received_date: receivedDate, reference_no: referenceNo,
        returned_quantity: n(returnedQuantity), inventory_claim_amount: n(principal), vat_amount: n(vatAmount),
        allocations: clean, refund_amount: n(refundAmount), refund_bank_account_id: refundBankAccountId || undefined,
        refund_reference_no: refundReferenceNo, unapplied_amount: n(unappliedAmount), unapplied_account_id: unappliedAccountId || undefined,
        court_dispute_determined_on: courtDisputeDeterminedOn || undefined, court_case_reference: courtCaseReference || undefined,
      });
      toast.success("Supplier credit note draft prepared. A different approver must post it.");
      setFormOpen(false); resetForm(); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to prepare credit note"); }
    finally { setSaving(false); }
  };
  const post = async (row: Credit) => {
    if (!token) return;
    setSaving(true);
    try { await v1Api.procurement.postSupplierReturnCredit(token, row.id); toast.success(`${row.credit_note_no} posted with its bill/refund/credit settlement.`); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to post supplier credit note"); }
    finally { setSaving(false); }
  };
  const cancel = async (row: Credit) => {
    if (!token) return;
    setSaving(true);
    try { await v1Api.procurement.cancelSupplierReturnCredit(token, row.id); toast.success(`${row.credit_note_no} draft cancelled.`); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to cancel draft"); }
    finally { setSaving(false); }
  };

  return <div className="space-y-5 pb-8">
    <PageHeader title="Supplier credit notes" description="Link a supplier credit note to its original invoice, reverse eligible input VAT, and settle it against bills, a cash refund or unapplied supplier credit." actions={<><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>{canCreate && <Button onClick={() => setFormOpen((open) => !open)}><FilePlus2 className="mr-2 h-4 w-4" />Match credit note</Button>}</>} />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Uncredited return claims" value={setup.claims.length} /><Metric label="Claim value still open" value={setup.claims.reduce((sum, claim) => sum + Math.max(n(claim.claim_value) - n(claim.reserved_value), 0), 0)} money /><Metric label="Drafts awaiting approval" value={credits.filter((row) => row.status === "draft").length} /></div>
    {formOpen && <Card className="rounded-2xl border-primary/20 shadow-sm"><CardContent className="p-5"><form className="space-y-4" onSubmit={createDraft}>
      <div><h2 className="font-semibold">Match supplier credit note</h2><p className="text-sm text-muted-foreground">Choose the posted supplier return and original receipt-linked tax invoice. The note issue date is subject to the six-month limit; input VAT reverses in the period the note is received. Add a court dispute determination date and case reference for the statutory exception.</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2 lg:col-span-2"><Label>Supplier return claim</Label><select required value={claimId} onChange={(e) => { setClaimId(e.target.value); setSourceBillLineId(""); setAllocations([{ bill_id: "", amount: "" }]); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select an open return claim</option>{setup.claims.map((claim) => <option key={claim.disposition_id} value={claim.disposition_id}>{claim.vendor_code} - {claim.vendor_name} - {claim.disposition_no} - {claim.item_code} {claim.item_name} (open {KES(n(claim.claim_value) - n(claim.reserved_value))})</option>)}</select>{selectedClaim && <p className="text-xs text-muted-foreground">Inventory claim account: {selectedClaim.claim_account_code} {selectedClaim.claim_account_name}. Remaining value: {KES(remainingClaim)}.</p>}</div>
        <div className="space-y-2 lg:col-span-2"><Label>Original supplier tax invoice line</Label><select required value={sourceBillLineId} onChange={(e) => { const line = sourceOptions.find((option) => option.source_bill_line_id === e.target.value); setSourceBillLineId(e.target.value); setReturnedQuantity(line ? String(line.available_return_quantity) : ""); }} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select invoice and received item</option>{sourceOptions.map((line) => <option key={line.source_bill_line_id} value={line.source_bill_line_id}>{line.supplier_invoice_no} - {line.bill_date.toString().slice(0, 10)} - {line.item_code}{line.batch_no ? ` - Batch ${line.batch_no}` : ""}{line.expiry_date ? ` - Exp ${line.expiry_date.toString().slice(0, 10)}` : ""} - Qty available {n(line.available_return_quantity)}</option>)}</select>{source && <p className="text-xs text-muted-foreground">Original invoice: {source.supplier_invoice_no}; {source.receipt_lot_id ? `receipt is linked to tracked batch ${source.batch_no}` : "untracked stock receipt"}; line VAT rate {n(source.tax_rate)}%; input VAT still available to reverse: {KES(n(source.available_vat))}.</p>}</div>
        <div className="space-y-2"><Label>Supplier credit note #</Label><Input required maxLength={100} value={creditNoteNo} onChange={(e) => setCreditNoteNo(e.target.value)} /></div>
        <div className="space-y-2"><Label>Supplier note issue date</Label><Input required type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} /></div>
        <div className="space-y-2"><Label>Date received</Label><Input required type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></div>
        <div className="space-y-2"><Label>Supplier return / RMA reference</Label><Input maxLength={100} value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} /></div>
        <div className="space-y-2"><Label>Returned quantity on this note</Label><Input required type="number" min="0.0001" step="any" max={source?.available_return_quantity || undefined} value={returnedQuantity} onChange={(e) => setReturnedQuantity(e.target.value)} /></div>
        <div className="space-y-2"><Label>Inventory value credited (KES)</Label><Input required type="number" min="0.01" step="0.01" max={remainingClaim || undefined} value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
        <div className="space-y-2"><Label>VAT credit per supplier note (KES)</Label><Input required type="number" min="0" step="0.01" max={source?.available_vat || undefined} value={vatAmount} onChange={(e) => setVatAmount(e.target.value)} /></div>
        <div className="space-y-2"><Label>Gross credit note total</Label><div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 font-semibold tabular-nums">{KES(grossTotal)}</div></div>
      </div>
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-muted-foreground">The system checks that returned quantity, inventory value and VAT do not exceed the original receipt-linked invoice line. A tax reversal is posted only against the configured VAT Input account 1400.</div>
      <div className="space-y-2"><div className="flex items-center justify-between"><Label>Allocate to open KES bills</Label><Button type="button" size="sm" variant="outline" onClick={addAllocation}>Add bill</Button></div>{allocations.map((row, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_200px_auto]"><select value={row.bill_id} onChange={(e) => updateAllocation(index, { bill_id: e.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">No bill allocation</option>{supplierBills.map((bill) => <option key={bill.id} value={bill.id}>{bill.bill_no} / {bill.supplier_invoice_no} - open {KES(n(bill.balance_due))}</option>)}</select><Input aria-label="Allocation amount" type="number" min="0" step="0.01" value={row.amount} onChange={(e) => updateAllocation(index, { amount: e.target.value })} placeholder="Amount" />{allocations.length > 1 && <Button type="button" variant="ghost" onClick={() => setAllocations((rows) => rows.filter((_, i) => i !== index))}>Remove</Button>}</div>)}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2"><Label>Supplier cash refund (KES)</Label><Input type="number" min="0" step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} /></div>
        {n(refundAmount) > 0 && <><div className="space-y-2"><Label>Refund received into</Label><select required value={refundBankAccountId} onChange={(e) => setRefundBankAccountId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Choose bank/cash account</option>{bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_code} - {account.account_name}</option>)}</select></div><div className="space-y-2"><Label>Bank deposit / refund reference</Label><Input required value={refundReferenceNo} onChange={(e) => setRefundReferenceNo(e.target.value)} /></div></>}
        <div className="space-y-2"><Label>Unapplied supplier credit (KES)</Label><Input type="number" min="0" step="0.01" value={unappliedAmount} onChange={(e) => setUnappliedAmount(e.target.value)} /></div>
        {n(unappliedAmount) > 0 && <div className="space-y-2"><Label>Supplier-credit asset account</Label><select required value={unappliedAccountId} onChange={(e) => setUnappliedAccountId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Choose configured asset account</option>{unappliedAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_code} - {account.account_name}</option>)}</select></div>}
      </div>
      <div className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/40 p-3 text-sm"><span>Settlement: bills {KES(allocationTotal)} + refund {KES(n(refundAmount))} + unapplied {KES(n(unappliedAmount))}</span><span className={Math.abs(settlementTotal - grossTotal) <= 0.005 ? "font-semibold text-emerald-700" : "font-semibold text-destructive"}>Total {KES(settlementTotal)} / {KES(grossTotal)}</span></div>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Court price dispute exception (if applicable)</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Court determination date</Label><Input type="date" value={courtDisputeDeterminedOn} onChange={(e) => setCourtDisputeDeterminedOn(e.target.value)} /></div><div className="space-y-2"><Label>Court case / determination reference</Label><Input value={courtCaseReference} maxLength={100} onChange={(e) => setCourtCaseReference(e.target.value)} /></div></div></details>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button><Button type="submit" disabled={saving || !source || !selectedClaim || grossTotal <= 0 || Math.abs(settlementTotal - grossTotal) > 0.005}>{saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}Prepare draft</Button></div>
    </form></CardContent></Card>}
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="p-0"><div className="border-b p-5"><h2 className="font-semibold">Supplier return credit register</h2><p className="text-sm text-muted-foreground">Posted notes reverse input VAT in the receipt month and settle to bills, bank refunds or the configured supplier-credit asset account. Inventory is not moved a second time.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3">Supplier credit note</th><th className="px-3 py-3">Original invoice</th><th className="px-3 py-3">Return claim</th><th className="px-3 py-3">Bill allocations</th><th className="px-3 py-3 text-right">Net / VAT</th><th className="px-3 py-3 text-right">Refund / open</th><th className="px-3 py-3">Received / status</th><th className="px-3 py-3">Action</th></tr></thead><tbody>{credits.map((row) => { const isPreparer = String(row.created_by) === String(user?.id); const canCancel = isPreparer || user?.role === "Admin"; return <tr key={row.id} className="border-t"><td className="px-3 py-3 font-medium">{row.credit_note_no}<div className="text-xs text-muted-foreground">{String(row.vendor_name)}{row.reference_no ? ` - ${String(row.reference_no)}` : ""}</div></td><td className="px-3 py-3">{String(row.supplier_invoice_no || "Legacy / unlinked")}</td><td className="px-3 py-3">{String(row.disposition_no)}</td><td className="px-3 py-3">{String(row.bill_numbers || "No bill allocation")}</td><td className="px-3 py-3 text-right tabular-nums">{KES(n(row.inventory_claim_amount))} / {KES(n(row.vat_amount))}</td><td className="px-3 py-3 text-right tabular-nums">{KES(n(row.refund_amount))} / {KES(n(row.unapplied_amount))}</td><td className="px-3 py-3"><div>{String(row.received_date || row.credit_date).slice(0, 10)}</div><StatusBadge status={row.status} />{row.journal_no && <div className="text-xs text-muted-foreground">{String(row.journal_no)}</div>}</td><td className="px-3 py-3">{row.status === "draft" && canApprove && !isPreparer ? <Button size="sm" disabled={saving} onClick={() => void post(row)}><Check className="mr-1 h-4 w-4" />Post credit</Button> : row.status === "draft" && canCancel ? <Button size="sm" variant="outline" disabled={saving} onClick={() => void cancel(row)}>Cancel draft</Button> : row.status === "draft" ? <span className="text-xs text-muted-foreground">Awaiting another approver</span> : <span className="text-xs text-muted-foreground">-</span>}</td></tr>; })}{!loading && !credits.length && <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">No supplier return credits have been recorded.</td></tr>}{loading && <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">Loading supplier credit notes...</td></tr>}</tbody></table></div></CardContent></Card>
  </div>;
}

function Metric({ label, value, money = false }: { label: string; value: number; money?: boolean }) { return <Card className="rounded-2xl border-border/70"><CardContent className="p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{money ? KES(value) : value.toLocaleString("en-KE")}</div></CardContent></Card>; }
