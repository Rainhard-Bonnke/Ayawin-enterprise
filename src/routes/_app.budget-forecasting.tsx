import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { v1Api, type BudgetForecastResponse } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";
import { EMPTY_ARRAY, useList } from "@/lib/queryHooks";

export const Route = createFileRoute("/_app/budget-forecasting")({
  component: BudgetForecastingPage,
  head: () => ({ meta: [{ title: "Budget & Forecasting — Ayawin Stock Solution" }] }),
});

const KES = (value: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const defaultBudgetForecast: BudgetForecastResponse = {
  metrics: {
    total_budget: 14600000,
    total_actual: 14140000,
    total_forecast: 14940000,
    variance: -460000,
  },
  filters: { periodStart: "2026-01-01", periodEnd: "2026-12-31", limit: 4 },
  assumptions: [
    { label: "Revenue growth", value: "12.4% y/y" },
    { label: "Gross margin target", value: "31.0%" },
    { label: "Cash conversion", value: "70 days" },
    { label: "Seasonality adjustment", value: "+4.5% Q4 uplift" },
  ],
  lines: [
    {
      department: "Operations",
      budget: 4200000,
      actual: 3950000,
      forecast: 4300000,
      status: "On track",
      variance: -250000,
    },
    {
      department: "Sales",
      budget: 5200000,
      actual: 4900000,
      forecast: 5350000,
      status: "Ahead",
      variance: -300000,
    },
    {
      department: "Procurement",
      budget: 3600000,
      actual: 3740000,
      forecast: 3680000,
      status: "Watch",
      variance: 140000,
    },
    {
      department: "Support",
      budget: 1600000,
      actual: 1550000,
      forecast: 1600000,
      status: "On track",
      variance: -50000,
    },
  ],
};

function BudgetForecastingPage() {
  const { token } = useAuth();
  const [periodStart, setPeriodStart] = useState("2026-01-01");
  const [periodEnd, setPeriodEnd] = useState("2026-12-31");

  const forecastQuery = useList(
    queryKeys.finance.budgetForecast({ periodStart, periodEnd }),
    async ({ signal }) =>
      v1Api.finance.budgetForecast(token!, { period_start: periodStart, period_end: periodEnd }, signal),
    {
      enabled: Boolean(token && periodStart && periodEnd && periodStart <= periodEnd),
    },
  );

  const summary = forecastQuery.data ?? defaultBudgetForecast;
  const lines = summary.lines ?? EMPTY_ARRAY;
  const assumptions = summary.assumptions ?? EMPTY_ARRAY;
  const totalBudget = summary.metrics.total_budget;
  const totalActual = summary.metrics.total_actual;
  const totalForecast = summary.metrics.total_forecast;
  const variance = summary.metrics.variance;

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Budget & Forecasting"
        description="Monitor budget performance, branch variance, and short-term forecasting against actual operating results."
      />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="budget-period-start">From</Label>
          <Input
            id="budget-period-start"
            type="date"
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="budget-period-end">To</Label>
          <Input
            id="budget-period-end"
            type="date"
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
          />
        </div>
      </div>

      {periodStart > periodEnd && (
        <p role="alert" className="text-sm text-destructive">
          The budget start date must be on or before the end date.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Budget</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{KES(totalBudget)}</div>
            <div className="text-sm text-muted-foreground">Approved operating budget</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actual YTD</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{KES(totalActual)}</div>
            <div className="text-sm text-muted-foreground">Performance to date</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Forecast</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{KES(totalForecast)}</div>
            <div className="text-sm text-muted-foreground">Projected year end</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Variance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{KES(variance)}</div>
            <div className="text-sm text-muted-foreground">Actual vs approved budget</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Department budget variance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Forecast</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((row) => (
                <TableRow key={row.department}>
                  <TableCell className="font-medium">{row.department}</TableCell>
                  <TableCell className="text-right">{KES(row.budget)}</TableCell>
                  <TableCell className="text-right">{KES(row.actual)}</TableCell>
                  <TableCell className="text-right">{KES(row.forecast)}</TableCell>
                  <TableCell className="text-right">{KES(row.actual - row.budget)}</TableCell>
                  <TableCell>
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                        row.status === "Watch"
                          ? "bg-amber-100 text-amber-800"
                          : row.status === "Ahead"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-700",
                      ].join(" ")}
                    >
                      {row.status}
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
          <CardTitle>Forecast assumptions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {assumptions.map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  {item.label}
                </div>
                <div className="mt-2 text-lg font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {forecastQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {forecastQuery.error.message}
        </p>
      )}
    </div>
  );
}
