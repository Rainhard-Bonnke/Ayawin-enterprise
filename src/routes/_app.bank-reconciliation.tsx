import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileUp, RefreshCw, Check, Link2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import {
  completeBankReconciliation, createBankReconciliation, fetchBankAccounts,
  fetchBankCandidates, fetchBankReconciliation, fetchBankReconciliations,
  matchBankStatementLine, type BankLedgerCandidate, type BankReconciliation,
} from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/bank-reconciliation")({
  component: BankReconciliationPage,
  head: () => ({ meta: [{ title: "Bank reconciliation - Ayawin Stock Solution" }] }),
});

type ImportLine = { transaction_date: string; reference: string; description: string; debit: number; credit: number };
type BankAccount = { id: string; account_code: string; account_name: string; currency_code: string };

const money = (value: number, currency = "KES") => new Intl.NumberFormat("en-KE", {
  style: "currency", currency, maximumFractionDigits: 2,
}).format(value);

function parseCSV(text: string): ImportLine[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field.trim()); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one transaction");
  const keys = rows[0].map((value) => value.toLowerCase().replace(/[^a-z]/g, ""));
  const find = (...aliases: string[]) => keys.findIndex((key) => aliases.includes(key));
  const dateIndex = find("date", "transactiondate", "valuedate", "posteddate");
  const descriptionIndex = find("description", "details", "narration", "transactiondescription", "transactiondetails");
  const referenceIndex = find("reference", "ref", "transactionreference", "transactionid");
  const debitIndex = find("debit", "withdrawal", "withdrawals", "paidout", "moneyout");
  const creditIndex = find("credit", "deposit", "deposits", "paidin", "moneyin");
  if (dateIndex < 0 || descriptionIndex < 0 || debitIndex < 0 || creditIndex < 0) {
    throw new Error("CSV headers must include Date, Description, Debit and Credit; Reference is optional");
  }
  const dateValue = (value: string) => {
    const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return value.trim();
    const dmy = value.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return "";
  };
  const amount = (value: string) => {
    if (!value.trim()) return 0;
    const parsed = Number(value.replace(/[ ,]/g, ""));
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid bank amount: ${value}`);
    return Math.round(parsed * 10000) / 10000;
  };
  return rows.slice(1).map((columns, index) => {
    const get = (column: number) => column < 0 ? "" : columns[column] || "";
    const transaction_date = dateValue(get(dateIndex));
    if (!transaction_date) throw new Error(`Line ${index + 2} has an unsupported date; use YYYY-MM-DD or DD/MM/YYYY`);
    return {
      transaction_date,
      reference: get(referenceIndex),
      description: get(descriptionIndex),
      debit: amount(get(debitIndex)),
      credit: amount(get(creditIndex)),
    };
  });
}

function BankReconciliationPage() {
  const { token } = useAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [sessions, setSessions] = useState<BankReconciliation[]>([]);
  const [selected, setSelected] = useState<BankReconciliation | null>(null);
  const [candidates, setCandidates] = useState<BankLedgerCandidate[]>([]);
  const [selectedMatches, setSelectedMatches] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 8) + "01");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  const [fileName, setFileName] = useState("");
  const [importLines, setImportLines] = useState<ImportLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async (id?: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const [accountRows, sessionRows] = await Promise.all([fetchBankAccounts(token), fetchBankReconciliations(token)]);
      setAccounts(accountRows);
      setSessions(sessionRows);
      if (!accountId && accountRows[0]) setAccountId(accountRows[0].id);
      const targetId = id || selected?.id;
      if (targetId) {
        const [detail, ledgerRows] = await Promise.all([
          fetchBankReconciliation(token, targetId), fetchBankCandidates(token, targetId),
        ]);
        setSelected(detail);
        setCandidates(ledgerRows);
        setSelectedMatches({});
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load bank reconciliation");
    } finally { setLoading(false); }
  }, [token, accountId, selected?.id]);

  useEffect(() => { void reload(); }, [reload]);

  const expectedClosing = useMemo(
    () => Number(openingBalance || 0) + importLines.reduce((sum, line) => sum + line.credit - line.debit, 0),
    [openingBalance, importLines],
  );

  const openReconciliation = async (id: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const [detail, ledgerRows] = await Promise.all([
        fetchBankReconciliation(token, id), fetchBankCandidates(token, id),
      ]);
      setSelected(detail); setCandidates(ledgerRows); setSelectedMatches({});
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to open reconciliation"); }
    finally { setLoading(false); }
  };

  const importStatement = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !importLines.length) return;
    setSaving(true);
    try {
      const created = await createBankReconciliation(token, {
        bank_account_id: accountId, statement_reference: reference,
        statement_start: startDate, statement_end: endDate,
        opening_balance: Number(openingBalance), closing_balance: Number(closingBalance),
        lines: importLines,
      });
      setImportLines([]); setFileName(""); setReference("");
      await reload(created.id);
      toast.success("Bank statement imported. Match each statement line to a posted ledger entry.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to import statement"); }
    finally { setSaving(false); }
  };

  const candidatesFor = (line: NonNullable<BankReconciliation["lines"]>[number]) => candidates.filter((candidate) => {
    const bankDebit = Number(line.debit) > 0;
    // Bank debit/outflow maps to a credit on the ERP cash asset account, and vice versa.
    const directionMatches = bankDebit
      ? Number(candidate.credit) > 0 && Number(candidate.debit) === 0
      : Number(candidate.debit) > 0 && Number(candidate.credit) === 0;
    const amountMatches = Math.abs(Number(bankDebit ? line.debit : line.credit) - Number(bankDebit ? candidate.credit : candidate.debit)) <= 0.01;
    const days = Math.abs(new Date(`${line.transaction_date}T00:00:00`).getTime() - new Date(`${String(candidate.entry_date).slice(0, 10)}T00:00:00`).getTime()) / 86400000;
    return directionMatches && amountMatches && days <= 14;
  });

  const matchLine = async (lineId: string) => {
    if (!token || !selected || !selectedMatches[lineId]) return;
    setSaving(true);
    try {
      await matchBankStatementLine(token, selected.id, lineId, selectedMatches[lineId]);
      await openReconciliation(selected.id);
      toast.success("Statement line matched to the posted bank ledger entry");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to match statement line"); }
    finally { setSaving(false); }
  };

  const complete = async () => {
    if (!token || !selected) return;
    setSaving(true);
    try {
      await completeBankReconciliation(token, selected.id);
      await reload(selected.id);
      toast.success("Bank reconciliation completed");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to complete reconciliation"); }
    finally { setSaving(false); }
  };

  const account = accounts.find((row) => row.id === accountId);

  return (
    <div className="space-y-6 pb-8">
      <PageHeader title="Bank reconciliation" description="Import a bank statement and match its transactions to posted cash ledger entries." actions={<Button variant="outline" onClick={() => void reload()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>} />

      <Card>
        <CardHeader><CardTitle>Import statement CSV</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={importStatement}>
            <p className="text-sm text-muted-foreground">Expected columns: Date, Description, Debit, Credit; Reference is optional. Dates may be YYYY-MM-DD or DD/MM/YYYY. The CSV is parsed in your browser and only its rows are sent to this ERP. Statement lines must match posted ledger entries; record bank fees in the ledger first. A different finance approver completes the reconciliation.</p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2"><Label>Bank or cash account</Label><select required value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Choose account</option>{accounts.map((row) => <option key={row.id} value={row.id}>{row.account_code} · {row.account_name} ({row.currency_code})</option>)}</select></div>
              <div className="space-y-2"><Label>Statement reference</Label><Input required maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Bank statement 2026-10" /></div>
              <div className="space-y-2"><Label>From date</Label><Input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
              <div className="space-y-2"><Label>To date</Label><Input required type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
              <div className="space-y-2"><Label>Opening balance ({account?.currency_code || "account currency"})</Label><Input required type="number" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} /></div>
              <div className="space-y-2"><Label>Closing balance ({account?.currency_code || "account currency"})</Label><Input required type="number" step="0.01" value={closingBalance} onChange={(e) => setClosingBalance(e.target.value)} /></div>
              <div className="space-y-2 md:col-span-2"><Label>Bank CSV file</Label><Input required type="file" accept=".csv,text/csv" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setImportLines(parseCSV(await file.text())); setFileName(file.name); } catch (error) { setImportLines([]); setFileName(""); toast.error(error instanceof Error ? error.message : "Unable to read CSV"); } }} /></div>
            </div>
            {importLines.length > 0 && <div className="rounded-lg border bg-muted/30 p-3 text-sm">{fileName}: {importLines.length} transactions · calculated closing balance {money(expectedClosing, account?.currency_code)}{Math.abs(expectedClosing - Number(closingBalance || 0)) > 0.01 ? <span className="ml-2 text-destructive">Does not match the entered closing balance.</span> : <span className="ml-2 text-emerald-600">Balances agree.</span>}</div>}
            <Button type="submit" disabled={saving || loading || !importLines.length || Math.abs(expectedClosing - Number(closingBalance || 0)) > 0.01}><FileUp className="mr-2 h-4 w-4" />{saving ? "Importing…" : "Import and prepare matching"}</Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader><CardTitle>Statement history</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {sessions.map((session) => <button key={session.id} type="button" onClick={() => void openReconciliation(session.id)} className={`w-full rounded-lg border p-3 text-left ${selected?.id === session.id ? "border-primary bg-primary/5" : "border-border/70"}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{session.statement_reference}</span><StatusBadge status={session.status} /></div><div className="mt-1 text-xs text-muted-foreground">{session.account_code} · {String(session.statement_start).slice(0, 10)} to {String(session.statement_end).slice(0, 10)}</div><div className="mt-1 text-xs">{session.matched_count}/{session.line_count} lines matched</div></button>)}
            {!sessions.length && <p className="py-8 text-center text-sm text-muted-foreground">No statements imported yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{selected ? `${selected.statement_reference} · ${selected.account_code}` : "Statement matching"}</CardTitle></CardHeader>
          <CardContent>
            {!selected ? <p className="py-10 text-center text-sm text-muted-foreground">Import a statement or choose one from history.</p> : <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3 text-sm"><div>Opening {money(Number(selected.opening_balance), selected.currency_code)} → Closing {money(Number(selected.closing_balance), selected.currency_code)}</div><div>{selected.matched_count}/{selected.line_count} statement lines matched</div><Button size="sm" disabled={saving || selected.status !== "draft" || selected.line_count === 0 || selected.matched_count !== selected.line_count} onClick={() => void complete()}><Check className="mr-2 h-4 w-4" />Complete reconciliation</Button></div>
              <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Bank transaction</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead>Match to posted ledger</TableHead></TableRow></TableHeader><TableBody>
                {(selected.lines || []).map((line) => {
                  const options = candidatesFor(line);
                  return <TableRow key={line.id}><TableCell>{String(line.transaction_date).slice(0, 10)}</TableCell><TableCell><div className="font-medium">{line.description}</div><div className="text-xs text-muted-foreground">{line.reference || "No bank reference"}</div></TableCell><TableCell className="text-right">{Number(line.debit) ? money(Number(line.debit), selected.currency_code) : "—"}</TableCell><TableCell className="text-right">{Number(line.credit) ? money(Number(line.credit), selected.currency_code) : "—"}</TableCell><TableCell>{line.journal_line_id ? <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><Link2 className="h-4 w-4" />{line.journal_no} · {line.matched_account_code}</span> : <div className="flex min-w-[280px] gap-2"><select className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs" value={selectedMatches[line.id] || ""} onChange={(e) => setSelectedMatches((current) => ({ ...current, [line.id]: e.target.value }))} disabled={selected.status !== "draft"}><option value="">{options.length ? "Choose matching ledger entry" : "No amount/date match found"}</option>{options.map((candidate) => <option key={candidate.journal_line_id} value={candidate.journal_line_id}>{candidate.journal_no} · {String(candidate.entry_date).slice(0, 10)} · {candidate.reference_no || candidate.line_description || candidate.journal_description} · {money(Number(candidate.debit || candidate.credit), selected.currency_code)}</option>)}</select><Button size="sm" variant="outline" disabled={saving || selected.status !== "draft" || !selectedMatches[line.id]} onClick={() => void matchLine(line.id)}>Match</Button></div>}</TableCell></TableRow>;
                })}
                {!selected.lines?.length && <TableRow><TableCell colSpan={5} className="h-20 text-center text-muted-foreground">This statement contains no transactions.</TableCell></TableRow>}
              </TableBody></Table></div>
              {selected.outstanding_book_lines?.length ? <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"><h3 className="font-medium">Posted bank ledger entries still unmatched ({selected.outstanding_book_lines.length})</h3><p className="mb-2 text-xs text-muted-foreground">These may be outstanding items or missing from the imported date range. Review them before closing your period.</p><div className="max-h-52 space-y-1 overflow-auto">{selected.outstanding_book_lines.map((item) => <div key={item.journal_line_id} className="flex flex-wrap justify-between gap-2 text-xs"><span>{item.entry_date} · {item.journal_no} · {item.reference_no || item.line_description || item.journal_description}</span><span>{Number(item.debit) ? `Out ${money(Number(item.debit), selected.currency_code)}` : `In ${money(Number(item.credit), selected.currency_code)}`}</span></div>)}</div></div> : <div className="mt-4 text-xs text-muted-foreground">No unmatched posted bank ledger entries remain in the matching date window.</div>}
            </>}
          </CardContent>
        </Card>
      </div>
      {account && <p className="text-xs text-muted-foreground">Selected account: {account.account_code} · {account.account_name}</p>}
    </div>
  );
}
