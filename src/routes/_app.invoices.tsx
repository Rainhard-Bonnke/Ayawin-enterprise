import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  createCreditNote,
  createSalesInvoice,
  downloadInvoicePdf,
  emailInvoiceToCustomer,
  fetchCreditNotes,
  downloadPaymentReceiptPdf,
  downloadReceiptPdf,
  fetchCustomers,
  fetchMasterItems,
  fetchSalesAnalytics,
  fetchSalesInvoices,
  fetchWarehouses,
  paySalesInvoice,
  submitInvoiceEtims,
  initiateMpesaPayment,
  fetchIntegrationStatus,
  verifyInvoiceDocument,
  type IntegrationStatus,
  type BackendCustomer,
  type BackendInvoice,
  type BackendMasterItem,
} from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribeLiveEvents } from "@/hooks/useLiveEvents";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { toast } from "sonner";
import { KES, fmtDate, VAT_RATE } from "@/lib/format";
import { SearchBar } from "@/components/SearchBar";
import { StatusBadge } from "@/components/StatusBadge";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notify, triggerEmailNotification } from "@/lib/notifications";
import { invoiceRiskFromStatus } from "@/lib/smartSignals";
import { exportWorkbook } from "@/lib/excel";
import { trackEvent } from "@/lib/event-tracker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Mail, Printer, FileDown, ArrowUpDown, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportVerificationCertificatePdf } from "@/lib/pdf";
import { PermissionGate } from "@/components/PermissionGate";
import { DetailNav } from "@/components/DetailNav";
import { humanizeError } from "@/lib/humanizeError";

export const Route = createFileRoute("/_app/invoices")({
  component: InvoicesPage,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  head: () => ({ meta: [{ title: "Invoicing — Ayawin Stock Solutions ERP" }] }),
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
  const { token } = useAuth();
  const { q: searchQ } = Route.useSearch();
  const [rows, setRows] = useState<BackendInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(searchQ || "");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [invoiceStats, setInvoiceStats] = useState<Array<{ status: string; total: number }>>([]);
  const pageSize = 25;
  const [preview, setPreview] = useState<BackendInvoice | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifyHashInput, setVerifyHashInput] = useState("");
  const [verifyResult, setVerifyResult] = useState<null | { hash: string; valid?: boolean; url: string }>(null);
  const [customers, setCustomers] = useState<BackendCustomer[]>([]);
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [form, setForm] = useState({
    customer_id: "",
    invoice_type: "tax" as "tax" | "proforma",
    invoice_date: today(),
    due_date: dueInDays(30),
    lines: [emptyLine()] as InvoiceLineForm[],
  });
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditNotes, setCreditNotes] = useState<Array<Record<string, unknown>>>([]);
  const [creditForm, setCreditForm] = useState({
    customer_id: "",
    invoice_id: "",
    reason: "",
    item_id: "",
    quantity: "1",
    unit_price: "",
    warehouse_id: "",
  });
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);

  useEffect(() => {
    if (searchQ) setQ(searchQ);
  }, [searchQ]);

  const loadInvoices = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const { rows, total } = await fetchSalesInvoices(token, {
        page,
        limit: pageSize,
        q: q.trim() || undefined,
      });
      setRows(rows ?? []);
      setListTotal(total);
    } catch (err) {
      toast.error(humanizeError(err, "Unable to load invoices"));
      setRows([]);
      setListTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token, page, pageSize, q]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    if (!token) return;
    void fetchSalesAnalytics(token)
      .then((data) => {
        const rows = (data?.invoices_by_status as Array<{ status: string; total: number }>) ?? [];
        setInvoiceStats(rows);
      })
      .catch(() => setInvoiceStats([]));
    void fetchIntegrationStatus(token)
      .then(setIntegrations)
      .catch(() => setIntegrations(null));
  }, [token, loading]);

  useRealtimeSync(() => void loadInvoices(), { enabled: Boolean(token) });

  useEffect(() => {
    return subscribeLiveEvents((ev) => {
      if (ev.type === "invoice.updated" || ev.type === "payment.received") {
        void loadInvoices();
      }
    });
  }, [loadInvoices]);

  useEffect(() => {
    if (!token) return;
    void fetchCreditNotes(token)
      .then(setCreditNotes)
      .catch(() => setCreditNotes([]));
  }, [token, loading]);

  useEffect(() => {
    setVerifyHashInput("");
    setVerifyResult(null);
  }, [preview?.id]);

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
        lines: [{ item_id: catalog[0]?.id || "", quantity: "1", unit_price: String(catalog[0]?.standard_cost || "") }],
      });
      setCreateOpen(true);
    } catch (err) {
      toast.error(humanizeError(err, "Could not load customers or products"));
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
        invoice_type: form.invoice_type,
        lines,
      });
      toast.success(form.invoice_type === "proforma" ? "Proforma created (no GL posting)" : "Tax invoice created and posted");
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
      toast.error(humanizeError(err, "Could not create invoice"));
    } finally {
      setSaving(false);
    }
  };

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sort === "total") return b.total - a.total;
      if (sort === "status") return a.status.localeCompare(b.status);
      return b.date.localeCompare(a.date);
    });
  }, [rows, sort]);
  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const paged = sorted;
  const totals = useMemo(() => {
    const sumStatuses = (statuses: string[]) =>
      invoiceStats
        .filter((r) => statuses.includes(String(r.status).toLowerCase()))
        .reduce((s, r) => s + Number(r.total || 0), 0);
    return {
      sent: sumStatuses(["posted", "partial"]),
      paid: sumStatuses(["paid"]),
      overdue: sumStatuses(["overdue"]),
      excise: rows.reduce((s, i) => s + i.excise, 0),
    };
  }, [invoiceStats, rows]);

  const draftPreview = useMemo(() => {
    const subtotal = form.lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);
    const vat = Math.round(subtotal * VAT_RATE * 100) / 100;
    return { subtotal, vat, total: subtotal + vat };
  }, [form.lines]);

  const exportInvoices = () => {
    void trackEvent({
      action: "invoice_export_xlsx",
      entityType: "report",
      entityId: "invoices",
      details: { rows: listTotal },
      scenario: "invoice",
      context: { q, sort, rows: listTotal },
    });
    exportWorkbook("ayawin-enterprise-invoices.xlsx", [
      {
        name: "Invoices",
        rows: sorted.map((i) => ({
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
        description="KRA-compliant invoices with auto VAT. New invoices post to the general ledger."
        actions={
          <>
            <Button variant="outline" onClick={exportInvoices}>
              <FileDown className="mr-2 h-4 w-4" />
              Export XLSX
            </Button>
            <Button variant="outline" onClick={() => void openCreate()}>
              <Plus className="mr-2 h-4 w-4" />
              New Invoice
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                if (!token) return;
                const [cust, catalog, whs] = await Promise.all([
                  fetchCustomers(token),
                  fetchMasterItems(token),
                  fetchWarehouses(token),
                ]);
                setCustomers(cust);
                setItems(catalog);
                setCreditForm({
                  customer_id: String(cust[0]?.id ?? ""),
                  invoice_id: "",
                  reason: "",
                  item_id: catalog[0]?.id ?? "",
                  quantity: "1",
                  unit_price: String(catalog[0]?.standard_cost ?? ""),
                  warehouse_id: String(whs[0]?.id ?? ""),
                });
                setCreditOpen(true);
              }}
            >
              Credit note
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
              <div className={`mt-1 text-2xl font-bold ${k.warn ? "text-destructive" : ""}`}>{k.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <QuietNote scenario="invoice" contextKey={`${q}-${sort}`} context={{ q, sort, invoices: paged, preview }} className="mb-4" />

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center gap-3">
            <SearchBar value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Invoice # or customer..." />
            <div className="ml-auto">
              <Select value={sort} onValueChange={(value) => { setSort(value); setPage(1); }}>
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
                <TableHead className="text-right">VAT 16%</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                    Loading invoices…
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((i) => {
                  const risk = invoiceRiskFromStatus(i.status);
                  return (
                    <TableRow key={i.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setPreview(i)}>
                      <TableCell className="font-mono text-xs font-medium">{i.id}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{i.etr}</TableCell>
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
                          <div className={`text-[10px] ${risk.tone === "warning" ? "text-warning" : "text-muted-foreground"}`}>
                            {risk.label}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {i.status === "Paid" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              if (!token) return;
                              try {
                                await downloadReceiptPdf(token, i.id);
                                notify(`Receipt ${i.id}`, "PDF with QR downloaded");
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Receipt PDF failed");
                              }
                            }}
                          >
                            <FileDown className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
              {!loading && paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                    No invoices yet. Click New Invoice to create one.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <ListPagination page={page} totalPages={totalPages} totalItems={listTotal} pageSize={pageSize} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New invoice</DialogTitle>
            <DialogDescription>Tax invoices post to GL and AR. Proforma quotes do not affect the ledger.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Invoice type</Label>
              <Select
                value={form.invoice_type}
                onValueChange={(v) => setForm((p) => ({ ...p, invoice_type: v as "tax" | "proforma" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tax">Tax invoice (posts to ledger)</SelectItem>
                  <SelectItem value="proforma">Proforma (no GL posting)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Select value={form.customer_id} onValueChange={(v) => setForm((p) => ({ ...p, customer_id: v }))}>
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
                <Input type="date" value={form.invoice_date} onChange={(e) => setForm((p) => ({ ...p, invoice_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input type="date" value={form.due_date} onChange={(e) => setForm((p) => ({ ...p, due_date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line items</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setForm((p) => ({ ...p, lines: [...p.lines, emptyLine()] }))}>
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
                            i === idx ? { ...row, item_id: v, unit_price: row.unit_price || String(item?.standard_cost || "") } : row,
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
                          lines: p.lines.map((row, i) => (i === idx ? { ...row, quantity: e.target.value } : row)),
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
                          lines: p.lines.map((row, i) => (i === idx ? { ...row, unit_price: e.target.value } : row)),
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
                        onClick={() => setForm((p) => ({ ...p, lines: p.lines.filter((_, i) => i !== idx) }))}
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
                <span>VAT ({(VAT_RATE * 100).toFixed(0)}%)</span>
                <span>{KES(draftPreview.vat)}</span>
              </div>
              <div className="mt-1 flex justify-between font-semibold">
                <span>Total</span>
                <span>{KES(draftPreview.total)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitInvoice} disabled={saving || !customers.length || !items.length}>
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
              <DetailNav
                backLabel="Back to invoices"
                onBack={() => setPreview(null)}
                crumbs={[
                  { label: "Invoicing", to: "/invoices" },
                  { label: preview.id },
                ]}
              />
              <DialogHeader>
                <DialogTitle>Tax Invoice — {preview.id}</DialogTitle>
              </DialogHeader>
              <div className="printable rounded-md border border-border bg-white p-6 text-sm text-foreground">
                <div className="flex items-start justify-between border-b border-border pb-4">
                  <div>
                    <img
                      src="/ayawin-logo.png"
                      alt="Ayawin Stock Solutions"
                      className="h-10 w-auto object-contain object-left"
                    />
                    <div className="mt-1 text-xs text-muted-foreground">Nairobi, Kenya</div>
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
                      <span className="text-muted-foreground">Invoice Date:</span> {fmtDate(preview.date)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Due Date:</span> {fmtDate(preview.due)}
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
                    <span>VAT ({(VAT_RATE * 100).toFixed(0)}%)</span>
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
                        const result = await verifyInvoiceDocument(token, preview.id, verifyHashInput.trim() || undefined);
                        const base = window.location.origin;
                        const url = `${base}/api/v1/sales/invoices/${encodeURIComponent(preview.id)}/verify?hash=${encodeURIComponent(result.verification_hash)}`;
                        setVerifyResult({ hash: result.verification_hash, valid: result.valid, url });
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
                {preview.status !== 'Draft' && (
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
                    if (!token) return;
                    try {
                      const result = await emailInvoiceToCustomer(token, preview.id);
                      toast.success(`Invoice emailed to ${result.to} (${result.pdf_bytes ?? 0} byte PDF)`);
                      void trackEvent({
                        action: "invoice_email_sent",
                        entityType: "invoice",
                        entityId: preview.id,
                        details: { to: result.to, pdf_bytes: result.pdf_bytes },
                        scenario: "invoice",
                      });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not email invoice");
                    }
                  }}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Email to customer
                </Button>
                {integrations?.etims.enabled && preview.status !== "Draft" && preview.status !== "Paid" && preview.status !== "Cancelled" && (
                  <PermissionGate permission="sales.create">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        if (!token || !preview.internal_id) return;
                        setIntegrationBusy(true);
                        try {
                          const result = await submitInvoiceEtims(token, preview.internal_id);
                          toast.success(`eTIMS ref: ${String(result.etims_ref || "submitted")}`);
                          await loadInvoices();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "eTIMS submit failed");
                        } finally {
                          setIntegrationBusy(false);
                        }
                      }}
                      disabled={integrationBusy}
                    >
                      Submit eTIMS
                    </Button>
                  </PermissionGate>
                )}
                {integrations?.mpesa.enabled && preview.status !== "Draft" && preview.status !== "Paid" && preview.status !== "Cancelled" && (
                  <PermissionGate permission="sales.create">
                    <div className="flex items-center gap-2">
                      <Input
                        className="h-9 w-32"
                        placeholder="2547…"
                        value={mpesaPhone}
                        onChange={(e) => setMpesaPhone(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        disabled={integrationBusy || !mpesaPhone.trim()}
                        onClick={async () => {
                          if (!token) return;
                          setIntegrationBusy(true);
                          try {
                            const result = await initiateMpesaPayment(token, {
                              phone: mpesaPhone.trim(),
                              amount: preview.total,
                              reference: preview.id,
                            });
                            toast.success(`STK push sent — ${String(result.checkout_request_id || "pending")}`);
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "M-Pesa failed");
                          } finally {
                            setIntegrationBusy(false);
                          }
                        }}
                      >
                        M-Pesa STK
                      </Button>
                    </div>
                  </PermissionGate>
                )}
                {preview.status !== "Draft" && preview.status !== "Paid" && preview.status !== "Cancelled" && (
                  <PermissionGate permission="sales.create">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        const paid = await paySalesInvoice(token, preview.internal_id || preview.id, {
                          amount: preview.total,
                          payment_date: new Date().toISOString().slice(0, 10),
                          reference_no: preview.etr || undefined,
                          notes: "Paid in full from invoice screen",
                        });
                        notify(`Payment posted for ${preview.id}`, `Receipt ${paid.payment_no} — download from Invoices or Customer statement`);
                        if (paid.payment_no) {
                          try {
                            await downloadPaymentReceiptPdf(token, paid.payment_no);
                          } catch {
                            /* user can retry from receipt buttons */
                          }
                        }
                        await loadInvoices();
                        setPreview(null);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not post payment");
                      }
                    }}
                  >
                    Mark Paid
                  </Button>
                  </PermissionGate>
                )}
                {preview.status === "Paid" && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await downloadReceiptPdf(token, preview.id);
                        notify(`Receipt for ${preview.id} downloaded`, "PDF includes QR verification");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Could not generate receipt PDF");
                      }
                    }}
                  >
                    <FileDown className="mr-2 h-4 w-4" />
                    Download receipt (QR)
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

      <Card className="mt-4">
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Posted credit notes</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CN #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creditNotes.map((cn) => (
                <TableRow key={String(cn.id)}>
                  <TableCell className="font-mono text-xs">{String(cn.credit_note_no)}</TableCell>
                  <TableCell>{String(cn.customer_name || "")}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{String(cn.reason || "")}</TableCell>
                  <TableCell className="text-right">{KES(Number(cn.total_amount || 0))}</TableCell>
                </TableRow>
              ))}
              {creditNotes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    No credit notes posted yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={creditOpen} onOpenChange={setCreditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue credit note</DialogTitle>
            <DialogDescription>Reverses revenue and returns stock when a warehouse is selected.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Customer</Label>
              <Select
                value={creditForm.customer_id}
                onValueChange={(v) => setCreditForm((p) => ({ ...p, customer_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason</Label>
              <Input value={creditForm.reason} onChange={(e) => setCreditForm((p) => ({ ...p, reason: e.target.value }))} />
            </div>
            <div>
              <Label>Product (return)</Label>
              <Select value={creditForm.item_id} onValueChange={(v) => setCreditForm((p) => ({ ...p, item_id: v }))}>
                <SelectTrigger>
                  <SelectValue />
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Qty</Label>
                <Input
                  type="number"
                  value={creditForm.quantity}
                  onChange={(e) => setCreditForm((p) => ({ ...p, quantity: e.target.value }))}
                />
              </div>
              <div>
                <Label>Unit price</Label>
                <Input
                  value={creditForm.unit_price}
                  onChange={(e) => setCreditForm((p) => ({ ...p, unit_price: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                if (!token || !creditForm.customer_id || !creditForm.reason.trim()) {
                  toast.error("Customer and reason are required");
                  return;
                }
                try {
                  await createCreditNote(token, {
                    customer_id: creditForm.customer_id,
                    reason: creditForm.reason.trim(),
                    warehouse_id: creditForm.warehouse_id || undefined,
                    lines: [
                      {
                        item_id: creditForm.item_id,
                        quantity: Number(creditForm.quantity),
                        unit_price: Number(creditForm.unit_price),
                        warehouse_id: creditForm.warehouse_id,
                      },
                    ],
                  });
                  toast.success("Credit note posted");
                  setCreditOpen(false);
                  setCreditNotes(await fetchCreditNotes(token));
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not post credit note");
                }
              }}
            >
              Post credit note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
