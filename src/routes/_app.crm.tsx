import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Archive, Check, CircleDollarSign, Plus, RefreshCw, Send, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import {
  normalizeMasterCustomer,
  normalizeMasterItem,
  normalizeMasterWarehouse,
  v1Api,
} from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";
import { useAction, useList } from "@/lib/queryHooks";
import { KES } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/crm")({
  component: CrmPage,
  head: () => ({ meta: [{ title: "CRM & Quotations - Ayawin Stock Solution" }] }),
});

type Row = Record<string, unknown>;
const text = (row: Row, key: string, fallback = "—") => String(row[key] ?? fallback);
const dateToday = () => new Date().toISOString().slice(0, 10);

function CrmPage() {
  const { token, user } = useAuth();
  const canCreate = user?.role === "Admin" || user?.permissions?.includes("sales.create") === true;
  const [tab, setTab] = useState("leads");
  const [leadSearch, setLeadSearch] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadContact, setLeadContact] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [leadValue, setLeadValue] = useState("");
  const [opportunityName, setOpportunityName] = useState("");
  const [opportunityCustomer, setOpportunityCustomer] = useState("");
  const [opportunityAmount, setOpportunityAmount] = useState("");
  const [opportunityLead, setOpportunityLead] = useState("");
  const [quoteCustomer, setQuoteCustomer] = useState("");
  const [quoteOpportunity, setQuoteOpportunity] = useState("");
  const [quoteItem, setQuoteItem] = useState("");
  const [quoteQuantity, setQuoteQuantity] = useState("1");
  const [quoteDiscount, setQuoteDiscount] = useState("0");
  const [quoteValidUntil, setQuoteValidUntil] = useState("");
  const [quoteWarehouse, setQuoteWarehouse] = useState("");
  const [quoteRequiredDate, setQuoteRequiredDate] = useState("");
  const [convertingQuote, setConvertingQuote] = useState<Row | null>(null);
  const [activityLead, setActivityLead] = useState("");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityDescription, setActivityDescription] = useState("");

  const crmQuery = useList(
    queryKeys.crm.leads({ q: leadSearch }),
    async ({ signal }) => {
      const [
        leadResult,
        opportunities,
        quoteResult,
        activities,
        customerRows,
        itemRows,
        warehouseRows,
      ] = await Promise.all([
        v1Api.crm.leads(token!, { q: leadSearch }, signal),
        v1Api.crm.opportunities(token!, signal),
        v1Api.crm.quotes(token!, {}, signal),
        v1Api.crm.activities(token!, {}, signal),
        v1Api.master.customers(token!, "", signal),
        v1Api.master.items(token!, 500, signal),
        v1Api.master.warehouses(token!, signal),
      ]);
      return {
        leads: leadResult.data,
        opportunities,
        quotes: quoteResult.data,
        activities,
        customers: customerRows.map(normalizeMasterCustomer),
        items: itemRows.map(normalizeMasterItem).filter((item) => item.is_active),
        warehouses: warehouseRows
          .map(normalizeMasterWarehouse)
          .filter((warehouse) => warehouse.is_active),
      };
    },
    { enabled: Boolean(token) },
  );
  const data = crmQuery.data;
  const invalidate = [
    queryKeys.crm.leads({ q: leadSearch }),
    queryKeys.crm.opportunities(),
    queryKeys.crm.quotes(),
    queryKeys.crm.activities(),
  ];
  const createLead = useAction({
    mutationFn: (body: Row) => v1Api.crm.createLead(token!, body),
    invalidate,
  });
  const updateLead = useAction({
    mutationFn: (input: { id: string; body: Row }) =>
      v1Api.crm.updateLead(token!, input.id, input.body),
    invalidate,
  });
  const archiveLead = useAction({
    mutationFn: (id: string) => v1Api.crm.archiveLead(token!, id),
    invalidate,
  });
  const convertLead = useAction({
    mutationFn: (id: string) => v1Api.crm.convertLead(token!, id),
    invalidate: [...invalidate, queryKeys.customers.list()],
  });
  const createOpportunity = useAction({
    mutationFn: (body: Row) => v1Api.crm.createOpportunity(token!, body),
    invalidate,
  });
  const updateOpportunity = useAction({
    mutationFn: (input: { id: string; body: Row }) =>
      v1Api.crm.updateOpportunity(token!, input.id, input.body),
    invalidate,
  });
  const archiveOpportunity = useAction({
    mutationFn: (id: string) => v1Api.crm.archiveOpportunity(token!, id),
    invalidate,
  });
  const createActivity = useAction({
    mutationFn: (body: Row) => v1Api.crm.createActivity(token!, body),
    invalidate,
  });
  const createQuote = useAction({
    mutationFn: (body: Row) => v1Api.crm.createQuote(token!, body),
    invalidate,
  });
  const quoteAction = useAction({
    mutationFn: (input: { id: string; action: "send" | "accept" | "reject" }) =>
      v1Api.crm.updateQuote(token!, input.id, input.action),
    invalidate,
  });
  const convertQuote = useAction({
    mutationFn: (input: { id: string; warehouse_id: string; required_date: string }) =>
      v1Api.crm.convertQuote(token!, input.id, {
        warehouse_id: input.warehouse_id,
        required_date: input.required_date,
      }),
    invalidate: [...invalidate, queryKeys.sales.orderLists()],
  });

  const run = async (label: string, action: () => Promise<unknown>, after?: () => void) => {
    try {
      await action();
      after?.();
      toast.success(label);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save CRM changes");
    }
  };

  const addLead = (event: React.FormEvent) => {
    event.preventDefault();
    if (!leadName.trim()) return toast.error("Enter a lead or organization name.");
    void run(
      "Lead created",
      () =>
        createLead.mutateAsync({
          company_name: leadName.trim(),
          contact_name: leadContact.trim() || undefined,
          email: leadEmail.trim() || undefined,
          phone: leadPhone.trim() || undefined,
          source: leadSource.trim() || "manual",
          estimated_value: Number(leadValue || 0),
        }),
      () => {
        setLeadName("");
        setLeadContact("");
        setLeadEmail("");
        setLeadPhone("");
        setLeadSource("");
        setLeadValue("");
      },
    );
  };

  const addOpportunity = (event: React.FormEvent) => {
    event.preventDefault();
    if (!opportunityName.trim()) return toast.error("Enter an opportunity name.");
    void run(
      "Opportunity created",
      () =>
        createOpportunity.mutateAsync({
          name: opportunityName.trim(),
          customer_id: opportunityCustomer || null,
          lead_id: opportunityLead || null,
          amount: Number(opportunityAmount || 0),
          stage: "prospecting",
          probability: 10,
        }),
      () => {
        setOpportunityName("");
        setOpportunityCustomer("");
        setOpportunityLead("");
        setOpportunityAmount("");
      },
    );
  };

  const addQuote = (event: React.FormEvent) => {
    event.preventDefault();
    const quantity = Number(quoteQuantity);
    const discount = Number(quoteDiscount);
    if (
      !quoteCustomer ||
      !quoteItem ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(discount) ||
      discount < 0 ||
      discount > 100
    ) {
      return toast.error("Choose a customer and item, and enter valid quantity and discount.");
    }
    void run(
      "Quotation created with server-calculated price and tax",
      () =>
        createQuote.mutateAsync({
          customer_id: quoteCustomer,
          opportunity_id: quoteOpportunity || null,
          quote_date: dateToday(),
          valid_until: quoteValidUntil || null,
          lines: [{ item_id: quoteItem, quantity, discount_percent: discount }],
        }),
      () => {
        setQuoteQuantity("1");
        setQuoteDiscount("0");
      },
    );
  };

  const addActivity = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activitySubject.trim()) return toast.error("Enter an activity subject.");
    void run(
      "CRM activity saved",
      () =>
        createActivity.mutateAsync({
          lead_id: activityLead || null,
          activity_type: "note",
          subject: activitySubject.trim(),
          description: activityDescription.trim() || null,
        }),
      () => {
        setActivitySubject("");
        setActivityDescription("");
      },
    );
  };

  const changeLeadStatus = (lead: Row, status: string) => {
    void run("Lead updated", () =>
      updateLead.mutateAsync({ id: String(lead.id), body: { status } }),
    );
  };

  const moveOpportunity = (opportunity: Row, stage: string) => {
    const lostReason =
      stage === "lost" ? window.prompt("Reason for losing this opportunity")?.trim() : undefined;
    if (stage === "lost" && !lostReason) return;
    const probability =
      stage === "won" ? 100 : stage === "lost" ? 0 : Number(opportunity.probability || 10);
    void run("Opportunity updated", () =>
      updateOpportunity.mutateAsync({
        id: String(opportunity.id),
        body: { stage, probability, ...(lostReason ? { lost_reason: lostReason } : {}) },
      }),
    );
  };

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="CRM & quotations"
        description="Track prospects, manage sales opportunities, and turn accepted quotations into controlled sales orders."
        actions={
          <Button
            variant="outline"
            disabled={crmQuery.isFetching}
            onClick={() => void crmQuery.refetch()}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${crmQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />
      {crmQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {crmQuery.error.message}{" "}
          <Button size="sm" variant="ghost" onClick={() => void crmQuery.refetch()}>
            Retry
          </Button>
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="leads">Leads & activity</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="quotes">Quotations</TabsTrigger>
        </TabsList>
        <TabsContent value="leads" className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Add a lead</h2>
              <form onSubmit={addLead} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <Field label="Organization" value={leadName} onChange={setLeadName} required />
                <Field label="Contact" value={leadContact} onChange={setLeadContact} />
                <Field label="Email" type="email" value={leadEmail} onChange={setLeadEmail} />
                <Field label="Phone" value={leadPhone} onChange={setLeadPhone} />
                <Field
                  label="Source"
                  value={leadSource}
                  onChange={setLeadSource}
                  placeholder="Referral, event..."
                />
                <Field
                  label="Estimated value"
                  type="number"
                  value={leadValue}
                  onChange={setLeadValue}
                />
                <Button
                  type="submit"
                  disabled={!canCreate || createLead.isPending}
                  className="sm:col-span-2 xl:col-span-6"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create lead
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Lead register</h2>
                <Input
                  className="max-w-xs"
                  placeholder="Search leads"
                  value={leadSearch}
                  onChange={(event) => setLeadSearch(event.target.value)}
                />
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lead</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Estimate</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.leads || []).map((lead) => (
                      <TableRow key={String(lead.id)}>
                        <TableCell className="font-medium">
                          {text(lead, "company_name")}
                          <div className="text-xs text-muted-foreground">
                            {text(lead, "lead_no")}
                          </div>
                        </TableCell>
                        <TableCell>
                          {text(lead, "contact_name")}
                          <div className="text-xs text-muted-foreground">{text(lead, "email")}</div>
                        </TableCell>
                        <TableCell>{text(lead, "source")}</TableCell>
                        <TableCell>{KES(Number(lead.estimated_value || 0))}</TableCell>
                        <TableCell>
                          <select
                            aria-label={`Stage for ${text(lead, "company_name")}`}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            value={String(lead.status)}
                            disabled={!canCreate || lead.status === "converted"}
                            onChange={(event) => changeLeadStatus(lead, event.target.value)}
                          >
                            <option value="new">New</option>
                            <option value="contacted">Contacted</option>
                            <option value="qualified">Qualified</option>
                            <option value="lost">Lost</option>
                          </select>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {lead.status !== "converted" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!canCreate}
                                onClick={() =>
                                  void run("Lead converted to customer and opportunity", () =>
                                    convertLead.mutateAsync(String(lead.id)),
                                  )
                                }
                              >
                                <UserPlus className="mr-1 h-4 w-4" />
                                Convert
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Archive ${text(lead, "company_name")}`}
                              disabled={!canCreate}
                              onClick={() =>
                                void run("Lead archived", () =>
                                  archiveLead.mutateAsync(String(lead.id)),
                                )
                              }
                            >
                              <Archive className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!data?.leads?.length && (
                      <EmptyRow colSpan={6} text="No leads match this search." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Log CRM activity</h2>
              <form onSubmit={addActivity} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Lead</Label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={activityLead}
                    onChange={(event) => setActivityLead(event.target.value)}
                  >
                    <option value="">No linked lead</option>
                    {(data?.leads || []).map((lead) => (
                      <option key={String(lead.id)} value={String(lead.id)}>
                        {text(lead, "company_name")}
                      </option>
                    ))}
                  </select>
                </div>
                <Field
                  label="Subject"
                  value={activitySubject}
                  onChange={setActivitySubject}
                  required
                />
                <Field
                  label="Notes"
                  value={activityDescription}
                  onChange={setActivityDescription}
                />
                <Button type="submit" disabled={!canCreate || createActivity.isPending}>
                  Save activity
                </Button>
              </form>
              <div className="max-h-56 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.activities || []).slice(0, 20).map((activity) => (
                      <TableRow key={String(activity.id)}>
                        <TableCell>{text(activity, "activity_date").slice(0, 10)}</TableCell>
                        <TableCell>{text(activity, "activity_type")}</TableCell>
                        <TableCell>{text(activity, "subject")}</TableCell>
                        <TableCell>{text(activity, "description")}</TableCell>
                      </TableRow>
                    ))}
                    {!data?.activities?.length && (
                      <EmptyRow colSpan={4} text="No activities recorded." />
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="opportunities" className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Add an opportunity</h2>
              <form onSubmit={addOpportunity} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field
                  label="Opportunity"
                  value={opportunityName}
                  onChange={setOpportunityName}
                  required
                />
                <div className="space-y-1.5">
                  <Label htmlFor="opportunity-customer">Customer</Label>
                  <select
                    id="opportunity-customer"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={opportunityCustomer}
                    onChange={(event) => setOpportunityCustomer(event.target.value)}
                  >
                    <option value="">No customer yet</option>
                    {(data?.customers || []).map((customer) => (
                      <option key={customer.id} value={String(customer.id)}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="opportunity-lead">Lead</Label>
                  <select
                    id="opportunity-lead"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={opportunityLead}
                    onChange={(event) => setOpportunityLead(event.target.value)}
                  >
                    <option value="">No linked lead</option>
                    {(data?.leads || []).map((lead) => (
                      <option key={String(lead.id)} value={String(lead.id)}>
                        {text(lead, "company_name")}
                      </option>
                    ))}
                  </select>
                </div>
                <Field
                  label="Amount"
                  type="number"
                  value={opportunityAmount}
                  onChange={setOpportunityAmount}
                />
                <Button type="submit" disabled={!canCreate || createOpportunity.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="overflow-x-auto p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Probability</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.opportunities || []).map((opportunity) => (
                    <TableRow key={String(opportunity.id)}>
                      <TableCell className="font-medium">
                        {text(opportunity, "name")}
                        <div className="text-xs text-muted-foreground">
                          {text(opportunity, "opportunity_no")}
                        </div>
                      </TableCell>
                      <TableCell>{text(opportunity, "customer_name")}</TableCell>
                      <TableCell>
                        <select
                          aria-label={`Stage for ${text(opportunity, "name")}`}
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value={String(opportunity.stage)}
                          disabled={!canCreate}
                          onChange={(event) => moveOpportunity(opportunity, event.target.value)}
                        >
                          <option value="prospecting">Prospecting</option>
                          <option value="qualification">Qualification</option>
                          <option value="proposal">Proposal</option>
                          <option value="negotiation">Negotiation</option>
                          <option value="won">Won</option>
                          <option value="lost">Lost</option>
                        </select>
                      </TableCell>
                      <TableCell>{Number(opportunity.probability || 0)}%</TableCell>
                      <TableCell className="text-right">
                        {KES(Number(opportunity.amount || 0))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Archive ${text(opportunity, "name")}`}
                          disabled={!canCreate}
                          onClick={() =>
                            void run("Opportunity archived", () =>
                              archiveOpportunity.mutateAsync(String(opportunity.id)),
                            )
                          }
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!data?.opportunities?.length && (
                    <EmptyRow colSpan={6} text="No opportunities recorded." />
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="quotes" className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="font-semibold">Prepare a quotation</h2>
              <p className="text-sm text-muted-foreground">
                Prices and VAT are resolved from effective company rules when saved.
              </p>
              <form onSubmit={addQuote} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
                <div className="space-y-1.5">
                  <Label htmlFor="quote-customer">Customer</Label>
                  <select
                    id="quote-customer"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={quoteCustomer}
                    onChange={(event) => setQuoteCustomer(event.target.value)}
                  >
                    <option value="">Select customer</option>
                    {(data?.customers || []).map((customer) => (
                      <option key={customer.id} value={String(customer.id)}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quote-opportunity">Opportunity</Label>
                  <select
                    id="quote-opportunity"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={quoteOpportunity}
                    onChange={(event) => setQuoteOpportunity(event.target.value)}
                  >
                    <option value="">No linked opportunity</option>
                    {(data?.opportunities || [])
                      .filter((opportunity) => !["won", "lost"].includes(String(opportunity.stage)))
                      .map((opportunity) => (
                        <option key={String(opportunity.id)} value={String(opportunity.id)}>
                          {text(opportunity, "name")}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quote-item">Item</Label>
                  <select
                    id="quote-item"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={quoteItem}
                    onChange={(event) => setQuoteItem(event.target.value)}
                  >
                    <option value="">Select item</option>
                    {(data?.items || []).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.item_code} · {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Field
                  label="Quantity"
                  type="number"
                  value={quoteQuantity}
                  onChange={setQuoteQuantity}
                  required
                />
                <Field
                  label="Discount %"
                  type="number"
                  value={quoteDiscount}
                  onChange={setQuoteDiscount}
                />
                <Field
                  label="Valid until"
                  type="date"
                  value={quoteValidUntil}
                  onChange={setQuoteValidUntil}
                />
                <Button type="submit" disabled={!canCreate || createQuote.isPending}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create quote
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 overflow-x-auto p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quote</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Valid until</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.quotes || []).map((quote) => (
                    <TableRow key={String(quote.id)}>
                      <TableCell className="font-mono text-xs">{text(quote, "quote_no")}</TableCell>
                      <TableCell>{text(quote, "customer_name")}</TableCell>
                      <TableCell>{text(quote, "quote_date").slice(0, 10)}</TableCell>
                      <TableCell>{text(quote, "valid_until").slice(0, 10)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{text(quote, "status")}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {KES(Number(quote.total_amount || 0))}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {quote.status === "draft" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canCreate}
                              onClick={() =>
                                void run("Quotation sent", () =>
                                  quoteAction.mutateAsync({ id: String(quote.id), action: "send" }),
                                )
                              }
                            >
                              <Send className="mr-1 h-3.5 w-3.5" />
                              Send
                            </Button>
                          )}
                          {quote.status === "draft" || quote.status === "sent" ? (
                            <>
                              <Button
                                size="sm"
                                disabled={!canCreate}
                                onClick={() =>
                                  void run("Quotation accepted", () =>
                                    quoteAction.mutateAsync({
                                      id: String(quote.id),
                                      action: "accept",
                                    }),
                                  )
                                }
                              >
                                <Check className="mr-1 h-3.5 w-3.5" />
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={!canCreate}
                                onClick={() =>
                                  void run("Quotation rejected", () =>
                                    quoteAction.mutateAsync({
                                      id: String(quote.id),
                                      action: "reject",
                                    }),
                                  )
                                }
                              >
                                Reject
                              </Button>
                            </>
                          ) : null}
                          {quote.status === "accepted" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setConvertingQuote(quote);
                                setQuoteRequiredDate(
                                  String(quote.valid_until || dateToday()).slice(0, 10),
                                );
                              }}
                            >
                              <CircleDollarSign className="mr-1 h-4 w-4" />
                              Convert
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!data?.quotes?.length && <EmptyRow colSpan={7} text="No quotations recorded." />}
                </TableBody>
              </Table>
              {convertingQuote && (
                <form
                  className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!token || !quoteWarehouse || !quoteRequiredDate)
                      return toast.error("Choose a warehouse and required date.");
                    void run(
                      "Quotation converted to sales order",
                      () =>
                        convertQuote.mutateAsync({
                          id: String(convertingQuote.id),
                          warehouse_id: quoteWarehouse,
                          required_date: quoteRequiredDate,
                        }),
                      () => setConvertingQuote(null),
                    );
                  }}
                >
                  <div className="sm:col-span-3">
                    <h3 className="font-medium">
                      Convert {text(convertingQuote, "quote_no")} to an order
                    </h3>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="quote-warehouse">Warehouse</Label>
                    <select
                      id="quote-warehouse"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={quoteWarehouse}
                      onChange={(event) => setQuoteWarehouse(event.target.value)}
                    >
                      <option value="">Select warehouse</option>
                      {(data?.warehouses || []).map((warehouse) => (
                        <option key={String(warehouse.id)} value={String(warehouse.id)}>
                          {warehouse.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Field
                    label="Required delivery date"
                    type="date"
                    value={quoteRequiredDate}
                    onChange={setQuoteRequiredDate}
                    required
                  />
                  <div className="flex items-end gap-2">
                    <Button type="submit" disabled={convertQuote.isPending}>
                      Create sales order
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConvertingQuote(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const id = `crm-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
      />
    </div>
  );
}

function EmptyRow({ colSpan, text: message }: { colSpan: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-20 text-center text-sm text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}
