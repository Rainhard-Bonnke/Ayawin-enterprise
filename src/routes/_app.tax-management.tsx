import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
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
import { v1Api } from "@/lib/api-v1";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMPTY_ARRAY, useAction, useList } from "@/lib/queryHooks";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/tax-management")({
  component: TaxManagementPage,
  head: () => ({ meta: [{ title: "Tax Management — Ayawin Stock Solution" }] }),
});

const KES = (value: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

function TaxManagementPage() {
  const { token } = useAuth();
  const [categoryFormOpen, setCategoryFormOpen] = useState(false);
  const [categoryCode, setCategoryCode] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [residency, setResidency] = useState<"resident" | "non_resident">("resident");
  const [rate, setRate] = useState("");
  const [taxableBasis, setTaxableBasis] = useState<"net_before_vat" | "gross_including_vat">(
    "net_before_vat",
  );
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState("");
  const [remittanceDays, setRemittanceDays] = useState("5");
  const [liabilityAccountId, setLiabilityAccountId] = useState("");
  const [selectedObligations, setSelectedObligations] = useState<string[]>([]);
  const [remittanceDate, setRemittanceDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentReference, setPaymentReference] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const summaryQuery = useList(
    queryKeys.tax.summary(),
    ({ signal }) => v1Api.tax.summary(token!, signal),
    { enabled: Boolean(token) },
  );
  const categoriesQuery = useList(
    queryKeys.tax.withholdingCategories(),
    ({ signal }) => v1Api.tax.withholdingCategories(token!, signal),
    { enabled: Boolean(token) },
  );
  const obligationsQuery = useList(
    queryKeys.tax.withholdingObligations(),
    ({ signal }) => v1Api.tax.withholdingObligations(token!, signal),
    { enabled: Boolean(token) },
  );
  const accountsQuery = useList(
    ["master", "chart-of-accounts"],
    ({ signal }) => v1Api.master.chartOfAccounts(token!, signal),
    { enabled: Boolean(token) },
  );
  const bankAccountsQuery = useList(
    ["finance", "bank-accounts"],
    ({ signal }) => v1Api.finance.bankAccounts(token!, signal),
    { enabled: Boolean(token) },
  );
  const createCategoryAction = useAction({
    mutationFn: (payload: Parameters<typeof v1Api.tax.createWithholdingCategory>[1]) =>
      v1Api.tax.createWithholdingCategory(token!, payload),
    invalidate: [queryKeys.tax.withholdingCategories()],
  });
  const approveCategoryAction = useAction({
    mutationFn: (id: string) => v1Api.tax.approveWithholdingCategory(token!, id),
    invalidate: [queryKeys.tax.withholdingCategories()],
  });
  const remitAction = useAction({
    mutationFn: (_input: undefined) =>
      v1Api.tax.remitWithholding(token!, {
        obligation_ids: selectedObligations,
        remittance_date: remittanceDate,
        payment_reference: paymentReference,
        bank_account_id: bankAccountId,
      }),
    invalidate: [queryKeys.tax.summary(), queryKeys.tax.withholdingObligations()],
  });
  const createCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await createCategoryAction.mutateAsync({
        code: categoryCode,
        name: categoryName,
        residency,
        rate: Number(rate),
        taxable_basis: taxableBasis,
        effective_from: effectiveFrom,
        effective_to: effectiveTo || null,
        remittance_working_days: Number(remittanceDays),
        liability_account_id: liabilityAccountId,
      });
      toast.success("Withholding category saved for independent approval");
      setCategoryFormOpen(false);
      setCategoryCode("");
      setCategoryName("");
      setRate("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save withholding category");
    }
  };
  const approveCategory = async (id: string) => {
    try {
      await approveCategoryAction.mutateAsync(id);
      toast.success("Withholding category approved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to approve category");
    }
  };
  const submitRemittance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await remitAction.mutateAsync(undefined);
      toast.success("Withholding remittance posted and certificates issued");
      setSelectedObligations([]);
      setPaymentReference("");
      await summaryQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to post WHT remittance");
    }
  };

  const summary = summaryQuery.data ?? {
    summary: [
      { label: "VAT due", value: 0, tone: "amber" },
      { label: "WHT payable", value: 0, tone: "slate" },
      { label: "Input VAT claim", value: 0, tone: "emerald" },
      { label: "Tax calendar status", value: "No deadlines", tone: "blue" },
    ],
    obligations: [],
    deadlines: [],
    followUps: [],
  };

  const taxSummaryData = summary.summary ?? [];
  const taxRows = summary.obligations ?? EMPTY_ARRAY;
  const taxDeadlinesData = summary.deadlines ?? EMPTY_ARRAY;
  const followUps = summary.followUps ?? EMPTY_ARRAY;
  const categories = categoriesQuery.data ?? EMPTY_ARRAY;
  const obligations = obligationsQuery.data ?? EMPTY_ARRAY;
  const liabilityAccounts = ((accountsQuery.data ?? []) as Array<Record<string, unknown>>).filter(
    (account) => account.account_type === "liability" && account.is_active && account.is_postable,
  );
  const bankAccounts = bankAccountsQuery.data ?? EMPTY_ARRAY;
  const outstanding = obligations.filter((item) => item.status === "outstanding");

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Tax Management"
        description="Track VAT, WHT, tax calendar deadlines and statutory filing readiness across the accounting period."
        actions={
          <Button variant="outline" onClick={() => setCategoryFormOpen((open) => !open)}>
            <Plus className="mr-2 h-4 w-4" /> Withholding category
          </Button>
        }
      />

      {summaryQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {summaryQuery.error.message}
        </p>
      )}

      {categoryFormOpen && (
        <Card>
          <CardHeader>
            <CardTitle>Configure withholding category</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={createCategory}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wht-code">Code</Label>
                  <Input
                    id="wht-code"
                    required
                    maxLength={40}
                    value={categoryCode}
                    onChange={(event) => setCategoryCode(event.target.value.toUpperCase())}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wht-name">Category</Label>
                  <Input
                    id="wht-name"
                    required
                    maxLength={180}
                    value={categoryName}
                    onChange={(event) => setCategoryName(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wht-residency">Supplier residency</Label>
                  <select
                    id="wht-residency"
                    value={residency}
                    onChange={(event) =>
                      setResidency(event.target.value as "resident" | "non_resident")
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="resident">Resident</option>
                    <option value="non_resident">Non-resident</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wht-rate">Rate (%)</Label>
                  <Input
                    id="wht-rate"
                    type="number"
                    min="0.00001"
                    max="100"
                    step="0.00001"
                    required
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wht-basis">Taxable basis</Label>
                  <select
                    id="wht-basis"
                    value={taxableBasis}
                    onChange={(event) =>
                      setTaxableBasis(
                        event.target.value as "net_before_vat" | "gross_including_vat",
                      )
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="net_before_vat">Net before VAT</option>
                    <option value="gross_including_vat">Gross including VAT</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wht-effective-from">Effective from</Label>
                  <Input
                    id="wht-effective-from"
                    type="date"
                    required
                    value={effectiveFrom}
                    onChange={(event) => setEffectiveFrom(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wht-effective-to">Effective to</Label>
                  <Input
                    id="wht-effective-to"
                    type="date"
                    min={effectiveFrom}
                    value={effectiveTo}
                    onChange={(event) => setEffectiveTo(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wht-days">Remittance working days</Label>
                  <Input
                    id="wht-days"
                    type="number"
                    min="1"
                    max="30"
                    step="1"
                    required
                    value={remittanceDays}
                    onChange={(event) => setRemittanceDays(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="wht-liability">WHT payable account</Label>
                  <select
                    id="wht-liability"
                    required
                    value={liabilityAccountId}
                    onChange={(event) => setLiabilityAccountId(event.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Select liability account</option>
                    {liabilityAccounts.map((account) => (
                      <option key={String(account.id)} value={String(account.id)}>
                        {String(account.account_code)} · {String(account.account_name)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCategoryFormOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createCategoryAction.isPending}>
                  {createCategoryAction.isPending ? "Saving…" : "Save draft category"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Withholding categories</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Residency</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.length ? (
                  categories.map((category) => (
                    <TableRow key={category.id}>
                      <TableCell>
                        <div className="font-medium">{category.name}</div>
                        <div className="text-xs text-muted-foreground">{category.code}</div>
                      </TableCell>
                      <TableCell>
                        {category.residency === "resident" ? "Resident" : "Non-resident"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(category.rate)}%
                      </TableCell>
                      <TableCell>
                        {category.taxable_basis === "net_before_vat"
                          ? "Net before VAT"
                          : "Gross incl. VAT"}
                      </TableCell>
                      <TableCell>
                        {category.effective_from}
                        {category.effective_to ? ` to ${category.effective_to}` : " onward"}
                      </TableCell>
                      <TableCell>{category.status}</TableCell>
                      <TableCell>{category.liability_account_code}</TableCell>
                      <TableCell>
                        {category.status === "draft" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void approveCategory(category.id)}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" />
                            Approve
                          </Button>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      No withholding categories configured.
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
          <CardTitle>Withholding obligations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Select</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Taxable base</TableHead>
                  <TableHead className="text-right">WHT</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status / certificate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {obligations.length ? (
                  obligations.map((obligation) => (
                    <TableRow key={obligation.id}>
                      <TableCell>
                        {obligation.status === "outstanding" ? (
                          <input
                            type="checkbox"
                            aria-label={`Select ${obligation.vendor_name} withholding obligation`}
                            checked={selectedObligations.includes(obligation.id)}
                            onChange={(event) =>
                              setSelectedObligations((current) =>
                                event.target.checked
                                  ? [...current, obligation.id]
                                  : current.filter((id) => id !== obligation.id),
                              )
                            }
                          />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{obligation.vendor_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {obligation.vendor_code}
                        </div>
                      </TableCell>
                      <TableCell>{obligation.category_name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {KES(Number(obligation.taxable_base))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {KES(Number(obligation.amount))}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({Number(obligation.rate)}%)
                        </span>
                      </TableCell>
                      <TableCell>{obligation.due_date}</TableCell>
                      <TableCell>
                        {obligation.status === "remitted"
                          ? obligation.certificate_no || "Remitted"
                          : "Outstanding"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      No withholding obligations have been generated.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {selectedObligations.length > 0 && (
            <form
              className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4"
              onSubmit={submitRemittance}
            >
              <div className="space-y-1.5">
                <Label htmlFor="wht-remittance-date">Remittance date</Label>
                <Input
                  id="wht-remittance-date"
                  type="date"
                  required
                  value={remittanceDate}
                  onChange={(event) => setRemittanceDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wht-payment-reference">Payment reference</Label>
                <Input
                  id="wht-payment-reference"
                  required
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wht-bank-account">Pay from</Label>
                <select
                  id="wht-bank-account"
                  required
                  value={bankAccountId}
                  onChange={(event) => setBankAccountId(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select bank account</option>
                  {bankAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.account_code} · {account.account_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={remitAction.isPending || !bankAccountId}>
                  {remitAction.isPending
                    ? "Posting…"
                    : `Remit ${selectedObligations.length} obligations`}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        {taxSummaryData.map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardTitle>{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {typeof item.value === "number" ? KES(item.value) : item.value}
              </div>
              <div className="text-sm text-muted-foreground">
                {item.tone === "amber"
                  ? "Current return obligations"
                  : item.tone === "slate"
                    ? "Remittance due"
                    : item.tone === "emerald"
                      ? "Recoverable credits"
                      : "Compliance checkpoint"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tax obligations</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tax type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Period</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {taxRows.map((row) => (
                <TableRow key={row.type}>
                  <TableCell className="font-medium">{row.type}</TableCell>
                  <TableCell className="text-right">{KES(row.amount)}</TableCell>
                  <TableCell>
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                        row.status === "Awaiting payment"
                          ? "bg-amber-100 text-amber-800"
                          : row.status === "Validated" || row.status === "Filed"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-200 text-slate-700",
                      ].join(" ")}
                    >
                      {row.status}
                    </span>
                  </TableCell>
                  <TableCell>{row.period}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filing item</TableHead>
                <TableHead>Due date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {taxDeadlinesData.map((item) => (
                <TableRow key={item.name}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.due}</TableCell>
                  <TableCell>
                    <span
                      className={[
                        "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                        item.status === "Ready" || item.status === "Draft ready"
                          ? "bg-emerald-100 text-emerald-800"
                          : item.status === "Pending approval" || item.status === "In review"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-200 text-slate-700",
                      ].join(" ")}
                    >
                      {item.status}
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
          <CardTitle>Follow-up actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {followUps.map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="text-2xl font-bold">{item.value}</div>
                <div className="mt-2 font-medium">{item.label}</div>
                <div className="mt-1 text-sm text-muted-foreground">{item.detail}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
