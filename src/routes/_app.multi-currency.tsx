import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useAction } from "@/lib/queryHooks";
import { toast } from "sonner";
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
import { v1Api } from "@/lib/api-v1";
import { useList } from "@/lib/queryHooks";
import { queryKeys } from "@/lib/queryKeys";

export const Route = createFileRoute("/_app/multi-currency")({
  component: MultiCurrencyPage,
  head: () => ({ meta: [{ title: "Multi-currency — Ayawin Stock Solution" }] }),
});

const formatRate = (value: number) =>
  new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value || 0));

function MultiCurrencyPage() {
  const { token, user } = useAuth();
  const [periodId, setPeriodId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");

  const fxQuery = useList(
    queryKeys.finance.reports("multi-currency", { userId: user?.id }),
    async ({ signal }) => {
      const [currencies, exchangeRates, fxPolicies, revaluations] = await Promise.all([
        v1Api.currencies.list(token!, signal),
        v1Api.currencies.exchangeRates(token!, signal),
        v1Api.currencies.fxPolicies(token!, signal),
        v1Api.currencies.fxRevaluations(token!, signal),
      ]);
      return { currencies, exchangeRates, fxPolicies, revaluations };
    },
    { enabled: Boolean(token) },
  );
  const periodsQuery = useList(
    ["finance", "fiscal-periods"],
    ({ signal }) => v1Api.finance.fiscalPeriods(token!, signal),
    { enabled: Boolean(token) },
  );
  const revaluationAction = useAction({
    mutationFn: (input: { period_id: string; currency_code: string }) =>
      v1Api.currencies.postFxRevaluation(token!, input),
    invalidate: [queryKeys.finance.fxRevaluations(), queryKeys.accounting.snapshot()],
  });

  const data = fxQuery.data ?? {
    currencies: [],
    exchangeRates: [],
    fxPolicies: [],
    revaluations: [],
  };
  const openPeriods = (periodsQuery.data ?? []).filter((period) => period.status === "open");
  const approvedCurrencies = [
    ...new Set(
      data.fxPolicies
        .filter((policy) => String(policy.status).toLowerCase() === "approved")
        .map((policy) => String(policy.currency_code)),
    ),
  ];
  const postRevaluation = async () => {
    if (!periodId || !currencyCode) return;
    try {
      const result = await revaluationAction.mutateAsync({
        period_id: periodId,
        currency_code: currencyCode,
      });
      toast.success(
        `FX revaluation posted with ${result.lines.length} account balances and automatic reversal.`,
      );
      await fxQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to post FX revaluation");
    }
  };

  const approvedRates = data.exchangeRates.filter(
    (row) => String(row.status || "approved").toLowerCase() === "approved",
  ).length;
  const activePolicies = data.fxPolicies.filter(
    (row) => String(row.status || "approved").toLowerCase() === "approved",
  ).length;
  const coverage =
    data.currencies.length > 1
      ? Math.min(100, Math.round((activePolicies / Math.max(data.currencies.length - 1, 1)) * 100))
      : 0;

  const summaryCards = [
    { label: "Active currencies", value: data.currencies.length },
    { label: "Approved rates", value: approvedRates },
    { label: "FX policies", value: activePolicies },
    { label: "Coverage", value: `${coverage}%` },
  ];

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Multi-currency"
        description="Track approved exchange rates, FX accounting policy coverage, and the currency exposures that flow into the finance close cycle."
      />

      {fxQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {fxQuery.error.message}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {summaryCards.map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardTitle>{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{item.value}</div>
              <div className="text-sm text-muted-foreground">Current setup</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Exchange-rate register</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pair</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Effective date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.exchangeRates.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.from_currency_code} / {row.to_currency_code}
                  </TableCell>
                  <TableCell>{formatRate(row.rate)}</TableCell>
                  <TableCell>{row.effective_date}</TableCell>
                  <TableCell>{row.source || "Manual entry"}</TableCell>
                  <TableCell>
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                        String(row.status || "approved").toLowerCase() === "approved"
                          ? "bg-emerald-100 text-emerald-800"
                          : String(row.status || "pending").toLowerCase() === "rejected"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-800",
                      ].join(" ")}
                    >
                      {String(row.status || "approved").toLowerCase()}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Period-end revaluation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <select
              aria-label="Fiscal period"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={periodId}
              onChange={(event) => setPeriodId(event.target.value)}
            >
              <option value="">Select open period</option>
              {openPeriods.map((period) => (
                <option key={String(period.id)} value={String(period.id)}>
                  {String(period.name)} · {String(period.end_date).slice(0, 10)}
                </option>
              ))}
            </select>
            <select
              aria-label="Foreign currency"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={currencyCode}
              onChange={(event) => setCurrencyCode(event.target.value)}
            >
              <option value="">Select approved policy currency</option>
              {approvedCurrencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <Button
              onClick={() => void postRevaluation()}
              disabled={!periodId || !currencyCode || revaluationAction.isPending}
            >
              {revaluationAction.isPending ? "Posting…" : "Post and reverse"}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Gain</TableHead>
                  <TableHead className="text-right">Loss</TableHead>
                  <TableHead>Adjustment journal</TableHead>
                  <TableHead>Reversal journal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.revaluations.length ? (
                  data.revaluations.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>{run.period_name}</TableCell>
                      <TableCell>{run.currency_code}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRate(run.closing_rate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(run.total_gain).toLocaleString("en-KE", {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(run.total_loss).toLocaleString("en-KE", {
                          minimumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>{run.journal_id || "No adjustment required"}</TableCell>
                      <TableCell>{run.reversal_journal_id || "—"}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      No period-end revaluations have been posted.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>FX accounting policy coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Currency</TableHead>
                <TableHead>Rate direction</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Rounding</TableHead>
                <TableHead>Reversal</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.fxPolicies.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.currency_code}</TableCell>
                  <TableCell>{row.rate_direction}</TableCell>
                  <TableCell>{row.rate_source || "Policy source"}</TableCell>
                  <TableCell>{row.rounding_method || "half_up"}</TableCell>
                  <TableCell>{row.reversal_policy || "auto_reversal"}</TableCell>
                  <TableCell>
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                        String(row.status || "approved").toLowerCase() === "approved"
                          ? "bg-emerald-100 text-emerald-800"
                          : String(row.status || "pending").toLowerCase() === "rejected"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-800",
                      ].join(" ")}
                    >
                      {String(row.status || "approved").toLowerCase()}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
