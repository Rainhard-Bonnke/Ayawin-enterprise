import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import { ReceiptPdfButton } from "@/components/ReceiptPdfButton";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { MasterBulkActionsBar, useMasterRowSelection } from "@/components/MasterBulkActionsBar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchBar } from "@/components/SearchBar";
import { KES } from "@/lib/format";
import { customerHealthFromBalances } from "@/lib/smartSignals";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchCrmLeads, fetchCrmOpportunities, fetchCrmPipeline, createCrmLead, createCrmOpportunity, type CrmLeadRow, type CrmOpportunityRow } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { exportWorkbook } from "@/lib/excel";
import {
  createCustomer,
  deleteCustomer,
  fetchArAging,
  fetchCustomerStatement,
  fetchCustomers,
  type BackendCustomer,
  type CustomerStatementTxn,
  updateCustomer,
} from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { validateKraPin, validateKenyaPhone } from "@/lib/validators";
import { KraPinField } from "@/components/KraPinField";
import { KenyaPhoneField } from "@/components/KenyaPhoneField";
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
  is_active: boolean;
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
  is_active: true,
});

const segmentOptions = ["Bar/Restaurant", "Wholesaler", "Retailer", "Distributor", "Supermarket"];

export const Route = createFileRoute("/_app/customers")({
  component: CustomersPage,
  head: () => ({ meta: [{ title: "Customers (CRM) - Ayawin Stock Solutions ERP" }] }),
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
  const [leads, setLeads] = useState<CrmLeadRow[]>([]);
  const [opportunities, setOpportunities] = useState<CrmOpportunityRow[]>([]);
  const [pipeline, setPipeline] = useState<Array<{ stage: string; count: number; total_amount: number }>>([]);
  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [oppDialogOpen, setOppDialogOpen] = useState(false);
  const [leadForm, setLeadForm] = useState({ company_name: "", contact_name: "", email: "", phone: "", source: "Referral" });
  const [oppForm, setOppForm] = useState({ name: "", customer_id: "", amount: "0", stage: "prospecting" });
  const [crmSaving, setCrmSaving] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementCustomer, setStatementCustomer] = useState<BackendCustomer | null>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementTxns, setStatementTxns] = useState<CustomerStatementTxn[]>([]);
  const [statementOpening, setStatementOpening] = useState(0);
  const [statementClosing, setStatementClosing] = useState(0);
  const [agingSummary, setAgingSummary] = useState<Record<string, number> | null>(null);
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
    if (!token) return;
    fetchCrmLeads(token).then(setLeads).catch(() => setLeads([]));
    fetchCrmOpportunities(token).then(setOpportunities).catch(() => setOpportunities([]));
    fetchCrmPipeline(token)
      .then((rows) =>
        setPipeline(
          rows.map((r) => ({
            stage: String(r.stage || "—"),
            count: Number(r.count || 0),
            total_amount: Number(r.total_amount || 0),
          })),
        ),
      )
      .catch(() => setPipeline([]));
    fetchArAging(token)
      .then((d) => setAgingSummary(d.summary))
      .catch(() => setAgingSummary(null));
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
  const selection = useMasterRowSelection(filtered.map((c) => ({ id: String(c.id) })));

  const metrics = useMemo(() => {
    const creditExposure = rows.reduce((sum, row) => sum + Number(row.balance || 0), 0);
    const atRisk = rows.filter((row) => {
      const health = customerHealthFromBalances(Number(row.balance || 0), Number(row.credit_limit || 0));
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

  const openStatement = async (customer: BackendCustomer) => {
    if (!token) return;
    setStatementCustomer(customer);
    setStatementOpen(true);
    setStatementLoading(true);
    setStatementTxns([]);
    try {
      const data = await fetchCustomerStatement(token, String(customer.id));
      setStatementOpening(data.opening_balance);
      setStatementClosing(data.closing_balance);
      setStatementTxns(data.transactions || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load statement");
      setStatementTxns([]);
    } finally {
      setStatementLoading(false);
    }
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
      is_active: customer.is_active !== false,
    });
    setDialogOpen(true);
  };

  const saveCustomer = async () => {
    if (!token) return;
    if (!form.name.trim()) {
      toast.error("Customer name is required");
      return;
    }
    const kra = validateKraPin(form.kra_pin, { required: true });
    if (!kra.ok) {
      toast.error(kra.error);
      return;
    }
    const phone = form.contact.trim() ? validateKenyaPhone(form.contact, { required: false }) : { ok: true as const, value: "" };
    if (!phone.ok) {
      toast.error(phone.error);
      return;
    }

    const payload = {
      name: form.name.trim(),
      kra_pin: kra.value,
      tax_id: kra.value,
      contact: phone.value,
      email: form.email.trim(),
      address: form.address.trim(),
      location: form.location.trim(),
      type: form.type.trim(),
      segment: form.segment.trim(),
      credit_limit: Number(form.credit_limit || 0),
      payment_terms: form.payment_terms.trim(),
      balance: Number(form.balance || 0),
      is_active: form.is_active,
    };

    setSaving(true);
    try {
      if (editing) {
        const updated = await updateCustomer(
          token,
          editing.id,
          payload,
          editing.updated_at ? { ifMatch: editing.updated_at } : undefined,
        );
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

      {agingSummary && (
        <Card className="mb-4">
          <CardContent className="grid gap-2 p-4 sm:grid-cols-5">
            {[
              { label: "Current", key: "current" },
              { label: "1–30 days", key: "days_30" },
              { label: "31–60 days", key: "days_60" },
              { label: "61–90 days", key: "days_90" },
              { label: "90+ days", key: "days_90_plus" },
            ].map((b) => (
              <div key={b.key} className="rounded-lg border border-border/60 p-2 text-center">
                <div className="text-xs text-muted-foreground">{b.label}</div>
                <div className="text-sm font-semibold">{KES(Number(agingSummary[b.key] || 0))}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <QuietNote
        scenario="customers"
        contextKey={`${q}-${segment}-${sort}`}
        context={{ q, segment, sort, customers: paged }}
        className="mb-4"
      />

      <Tabs defaultValue="customers" className="mb-4">
        <TabsList>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex justify-end">
                <Button size="sm" onClick={() => setLeadDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Lead
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">{lead.name}</TableCell>
                      <TableCell>{lead.company}</TableCell>
                      <TableCell>{lead.phone}</TableCell>
                      <TableCell>{lead.source}</TableCell>
                      <TableCell><StatusBadge status={lead.status} /></TableCell>
                    </TableRow>
                  ))}
                  {leads.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        No leads in CRM yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pipeline" className="mt-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {pipeline.map((stage) => (
              <Card key={stage.stage}>
                <CardContent className="p-4">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{stage.stage}</div>
                  <div className="mt-1 text-lg font-bold">{stage.count} deals · {KES(stage.total_amount)}</div>
                </CardContent>
              </Card>
            ))}
            {pipeline.length === 0 && (
              <Card className="sm:col-span-3">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">No open pipeline stages.</CardContent>
              </Card>
            )}
          </div>
          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex justify-end">
                <Button size="sm" onClick={() => setOppDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Opportunity
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Probability</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {opportunities.map((opp) => (
                    <TableRow key={opp.id}>
                      <TableCell className="font-medium">{opp.title}</TableCell>
                      <TableCell>{opp.customerName}</TableCell>
                      <TableCell><StatusBadge status={opp.stage} /></TableCell>
                      <TableCell className="text-right">{KES(opp.amount)}</TableCell>
                      <TableCell className="text-right">{opp.probability}%</TableCell>
                    </TableRow>
                  ))}
                  {opportunities.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        No opportunities on file.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="customers" className="mt-4">
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

          <MasterBulkActionsBar
            token={token}
            entity="customers"
            selectedIds={selection.selectedIds}
            onComplete={loadCustomers}
            onClearSelection={selection.clear}
          />

          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selection.allSelected}
                    onCheckedChange={() => selection.toggleAll()}
                    aria-label="Select all customers"
                  />
                </TableHead>
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
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    Loading customers...
                  </TableCell>
                </TableRow>
              ) : paged.map((customer) => {
                const limit = Number(customer.credit_limit || 0);
                const balance = Number(customer.balance || 0);
                const utilisation = limit > 0 ? Math.min(100, Math.round((balance / limit) * 100)) : 0;
                const health = customerHealthFromBalances(balance, limit);

                return (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <Checkbox
                        checked={selection.isSelected(String(customer.id))}
                        onCheckedChange={() => selection.toggle(String(customer.id))}
                        aria-label={`Select ${customer.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{customer.name}</span>
                        {customer.is_active === false && <Badge variant="secondary">Inactive</Badge>}
                      </div>
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
                        <Button variant="ghost" size="sm" onClick={() => void openStatement(customer)}>
                          Statement
                        </Button>
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
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    No customers match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <ListPagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} />
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={statementOpen} onOpenChange={setStatementOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Customer statement</DialogTitle>
            <DialogDescription>
              {statementCustomer
                ? `${statementCustomer.name} · KRA ${statementCustomer.kra_pin} · AR ${KES(statementClosing)}`
                : "Chronological invoices, credit notes and receipts"}
            </DialogDescription>
          </DialogHeader>
          {statementLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading transactions…</p>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">Opening</div>
                  <div className="font-semibold">{KES(statementOpening)}</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">Movement</div>
                  <div className="font-semibold">{KES(statementClosing - statementOpening)}</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-xs text-muted-foreground">Closing</div>
                  <div className="font-semibold">{KES(statementClosing)}</div>
                </div>
              </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statementTxns.map((txn, i) => (
                  <TableRow key={`${txn.ref}-${i}`}>
                    <TableCell>{fmtDate(txn.txn_date)}</TableCell>
                    <TableCell className="capitalize">{txn.type.replace("_", " ")}</TableCell>
                    <TableCell className="font-mono text-xs">{txn.ref}</TableCell>
                    <TableCell className="text-right">{txn.debit ? KES(txn.debit) : "—"}</TableCell>
                    <TableCell className="text-right">
                      {txn.credit ? KES(txn.credit) : txn.credit_applied ? KES(txn.credit_applied) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {txn.running_balance != null ? KES(txn.running_balance) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {txn.type === "payment" ? (
                        <ReceiptPdfButton kind="payment" receiptRef={txn.ref} label="PDF" />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {statementTxns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No posted transactions for this customer yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </>
          )}
        </DialogContent>
      </Dialog>

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
            <KraPinField
              value={form.kra_pin}
              onChange={(value) => setForm((prev) => ({ ...prev, kra_pin: value }))}
            />
            <KenyaPhoneField
              label="Phone"
              value={form.contact}
              onChange={(value) => setForm((prev) => ({ ...prev, contact: value }))}
            />
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
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox
                id="customer-active"
                checked={form.is_active}
                onCheckedChange={(v) => setForm((prev) => ({ ...prev, is_active: v === true }))}
              />
              <Label htmlFor="customer-active">Active (inactive customers cannot receive new orders)</Label>
            </div>
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

      <Dialog open={leadDialogOpen} onOpenChange={setLeadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Lead</DialogTitle>
            <DialogDescription>Add a sales lead to the CRM pipeline.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Field label="Company name" value={leadForm.company_name} onChange={(v) => setLeadForm((p) => ({ ...p, company_name: v }))} />
            <Field label="Contact name" value={leadForm.contact_name} onChange={(v) => setLeadForm((p) => ({ ...p, contact_name: v }))} />
            <Field label="Email" value={leadForm.email} onChange={(v) => setLeadForm((p) => ({ ...p, email: v }))} />
            <Field label="Phone" value={leadForm.phone} onChange={(v) => setLeadForm((p) => ({ ...p, phone: v }))} />
            <Field label="Source" value={leadForm.source} onChange={(v) => setLeadForm((p) => ({ ...p, source: v }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeadDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={crmSaving || !leadForm.company_name.trim()}
              onClick={() => {
                if (!token) return;
                setCrmSaving(true);
                void createCrmLead(token, leadForm)
                  .then(() => {
                    toast.success("Lead created");
                    setLeadDialogOpen(false);
                    return fetchCrmLeads(token);
                  })
                  .then(setLeads)
                  .catch((err) => toast.error(err instanceof Error ? err.message : "Unable to create lead"))
                  .finally(() => setCrmSaving(false));
              }}
            >
              {crmSaving ? "Saving…" : "Create Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={oppDialogOpen} onOpenChange={setOppDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Opportunity</DialogTitle>
            <DialogDescription>Track a deal in the sales pipeline.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Field label="Opportunity name" value={oppForm.name} onChange={(v) => setOppForm((p) => ({ ...p, name: v }))} />
            <div className="space-y-1.5">
              <Label>Customer (optional)</Label>
              <Select value={oppForm.customer_id || "none"} onValueChange={(v) => setOppForm((p) => ({ ...p, customer_id: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {rows.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field label="Amount (KES)" type="number" value={oppForm.amount} onChange={(v) => setOppForm((p) => ({ ...p, amount: v }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOppDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={crmSaving || !oppForm.name.trim()}
              onClick={() => {
                if (!token) return;
                setCrmSaving(true);
                void createCrmOpportunity(token, {
                  name: oppForm.name,
                  customer_id: oppForm.customer_id || undefined,
                  amount: Number(oppForm.amount) || 0,
                  stage: oppForm.stage,
                })
                  .then(() => {
                    toast.success("Opportunity created");
                    setOppDialogOpen(false);
                    return Promise.all([fetchCrmOpportunities(token), fetchCrmPipeline(token)]);
                  })
                  .then(([opps, pipe]) => {
                    setOpportunities(opps);
                    setPipeline(pipe.map((r) => ({
                      stage: String(r.stage || "—"),
                      count: Number(r.count || 0),
                      total_amount: Number(r.total_amount || 0),
                    })));
                  })
                  .catch((err) => toast.error(err instanceof Error ? err.message : "Unable to create opportunity"))
                  .finally(() => setCrmSaving(false));
              }}
            >
              {crmSaving ? "Saving…" : "Create Opportunity"}
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
