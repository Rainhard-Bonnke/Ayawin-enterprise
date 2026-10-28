import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  createSalesInvoice,
  downloadInvoicePdf,
  downloadReceiptPdf,
  fetchCustomers,
  fetchMasterItems,
  fetchSalesInvoices,
  previewSalesTax,
  paySalesInvoice,
  postSalesInvoice,
  verifyInvoiceDocument,
  type BackendCustomer,
  type BackendInvoice,
  type BackendMasterItem,
} from "@/lib/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { KES, fmtDate } from "@/lib/format";
import { SearchBar } from "@/components/SearchBar";
import { StatusBadge } from "@/components/StatusBadge";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { notify, triggerEmailNotification } from "@/lib/notifications";
import { invoiceRisk } from "@/lib/smartSignals";
import { exportWorkbook } from "@/lib/excel";
import { trackEvent } from "@/lib/event-tracker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Mail, Printer, FileDown, ArrowUpDown, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportVerificationCertificatePdf } from "@/lib/pdf";

export const Route = createFileRoute("/_app/invoices")({
  component: InvoicesPage,
  head: () => ({ meta: [{ title: "Invoicing — Ayawin Stock Solution" }] }),
});

type InvoiceLineForm = { item_id: string; quantity: string; unit_price: string };

const today = () => new Date().toISOString().slice(0, 10);
const dueInDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const emptyLine = (): InvoiceLineForm => ({ item_id: "", quantity: "1", unit_price: "" });

function InvoicesPage() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<BackendInvoice[]>([]);
  const rowsRef = useRef<BackendInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [preview, setPreview] = useState<BackendInvoice | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifyHashInput, setVerifyHashInput] = useState("");
  const [verifyResult, setVerifyResult] = useState<null | {
    hash: string;
    valid?: boolean;
    url: string;
  }>(null);
  const [customers, setCustomers] = useState<BackendCustomer[]>([]);
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [draftTaxPreview, setDraftTaxPreview] = useState<{ subtotal: number; tax_amount: number; total_amount: number } | null>(null);
  const [draftTaxLoading, setDraftTaxLoading] = useState(false);
  const cacheKey = `ayawin-invoices-cache:${user?.id || user?.email || "default"}`;
  const [form, setForm] = useState({
    customer_id: "",
    invoice_date: today(),
    due_date: dueInDays(30),
    lines: [emptyLine()] as InvoiceLineForm[],
  });

  const loadInvoices = useCallback(async () => {
    if (!token) return;
    if (!rowsRef.current.length) setLoading(true);
    try {
      const data = await fetchSalesInvoices(token);
      rowsRef.current = data ?? [];
      setRows(data ?? []);
      sessionStorage.setItem(cacheKey, JSON.stringify(data ?? []));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load invoices");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, cacheKey]);

  useEffect(() => {
    rowsRef.current = [];
    setRows([]);
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as BackendInvoice[];
        if (Array.isArray(parsed) && parsed.length) {
          rowsRef.current = parsed;
          setRows(parsed);
          setLoading(false);
        }
      }
    } catch {
      sessionStorage.removeItem(cacheKey);
    }
    void loadInvoices();
  }, [cacheKey, loadInvoices]);

  useEffect(() => {
    if (!token) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void loadInvoices();
    }, 60000);
    return () => window.clearInterval(id);
  }, [token, loadInvoices]);

  useEffect(() => {
    setVerifyHashInput("");
    setVerifyResult(null);
  }, [preview?.id]);

  useEffect(() => {
    if (!createOpen || !token) { setDraftTaxPreview(null); setDraftTaxLoading(false); return; }
    const lines = form.lines.filter((line) => line.item_id && Number(line.quantity) > 0)
      .map((line) => ({ item_id: line.item_id, quantity: Number(line.quantity), unit_price: Number(line.unit_price || 0) }));
    if (!lines.length) { setDraftTaxPreview(null); setDraftTaxLoading(false); return; }
    let active = true;
    setDraftTaxLoading(true);
    void previewSalesTax(token, lines, form.invoice_date)
      .then((result) => { if (active) setDraftTaxPreview({ subtotal: result.subtotal, tax_amount: result.tax_amount, total_amount: result.total_amount }); })
      .catch((error) => { if (active) { setDraftTaxPreview(null); toast.error(error instanceof Error ? error.message : "Could not calculate invoice tax"); } })
      .finally(() => { if (active) setDraftTaxLoading(false); });
    return () => { active = false; };
  }, [createOpen, form.invoice_date, form.lines, token]);

  const openCreate = async () => {
    if (!token) return;
    try {
      const [cust, catalog] = await Promise.all([fetchCustomers(token), fetchMasterItems(token)]);
      setCustomers(cust);
      setItems(catalog);
      setForm({
        customer_id: cust[0]?.id?.toString() || "",
        invoice_date: today(),
        due_date: dueInDays(30),
        lines: [
          {
            item_id: catalog[0]?.id || "",
            quantity: "1",
            unit_price: String(catalog[0]?.standard_cost || ""),
          },
        ],
      });
      setCreateOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load customers or products");
    }
  };

  const submitInvoice = async () => {
    if (!token || !form.customer_id) {
      toast.error("Select a customer");
      return;
    }
    const lines = form.lines
      .filter((l) => l.item_id && Number(l.quantity) > 0)
      .map((l) => ({
        item_id: l.item_id,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price) || 0,
      }));
    if (!lines.length) {
      toast.error("Add at least one line with quantity");
      return;
    }
    setSaving(true);
    try {
      const result = await createSalesInvoice(token, {
        customer_id: String(form.customer_id),
        invoice_date: form.invoice_date,
        due_date: form.due_date,
        lines,
      });
      toast.success("Invoice created and posted");
      if (result.gl_warning) toast.warning(result.gl_warning);
      setCreateOpen(false);
      setPage(1);
      setQ("");
      await loadInvoices();
      void trackEvent({
        action: "invoice_created",
        entityType: "invoice",
        entityId: "new",
        details: { customer_id: form.customer_id, lines: lines.length },
        scenario: "invoice",
        context: form,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create invoice");
    } finally {
      setSaving(false);
    }
  };

  const filtered = rows
    .filter(
      (i) =>
        i.id.toLowerCase().includes(q.toLowerCase()) ||
        i.customer.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === "total") return b.total - a.total;
      if (sort === "status") return a.status.localeCompare(b.status);
      return b.date.localeCompare(a.date);
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totals = useMemo(
    () => ({
      sent: rows.filter((i) => i.status === "Sent").reduce((s, i) => s + i.total, 0),
      paid: rows.filter((i) => i.status === "Paid").reduce((s, i) => s + i.total, 0),
      overdue: rows.filter((i) => i.status === "Overdue").reduce((s, i) => s + i.total, 0),
      excise: rows.reduce((s, i) => s + i.excise, 0),
    }),
    [rows],
  );

  const draftSubtotal = form.lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0);
  const draftPreview = draftTaxPreview || { subtotal: draftSubtotal, tax_amount: 0, total_amount: draftSubtotal };

  const exportInvoices = () => {
    void trackEvent({
      action: "invoice_export_xlsx",
      entityType: "report",
      entityId: "invoices",
      details: { rows: filtered.length },
      scenario: "invoice",
      context: { q, sort, rows: filtered.length },
    });
    exportWorkbook("ayawin-stock-solution-invoices.xlsx", [
      {
        name: "Invoices",
        rows: filtered.map((i) => ({
          "Invoice #": i.id,
          "ETR / TIMS": i.etr,
          Customer: i.customer,
          "KRA PIN": i.kraPin,
          Date: fmtDate(i.date),
          Due: fmtDate(i.due),
          Excise: i.excise,
          VAT: i.vat,
          Total: i.total,
          Status: i.status,
        })),
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Invoicing & Billing"
        description="Invoices use each item’s configured tax treatment and post receivables and applicable output VAT to the ledger. eTIMS submission is not configured."
        actions={
          <>
            <Button variant="outline" onClick={exportInvoices}>
              <FileDown className="mr-2 h-4 w-4" />
              Export XLSX
            </Button>
            <Button onClick={() => void openCreate()}>
              <Plus className="mr-2 h-4 w-4" />
              New Invoice
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Sent / Awaiting", v: KES(totals.sent) },
          { l: "Paid (MTD)", v: KES(totals.paid) },
          { l: "Overdue", v: KES(totals.overdue), warn: true },
          { l: "Excise Duty (MTD)", v: KES(totals.excise) },
        ].map((k) => (
          <Card key={k.l}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
              <div className={`mt-1 text-2xl font-bold ${k.warn ? "text-destructive" : ""}`}>
                {k.v}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <QuietNote
        scenario="invoice"
        contextKey={`${q}-${sort}`}
        context={{ q, sort, invoices: paged, preview }}
        className="mb-4"
      />

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center gap-3">
            <SearchBar
              value={q}
              onChange={(value) => {
                setQ(value);
                setPage(1);
              }}
              placeholder="Invoice # or customer..."
            />
            <div className="ml-auto">
              <Select
                value={sort}
                onValueChange={(value) => {
                  setSort(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-44">
                  <ArrowUpDown className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Sort by date</SelectItem>
                  <SelectItem value="total">Highest total</SelectItem>
                  <SelectItem value="status">Sort by status</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>ETR / TIMS</TableHead>
                <TableHead>Customer (KRA PIN)</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Excise</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !rows.length ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center">
                    <div className="mx-auto flex max-w-xs items-center justify-center gap-2 text-sm text-muted-foreground">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-primary" />
                      Loading your latest invoices…
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((i) => {
                  const risk = invoiceRisk(i.customer);
                  return (
                    <TableRow
                      key={i.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setPreview(i)}
                    >
                      <TableCell className="font-mono text-xs font-medium">{i.id}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {i.etr}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{i.customer}</div>
                        <div className="text-xs text-muted-foreground">{i.kraPin || "—"}</div>
                      </TableCell>
                      <TableCell>{fmtDate(i.date)}</TableCell>
                      <TableCell>{fmtDate(i.due)}</TableCell>
                      <TableCell className="text-right text-xs">{KES(i.excise)}</TableCell>
                      <TableCell className="text-right text-xs">{KES(i.vat)}</TableCell>
                      <TableCell className="text-right font-semibold">{KES(i.total)}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <StatusBadge status={i.status} />
                          <div
                            className={`text-[10px] ${risk.tone === "warning" ? "text-warning" : "text-muted-foreground"}`}
                          >
                            {risk.label}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
              {!loading && paged.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No invoices yet. Click New Invoice to create one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <ListPagination
            page={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New tax invoice</DialogTitle>
            <DialogDescription>
              Creates a draft invoice, posts it, and records AR in the ledger.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Select
                value={form.customer_id}
                onValueChange={(v) => setForm((p) => ({ ...p, customer_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name} {c.kra_pin ? `(${c.kra_pin})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Invoice date</Label>
                <Input
                  type="date"
                  value={form.invoice_date}
                  onChange={(e) => setForm((p) => ({ ...p, invoice_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line items</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setForm((p) => ({ ...p, lines: [...p.lines, emptyLine()] }))}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add line
                </Button>
              </div>
              {form.lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-6 space-y-1">
                    {idx === 0 && <span className="text-xs text-muted-foreground">Product</span>}
                    <Select
                      value={line.item_id}
                      onValueChange={(v) => {
                        const item = items.find((i) => i.id === v);
                        setForm((p) => ({
                          ...p,
                          lines: p.lines.map((row, i) =>
                            i === idx
                              ? {
                                  ...row,
                                  item_id: v,
                                  unit_price: row.unit_price || String(item?.standard_cost || ""),
                                }
                              : row,
                          ),
                        }));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Item" />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.item_code} — {i.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    {idx === 0 && <span className="text-xs text-muted-foreground">Qty</span>}
                    <Input
                      type="number"
                      min={0.01}
                      step="any"
                      value={line.quantity}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          lines: p.lines.map((row, i) =>
                            i === idx ? { ...row, quantity: e.target.value } : row,
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="col-span-3 space-y-1">
                    {idx === 0 && <span className="text-xs text-muted-foreground">Unit price</span>}
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      value={line.unit_price}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          lines: p.lines.map((row, i) =>
                            i === idx ? { ...row, unit_price: e.target.value } : row,
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="col-span-1">
                    {form.lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        onClick={() =>
                          setForm((p) => ({ ...p, lines: p.lines.filter((_, i) => i !== idx) }))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{KES(draftPreview.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>{draftTaxLoading ? "Calculating tax…" : "Tax"}</span>
                <span>{KES(draftPreview.tax_amount)}</span>
              </div>
              <div className="mt-1 flex justify-between font-semibold">
                <span>Total</span>
                <span>{KES(draftPreview.total_amount)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitInvoice} disabled={saving || draftTaxLoading || !draftTaxPreview || !customers.length || !items.length}>
              {saving ? "Creating…" : "Create & post invoice"}
            </Button>
          </DialogFooter>
          {(!customers.length || !items.length) && (
            <p className="text-xs text-muted-foreground">
              Add customers (CRM) and products (Master Data) before creating invoices.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle>Tax Invoice — {preview.id}</DialogTitle>
              </DialogHeader>
              <div className="printable rounded-md border border-border bg-white p-6 text-sm text-foreground">
                <div className="flex items-start justify-between border-b border-border pb-4">
                  <div>
                    <div className="text-xl font-bold">Ayawin Stock Solution</div>
                    <div className="text-xs text-muted-foreground">Nairobi, Kenya</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold">TAX INVOICE</div>
                    <div className="font-mono text-xs">{preview.id}</div>
                    <div className="text-xs text-muted-foreground">ETR: {preview.etr}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-muted-foreground">Bill To</div>
                    <div className="font-semibold">{preview.customer}</div>
                    <div className="text-muted-foreground">KRA PIN: {preview.kraPin || "—"}</div>
                  </div>
                  <div className="text-right">
                    <div>
                      <span className="text-muted-foreground">Invoice Date:</span>{" "}
                      {fmtDate(preview.date)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Due Date:</span>{" "}
                      {fmtDate(preview.due)}
                    </div>
                  </div>
                </div>
                <div className="mt-4 ml-auto w-64 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{KES(preview.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Excise Duty</span>
                    <span>{KES(preview.excise)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tax</span>
                    <span>{KES(preview.vat)}</span>
                  </div>
                  <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-bold">
                    <span>Total</span>
                    <span>{KES(preview.total)}</span>
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
                <div className="mb-2 font-medium">Document verification</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={verifyHashInput}
                    onChange={(e) => setVerifyHashInput(e.target.value)}
                    placeholder="Paste verification hash (optional)"
                    className="max-w-xl"
                  />
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        const result = await verifyInvoiceDocument(
                          token,
                          preview.id,
                          verifyHashInput.trim() || undefined,
                        );
                        const base = window.location.origin;
                        const url = `${base}/api/v1/sales/invoices/${encodeURIComponent(preview.id)}/verify?hash=${encodeURIComponent(result.verification_hash)}`;
                        setVerifyResult({
                          hash: result.verification_hash,
                          valid: result.valid,
                          url,
                        });
                        if (typeof result.valid === "boolean") {
                          notify(`Verification ${result.valid ? "passed" : "failed"}`, preview.id);
                        } else {
                          notify("Reference hash loaded", preview.id);
                        }
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not verify document");
                      }
                    }}
                  >
                    Verify Document
                  </Button>
                </div>
                {verifyResult && (
                  <div className="mt-2 space-y-1">
                    <div className="font-mono break-all">Server hash: {verifyResult.hash}</div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(verifyResult.hash);
                            notify("Server hash copied", preview.id);
                          } catch {
                            toast.error("Could not copy hash");
                          }
                        }}
                      >
                        Copy server hash
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          window.open(verifyResult.url, "_blank", "noopener,noreferrer");
                        }}
                      >
                        Open verification URL
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const status =
                            typeof verifyResult.valid === "boolean"
                              ? verifyResult.valid
                                ? "valid"
                                : "invalid"
                              : "reference-only";
                          exportVerificationCertificatePdf(`verification-${preview.id}.pdf`, {
                            invoiceNo: preview.id,
                            serverHash: verifyResult.hash,
                            verificationUrl: verifyResult.url,
                            validationStatus: status,
                            generatedAt: new Date().toISOString(),
                            verifiedBy: "Current signed-in user",
                          });
                          notify(`Verification certificate downloaded`, preview.id);
                        }}
                      >
                        Download verification certificate
                      </Button>
                    </div>
                    {typeof verifyResult.valid === "boolean" && (
                      <div className={verifyResult.valid ? "text-emerald-700" : "text-destructive"}>
                        Result: {verifyResult.valid ? "Valid document hash" : "Hash mismatch"}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print
                </Button>
                {preview.status === "Draft" && (
                  <Button
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await postSalesInvoice(token, preview.id);
                        toast.success(`Invoice ${preview.id} posted to the ledger`);
                        await loadInvoices();
                        setPreview(null);
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Invoice could not be posted");
                      }
                    }}
                  >Post invoice</Button>
                )}
                {preview.status !== "Draft" && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await downloadInvoicePdf(token, preview.id);
                        notify(`Invoice ${preview.id} downloaded`, "PDF saved");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not generate PDF");
                      }
                    }}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    Download PDF
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={async () => {
                    notify(
                      `Invoice ${preview.id} queued for email`,
                      "An export trigger has been recorded.",
                    );
                    void trackEvent({
                      action: "invoice_email_requested",
                      entityType: "invoice",
                      entityId: preview.id,
                      details: { customer: preview.customer, etr: preview.etr },
                      scenario: "invoice",
                      context: {
                        customer: preview.customer,
                        due: preview.due,
                        total: preview.total,
                      },
                    });
                    await triggerEmailNotification({
                      recipient: preview.customer,
                      subject: `Invoice ${preview.id}`,
                      message: `Please find attached invoice ${preview.id}.`,
                    });
                  }}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Email to customer
                </Button>
                {preview.status !== "Draft" &&
                  preview.status !== "Paid" &&
                  preview.status !== "Cancelled" && (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        if (!token) return;
                        try {
                          await paySalesInvoice(token, preview.id, {
                            amount: preview.total,
                            payment_date: new Date().toISOString().slice(0, 10),
                            reference_no: preview.etr || undefined,
                            notes: "Paid in full from invoice screen",
                          });
                          notify(`Payment posted for ${preview.id}`, "Invoice marked as paid");
                          await loadInvoices();
                          setPreview(null);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Could not post payment");
                        }
                      }}
                    >
                      Mark Paid
                    </Button>
                  )}
                {preview.status === "Paid" && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await downloadReceiptPdf(token, preview.id);
                        notify(`Receipt for ${preview.id} downloaded`, "PDF saved");
                      } catch (e) {
                        toast.error(
                          e instanceof Error ? e.message : "Could not generate receipt PDF",
                        );
                      }
                    }}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    Download Receipt
                  </Button>
                )}
                <Button onClick={exportInvoices}>
                  <FileDown className="mr-2 h-4 w-4" />
                  Download XLSX
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
