import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { fetchFinanceWorkspaceV1 } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";
import { useList } from "@/lib/queryHooks";

export const Route = createFileRoute("/_app/financial-reporting")({
  component: FinancialReportingPage,
  head: () => ({ meta: [{ title: "Financial Reporting — Ayawin Stock Solution" }] }),
});

const KES = (value: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

function FinancialReportingPage() {
  const { token, user } = useAuth();

  const financeQuery = useList(
    queryKeys.finance.reports("workspace", { userId: user?.id }),
    ({ signal }) => fetchFinanceWorkspaceV1(token!, undefined, signal),
    { enabled: Boolean(token) },
  );

  const finance = financeQuery.data ?? {
    periods: [],
    trialBalance: { lines: [], totals: { period_debit: 0, period_credit: 0 } },
    balanceSheet: [],
    profitLoss: { lines: [], net_profit: 0 },
    cashFlow: {
      operating: 0,
      investing: 0,
      financing: 0,
      net_movement: 0,
      opening_cash: 0,
      closing_cash: 0,
      reconciliation_variance: 0,
      lines: [],
    },
  };

  const income = finance.profitLoss.lines
    .filter((row) => row.account_type === "income")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const operatingCosts = finance.profitLoss.lines
    .filter((row) => row.account_type === "expense")
    .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);
  const netProfit = income - operatingCosts;
  const cashPosition = finance.cashFlow.closing_cash || Math.max(0, netProfit);

  const summaryCards = [
    { label: "Revenue", value: income },
    { label: "Operating costs", value: operatingCosts },
    { label: "Net profit", value: netProfit },
    { label: "Cash position", value: cashPosition },
  ];

  const trialBalance = finance.trialBalance.lines.map((row) => ({
    account: row.account_name || row.account_code || "Unnamed account",
    debit:
      Number(row.period_debit || row.balance || 0) > 0
        ? Number(row.period_debit || row.balance || 0)
        : 0,
    credit:
      Number(row.period_credit || row.balance || 0) > 0
        ? Number(row.period_credit || row.balance || 0)
        : 0,
  }));

  const balanceSheet = [
    {
      item: "Assets",
      amount: finance.balanceSheet
        .filter((row) => row.account_type === "asset")
        .reduce((sum, row) => sum + Math.abs(Number(row.balance || 0)), 0),
    },
    {
      item: "Liabilities",
      amount: finance.balanceSheet
        .filter((row) => row.account_type === "liability")
        .reduce((sum, row) => sum + Math.abs(Number(row.balance || 0)), 0),
    },
    {
      item: "Equity",
      amount: finance.balanceSheet
        .filter((row) => row.account_type === "equity")
        .reduce((sum, row) => sum + Math.abs(Number(row.balance || 0)), 0),
    },
  ];

  const cashFlow = finance.cashFlow.lines.length
    ? finance.cashFlow.lines.map((row) => ({
        item:
          row.activity === "operating"
            ? "Operating cash flow"
            : row.activity === "investing"
              ? "Investing cash flow"
              : row.activity === "financing"
                ? "Financing cash flow"
                : row.activity,
        amount: Number(row.amount || 0),
      }))
    : [
        { item: "Operating cash flow", amount: finance.cashFlow.operating },
        { item: "Investing cash flow", amount: finance.cashFlow.investing },
        { item: "Financing cash flow", amount: finance.cashFlow.financing },
      ];

  const selectedPeriod =
    finance.periods.find((period) => period.status === "open") ?? finance.periods[0];
  const periodLabel = selectedPeriod
    ? selectedPeriod.name || selectedPeriod.code || "Current period"
    : "Current period";
  const balanceStatus =
    Math.abs(finance.trialBalance.totals.period_debit - finance.trialBalance.totals.period_credit) <
    0.01
      ? "Balanced"
      : "Review needed";

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Financial Reporting"
        description={`Review the key financial statements, management metrics, and close-pack readiness for ${periodLabel}.`}
      />

      <div className="grid gap-4 md:grid-cols-4">
        {summaryCards.map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardTitle>{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{KES(item.value)}</div>
              <div className="text-sm text-muted-foreground">Current period</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trial balance snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trialBalance.map((row) => (
                <TableRow key={row.account}>
                  <TableCell className="font-medium">{row.account}</TableCell>
                  <TableCell className="text-right">{row.debit ? KES(row.debit) : "—"}</TableCell>
                  <TableCell className="text-right">{row.credit ? KES(row.credit) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Balance sheet</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Section</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balanceSheet.map((row) => (
                  <TableRow key={row.item}>
                    <TableCell>{row.item}</TableCell>
                    <TableCell className="text-right">{KES(row.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cash flow</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashFlow.map((row) => (
                  <TableRow key={row.item}>
                    <TableCell>{row.item}</TableCell>
                    <TableCell className="text-right">{KES(row.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Management pack readiness</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Trial balance
              </div>
              <div className="mt-2 text-lg font-semibold">{balanceStatus}</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                VAT return
              </div>
              <div className="mt-2 text-lg font-semibold">Locked</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Close checklist
              </div>
              <div className="mt-2 text-lg font-semibold">8/10 complete</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
