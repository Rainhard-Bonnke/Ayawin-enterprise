import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchBar } from "@/components/SearchBar";
import { KES } from "@/lib/format";
import { customerHealth } from "@/lib/smartSignals";
import { exportWorkbook } from "@/lib/excel";
import { createCustomer, deleteCustomer, fetchCustomers, type BackendCustomer, updateCustomer } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { trackEvent } from "@/lib/event-tracker";
import { toast } from "sonner";

type CustomerFormState = {
  name: string;
  kra_pin: string;
  contact: string;
  email: string;
  address: string;
  location: string;
  type: string;
  segment: string;
  credit_limit: string;
  payment_terms: string;
  balance: string;
};

const emptyForm = (): CustomerFormState => ({
  name: "",
  kra_pin: "",
  contact: "",
  email: "",
  address: "",
  location: "",
  type: "Bar/Restaurant",
  segment: "Bar/Restaurant",
  credit_limit: "0",
  payment_terms: "Net 30",
  balance: "0",
});

const segmentOptions = ["Bar/Restaurant", "Wholesaler", "Retailer", "Distributor", "Supermarket"];

export const Route = createFileRoute("/_app/customers")({
  component: CustomersPage,
  head: () => ({ meta: [{ title: "Customers (CRM) - Ayawin Enterprise ERP" }] }),
});

function CustomersPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<BackendCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState("all");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BackendCustomer | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(emptyForm());
  const pageSize = 5;

  const loadCustomers = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await fetchCustomers(token);
      setRows(data);
    } catch {
      setRows([]);
      toast.error("Unable to load customers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCustomers();
  }, [token]);

  const filtered = useMemo(
    () =>
      rows
        .filter((customer) => {
          const matchesQuery =
            customer.name.toLowerCase().includes(q.toLowerCase()) ||
            (customer.location || "").toLowerCase().includes(q.toLowerCase()) ||
            (customer.email || "").toLowerCase().includes(q.toLowerCase()) ||
            customer.kra_pin.toLowerCase().includes(q.toLowerCase());
          const matchesSegment = segment === "all" || (customer.segment || customer.type || "").toLowerCase() === segment.toLowerCase();
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
      const health = customerHealth(row.name);
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
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (customer: BackendCustomer) => {
    setEditing(customer);
    setForm({
      name: customer.name,
      kra_pin: customer.kra_pin,
      contact: customer.contact ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      location: customer.location ?? "",
      type: customer.type ?? customer.segment ?? "Bar/Restaurant",
      segment: customer.segment ?? customer.type ?? "Bar/Restaurant",
      credit_limit: String(customer.credit_limit ?? 0),
      payment_terms: customer.payment_terms ?? "Net 30",
      balance: String(customer.balance ?? 0),
    });
    setDialogOpen(true);
  };

  const saveCustomer = async () => {
    if (!token) return;
    if (!form.name.trim() || !form.kra_pin.trim()) {
      toast.error("Customer name and KRA PIN are required");
      return;
    }

    const payload = {
      name: form.name.trim(),
      kra_pin: form.kra_pin.trim(),
      contact: form.contact.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      location: form.location.trim(),
      type: form.type.trim(),
      segment: form.segment.trim(),
      credit_limit: Number(form.credit_limit || 0),
      payment_terms: form.payment_terms.trim(),
      balance: Number(form.balance || 0),
    };

    setSaving(true);
    try {
      if (editing) {
        const updated = await updateCustomer(token, editing.id, payload);
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
        const created = await createCustomer(token, payload);
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
      setPage(1);
      await loadCustomers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save customer");
    } finally {
      setSaving(false);
    }
  };

  const removeCustomer = async (customer: BackendCustomer) => {
    if (!token) return;
    try {
      await deleteCustomer(token, customer.id);
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
    exportWorkbook("ayawin-enterprise-customers.xlsx", [
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
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{metric.l}</div>
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
                <TableHead className="w-[200px]">Credit Utilisation</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    Loading customers...
                  </TableCell>
                </TableRow>
              ) : paged.map((customer) => {
                const limit = Number(customer.credit_limit || 0);
                const balance = Number(customer.balance || 0);
                const utilisation = limit > 0 ? Math.min(100, Math.round((balance / limit) * 100)) : 0;
                const health = customerHealth(customer.name);

                return (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <div className="font-medium">{customer.name}</div>
                      <div className="text-xs text-muted-foreground">{customer.email || "No email on file"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            health.tone === "success" ? "bg-success" : health.tone === "warning" ? "bg-warning" : "bg-destructive"
                          }`}
                        />
                        <Badge variant="outline">{customer.segment || customer.type || "Unassigned"}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{customer.kra_pin}</TableCell>
                    <TableCell className="text-xs">{customer.location || customer.address || "-"}</TableCell>
                    <TableCell className="text-xs">{customer.payment_terms || "-"}</TableCell>
                    <TableCell>
                      <Progress
                        value={utilisation}
                        className={utilisation > 80 ? "[&>div]:bg-destructive" : utilisation > 50 ? "[&>div]:bg-warning" : "[&>div]:bg-success"}
                      />
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {utilisation}% of {KES(limit)}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">{health.label} profile</div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{KES(balance)}</TableCell>
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
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </ConfirmActionDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    No customers match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <ListPagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Customer" : "New Customer"}</DialogTitle>
            <DialogDescription>
              Maintain customer credit controls, KRA details and payment terms.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <Field label="Customer Name" value={form.name} onChange={(value) => setForm((prev) => ({ ...prev, name: value }))} />
            <Field label="KRA PIN" value={form.kra_pin} onChange={(value) => setForm((prev) => ({ ...prev, kra_pin: value }))} />
            <Field label="Contact" value={form.contact} onChange={(value) => setForm((prev) => ({ ...prev, contact: value }))} />
            <Field label="Email" value={form.email} onChange={(value) => setForm((prev) => ({ ...prev, email: value }))} />
            <Field label="Address" value={form.address} onChange={(value) => setForm((prev) => ({ ...prev, address: value }))} />
            <Field label="Location" value={form.location} onChange={(value) => setForm((prev) => ({ ...prev, location: value }))} />
            <div className="space-y-1.5">
              <Label>Segment</Label>
              <Select
                value={form.segment}
                onValueChange={(value) => setForm((prev) => ({ ...prev, segment: value, type: value }))}
              >
                <SelectTrigger>
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
            </div>
            <Field label="Payment Terms" value={form.payment_terms} onChange={(value) => setForm((prev) => ({ ...prev, payment_terms: value }))} />
            <Field
              label="Credit Limit"
              type="number"
              value={form.credit_limit}
              onChange={(value) => setForm((prev) => ({ ...prev, credit_limit: value }))}
            />
            <Field
              label="Balance"
              type="number"
              value={form.balance}
              onChange={(value) => setForm((prev) => ({ ...prev, balance: value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveCustomer} disabled={saving}>
              {saving ? "Saving..." : editing ? "Save Changes" : "Create Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
