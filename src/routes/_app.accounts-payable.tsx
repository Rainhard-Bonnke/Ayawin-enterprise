import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight, FilePlus2, RefreshCw, WalletCards } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { KES } from "@/lib/format";
import {
  createSupplierBill,
  createSupplierPayment,
  fetchChartOfAccounts,
  fetchGoodsReceiptDetail,
  fetchGoodsReceipts,
  fetchSupplierBills,
  fetchSupplierPayments,
  fetchSuppliers,
  postSupplierBill,
  postSupplierPayment,
  type BackendSupplier,
  type BackendGoodsReceipt,
  type BackendGoodsReceiptDetail,
  type SupplierBill,
} from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/accounts-payable")({
  component: AccountsPayablePage,
  head: () => ({ meta: [{ title: "Accounts Payable - Ayawin Stock Solution" }] }),
});

type BillLine = {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  account_id: string;
  goods_receipt_line_id?: string;
};

function AccountsPayablePage() {
  const { token } = useAuth();
  const [bills, setBills] = useState<SupplierBill[]>([]);
  const [payments, setPayments] = useState<Array<Record<string, unknown>>>([]);
  const [suppliers, setSuppliers] = useState<BackendSupplier[]>([]);
  const [receipts, setReceipts] = useState<BackendGoodsReceipt[]>([]);
  const [receiptDetail, setReceiptDetail] = useState<BackendGoodsReceiptDetail | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [accounts, setAccounts] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [billReceiptId, setBillReceiptId] = useState("");
  const [paymentVendorId, setPaymentVendorId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentAllocations, setPaymentAllocations] = useState<Record<string, number>>({});
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<BillLine[]>([
    { description: "", quantity: 1, unit_price: 0, tax_rate: 0, account_id: "" },
  ]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [billRows, supplierRows, accountRows, paymentRows, receiptRows] = await Promise.all([
        fetchSupplierBills(token),
        fetchSuppliers(token),
        fetchChartOfAccounts(token),
        fetchSupplierPayments(token),
        fetchGoodsReceipts(token),
      ]);
      setBills(billRows);
      setPayments(paymentRows);
      setSuppliers(supplierRows);
      setReceipts(receiptRows);
      setAccounts(
        accountRows.filter(
          (account) =>
            account.is_postable && ["expense", "asset"].includes(String(account.account_type)),
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load supplier payables");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () =>
      bills.reduce(
        (sum, bill) => ({
          outstanding:
            sum.outstanding +
            (["posted", "partial", "overdue"].includes(bill.status)
              ? Number(bill.balance_due || 0)
              : 0),
          overdue:
            sum.overdue + (Number(bill.days_overdue || 0) > 0 ? Number(bill.balance_due || 0) : 0),
          dueSoon:
            sum.dueSoon +
            (Number(bill.days_overdue || 0) === 0 &&
            bill.status !== "paid" &&
            bill.status !== "draft"
              ? Number(bill.balance_due || 0)
              : 0),
        }),
        { outstanding: 0, overdue: 0, dueSoon: 0 },
      ),
    [bills],
  );

  const setLine = (index: number, patch: Partial<BillLine>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const addLine = () =>
    setLines((current) => [
      ...current,
      { description: "", quantity: 1, unit_price: 0, tax_rate: 0, account_id: "" },
    ]);

  const selectReceipt = async (receiptId: string) => {
    setBillReceiptId(receiptId);
    setReceiptDetail(null);
    if (!receiptId || !token) {
      setLines([{ description: "", quantity: 1, unit_price: 0, tax_rate: 0, account_id: "" }]);
      return;
    }
    setReceiptLoading(true);
    try {
      const detail = await fetchGoodsReceiptDetail(token, receiptId);
      const inventoryAccount = accounts.find((account) => String(account.account_code) === "1300");
      const fallbackAccount = inventoryAccount || accounts.find((account) => account.account_type === "asset");
      if (!fallbackAccount) throw new Error("Add an active inventory asset account before matching a stock bill");
      const openLines = detail.lines.filter((line) => Number(line.unbilled_quantity) > 0.00005);
      setReceiptDetail(detail);
      setVendorId(detail.vendor_id);
      setLines(openLines.map((line) => ({
        description: `${line.item_code} · ${line.item_name}`,
        quantity: Number(line.unbilled_quantity),
        unit_price: Number(line.unit_price),
        tax_rate: 0,
        account_id: String(fallbackAccount.id),
        goods_receipt_line_id: line.goods_receipt_line_id,
      })));
      if (!openLines.length) toast.info("Every line on this receipt has already been billed");
    } catch (error) {
      setBillReceiptId("");
      setReceiptDetail(null);
      toast.error(error instanceof Error ? error.message : "Unable to load receipt lines");
    } finally {
      setReceiptLoading(false);
    }
  };

  const submitBill = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    try {
      await createSupplierBill(token, {
        vendor_id: vendorId,
        supplier_invoice_no: supplierInvoiceNo,
        bill_date: billDate,
        due_date: dueDate,
        ...(receiptDetail ? {
          purchase_order_id: receiptDetail.purchase_order_id,
          goods_receipt_id: receiptDetail.id,
        } : {}),
        lines,
      });
      toast.success("Supplier bill saved as draft");
      setShowForm(false);
      setSupplierInvoiceNo("");
      setBillReceiptId("");
      setReceiptDetail(null);
      setLines([{ description: "", quantity: 1, unit_price: 0, tax_rate: 0, account_id: "" }]);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save supplier bill");
    } finally {
      setSaving(false);
    }
  };

  const postBill = async (bill: SupplierBill) => {
    if (!token) return;
    try {
      await postSupplierBill(token, bill.id);
      toast.success(`Bill ${bill.bill_no} posted to the General Ledger`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to post supplier bill");
    }
  };

  const supplierBills = bills.filter(
    (bill) =>
      bill.vendor_id === paymentVendorId &&
      ["posted", "partial", "overdue"].includes(bill.status) &&
      Number(bill.balance_due) > 0,
  );
  const paymentAmount = Object.values(paymentAllocations).reduce(
    (sum, amount) => sum + Number(amount || 0),
    0,
  );

  const savePayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    try {
      const draft = await createSupplierPayment(token, {
        vendor_id: paymentVendorId,
        bank_account_id: bankAccountId,
        payment_date: paymentDate,
        payment_method: "bank",
        reference_no: paymentReference,
        allocations: Object.entries(paymentAllocations)
          .filter(([, amount]) => amount > 0)
          .map(([bill_id, amount]) => ({ bill_id, amount })),
      });
      toast.success(`Payment draft ${draft.payment_no} created. Review it below, then post it.`);
      setShowPaymentForm(false);
      setPaymentAllocations({});
      setPaymentReference("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create supplier payment");
    } finally {
      setSaving(false);
    }
  };

  const postPayment = async (payment: Record<string, unknown>) => {
    if (!token) return;
    try {
      await postSupplierPayment(token, String(payment.id));
      toast.success(`Payment ${String(payment.payment_no)} posted to the General Ledger`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to post supplier payment");
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Accounts payable"
        description="Supplier invoices, due dates, balances and posting to the General Ledger."
        actions={
          <>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={() => setShowForm((value) => !value)}>
              <FilePlus2 className="mr-2 h-4 w-4" />
              New supplier bill
            </Button>
            <Button variant="outline" onClick={() => setShowPaymentForm((value) => !value)}>
              <WalletCards className="mr-2 h-4 w-4" />
              Record payment
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Outstanding", totals.outstanding, "All unpaid supplier invoices"],
          ["Overdue", totals.overdue, "Past due date"],
          [
            "Open bills",
            bills.filter((bill) => !["paid", "cancelled", "draft"].includes(bill.status)).length,
            "Posted and part-paid",
          ],
        ].map(([label, value, hint]) => (
          <Card
            key={String(label)}
            className="rounded-2xl border-border/70 bg-background/70 shadow-sm"
          >
            <CardContent className="p-5">
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">
                {label === "Open bills" ? value : KES(Number(value))}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {showPaymentForm && (
        <Card className="rounded-2xl border-primary/20 shadow-sm">
          <CardContent className="p-5">
            <form className="space-y-4" onSubmit={savePayment}>
              <div>
                <h2 className="font-semibold">Prepare supplier payment</h2>
                <p className="text-sm text-muted-foreground">
                  Allocate the payment to posted bills. Posting creates the bank and payable journal
                  and updates bill balances.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Supplier</Label>
                  <select
                    required
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={paymentVendorId}
                    onChange={(e) => {
                      setPaymentVendorId(e.target.value);
                      setPaymentAllocations({});
                    }}
                  >
                    <option value="">Choose supplier</option>
                    {suppliers.map((supplier) => (
                      <option key={String(supplier.id)} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Pay from</Label>
                  <select
                    required
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                  >
                    <option value="">Choose bank or cash account</option>
                    {accounts
                      .filter(
                        (account) =>
                          account.account_type === "asset" &&
                          String(account.account_code).startsWith("11"),
                      )
                      .map((account) => (
                        <option key={String(account.id)} value={String(account.id)}>
                          {String(account.account_code)} · {String(account.account_name)}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Payment date</Label>
                  <Input
                    required
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Bank reference</Label>
                  <Input
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                {supplierBills.map((bill) => (
                  <div
                    key={bill.id}
                    className="grid items-center gap-2 rounded-lg border border-border/70 p-3 sm:grid-cols-[1fr_auto_auto]"
                  >
                    <div className="text-sm">
                      <span className="font-medium">{bill.supplier_invoice_no}</span>
                      <span className="ml-2 text-muted-foreground">
                        Due {String(bill.due_date).slice(0, 10)}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Balance {KES(Number(bill.balance_due))}
                    </div>
                    <Input
                      aria-label={`Amount allocated to ${bill.supplier_invoice_no}`}
                      className="sm:w-40"
                      type="number"
                      min="0"
                      max={bill.balance_due}
                      step="0.01"
                      value={paymentAllocations[bill.id] || ""}
                      onChange={(e) =>
                        setPaymentAllocations((current) => ({
                          ...current,
                          [bill.id]: Number(e.target.value),
                        }))
                      }
                      placeholder="Allocate amount"
                    />
                  </div>
                ))}
                {paymentVendorId && supplierBills.length === 0 && (
                  <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                    This supplier has no posted bills with an outstanding balance.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="ghost" onClick={() => setShowPaymentForm(false)}>
                  Cancel
                </Button>
                <div className="text-right text-sm">
                  Payment total <span className="ml-2 font-semibold">{KES(paymentAmount)}</span>
                </div>
                <Button
                  type="submit"
                  disabled={saving || paymentAmount <= 0 || !supplierBills.length}
                >
                  {saving ? "Saving…" : "Create payment draft"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card className="rounded-2xl border-primary/20 shadow-sm">
          <CardContent className="p-5">
            <form className="space-y-5" onSubmit={submitBill}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">Record supplier invoice</h2>
                  <p className="text-sm text-muted-foreground">
                    Save the source invoice, then post it after checking amounts and accounts.
                  </p>
                </div>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                  Close
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Supplier</Label>
                  <select
                    required
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={vendorId}
                    disabled={Boolean(receiptDetail)}
                    onChange={(e) => {
                      setVendorId(e.target.value);
                      if (billReceiptId) void selectReceipt("");
                    }}
                  >
                    <option value="">Choose supplier</option>
                    {suppliers.map((supplier) => (
                      <option key={String(supplier.id)} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2 sm:col-span-2 lg:col-span-4">
                  <Label>Match received stock (optional)</Label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={billReceiptId}
                    onChange={(e) => void selectReceipt(e.target.value)}
                    disabled={receiptLoading || !vendorId}
                  >
                    <option value="">General expense or service bill</option>
                    {receipts.filter((receipt) => receipt.status === "posted" && receipt.vendor_id === vendorId).map((receipt) => (
                      <option key={receipt.id} value={receipt.id}>
                        {receipt.grn_number} · PO {receipt.po_number} · {receipt.receipt_date}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Select the posted GRN for stock purchases. Received quantities and approved prices are loaded for matching; enter the VAT rate shown on the supplier invoice for accountant review.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Supplier invoice number</Label>
                  <Input
                    required
                    value={supplierInvoiceNo}
                    onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Invoice date</Label>
                  <Input
                    required
                    type="date"
                    value={billDate}
                    onChange={(e) => setBillDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Due date</Label>
                  <Input
                    required
                    type="date"
                    min={billDate}
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-3">
                {lines.map((line, index) => (
                  <div
                    key={index}
                    className="grid gap-3 rounded-xl border border-border/70 p-3 sm:grid-cols-2 lg:grid-cols-6"
                  >
                    <div className="space-y-1 lg:col-span-2">
                      <Label>Description{line.goods_receipt_line_id ? " · received item" : ""}</Label>
                      <Input
                        required
                        value={line.description}
                        readOnly={Boolean(line.goods_receipt_line_id)}
                        onChange={(e) => setLine(index, { description: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Quantity</Label>
                      <Input
                        required
                        min="0.0001"
                        max={line.goods_receipt_line_id ? receiptDetail?.lines.find((source) => source.goods_receipt_line_id === line.goods_receipt_line_id)?.unbilled_quantity : undefined}
                        type="number"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => setLine(index, { quantity: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Unit price (KES)</Label>
                      <Input
                        required
                        min="0"
                        type="number"
                        step="0.01"
                        value={line.unit_price}
                        readOnly={Boolean(line.goods_receipt_line_id)}
                        onChange={(e) => setLine(index, { unit_price: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>VAT rate %</Label>
                      <Input
                        min="0"
                        max="100"
                        type="number"
                        step="0.01"
                        value={line.tax_rate}
                        onChange={(e) => setLine(index, { tax_rate: Number(e.target.value) })}
                      />
                    </div>
                    {!line.goods_receipt_line_id && <div className="space-y-1">
                      <Label>Expense or asset</Label>
                      <select
                        required
                        className="h-10 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={line.account_id}
                        onChange={(e) => setLine(index, { account_id: e.target.value })}
                      >
                        <option value="">Choose account</option>
                        {accounts.map((account) => (
                          <option key={String(account.id)} value={String(account.id)}>
                            {String(account.account_code)} · {String(account.account_name)}
                          </option>
                        ))}
                      </select>
                    </div>}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="button" variant="outline" onClick={addLine} disabled={Boolean(receiptDetail) || receiptLoading}>
                  Add bill line
                </Button>
                <div className="text-right text-sm">
                  Gross total{" "}
                  <span className="ml-2 font-semibold">
                    {KES(
                      lines.reduce(
                        (total, line) =>
                          total + line.quantity * line.unit_price * (1 + line.tax_rate / 100),
                        0,
                      ),
                    )}
                  </span>
                </div>
                <Button type="submit" disabled={saving || receiptLoading || (Boolean(billReceiptId) && (!receiptDetail || !lines.length))}>
                  {saving ? "Saving…" : "Save draft bill"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-border/70 bg-background/70 shadow-sm">
        <CardContent className="p-0">
          {totals.overdue > 0 && (
            <div className="m-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <AlertCircle className="h-4 w-4" />
              Overdue supplier balances need follow-up.
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill / supplier ref</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Invoice date</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((bill) => (
                  <TableRow key={bill.id}>
                    <TableCell>
                      <div className="font-medium">{bill.bill_no}</div>
                      <div className="text-xs text-muted-foreground">
                        {bill.supplier_invoice_no}
                      </div>
                      {bill.grn_number && (
                        <div className="text-xs text-muted-foreground">
                          Matched to {bill.grn_number}{bill.po_number ? ` · PO ${bill.po_number}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{bill.vendor_name}</TableCell>
                    <TableCell>{String(bill.bill_date).slice(0, 10)}</TableCell>
                    <TableCell>
                      <div>{String(bill.due_date).slice(0, 10)}</div>
                      {Number(bill.days_overdue) > 0 && (
                        <div className="text-xs text-destructive">
                          {bill.days_overdue} days overdue
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={bill.display_status || bill.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {KES(Number(bill.total_amount))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {KES(Number(bill.balance_due))}
                    </TableCell>
                    <TableCell className="text-right">
                      {bill.status === "draft" ? (
                        <Button size="sm" variant="outline" onClick={() => void postBill(bill)}>
                          Post <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {bill.journal_id ? "Posted to GL" : "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && bills.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                      No supplier bills recorded. Create a bill to start tracking payables.
                    </TableCell>
                  </TableRow>
                )}
                {loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                      Loading supplier bills…
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/70 bg-background/70 shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-border/70 p-5">
            <h2 className="font-semibold">Supplier payment register</h2>
            <p className="text-sm text-muted-foreground">
              Payment drafts await posting; posted payments link to a GL journal.
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment #</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={String(payment.id)}>
                    <TableCell className="font-medium">{String(payment.payment_no)}</TableCell>
                    <TableCell>{String(payment.vendor_name)}</TableCell>
                    <TableCell>{String(payment.payment_date).slice(0, 10)}</TableCell>
                    <TableCell>{String(payment.reference_no || "—")}</TableCell>
                    <TableCell>
                      <StatusBadge status={String(payment.status)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {KES(Number(payment.amount))}
                    </TableCell>
                    <TableCell className="text-right">
                      {payment.status === "draft" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void postPayment(payment)}
                        >
                          Post <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {String(payment.journal_no || "—")}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!payments.length && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">
                      No supplier payments recorded.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
