import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/SearchBar";
import { KES } from "@/lib/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { exportWorkbook } from "@/lib/excel";
import { exportElementAsPdf } from "@/lib/pdf";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { ReceiptPdfButton } from "@/components/ReceiptPdfButton";
import {
  createFinanceJournal,
  fetchAccountingSnapshot,
  fetchChartOfAccounts,
  fetchFinanceJournals,
  fetchBankAccounts,
  fetchBankReconUnmatched,
  importBankStatement,
  matchBankStatementLine,
  postFinanceJournal,
  fetchMonthEndOpenPeriod,
  previewMonthEnd,
  closeMonthEnd,
  fetchKenyaCoaStatus,
  fetchVatReturnReport,
  fetchExciseReturnReport,
  type AccountingJournalRow,
  type ChartOfAccountRow,
  type FinanceJournalHeader,
} from "@/lib/api";
import { useEffect, useState } from "react";
import { Printer, FileDown, ArrowUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { PermissionGate } from "@/components/PermissionGate";

export const Route = createFileRoute("/_app/accounting")({
  component: Accounting,
  head: () => ({ meta: [{ title: "Accounting & Finance — Ayawin Stock Solutions ERP" }] }),
});

const pnl: Array<{ month: string; revenue: number; expenses: number }> = [];

const defaultJournal: AccountingJournalRow[] = [];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function Accounting() {
  const { token } = useAuth();
  const [liveJournal, setLiveJournal] = useState<AccountingJournalRow[] | null>(null);
  const [livePnl, setLivePnl] = useState<typeof pnl | null>(null);
  const [liveAging, setLiveAging] = useState<Array<{ bucket: string; ar: number; ap: number }>>([]);
  const [liveCashFlow, setLiveCashFlow] = useState<Array<{ label: string; value: number }>>([]);
  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);
  const [journalHeaders, setJournalHeaders] = useState<FinanceJournalHeader[]>([]);
  const [postingJournalId, setPostingJournalId] = useState<string | null>(null);
  const [journalDialogOpen, setJournalDialogOpen] = useState(false);
  const [journalSaving, setJournalSaving] = useState(false);
  const [journalForm, setJournalForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    description: "",
    debit_account_id: "",
    credit_account_id: "",
    amount: "",
  });
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [bankAccounts, setBankAccounts] = useState<Array<Record<string, unknown>>>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [bankUnmatched, setBankUnmatched] = useState<{
    statement_lines: Array<Record<string, unknown>>;
    open_receipts: Array<Record<string, unknown>>;
    suggestions: Array<{ statement_line_id: string; receipt_id: string }>;
  } | null>(null);
  const [importLine, setImportLine] = useState({ txn_date: todayIso(), description: "", reference_no: "", amount: "" });
  const [openPeriod, setOpenPeriod] = useState<Record<string, unknown> | null>(null);
  const [monthEndPreview, setMonthEndPreview] = useState<{
    can_close: boolean;
    blockers: string[];
    trial_balance: { difference: number; balanced?: boolean };
  } | null>(null);
  const [monthEndBusy, setMonthEndBusy] = useState(false);
  const [coaOk, setCoaOk] = useState<boolean | null>(null);
  const [vatReport, setVatReport] = useState<{
    invoice_vat_total: number;
    gl_vat_total: number;
    variance: number;
    matched: boolean;
  } | null>(null);
  const [exciseReport, setExciseReport] = useState<{
    totals: { total_excise?: number; total_litres?: number; gl_excise?: number; variance?: number };
    lines: Array<Record<string, unknown>>;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    void fetchAccountingSnapshot(token)
      .then((snap) => {
        if (!snap) return;
        if (snap.journalRows.length) setLiveJournal(snap.journalRows);
        if (snap.pnl.length) setLivePnl(snap.pnl);
        setLiveAging(snap.aging);
        setLiveCashFlow(snap.cashFlow);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Unable to load accounting snapshot");
      });
    void fetchChartOfAccounts(token)
      .then(setAccounts)
      .catch(() => setAccounts([]));
    void fetchFinanceJournals(token)
      .then(setJournalHeaders)
      .catch(() => setJournalHeaders([]));
    void fetchBankAccounts(token)
      .then((rows) => {
        setBankAccounts(rows);
        if (rows[0]?.id) setBankAccountId(String(rows[0].id));
      })
      .catch(() => setBankAccounts([]));
  }, [token]);

  useEffect(() => {
    if (!token || !bankAccountId) return;
    void fetchBankReconUnmatched(token, bankAccountId)
      .then(setBankUnmatched)
      .catch(() => setBankUnmatched(null));
  }, [token, bankAccountId]);

  useEffect(() => {
    if (!token) return;
    void fetchMonthEndOpenPeriod(token)
      .then((p) => setOpenPeriod(p))
      .catch(() => setOpenPeriod(null));
    void fetchKenyaCoaStatus(token)
      .then((s) => setCoaOk(s.ok))
      .catch(() => setCoaOk(null));
  }, [token]);

  useEffect(() => {
    if (!token || !openPeriod) return;
    const from = String(openPeriod.start_date || "").slice(0, 10);
    const to = String(openPeriod.end_date || "").slice(0, 10);
    void fetchVatReturnReport(token, from, to)
      .then((r) =>
        setVatReport({
          invoice_vat_total: r.invoice_vat_total,
          gl_vat_total: r.gl_vat_total,
          variance: r.variance,
          matched: r.matched,
        }),
      )
      .catch(() => setVatReport(null));
    void fetchExciseReturnReport(token, from, to)
      .then((r) => setExciseReport({ totals: r.totals, lines: r.lines }))
      .catch(() => setExciseReport(null));
  }, [token, openPeriod]);

  const reloadJournals = async () => {
    if (!token) return;
    const [snap, headers] = await Promise.all([
      fetchAccountingSnapshot(token),
      fetchFinanceJournals(token),
    ]);
    if (snap.journalRows.length) setLiveJournal(snap.journalRows);
    if (snap.pnl.length) setLivePnl(snap.pnl);
    setLiveAging(snap.aging);
    setLiveCashFlow(snap.cashFlow);
    setJournalHeaders(headers);
  };

  const journalSource = liveJournal ?? defaultJournal;
  const pnlSource = livePnl ?? pnl;
  const revenue = pnlSource.reduce((sum, row) => sum + row.revenue, 0);
  const expenses = pnlSource.reduce((sum, row) => sum + row.expenses, 0);
  const net = revenue - expenses;

  const journalRows = journalSource
    .filter((j) => j.d.includes(q) || j.a.toLowerCase().includes(q.toLowerCase()) || j.desc.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sort === "account") return a.a.localeCompare(b.a);
      return b.d.localeCompare(a.d);
    });
  const totalPages = Math.max(1, Math.ceil(journalRows.length / pageSize));
  const paged = journalRows.slice((page - 1) * pageSize, page * pageSize);
  const forecast = liveCashFlow;
  const aging = liveAging;
  const exportAccounting = () => {
    exportWorkbook("ayawin-enterprise-accounting.xlsx", [
      {
        name: "Journal",
        rows: journalRows.map((j) => ({
          Date: j.d,
          Account: j.a,
          Description: j.desc,
          Debit: j.db,
          Credit: j.cr,
        })),
      },
      {
        name: "P&L",
        rows: pnlSource.map((row) => ({
          Month: row.month,
          Revenue: row.revenue,
          Expenses: row.expenses,
          Profit: row.revenue - row.expenses,
        })),
      },
      {
        name: "Aging",
        rows: aging.map((row) => ({
          Bucket: row.bucket,
          Receivable: row.ar,
          Payable: row.ap,
        })),
      },
      {
        name: "Cash Flow",
        rows: forecast.map((row) => ({
          Period: row.label,
          Value: row.value,
        })),
      },
    ]);
  };

  return (
    <div className="printable">
      <PageHeader
        title="Accounting & Finance"
        description="General Ledger, AR/AP, VAT & Excise returns, P&L."
        actions={
          <>
            <PermissionGate permission="finance.create">
            <Button onClick={() => setJournalDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Journal Entry
            </Button>
            </PermissionGate>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const el = document.querySelector('.printable');
                if (!el) return;
                try {
                  await exportElementAsPdf('accounting-report.pdf', el as HTMLElement);
                } catch (e) {
                  // eslint-disable-next-line no-console
                  console.error(e);
                }
              }}
            >
              <FileDown className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
            <Button variant="outline" onClick={exportAccounting}>
              <FileDown className="mr-2 h-4 w-4" />
              Export XLSX
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Revenue (period)", v: KES(revenue) },
          { l: "Expenses (period)", v: KES(expenses) },
          { l: "Net Result", v: KES(net) },
          { l: "Journal Entries", v: String(journalRows.length) },
          {
            l: "Kenya COA",
            v: coaOk === null ? "—" : coaOk ? "Complete" : "Gaps",
          },
        ].map((k) => (
          <Card key={k.l}><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
            <div className="mt-1 text-2xl font-bold">{k.v}</div>
          </CardContent></Card>
        ))}
      </div>

      <QuietNote
        scenario="accounting"
        contextKey={`${q}-${sort}`}
        context={{ q, sort, journalRows, pnl, aging }}
        className="mb-4"
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Next 30 Days Cash Flow</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {(forecast.length ? forecast : [{ label: "Week 1", value: 0 }, { label: "Week 2", value: 0 }, { label: "Week 3", value: 0 }, { label: "Week 4", value: 0 }]).map((item) => (
            <div key={item.label} className="rounded-xl border border-border/70 bg-background/60 p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{item.label}</div>
              <div className="mt-1 text-xl font-bold">{KES(item.value)}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Tabs defaultValue="pnl">
        <TabsList>
          <TabsTrigger value="pnl">P&L</TabsTrigger>
          <TabsTrigger value="aging">Aging</TabsTrigger>
          <TabsTrigger value="journals">Journal Register</TabsTrigger>
          <TabsTrigger value="vat">VAT & Excise (KRA)</TabsTrigger>
          <TabsTrigger value="ledger">GL Lines</TabsTrigger>
          <TabsTrigger value="bank">Bank reconciliation</TabsTrigger>
          <TabsTrigger value="month-end">Month-end close</TabsTrigger>
        </TabsList>

        <TabsContent value="pnl" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Profit & Loss — Last 5 months</CardTitle></CardHeader>
            <CardContent className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnlSource}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `${v / 1000000}M`} />
                  <Tooltip formatter={(v: number) => KES(v)} />
                  <Bar dataKey="revenue" fill="var(--navy)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="expenses" fill="var(--gold)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aging" className="mt-4">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Receivable</TableHead>
                <TableHead className="text-right">Payable</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {aging.map((a) => (
                  <TableRow key={a.bucket}>
                    <TableCell className="font-medium">{a.bucket}</TableCell>
                    <TableCell className="text-right">{KES(a.ar)}</TableCell>
                    <TableCell className="text-right">{KES(a.ap)}</TableCell>
                  </TableRow>
                ))}
                {aging.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-sm text-muted-foreground">
                      No aging data yet. Post invoices and purchase orders to populate AR/AP buckets.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="journals" className="mt-4">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Journal #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {journalHeaders.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-mono text-xs">{j.journal_no}</TableCell>
                    <TableCell>{j.entry_date}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{j.description || "—"}</TableCell>
                    <TableCell><StatusBadge status={j.status} /></TableCell>
                    <TableCell className="text-right">{KES(j.total_debit)}</TableCell>
                    <TableCell className="text-right">{KES(j.total_credit)}</TableCell>
                    <TableCell className="text-right">
                      {j.status.toLowerCase() === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={postingJournalId === j.id}
                          onClick={() => {
                            if (!token) return;
                            setPostingJournalId(j.id);
                            void postFinanceJournal(token, j.id)
                              .then(() => {
                                toast.success(`Journal ${j.journal_no} posted`);
                                return reloadJournals();
                              })
                              .catch((err) => toast.error(err instanceof Error ? err.message : "Post failed"))
                              .finally(() => setPostingJournalId(null));
                          }}
                        >
                          {postingJournalId === j.id ? "Posting…" : "Post"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {journalHeaders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      No journals yet. Create a journal entry to start the GL register.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="vat" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>VAT Return — open period</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {vatReport ? (
                  <>
                    <Row label="Invoice VAT total" value={KES(vatReport.invoice_vat_total)} />
                    <Row label="GL VAT (2200)" value={KES(vatReport.gl_vat_total)} />
                    <Row label="Variance" value={KES(vatReport.variance)} bold />
                    <div className="mt-2">
                      <StatusBadge status={vatReport.matched ? "Matched" : "Review"} />
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">No VAT data for the open period.</p>
                )}
                <div className="mt-3 text-xs text-muted-foreground">File via KRA iTax when period closes</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Excise Duty — KRA format</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {exciseReport ? (
                  <>
                    <Row label="Total litres" value={String(exciseReport.totals.total_litres ?? 0)} />
                    <Row label="Excise on invoices" value={KES(exciseReport.totals.total_excise ?? 0)} />
                    <Row label="GL excise (2300)" value={KES(exciseReport.totals.gl_excise ?? 0)} />
                    <Row label="Variance" value={KES(exciseReport.totals.variance ?? 0)} bold />
                    <p className="text-xs text-muted-foreground">{exciseReport.lines.length} line(s) with excise</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">No excise lines in the open period.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <Card><CardContent className="p-4">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <SearchBar value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search journal entries..." />
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-40">
                  <ArrowUpDown className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Sort by date</SelectItem>
                  <SelectItem value="account">Sort by account</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Account</TableHead><TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {paged.map((j, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{j.d}</TableCell>
                    <TableCell className="font-mono text-xs">{j.a}</TableCell>
                    <TableCell className="text-xs">{j.desc}</TableCell>
                    <TableCell className="text-right text-xs">{j.db ? KES(j.db) : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{j.cr ? KES(j.cr) : "—"}</TableCell>
                  </TableRow>
                ))}
                {paged.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      No journal entries match your filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <ListPagination page={page} totalPages={totalPages} totalItems={journalRows.length} pageSize={pageSize} onPageChange={setPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="bank" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label>Bank account</Label>
                  <Select value={bankAccountId} onValueChange={setBankAccountId}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccounts.map((b) => (
                        <SelectItem key={String(b.id)} value={String(b.id)}>
                          {String(b.name)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <Input type="date" value={importLine.txn_date} onChange={(e) => setImportLine((p) => ({ ...p, txn_date: e.target.value }))} />
                <Input placeholder="Description" value={importLine.description} onChange={(e) => setImportLine((p) => ({ ...p, description: e.target.value }))} />
                <Input placeholder="Reference" value={importLine.reference_no} onChange={(e) => setImportLine((p) => ({ ...p, reference_no: e.target.value }))} />
                <Input placeholder="Amount (+ in)" value={importLine.amount} onChange={(e) => setImportLine((p) => ({ ...p, amount: e.target.value }))} />
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  if (!token || !bankAccountId) return;
                  const amount = Number(importLine.amount);
                  if (!amount) {
                    toast.error("Enter statement amount");
                    return;
                  }
                  try {
                    await importBankStatement(token, {
                      bank_account_id: bankAccountId,
                      lines: [{ ...importLine, amount }],
                    });
                    toast.success("Statement line imported");
                    setImportLine({ txn_date: todayIso(), description: "", reference_no: "", amount: "" });
                    setBankUnmatched(await fetchBankReconUnmatched(token, bankAccountId));
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Import failed");
                  }
                }}
              >
                Import statement line
              </Button>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Unmatched bank lines</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(bankUnmatched?.statement_lines || []).map((sl) => (
                      <TableRow key={String(sl.id)}>
                        <TableCell>{String(sl.txn_date).slice(0, 10)}</TableCell>
                        <TableCell className="max-w-[120px] truncate">{String(sl.description || "")}</TableCell>
                        <TableCell className="text-right">{KES(Number(sl.amount || 0))}</TableCell>
                        <TableCell>
                          <Select
                            onValueChange={async (receiptId) => {
                              if (!token) return;
                              try {
                                await matchBankStatementLine(token, {
                                  statement_line_id: String(sl.id),
                                  receipt_id: receiptId,
                                });
                                toast.success("Matched to receipt");
                                setBankUnmatched(await fetchBankReconUnmatched(token, bankAccountId));
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Match failed");
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 w-[130px]">
                              <SelectValue placeholder="Match…" />
                            </SelectTrigger>
                            <SelectContent>
                              {(bankUnmatched?.open_receipts || []).map((r) => (
                                <SelectItem key={String(r.id)} value={String(r.id)}>
                                  {String(r.receipt_no)} {KES(Number(r.amount || 0))}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!bankUnmatched?.statement_lines?.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                          No unmatched statement lines.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Open customer receipts</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">PDF</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(bankUnmatched?.open_receipts || []).map((r) => (
                      <TableRow key={String(r.id)}>
                        <TableCell className="font-mono text-xs">{String(r.receipt_no)}</TableCell>
                        <TableCell>{String(r.customer_name || "")}</TableCell>
                        <TableCell className="text-right">{KES(Number(r.amount || 0))}</TableCell>
                        <TableCell className="text-right">
                          <ReceiptPdfButton kind="payment" receiptRef={String(r.receipt_no)} label="Download" />
                        </TableCell>
                      </TableRow>
                    ))}
                    {!bankUnmatched?.open_receipts?.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                          No open receipts to match.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="month-end" className="mt-4">
          <Card>
            <CardContent className="space-y-4 p-4">
              <p className="text-sm text-muted-foreground">
                Close the open fiscal period after trial balance is zero and draft documents are cleared.
              </p>
              {openPeriod ? (
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
                  <div className="font-medium">{String(openPeriod.name || `Period ${openPeriod.period_no}`)}</div>
                  <div className="text-muted-foreground">
                    {String(openPeriod.start_date || "").slice(0, 10)} → {String(openPeriod.end_date || "").slice(0, 10)}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No open fiscal period found.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!openPeriod?.id || monthEndBusy}
                  onClick={async () => {
                    if (!token || !openPeriod?.id) return;
                    setMonthEndBusy(true);
                    try {
                      const preview = await previewMonthEnd(token, String(openPeriod.id));
                      setMonthEndPreview(preview);
                      if (preview.blockers.length) {
                        toast.warning(preview.blockers.join("; "));
                      } else {
                        toast.success("Ready to close — trial balance OK");
                      }
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Preview failed");
                    } finally {
                      setMonthEndBusy(false);
                    }
                  }}
                >
                  Preview close
                </Button>
                <Button
                  disabled={!openPeriod?.id || monthEndBusy}
                  onClick={async () => {
                    if (!token || !openPeriod?.id) return;
                    setMonthEndBusy(true);
                    try {
                      await closeMonthEnd(token, String(openPeriod.id), false);
                      toast.success("Fiscal period closed");
                      setOpenPeriod(null);
                      setMonthEndPreview(null);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Close failed");
                    } finally {
                      setMonthEndBusy(false);
                    }
                  }}
                >
                  Close period
                </Button>
              </div>
              {monthEndPreview && (
                <div className="text-sm">
                  <div>
                    Trial balance difference:{" "}
                    <strong>{KES(monthEndPreview.trial_balance.difference)}</strong>
                    {monthEndPreview.trial_balance.balanced === false && (
                      <span className="ml-2 text-destructive">(not balanced)</span>
                    )}
                  </div>
                  {monthEndPreview.blockers.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-destructive">
                      {monthEndPreview.blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={journalDialogOpen} onOpenChange={setJournalDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Journal Entry</DialogTitle>
            <DialogDescription>Post a balanced debit/credit entry to the general ledger.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Entry date</Label>
              <Input type="date" value={journalForm.entry_date} onChange={(e) => setJournalForm((p) => ({ ...p, entry_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={journalForm.description} onChange={(e) => setJournalForm((p) => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Debit account</Label>
              <Select value={journalForm.debit_account_id} onValueChange={(v) => setJournalForm((p) => ({ ...p, debit_account_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Credit account</Label>
              <Select value={journalForm.credit_account_id} onValueChange={(v) => setJournalForm((p) => ({ ...p, credit_account_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount (KES)</Label>
              <Input type="number" min={0} step="0.01" value={journalForm.amount} onChange={(e) => setJournalForm((p) => ({ ...p, amount: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJournalDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={journalSaving || !journalForm.debit_account_id || !journalForm.credit_account_id || Number(journalForm.amount) <= 0}
              onClick={() => {
                if (!token) return;
                const amount = Number(journalForm.amount);
                setJournalSaving(true);
                void createFinanceJournal(token, {
                  entry_date: journalForm.entry_date,
                  description: journalForm.description || "Manual journal entry",
                  lines: [
                    { account_id: journalForm.debit_account_id, debit: amount, description: journalForm.description },
                    { account_id: journalForm.credit_account_id, credit: amount, description: journalForm.description },
                  ],
                })
                  .then(() => {
                    toast.success("Journal entry created (draft)");
                    setJournalDialogOpen(false);
                    return reloadJournals();
                  })
                  .catch((err) => toast.error(err instanceof Error ? err.message : "Unable to create journal"))
                  .finally(() => setJournalSaving(false));
              }}
            >
              {journalSaving ? "Saving…" : "Create Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "text-base font-bold" : ""}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
