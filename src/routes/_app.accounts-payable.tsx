import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { PermissionGate } from "@/components/PermissionGate";
import { SearchBar } from "@/components/SearchBar";
import { KES, fmtDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import {
  createVendorBillFromGrn,
  fetchGoodsReceipts,
  fetchVendorBills,
  downloadVendorPaymentPdf,
  payVendorBill,
  postVendorBill,
  type BackendGoodsReceipt,
  type BackendVendorBill,
} from "@/lib/api";
import { toast } from "sonner";
import { Plus, CreditCard } from "lucide-react";

export const Route = createFileRoute("/_app/accounts-payable")({
  component: AccountsPayablePage,
  head: () => ({ meta: [{ title: "Accounts Payable - Ayawin Stock Solutions ERP" }] }),
});

function AccountsPayablePage() {
  const { token } = useAuth();
  const [bills, setBills] = useState<BackendVendorBill[]>([]);
  const [grns, setGrns] = useState<BackendGoodsReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<BackendVendorBill | null>(null);
  const [selectedGrn, setSelectedGrn] = useState("");
  const [vendorRef, setVendorRef] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payRef, setPayRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [billRows, grnRows] = await Promise.all([fetchVendorBills(token), fetchGoodsReceipts(token)]);
      setBills(billRows);
      setGrns(grnRows.filter((g) => g.status.toLowerCase() === "posted"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load AP data");
      setBills([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const filtered = useMemo(
    () =>
      bills.filter(
        (b) =>
          b.bill_no.toLowerCase().includes(q.toLowerCase()) ||
          b.vendor_name.toLowerCase().includes(q.toLowerCase()) ||
          b.po_number.toLowerCase().includes(q.toLowerCase()),
      ),
    [bills, q],
  );

  const apOutstanding = bills
    .filter((b) => ["posted", "partial", "overdue"].includes(b.status.toLowerCase()))
    .reduce((s, b) => s + (b.total_amount - b.amount_paid), 0);

  const createBill = async () => {
    if (!token || !selectedGrn) return;
    setSaving(true);
    try {
      await createVendorBillFromGrn(token, selectedGrn, { vendor_ref: vendorRef || undefined });
      toast.success("Vendor bill created with 3-way match");
      setCreateOpen(false);
      setSelectedGrn("");
      setVendorRef("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to create bill");
    } finally {
      setSaving(false);
    }
  };

  const postBill = async (bill: BackendVendorBill) => {
    if (!token) return;
    setPostingId(bill.id);
    try {
      await postVendorBill(token, bill.id);
      toast.success(`${bill.bill_no} posted`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Post failed");
    } finally {
      setPostingId(null);
    }
  };

  const submitPayment = async () => {
    if (!token || !payTarget) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid payment amount");
      return;
    }
    setSaving(true);
    try {
      const result = await payVendorBill(token, payTarget.id, { amount, reference_no: payRef || undefined });
      toast.success(`Vendor payment ${result.payment_no} recorded`);
      if (result.payment_no) {
        try {
          await downloadVendorPaymentPdf(token, result.payment_no);
        } catch {
          /* download again from bills list */
        }
      }
      setPayOpen(false);
      setPayTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed");
    } finally {
      setSaving(false);
    }
  };

  const matchBadge = (status: string) => {
    if (status === "matched") return <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Matched</Badge>;
    if (status === "variance") return <Badge variant="outline" className="border-amber-500/40 text-amber-600">Variance</Badge>;
    if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
    return <Badge variant="secondary">{status}</Badge>;
  };

  return (
    <div>
      <PageHeader
        title="Accounts Payable"
        description="Vendor bills, 3-way match (PO → GRN → bill), and payment runs."
        actions={
          <PermissionGate permission="finance.create">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Bill from GRN
            </Button>
          </PermissionGate>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Open bills", v: String(filtered.filter((b) => b.status !== "paid").length) },
          { l: "AP outstanding", v: KES(apOutstanding) },
          { l: "Matched", v: String(bills.filter((b) => b.match_status === "matched").length) },
          { l: "Variances", v: String(bills.filter((b) => b.match_status === "variance").length) },
        ].map((k) => (
          <Card key={k.l}><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
            <div className="mt-1 text-2xl font-bold">{k.v}</div>
          </CardContent></Card>
        ))}
      </div>

      <Tabs defaultValue="bills">
        <TabsList>
          <TabsTrigger value="bills">Vendor Bills</TabsTrigger>
        </TabsList>
        <TabsContent value="bills" className="mt-4">
          <Card><CardContent className="p-4">
            <div className="mb-4"><SearchBar value={q} onChange={setQ} placeholder="Search bill, vendor, PO…" /></div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>PO / GRN</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>3-way match</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                ) : filtered.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.bill_no}</TableCell>
                    <TableCell className="font-medium">{b.vendor_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{b.po_number} · {b.grn_number}</TableCell>
                    <TableCell>{fmtDate(b.bill_date)}</TableCell>
                    <TableCell>{matchBadge(b.match_status)}</TableCell>
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                    <TableCell className="text-right">{KES(b.total_amount)}</TableCell>
                    <TableCell className="text-right">{KES(b.total_amount - b.amount_paid)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {b.status.toLowerCase() === "draft" && b.match_status !== "failed" && (
                          <PermissionGate permission="finance.approve">
                            <Button size="sm" variant="outline" disabled={postingId === b.id} onClick={() => void postBill(b)}>
                              {postingId === b.id ? "Posting…" : "Post"}
                            </Button>
                          </PermissionGate>
                        )}
                        {["posted", "partial"].includes(b.status.toLowerCase()) && b.total_amount > b.amount_paid && (
                          <PermissionGate permission="finance.create">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setPayTarget(b);
                                setPayAmount(String(b.total_amount - b.amount_paid));
                                setPayRef("");
                                setPayOpen(true);
                              }}
                            >
                              <CreditCard className="mr-1 h-3 w-3" />
                              Pay
                            </Button>
                          </PermissionGate>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">No vendor bills. Create one from a posted GRN.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create vendor bill from GRN</DialogTitle>
            <DialogDescription>Runs 3-way match against PO quantities/costs and GRN receipt.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Posted GRN</Label>
              <Select value={selectedGrn} onValueChange={setSelectedGrn}>
                <SelectTrigger><SelectValue placeholder="Select GRN" /></SelectTrigger>
                <SelectContent>
                  {grns.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.grn_number} · {g.po_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Vendor invoice ref (optional)</Label>
              <Input value={vendorRef} onChange={(e) => setVendorRef(e.target.value)} placeholder="Supplier invoice #" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => void createBill()} disabled={saving || !selectedGrn}>{saving ? "Creating…" : "Create bill"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record vendor payment</DialogTitle>
            <DialogDescription>{payTarget ? `${payTarget.bill_no} · ${payTarget.vendor_name}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Amount (KES)</Label>
              <Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Payment reference</Label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Bank ref / cheque #" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitPayment()} disabled={saving}>{saving ? "Saving…" : "Record payment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
