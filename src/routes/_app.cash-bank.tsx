import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { v1Api, type BankAccountRecord, type BankReconciliationRecord } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";
import { EMPTY_ARRAY, useAction, useList } from "@/lib/queryHooks";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/cash-bank")({
  component: CashBankPage,
  head: () => ({ meta: [{ title: "Cash & Bank — Ayawin Stock Solution" }] }),
});

const formatMoney = (value: number, currency = "KES") =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

function CashBankPage() {
  const { token } = useAuth();
  const [cashBookAccountId, setCashBookAccountId] = useState("all");
  const [cashBookStart, setCashBookStart] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().slice(0, 10);
  });
  const [cashBookEnd, setCashBookEnd] = useState(() => new Date().toISOString().slice(0, 10));

  const registerQuery = useList(
    queryKeys.finance.bankReconciliations(),
    async ({ signal }) => {
      const [accounts, reconciliations] = await Promise.all([
        v1Api.finance.bankAccounts(token!, signal),
        v1Api.finance.bankReconciliations(token!, signal),
      ]);
      return { accounts, reconciliations } as const;
    },
    { enabled: Boolean(token) },
  );

  const [accountCode, setAccountCode] = useState("1110");
  const [accountName, setAccountName] = useState("Main operating account");
  const [currencyCode, setCurrencyCode] = useState("KES");
  const [isActive, setIsActive] = useState(true);
  const [isPostable, setIsPostable] = useState(true);

  const createAccountAction = useAction({
    mutationFn: (body: Parameters<typeof v1Api.finance.createBankAccount>[1]) =>
      v1Api.finance.createBankAccount(token!, body),
    invalidate: [queryKeys.finance.bankReconciliations()],
  });

  const accounts = (registerQuery.data?.accounts ?? EMPTY_ARRAY) as BankAccountRecord[];
  const reconciliations = (registerQuery.data?.reconciliations ??
    EMPTY_ARRAY) as BankReconciliationRecord[];
  const cashBookFilters = {
    start_date: cashBookStart,
    end_date: cashBookEnd,
    account_id: cashBookAccountId === "all" ? undefined : cashBookAccountId,
  };
  const cashBookQuery = useList(
    queryKeys.finance.cashBook(cashBookFilters),
    async ({ signal }) => v1Api.finance.cashBook(token!, cashBookFilters, signal),
    {
      enabled: Boolean(token && cashBookStart && cashBookEnd && cashBookStart <= cashBookEnd),
    },
  );
  const cashBookLines = cashBookQuery.data?.lines ?? EMPTY_ARRAY;
  const cashBookAccounts = cashBookQuery.data?.accounts ?? EMPTY_ARRAY;
  const selectedCashBookAccount = cashBookAccounts.find(
    (account) => account.id === cashBookAccountId,
  );

  const summaries = accounts.map((account) => {
    const accountReconciliations = reconciliations.filter(
      (row) => row.bank_account_id === account.id,
    );
    const latest = [...accountReconciliations].sort(
      (a, b) => new Date(b.statement_end).getTime() - new Date(a.statement_end).getTime(),
    )[0];
    const openCount = accountReconciliations.filter((row) => row.status === "draft").length;

    return {
      ...account,
      latest,
      openCount,
      statementCount: accountReconciliations.length,
    };
  });

  const totalStatements = reconciliations.length;
  const openStatements = reconciliations.filter((row) => row.status === "draft").length;

  const handleCreateAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;

    const code = accountCode.trim();
    const name = accountName.trim();
    if (!code || !name) {
      toast.error("Enter both the account code and account name.");
      return;
    }
    if (!/^11\d{2,4}$/.test(code)) {
      toast.error("Cash or bank account codes must start with 11 (for example 1110). ");
      return;
    }
    if (!/^[A-Z]{3}$/.test(currencyCode.toUpperCase())) {
      toast.error("Use a valid 3-letter ISO currency code such as KES or USD.");
      return;
    }

    try {
      await createAccountAction.mutateAsync({
        account_code: code,
        account_name: name,
        currency_code: currencyCode.toUpperCase(),
        is_active: isActive,
        is_postable: isPostable,
      });
      setAccountCode("1110");
      setAccountName("Main operating account");
      setCurrencyCode("KES");
      setIsActive(true);
      setIsPostable(true);
      toast.success("Cash or bank account created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create the cash or bank account.");
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Cash & Bank"
        description="Monitor cash and bank accounts, recent statements, and reconciliation health across the finance ledger."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{accounts.length}</div>
            <div className="text-sm text-muted-foreground">
              Active bank and cash ledger accounts
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Statements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalStatements}</div>
            <div className="text-sm text-muted-foreground">
              Imported across all bank and cash accounts
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open reconciliations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{openStatements}</div>
            <div className="text-sm text-muted-foreground">
              Draft matching sessions awaiting review
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add cash or bank account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateAccount} className="grid gap-4 md:grid-cols-5">
            <div className="space-y-1">
              <Label htmlFor="account-code">Account code</Label>
              <Input
                id="account-code"
                value={accountCode}
                onChange={(event) => setAccountCode(event.target.value)}
                placeholder="1110"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="account-name">Account name</Label>
              <Input
                id="account-name"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="Main operating account"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="currency-code">Currency</Label>
              <Input
                id="currency-code"
                value={currencyCode}
                onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
                placeholder="KES"
                maxLength={3}
              />
            </div>
            <div className="space-y-1 flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isPostable}
                  onChange={(event) => setIsPostable(event.target.checked)}
                />
                Postable
              </label>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={createAccountAction.isPending} className="w-full">
                {createAccountAction.isPending ? "Saving…" : "Save account"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cash book</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="cash-book-start">From</Label>
              <Input
                id="cash-book-start"
                type="date"
                value={cashBookStart}
                onChange={(event) => setCashBookStart(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cash-book-end">To</Label>
              <Input
                id="cash-book-end"
                type="date"
                value={cashBookEnd}
                onChange={(event) => setCashBookEnd(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cash-book-account">Cash or bank account</Label>
              <select
                id="cash-book-account"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={cashBookAccountId}
                onChange={(event) => setCashBookAccountId(event.target.value)}
              >
                <option value="all">All accounts</option>
                {cashBookAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.account_code} · {account.account_name} ({account.currency_code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {cashBookStart > cashBookEnd && (
            <p role="alert" className="text-sm text-destructive">
              The start date must be on or before the end date.
            </p>
          )}
          {cashBookQuery.isError && (
            <p role="alert" className="text-sm text-destructive">
              {cashBookQuery.error.message}
            </p>
          )}
          {selectedCashBookAccount && (
            <p className="text-sm text-muted-foreground">
              Opening balance on {cashBookStart}:{" "}
              {formatMoney(
                Number(selectedCashBookAccount.opening_balance),
                selectedCashBookAccount.currency_code,
              )}
            </p>
          )}

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Journal</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Running balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashBookLines.map((line) => (
                  <TableRow key={`${line.journal_id}-${line.line_no}`}>
                    <TableCell>{String(line.entry_date).slice(0, 10)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{line.account_code}</div>
                      <div className="text-xs text-muted-foreground">{line.account_name}</div>
                    </TableCell>
                    <TableCell>{line.journal_no}</TableCell>
                    <TableCell>{line.reference_no || "—"}</TableCell>
                    <TableCell className="min-w-52 whitespace-normal">{line.description}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(line.debit), line.currency_code)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(Number(line.credit), line.currency_code)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(Number(line.running_balance), line.currency_code)}
                    </TableCell>
                  </TableRow>
                ))}
                {!cashBookQuery.isPending && !cashBookQuery.isError && !cashBookLines.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                      No posted cash or bank journal lines match this period.
                    </TableCell>
                  </TableRow>
                )}
                {cashBookQuery.isPending && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                      Loading cash book…
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Cash book entries include posted general-ledger journals only. Results are limited to
            1,000 lines; narrow the date range or select one account for larger periods.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bank and cash account register</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Latest statement</TableHead>
                <TableHead>Matched lines</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <div className="font-medium">{account.account_name}</div>
                    <div className="text-xs text-muted-foreground">{account.account_code}</div>
                  </TableCell>
                  <TableCell>{account.currency_code}</TableCell>
                  <TableCell>
                    {account.latest ? (
                      <div>
                        <div className="font-medium">{account.latest.statement_reference}</div>
                        <div className="text-xs text-muted-foreground">
                          {account.latest.statement_end.slice(0, 10)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No statement</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {account.latest
                      ? `${account.latest.matched_count}/${account.latest.line_count}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                        account.openCount > 0
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800",
                      ].join(" ")}
                    >
                      {account.openCount > 0 ? `${account.openCount} open` : "Balanced"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {!summaries.length && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No bank or cash accounts are configured for this company yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent reconciliation activity</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Statement</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Opening</TableHead>
                <TableHead>Closing</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...reconciliations]
                .sort(
                  (a, b) =>
                    new Date(b.statement_end).getTime() - new Date(a.statement_end).getTime(),
                )
                .slice(0, 8)
                .map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.account_name}</div>
                      <div className="text-xs text-muted-foreground">{row.account_code}</div>
                    </TableCell>
                    <TableCell>{row.statement_reference}</TableCell>
                    <TableCell>
                      {row.statement_start.slice(0, 10)} to {row.statement_end.slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      {formatMoney(row.opening_balance, row.currency_code || "KES")}
                    </TableCell>
                    <TableCell>
                      {formatMoney(row.closing_balance, row.currency_code || "KES")}
                    </TableCell>
                    <TableCell>
                      <span
                        className={[
                          "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                          row.status === "draft"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800",
                        ].join(" ")}
                      >
                        {row.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              {!reconciliations.length && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No reconciliation sessions have been imported yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
