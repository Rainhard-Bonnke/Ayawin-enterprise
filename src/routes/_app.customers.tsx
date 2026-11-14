import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Controller, useForm, type FieldError, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListPagination } from "@/components/ListPagination";
import { MoneyText } from "@/components/MoneyText";
import { FormDialog } from "@/components/FormDialog";
import { QuietNote } from "@/components/QuietNote";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchBar } from "@/components/SearchBar";
import { KES } from "@/lib/format";
import { customerHealth } from "@/lib/smartSignals";
import { exportWorkbook } from "@/lib/excel";
import { type BackendCustomer } from "@/lib/api-types";
import { normalizeMasterCustomer, v1Api } from "@/lib/api-v1";
import { useAuth } from "@/lib/auth";
import { queryKeys } from "@/lib/queryKeys";
import { useAction, useList } from "@/lib/queryHooks";
import { useUrlSearchParam } from "@/lib/urlSearchState";
import { trackEvent } from "@/lib/event-tracker";
import { customerFormSchema, type CustomerFormValues } from "@/schemas/customers";
import { toast } from "sonner";

const emptyForm = (): CustomerFormValues => ({
  name: "",
  kra_pin: "",
  contact: "",
  email: "",
  address: "",
  location: "",
  type: "Bar/Restaurant",
  segment: "Bar/Restaurant",
  credit_limit: "0.00",
  payment_terms: "Net 30",
});

const segmentOptions = ["Bar/Restaurant", "Wholesaler", "Retailer", "Distributor", "Supermarket"];
const EMPTY_CUSTOMERS: BackendCustomer[] = [];

export const Route = createFileRoute("/_app/customers")({
  component: CustomersPage,
  head: () => ({ meta: [{ title: "Customers (CRM) - Ayawin Stock Solution" }] }),
});

function CustomersPage() {
  const { token, user } = useAuth();
  const [q, setQ] = useUrlSearchParam("q", "");
  const [segment, setSegment] = useUrlSearchParam("segment", "all");
  const [sort, setSort] = useUrlSearchParam("sort", "name");
  const [pageValue, setPageValue] = useUrlSearchParam("page", "1");
  const page = Math.max(1, Number(pageValue) || 1);
  const setPage = (next: number) => setPageValue(String(Math.max(1, next)));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BackendCustomer | null>(null);
  const {
    register,
    control,
    reset,
    setValue,
    setError,
    clearErrors,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: emptyForm(),
  });
  const saving = isSubmitting;
  const pageSize = 5;
  const customersQuery = useList(
    [...queryKeys.customers.list(), user?.id],
    async ({ signal }) =>
      (await v1Api.master.customers(token!, "", signal)).map(normalizeMasterCustomer),
    { enabled: Boolean(token) },
  );
  const createCustomerAction = useAction({
    mutationFn: (payload: Parameters<typeof v1Api.master.createCustomer>[1]) =>
      v1Api.master.createCustomer(token!, payload),
    invalidate: [queryKeys.customers.list()],
  });
  const updateCustomerAction = useAction({
    mutationFn: (input: {
      id: string | number;
      payload: Parameters<typeof v1Api.master.updateCustomer>[2];
    }) => v1Api.master.updateCustomer(token!, input.id, input.payload),
    invalidate: [queryKeys.customers.list()],
  });
  const deleteCustomerAction = useAction({
    mutationFn: (id: Parameters<typeof v1Api.master.deleteCustomer>[1]) =>
      v1Api.master.deleteCustomer(token!, id),
    invalidate: [queryKeys.customers.list()],
  });
  const rows: BackendCustomer[] = customersQuery.data ?? EMPTY_CUSTOMERS;
  const loading = customersQuery.isPending;

  const loadCustomers = async () => {
    if (token) await customersQuery.refetch();
  };

  const filtered = useMemo(
    () =>
      rows
        .filter((customer) => {
          const matchesQuery =
            customer.name.toLowerCase().includes(q.toLowerCase()) ||
            (customer.location || "").toLowerCase().includes(q.toLowerCase()) ||
            (customer.email || "").toLowerCase().includes(q.toLowerCase()) ||
            customer.kra_pin.toLowerCase().includes(q.toLowerCase());
          const matchesSegment =
            segment === "all" ||
            (customer.segment || customer.type || "").toLowerCase() === segment.toLowerCase();
          return matchesQuery && matchesSegment;
        })
        .sort((a, b) => {
          if (sort === "credit") return Number(b.credit_limit) - Number(a.credit_limit);
          if (sort === "balance") return Number(b.balance) - Number(a.balance);
          return a.name.localeCompare(b.name);
        }),
    [rows, q, segment, sort],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const metrics = useMemo(() => {
    const creditExposure = rows.reduce((sum, row) => sum + Number(row.balance || 0), 0);
    const atRisk = rows.filter((row) => {
      const health = customerHealth(Number(row.balance || 0), Number(row.credit_limit || 0));
      return health.tone === "warning" || health.tone === "destructive";
    }).length;

    return [
      { l: "Active Customers", v: String(rows.length) },
      { l: "Credit Exposure", v: KES(creditExposure) },
      { l: "At Risk", v: String(atRisk) },
      { l: "Statements Ready", v: String(rows.length) },
    ];
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    reset(emptyForm());
    clearErrors();
    setDialogOpen(true);
  };

  const openEdit = (customer: BackendCustomer) => {
    setEditing(customer);
    reset({
      name: customer.name,
      kra_pin: customer.kra_pin,
      contact: customer.contact ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      location: customer.location ?? "",
      type: customer.type ?? customer.segment ?? "Bar/Restaurant",
      segment: customer.segment ?? customer.type ?? "Bar/Restaurant",
      credit_limit: Number(customer.credit_limit ?? 0).toFixed(2),
      payment_terms: customer.payment_terms ?? "Net 30",
    });
    clearErrors();
    setDialogOpen(true);
  };

  const saveCustomer = async (values: CustomerFormValues) => {
    if (!token) return;
    const payload = {
      name: values.name,
      kra_pin: values.kra_pin,
      contact: values.contact,
      email: values.email,
      address: values.address,
      location: values.location,
      type: values.type,
      segment: values.segment,
      credit_limit: Number(values.credit_limit),
      payment_terms: values.payment_terms,
    };

    clearErrors();
    try {
      if (editing) {
        const updated = await updateCustomerAction.mutateAsync({ id: editing.id, payload });
        void trackEvent({
          action: "customer_updated",
          entityType: "customer",
          entityId: String(updated.id),
          details: { name: updated.name, kra_pin: updated.kra_pin, segment: updated.segment },
          scenario: "customers",
          context: payload,
        });
        toast.success(`Customer ${updated.name} updated`);
      } else {
        const created = await createCustomerAction.mutateAsync(payload);
        void trackEvent({
          action: "customer_created",
          entityType: "customer",
          entityId: String(created.id),
          details: { name: created.name, kra_pin: created.kra_pin, segment: created.segment },
          scenario: "customers",
          context: payload,
        });
        toast.success(`Customer ${created.name} created`);
      }

      setDialogOpen(false);
      reset(emptyForm());
      setPage(1);
      await loadCustomers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save customer";
      const lowerMessage = message.toLowerCase();
      const field =
        lowerMessage.includes("pin") || lowerMessage.includes("tax")
          ? "kra_pin"
          : lowerMessage.includes("phone")
            ? "contact"
            : lowerMessage.includes("email")
              ? "email"
              : null;
      if (field) setError(field, { type: "server", message });
      else setError("root.server", { type: "server", message });
      toast.error(message);
    }
  };

  const removeCustomer = async (customer: BackendCustomer) => {
    if (!token) return;
    try {
      await deleteCustomerAction.mutateAsync(customer.id);
      void trackEvent({
        action: "customer_deleted",
        entityType: "customer",
        entityId: String(customer.id),
        details: { name: customer.name, kra_pin: customer.kra_pin },
        scenario: "customers",
        context: { name: customer.name },
      });
      toast.success(`Customer ${customer.name} deleted`);
      await loadCustomers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete customer");
    }
  };

  const exportCustomers = () => {
    exportWorkbook("ayawin-stock-solution-customers.xlsx", [
      {
        name: "Customers",
        rows: filtered.map((customer) => ({
          Customer: customer.name,
          Segment: customer.segment || customer.type,
          "KRA PIN": customer.kra_pin,
          Contact: customer.contact ?? "",
          Email: customer.email ?? "",
          Location: customer.location ?? "",
          Address: customer.address ?? "",
          "Credit Limit": Number(customer.credit_limit || 0),
          Balance: Number(customer.balance || 0),
          Terms: customer.payment_terms ?? "",
        })),
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Customer Relationship Management"
        description="Bars, restaurants, supermarkets, wholesalers and distributors with credit control."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportCustomers}>
              <Plus className="mr-2 h-4 w-4" />
              Export XLSX
            </Button>
            <Button variant="outline" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              New Customer
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.l}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {metric.l}
              </div>
              <div className="mt-1 text-2xl font-bold">{metric.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <QuietNote
        scenario="customers"
        contextKey={`${q}-${segment}-${sort}`}
        context={{ q, segment, sort, customers: paged }}
        className="mb-4"
      />

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchBar
              value={q}
              onChange={(value) => {
                setQ(value);
                setPage(1);
              }}
              placeholder="Search customer, KRA PIN or location..."
            />
            <Select
              value={segment}
              onValueChange={(value) => {
                setSegment(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All segments</SelectItem>
                {segmentOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-44">
                <ArrowUpDown className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort by name</SelectItem>
                <SelectItem value="credit">Highest credit</SelectItem>
                <SelectItem value="balance">Highest balance</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Segment</TableHead>
                <TableHead>KRA PIN</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Terms</TableHead>
                <TableHead className="w-50">Credit Utilisation</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customersQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-destructive">
                    {customersQuery.error instanceof Error
                      ? customersQuery.error.message
                      : "Unable to load customers"}
                    <Button variant="ghost" size="sm" onClick={() => void customersQuery.refetch()}>
                      Retry
                    </Button>
                  </TableCell>
                </TableRow>
              ) : loading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Loading customers...
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((customer) => {
                  const limit = Number(customer.credit_limit || 0);
                  const balance = Number(customer.balance || 0);
                  const utilisation =
                    limit > 0 ? Math.min(100, Math.round((balance / limit) * 100)) : 0;
                  const health = customerHealth(
                    Number(customer.balance || 0),
                    Number(customer.credit_limit || 0),
                  );

                  return (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div className="font-medium">{customer.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {customer.email || "No email on file"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              health.tone === "success"
                                ? "bg-success"
                                : health.tone === "warning"
                                  ? "bg-warning"
                                  : "bg-destructive"
                            }`}
                          />
                          <Badge variant="outline">
                            {customer.segment || customer.type || "Unassigned"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{customer.kra_pin}</TableCell>
                      <TableCell className="text-xs">
                        {customer.location || customer.address || "-"}
                      </TableCell>
                      <TableCell className="text-xs">{customer.payment_terms || "-"}</TableCell>
                      <TableCell>
                        <Progress
                          value={utilisation}
                          className={
                            utilisation > 80
                              ? "[&>div]:bg-destructive"
                              : utilisation > 50
                                ? "[&>div]:bg-warning"
                                : "[&>div]:bg-success"
                          }
                        />
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {utilisation}% of <MoneyText value={customer.credit_limit} />
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {health.label} profile
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        <MoneyText value={customer.balance} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(customer)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                          <ConfirmActionDialog
                            title="Delete customer?"
                            description="This permanently removes the customer record from the CRM."
                            confirmLabel="Delete"
                            onConfirm={() => void removeCustomer(customer)}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </Button>
                          </ConfirmActionDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
              {!loading && !customersQuery.isError && paged.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No customers match your filters.
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

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Edit Customer" : "New Customer"}
        description="Maintain customer credit controls, KRA details and payment terms."
        submitLabel={editing ? "Save Changes" : "Create Customer"}
        submittingLabel="Saving..."
        isSubmitting={saving}
        onSubmit={handleSubmit(saveCustomer)}
      >
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field label="Customer Name" registration={register("name")} error={errors.name} />
          <Field label="KRA PIN" registration={register("kra_pin")} error={errors.kra_pin} />
          <Field
            label="Contact"
            type="tel"
            registration={register("contact")}
            error={errors.contact}
          />
          <Field label="Email" type="email" registration={register("email")} error={errors.email} />
          <Field label="Address" registration={register("address")} error={errors.address} />
          <Field label="Location" registration={register("location")} error={errors.location} />
          <div className="space-y-1.5">
            <Label htmlFor="customer-segment">Segment</Label>
            <Controller
              control={control}
              name="segment"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    setValue("type", value, { shouldValidate: true });
                  }}
                >
                  <SelectTrigger id="customer-segment" aria-invalid={Boolean(errors.segment)}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {segmentOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.segment && (
              <p role="alert" className="text-xs text-destructive">
                {errors.segment.message}
              </p>
            )}
          </div>
          <Field
            label="Payment Terms"
            registration={register("payment_terms")}
            error={errors.payment_terms}
          />
          <Field
            label="Credit Limit"
            inputMode="decimal"
            registration={register("credit_limit")}
            error={errors.credit_limit}
          />
        </div>
        {errors.root?.server && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.server.message}
          </p>
        )}
      </FormDialog>
    </div>
  );
}

function Field({
  label,
  registration,
  error,
  type = "text",
  inputMode,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
  type?: string;
  inputMode?: "decimal" | "email" | "numeric" | "tel" | "text";
}) {
  const errorId = `${registration.name}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={registration.name}>{label}</Label>
      <Input
        id={registration.name}
        type={type}
        inputMode={inputMode}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        {...registration}
      />
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error.message}
        </p>
      )}
    </div>
  );
}
