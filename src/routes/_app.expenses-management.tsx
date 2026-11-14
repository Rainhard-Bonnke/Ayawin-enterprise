import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { v1Api } from "@/lib/api-v1";
import { useAction, useList } from "@/lib/queryHooks";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/expenses-management")({
  component: ExpensesManagementPage,
  head: () => ({ meta: [{ title: "Expenses Management — Ayawin Stock Solution" }] }),
});

const KES = (value: number) =>
  new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

function ExpensesManagementPage() {
  const { token } = useAuth();
  const { user } = useAuth();
  const [claimOpen, setClaimOpen] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingClaimId, setUploadingClaimId] = useState<string | null>(null);
  const [paymentClaimId, setPaymentClaimId] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [claimDate, setClaimDate] = useState(new Date().toISOString().slice(0, 10));
  const [claimDescription, setClaimDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [lineDescription, setLineDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [costCentre, setCostCentre] = useState("");
  const summaryQuery = useList(
    queryKeys.expenses.summary(),
    ({ signal }) => v1Api.expenses.summary(token!, signal),
    { enabled: Boolean(token) },
  );
  const categoriesQuery = useList(
    queryKeys.expenses.categories(),
    ({ signal }) => v1Api.expenses.categories(token!, signal),
    { enabled: Boolean(token) },
  );
  const bankAccountsQuery = useList(
    ["finance", "bank-accounts"],
    ({ signal }) => v1Api.finance.bankAccounts(token!, signal),
    { enabled: Boolean(token) },
  );
  const createClaimAction = useAction({
    mutationFn: (payload: {
      claim_date: string;
      description: string;
      currency_code: string;
      lines: Array<{
        category_id: string;
        description: string;
        amount: number;
        cost_centre?: string;
      }>;
    }) => v1Api.expenses.createClaim(token!, payload),
    invalidate: [queryKeys.expenses.summary()],
  });
  const decisionAction = useAction({
    mutationFn: (input: { claimId: string; action: "approve" | "reject"; note?: string }) =>
      v1Api.expenses.decideClaim(token!, input.claimId, input.action, input.note),
    invalidate: [queryKeys.expenses.summary()],
  });
  const paymentAction = useAction({
    mutationFn: (input: {
      claimId: string;
      payment_date: string;
      payment_reference: string;
      bank_account_id: string;
    }) =>
      v1Api.expenses.reimburseClaim(token!, input.claimId, {
        payment_date: input.payment_date,
        payment_reference: input.payment_reference,
        bank_account_id: input.bank_account_id,
      }),
    invalidate: [queryKeys.expenses.summary()],
  });
  const uploadReceipt = async (claimId: string, file: File) => {
    if (!token) return;
    setUploadingClaimId(claimId);
    try {
      await v1Api.expenses.uploadReceipt(token, claimId, {
        file,
        file_name: file.name,
        content_type: file.type,
      });
      toast.success("Receipt attached to expense claim");
      await summaryQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload receipt");
    } finally {
      setUploadingClaimId(null);
    }
  };
  const submitClaim = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !categoryId) return;
    try {
      const created = await createClaimAction.mutateAsync({
        claim_date: claimDate,
        description: claimDescription,
        currency_code: "KES",
        lines: [
          {
            category_id: categoryId,
            description: lineDescription,
            amount: Number(amount),
            cost_centre: costCentre || undefined,
          },
        ],
      });
      const claimId = String(created.id || "");
      toast.success("Expense claim submitted for review");
      setClaimOpen(false);
      setClaimDescription("");
      setLineDescription("");
      setAmount("");
      setCostCentre("");
      const submittedReceipt = receiptFile;
      setReceiptFile(null);
      await summaryQuery.refetch();
      if (submittedReceipt && claimId) await uploadReceipt(claimId, submittedReceipt);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit expense claim");
    }
  };

  const decideClaim = async (claimId: string, action: "approve" | "reject") => {
    const note =
      action === "reject" ? window.prompt("Reason for rejecting this claim")?.trim() : undefined;
    if (action === "reject" && !note) return;
    try {
      await decisionAction.mutateAsync({ claimId, action, note });
      toast.success(
        action === "approve" ? "Claim approved and posted to the ledger" : "Claim rejected",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to review expense claim");
    }
  };

  const payClaim = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentClaimId || !paymentAccountId) return;
    try {
      await paymentAction.mutateAsync({
        claimId: paymentClaimId,
        payment_date: paymentDate,
        payment_reference: paymentReference,
        bank_account_id: paymentAccountId,
      });
      toast.success("Reimbursement posted to the selected bank account");
      setPaymentClaimId(null);
      setPaymentReference("");
      await summaryQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reimburse expense claim");
    }
  };

  const summary = summaryQuery.data ?? {
    summary: [
      { label: "Claims submitted", value: 0, tone: "blue" },
      { label: "Approved", value: 0, tone: "emerald" },
      { label: "Pending amount", value: 0, tone: "amber" },
      { label: "Policy adherence", value: 0, tone: "slate" },
    ],
    claims: [],
    budgets: [],
    status: "No claims",
  };

  const claims = summary.claims ?? [];
  const budgets = summary.budgets ?? [];

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Expenses Management"
        description="Track employee expense claims, policy compliance, and cost-centre performance in one view."
        actions={
          <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
            <DialogTrigger asChild>
              <Button disabled={!categoriesQuery.data?.length}>
                <Plus className="mr-2 h-4 w-4" /> Submit claim
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Submit expense claim</DialogTitle>
                <DialogDescription>
                  Enter the claim details and attach the receipt for review.
                </DialogDescription>
              </DialogHeader>
              <form id="expense-claim-form" className="grid gap-4" onSubmit={submitClaim}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="expense-claim-date">Expense date</Label>
                    <Input
                      id="expense-claim-date"
                      type="date"
                      required
                      value={claimDate}
                      onChange={(event) => setClaimDate(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expense-category">Category</Label>
                    <select
                      id="expense-category"
                      required
                      value={categoryId}
                      onChange={(event) => setCategoryId(event.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select category</option>
                      {(categoriesQuery.data ?? []).map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-claim-description">Claim description</Label>
                  <Input
                    id="expense-claim-description"
                    required
                    maxLength={500}
                    value={claimDescription}
                    onChange={(event) => setClaimDescription(event.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="expense-line-description">Expense line</Label>
                    <Input
                      id="expense-line-description"
                      required
                      maxLength={300}
                      value={lineDescription}
                      onChange={(event) => setLineDescription(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expense-amount">Amount (KES)</Label>
                    <Input
                      id="expense-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-cost-centre">Cost centre</Label>
                  <Input
                    id="expense-cost-centre"
                    maxLength={100}
                    value={costCentre}
                    onChange={(event) => setCostCentre(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-receipt">Receipt</Label>
                  <Input
                    id="expense-receipt"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    required
                    onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">
                    JPEG, PNG, WebP or PDF, up to 5 MB.
                  </p>
                </div>
              </form>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setClaimOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="expense-claim-form"
                  disabled={createClaimAction.isPending}
                >
                  {createClaimAction.isPending ? "Submitting…" : "Submit claim"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        {summary.summary?.map((item) => (
          <Card key={item.label}>
            <CardHeader>
              <CardTitle>{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {typeof item.value === "number"
                  ? item.label === "Policy adherence"
                    ? `${item.value}%`
                    : item.value
                  : item.value}
              </div>
              <div className="text-sm text-muted-foreground">
                {item.label === "Pending amount"
                  ? "Awaiting approval"
                  : item.label === "Approved"
                    ? "Passed review"
                    : item.label === "Claims submitted"
                      ? "Current cycle"
                      : "Within claim policy"}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Expense claims</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.length ? (
                claims.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.employee}</TableCell>
                    <TableCell>{row.category}</TableCell>
                    <TableCell className="text-right">{KES(Number(row.amount || 0))}</TableCell>
                    <TableCell>
                      <span
                        className={[
                          "inline-flex rounded-full px-2 py-1 text-xs font-medium",
                          row.status === "approved" || row.status === "paid"
                            ? "bg-emerald-100 text-emerald-800"
                            : row.status === "submitted"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-rose-100 text-rose-800",
                        ].join(" ")}
                      >
                        {row.status}
                      </span>
                    </TableCell>
                    <TableCell>{row.date}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {row.status === "submitted" && row.requested_by !== user?.id && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void decideClaim(row.id, "approve")}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void decideClaim(row.id, "reject")}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {row.status === "submitted" &&
                          row.requested_by === user?.id &&
                          row.attachment_count === 0 && (
                            <Label className="cursor-pointer text-xs">
                              {uploadingClaimId === row.id ? "Uploading…" : "Attach receipt"}
                              <Input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,application/pdf"
                                disabled={uploadingClaimId === row.id}
                                className="sr-only"
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (file) void uploadReceipt(row.id, file);
                                  event.currentTarget.value = "";
                                }}
                              />
                            </Label>
                          )}
                        {row.status === "approved" &&
                          row.requested_by !== user?.id &&
                          row.reviewed_by !== user?.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPaymentClaimId(row.id)}
                            >
                              Reimburse
                            </Button>
                          )}
                        {row.attachment_count > 0 && (
                          <span className="text-xs text-muted-foreground">Receipt attached</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No expense claims have been submitted.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(paymentClaimId)}
        onOpenChange={(open) => !open && setPaymentClaimId(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reimburse expense claim</DialogTitle>
            <DialogDescription>
              Record a bank payment with a separate finance approver.
            </DialogDescription>
          </DialogHeader>
          <form id="expense-payment-form" className="grid gap-4" onSubmit={payClaim}>
            <div className="space-y-1.5">
              <Label htmlFor="expense-payment-date">Payment date</Label>
              <Input
                id="expense-payment-date"
                type="date"
                required
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-payment-reference">Payment reference</Label>
              <Input
                id="expense-payment-reference"
                required
                maxLength={120}
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-payment-account">Cash or bank account</Label>
              <select
                id="expense-payment-account"
                required
                value={paymentAccountId}
                onChange={(event) => setPaymentAccountId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select account</option>
                {(bankAccountsQuery.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.account_code} · {account.account_name}
                  </option>
                ))}
              </select>
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPaymentClaimId(null)}>
              Cancel
            </Button>
            <Button type="submit" form="expense-payment-form" disabled={paymentAction.isPending}>
              {paymentAction.isPending ? "Posting…" : "Post reimbursement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Category budget performance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Allocated</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {budgets.length ? (
                budgets.map((row) => (
                  <TableRow key={row.category}>
                    <TableCell className="font-medium">{row.category}</TableCell>
                    <TableCell className="text-right">{KES(Number(row.allocated || 0))}</TableCell>
                    <TableCell className="text-right">{KES(Number(row.used || 0))}</TableCell>
                    <TableCell className="text-right">{KES(Number(row.remaining || 0))}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    No expense budgets are configured for this year.
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
