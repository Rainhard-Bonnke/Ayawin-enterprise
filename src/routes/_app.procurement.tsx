import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchBar } from "@/components/SearchBar";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { ReceiptPdfButton } from "@/components/ReceiptPdfButton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { KES, fmtDate } from "@/lib/format";
import { exportWorkbook } from "@/lib/excel";
import { supplierScoreFromBalances } from "@/lib/smartSignals";
import { trackEvent } from "@/lib/event-tracker";
import { useAuth } from "@/lib/auth";
import {
  createPurchaseOrder,
  createRequisition,
  approveRequisition,
  submitRequisition,
  createSupplier,
  deleteSupplier,
  fetchGoodsReceipts,
  fetchMasterItems,
  fetchPurchaseOrders,
  fetchRequisitions,
  fetchSuppliers,
  fetchWarehouses,
  postGoodsReceipt,
  receivePurchaseOrder,
  updatePurchaseOrderStatus,
  updateSupplier,
  type BackendGoodsReceipt,
  type BackendMasterItem,
  type BackendPurchaseOrder,
  type BackendRequisition,
  type BackendSupplier,
  type BackendWarehouse,
} from "@/lib/api";
import { toast } from "sonner";

type SupplierFormState = {
  name: string;
  kra_pin: string;
  contact: string;
  email: string;
  phone: string;
  payment_terms: string;
  credit_limit: string;
  balance: string;
};

const emptySupplierForm = (): SupplierFormState => ({
  name: "",
  kra_pin: "",
  contact: "",
  email: "",
  phone: "",
  payment_terms: "Net 30",
  credit_limit: "0",
  balance: "0",
});

export const Route = createFileRoute("/_app/procurement")({
  component: Procurement,
  head: () => ({ meta: [{ title: "Procurement - Ayawin Stock Solutions ERP" }] }),
});

function Procurement() {
  const { token } = useAuth();
  const [tab, setTab] = useState("purchase-orders");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orders, setOrders] = useState<BackendPurchaseOrder[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<BackendSupplier[]>([]);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierEditing, setSupplierEditing] = useState<BackendSupplier | null>(null);
  const [supplierForm, setSupplierForm] = useState<SupplierFormState>(emptySupplierForm());
  const [requisitions, setRequisitions] = useState<BackendRequisition[]>([]);
  const [requisitionsLoading, setRequisitionsLoading] = useState(true);
  const [grns, setGrns] = useState<BackendGoodsReceipt[]>([]);
  const [grnsLoading, setGrnsLoading] = useState(true);
  const [postingGrnId, setPostingGrnId] = useState<string | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqSaving, setReqSaving] = useState(false);
  const [reqItems, setReqItems] = useState<BackendMasterItem[]>([]);
  const [reqForm, setReqForm] = useState({ item_id: "", quantity: "1", required_date: "", notes: "" });

  const pageSize = 5;

  const loadSuppliers = async () => {
    if (!token) return;
    setSuppliersLoading(true);
    try {
      const data = await fetchSuppliers(token);
      setSuppliers(data);
    } catch {
      setSuppliers([]);
      toast.error("Unable to load suppliers");
    } finally {
      setSuppliersLoading(false);
    }
  };

  const loadOrders = async () => {
    if (!token) return;
    setOrdersLoading(true);
    try {
      const data = await fetchPurchaseOrders(token);
      setOrders(data);
    } catch (err) {
      setOrders([]);
      toast.error(err instanceof Error ? err.message : "Unable to load purchase orders");
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadRequisitions = async () => {
    if (!token) return;
    setRequisitionsLoading(true);
    try {
      setRequisitions(await fetchRequisitions(token));
    } catch {
      setRequisitions([]);
    } finally {
      setRequisitionsLoading(false);
    }
  };

  const loadGrns = async () => {
    if (!token) return;
    setGrnsLoading(true);
    try {
      setGrns(await fetchGoodsReceipts(token));
    } catch {
      setGrns([]);
    } finally {
      setGrnsLoading(false);
    }
  };

  useEffect(() => {
    void loadSuppliers();
    void loadOrders();
    void loadRequisitions();
    void loadGrns();
  }, [token]);

  const orderRows = useMemo(
    () =>
      orders
        .filter(
          (p) =>
            (status === "all" || p.status === status) &&
            (p.id.toLowerCase().includes(q.toLowerCase()) || p.supplier.toLowerCase().includes(q.toLowerCase())),
        )
        .sort((a, b) => {
          if (sort === "total") return b.total - a.total;
          if (sort === "status") return a.status.localeCompare(b.status);
          return b.date.localeCompare(a.date);
        }),
    [orders, q, sort, status],
  );

  const supplierRows = useMemo(
    () =>
      suppliers
        .filter((s) => {
          const query = q.toLowerCase();
          return (
            s.name.toLowerCase().includes(query) ||
            s.kra_pin.toLowerCase().includes(query) ||
            (s.email || "").toLowerCase().includes(query) ||
            (s.contact || "").toLowerCase().includes(query)
          );
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [suppliers, q],
  );

  const totalPages = Math.max(1, Math.ceil(orderRows.length / pageSize));
  const pagedOrders = orderRows.slice((page - 1) * pageSize, page * pageSize);

  const setOrderStatus = async (row: any, nextStatus: BackendPurchaseOrder["status"]) => {
    if (!token) return;
    const internalId = row.internal_id;
    if (!internalId) {
      toast.error("This purchase order is not connected to the database");
      return;
    }

    try {
      await updatePurchaseOrderStatus(token, internalId, nextStatus);
      toast.success(`Status set to ${nextStatus}`);
      setPage(1);
      await loadOrders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to update status");
    }
  };

  const receiveOrder = async (row: any) => {
    if (!token) return;
    const internalId = row.internal_id;
    if (!internalId) {
      toast.error("This purchase order is not connected to the database");
      return;
    }

    try {
      const result = await receivePurchaseOrder(token, internalId, "Warehouse Team");
      toast.success(`GRN created: ${result.grn_number}`);
      await loadOrders();
      await loadGrns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to receive order");
    }
  };

  const exportProcurement = () => {
    void trackEvent({
      action: "procurement_export_xlsx",
      entityType: "report",
      entityId: "procurement",
      details: { orders: orderRows.length, suppliers: supplierRows.length },
      scenario: "procurement",
      context: { q, status, sort, orders: orderRows.length, suppliers: supplierRows.length },
    });

    exportWorkbook("ayawin-enterprise-procurement.xlsx", [
      {
        name: "Purchase Orders",
        rows: orderRows.map((p) => ({
          "PO #": p.id,
          Date: fmtDate(p.date),
          Supplier: p.supplier,
          Items: p.items,
          Total: p.total,
          Status: p.status,
        })),
      },
      {
        name: "Suppliers",
        rows: supplierRows.map((s) => {
          const score = supplierScoreFromBalances(Number(s.balance || 0), Number(s.credit_limit || 0));
          return {
            Supplier: s.name,
            "KRA PIN": s.kra_pin,
            Contact: s.contact ?? "",
            Email: s.email ?? "",
            Phone: s.phone ?? "",
            Terms: s.payment_terms ?? "",
            "Credit Limit": Number(s.credit_limit || 0),
            Balance: Number(s.balance || 0),
            Score: score.score,
          };
        }),
      },
    ]);
  };

  const openCreateSupplier = () => {
    setSupplierEditing(null);
    setSupplierForm(emptySupplierForm());
    setSupplierDialogOpen(true);
  };

  const openEditSupplier = (supplier: BackendSupplier) => {
    setSupplierEditing(supplier);
    setSupplierForm({
      name: supplier.name,
      kra_pin: supplier.kra_pin,
      contact: supplier.contact ?? "",
      email: supplier.email ?? "",
      phone: supplier.phone ?? "",
      payment_terms: supplier.payment_terms ?? "Net 30",
      credit_limit: String(supplier.credit_limit ?? 0),
      balance: String(supplier.balance ?? 0),
    });
    setSupplierDialogOpen(true);
  };

  const saveSupplier = async () => {
    if (!token) return;
    if (!supplierForm.name.trim() || !supplierForm.kra_pin.trim()) {
      toast.error("Supplier name and KRA PIN are required");
      return;
    }

    const payload = {
      name: supplierForm.name.trim(),
      kra_pin: supplierForm.kra_pin.trim(),
      contact: supplierForm.contact.trim(),
      email: supplierForm.email.trim(),
      phone: supplierForm.phone.trim(),
      payment_terms: supplierForm.payment_terms.trim(),
      credit_limit: Number(supplierForm.credit_limit || 0),
      balance: Number(supplierForm.balance || 0),
    };

    setSupplierSaving(true);
    try {
      if (supplierEditing) {
        const updated = await updateSupplier(token, supplierEditing.id, payload);
        void trackEvent({
          action: "supplier_updated",
          entityType: "supplier",
          entityId: String(updated.id),
          details: { name: updated.name, kra_pin: updated.kra_pin },
          scenario: "procurement",
          context: payload,
        });
        toast.success(`Supplier ${updated.name} updated`);
      } else {
        const created = await createSupplier(token, payload);
        void trackEvent({
          action: "supplier_created",
          entityType: "supplier",
          entityId: String(created.id),
          details: { name: created.name, kra_pin: created.kra_pin },
          scenario: "procurement",
          context: payload,
        });
        toast.success(`Supplier ${created.name} created`);
      }

      setSupplierDialogOpen(false);
      setPage(1);
      await loadSuppliers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save supplier");
    } finally {
      setSupplierSaving(false);
    }
  };

  const removeSupplier = async (supplier: BackendSupplier) => {
    if (!token) return;
    try {
      await deleteSupplier(token, supplier.id);
      void trackEvent({
        action: "supplier_deleted",
        entityType: "supplier",
        entityId: String(supplier.id),
        details: { name: supplier.name, kra_pin: supplier.kra_pin },
        scenario: "procurement",
        context: { name: supplier.name },
      });
      toast.success(`Supplier ${supplier.name} deleted`);
      await loadSuppliers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete supplier");
    }
  };

  const summarySuppliers = supplierRows.slice(0, 3);

  const poKpis = useMemo(() => {
    const draft = orders.filter((o) => o.status === "Draft").length;
    const approved = orders.filter((o) => o.status === "Approved").length;
    const sent = orders.filter((o) => o.status === "Sent").length;
    const received = orders.filter((o) => o.status === "Received" || o.status === "Invoiced").length;
    return [
      { l: "Draft / Approved", v: `${draft} / ${approved}` },
      { l: "Sent", v: String(sent) },
      { l: "Received", v: String(received) },
      { l: "Suppliers", v: String(suppliers.length) },
    ];
  }, [orders, suppliers.length]);

  return (
    <div>
      <PageHeader
        title="Procurement & Suppliers"
        description="Raise purchase orders, receive goods, match supplier invoices and manage credit limits."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportProcurement}>
              <Plus className="mr-2 h-4 w-4" />
              Export XLSX
            </Button>
            <Button variant="outline" onClick={openCreateSupplier}>
              <Plus className="mr-2 h-4 w-4" />
              New Supplier
            </Button>
            <NewPoDialog suppliers={suppliers} onCompleted={loadOrders} />
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {poKpis.map((k) => (
          <Card key={k.l}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
              <div className="mt-1 text-2xl font-bold">{k.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <QuietNote
        scenario="procurement"
        contextKey={`${q}-${status}-${sort}-${supplierRows.length}`}
        context={{ q, status, sort, purchaseOrders: orderRows, suppliers: supplierRows }}
        className="mb-4"
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
          {summarySuppliers.map((supplier) => {
            const score = supplierScoreFromBalances(Number(supplier.balance || 0), Number(supplier.credit_limit || 0));
            return (
              <div key={supplier.id} className="rounded-xl border border-border/70 bg-background/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{supplier.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{supplier.kra_pin}</div>
                  </div>
                  <Badge variant="outline">{score.score}</Badge>
                </div>
                <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Terms</span>
                    <span className="font-medium text-foreground">{supplier.payment_terms || "-"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Credit</span>
                    <span className="font-medium text-foreground">{KES(Number(supplier.credit_limit || 0))}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Balance</span>
                    <span className="font-semibold text-foreground">{KES(Number(supplier.balance || 0))}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {summarySuppliers.length === 0 && (
            <div className="col-span-full py-6 text-center text-sm text-muted-foreground">
              {suppliersLoading ? "Loading suppliers..." : "No suppliers available."}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="purchase-orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="requisitions">Requisitions</TabsTrigger>
          <TabsTrigger value="goods-receipts">Goods Receipts</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>

        <TabsContent value="purchase-orders" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <SearchBar
                  value={q}
                  onChange={(value) => {
                    setQ(value);
                    setPage(1);
                  }}
                  placeholder="Search PO or supplier..."
                />
                <Select
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {["Draft", "Pending MD", "Approved", "Partial", "Sent", "Received"].map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="w-40">
                    <ArrowUpDown className="mr-2 h-4 w-4" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Sort by date</SelectItem>
                    <SelectItem value="total">Highest total</SelectItem>
                    <SelectItem value="status">Sort by status</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>PO #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Warehouse</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordersLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                        Loading purchase orders...
                      </TableCell>
                    </TableRow>
                  ) : pagedOrders.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.id}</TableCell>
                      <TableCell>{fmtDate(p.date)}</TableCell>
                      <TableCell className="font-medium">{p.supplier}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.warehouse ?? "-"}</TableCell>
                      <TableCell className="text-right">{p.items}</TableCell>
                      <TableCell className="text-right font-semibold">{KES(p.total)}</TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <ConfirmActionDialog
                            title="Approve purchase order?"
                            description="Moves the PO to Approved for sending to the supplier."
                            confirmLabel="Approve"
                            onConfirm={() => void setOrderStatus(p, "Approved")}
                          >
                            <Button variant="ghost" size="sm" disabled={p.status !== "Draft" && p.status !== "Pending MD"}>
                              Approve
                            </Button>
                          </ConfirmActionDialog>
                          <ConfirmActionDialog
                            title="Receive purchase order?"
                            description="Creates a GRN and posts stock-in movements to inventory."
                            confirmLabel="Receive"
                            onConfirm={() => void receiveOrder(p)}
                          >
                            <Button variant="ghost" size="sm" disabled={!["Sent", "Approved", "Partial"].includes(p.status)}>
                              Receive
                            </Button>
                          </ConfirmActionDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!ordersLoading && pagedOrders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                        No purchase orders match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <ListPagination page={page} totalPages={totalPages} totalItems={orderRows.length} pageSize={pageSize} onPageChange={setPage} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requisitions" className="mt-4">
          <Card><CardContent className="p-4">
            <div className="mb-4 flex justify-end">
              <PermissionGate permission="procurement.create">
                <Button onClick={() => {
                  setReqForm({ item_id: "", quantity: "1", required_date: "", notes: "" });
                  setReqOpen(true);
                  if (token) void fetchMasterItems(token).then(setReqItems).catch(() => setReqItems([]));
                }}>
                  <Plus className="mr-2 h-4 w-4" />
                  New requisition
                </Button>
              </PermissionGate>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PR #</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {requisitionsLoading ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                ) : requisitions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.requisition_no}</TableCell>
                    <TableCell>{fmtDate(r.required_date)}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.notes || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {r.status.toLowerCase() === "draft" && (
                          <PermissionGate permission="procurement.create">
                            <Button size="sm" variant="outline" onClick={() => void submitRequisition(token!, r.id).then(() => { toast.success("Submitted"); return loadRequisitions(); }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))}>
                              Submit
                            </Button>
                          </PermissionGate>
                        )}
                        {["draft", "submitted"].includes(r.status.toLowerCase()) && (
                          <PermissionGate permission="procurement.approve">
                            <Button size="sm" onClick={() => void approveRequisition(token!, r.id).then(() => { toast.success("Approved"); return loadRequisitions(); }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))}>
                              Approve
                            </Button>
                          </PermissionGate>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!requisitionsLoading && requisitions.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No purchase requisitions yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="goods-receipts" className="mt-4">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN #</TableHead>
                  <TableHead>PO #</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {grnsLoading ? (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                ) : grns.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-mono text-xs">{g.grn_number}</TableCell>
                    <TableCell className="font-mono text-xs">{g.po_number}</TableCell>
                    <TableCell>{fmtDate(g.received_date)}</TableCell>
                    <TableCell><StatusBadge status={g.status} /></TableCell>
                    <TableCell className="text-right">{KES(g.total_amount)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {g.status.toLowerCase() !== "draft" && (
                          <ReceiptPdfButton
                            kind="grn"
                            receiptRef={g.grn_number}
                            grnId={g.id}
                            label="GRN PDF"
                          />
                        )}
                        {g.status.toLowerCase() === "draft" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={postingGrnId === g.id}
                            onClick={() => {
                              if (!token) return;
                              setPostingGrnId(g.id);
                              void postGoodsReceipt(token, g.id)
                                .then(() => {
                                  toast.success(`GRN ${g.grn_number} posted to inventory`);
                                  return loadGrns();
                                })
                                .catch((err) => toast.error(err instanceof Error ? err.message : "Post failed"))
                                .finally(() => setPostingGrnId(null));
                            }}
                          >
                            {postingGrnId === g.id ? "Posting…" : "Post GRN"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!grnsLoading && grns.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Receive a PO to create goods receipts.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  Supplier directory is searchable by the same keyword bar above and sorted alphabetically for quick lookup.
                </div>
                <Button variant="outline" onClick={openCreateSupplier}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Supplier
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>KRA PIN</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Terms</TableHead>
                    <TableHead className="text-right">Credit Limit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliersLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                        Loading suppliers...
                      </TableCell>
                    </TableRow>
                  ) : supplierRows.map((s) => {
                    const score = supplierScoreFromBalances(Number(s.balance || 0), Number(s.credit_limit || 0));
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="font-mono text-xs">{s.kra_pin}</TableCell>
                        <TableCell className="text-xs">
                          {s.email || s.contact || "-"}
                          <br />
                          <span className="text-muted-foreground">{s.phone || "-"}</span>
                        </TableCell>
                        <TableCell>{s.payment_terms || "-"}</TableCell>
                        <TableCell className="text-right">{KES(Number(s.credit_limit || 0))}</TableCell>
                        <TableCell className="text-right font-semibold">{KES(Number(s.balance || 0))}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{score.score}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openEditSupplier(s)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </Button>
                            <ConfirmActionDialog
                              title="Delete supplier?"
                              description="This permanently removes the supplier record."
                              confirmLabel="Delete"
                              onConfirm={() => void removeSupplier(s)}
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
                  {!suppliersLoading && supplierRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                        No suppliers match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{supplierEditing ? "Edit Supplier" : "New Supplier"}</DialogTitle>
            <DialogDescription>Maintain supplier KRA details, payment terms, and credit limits.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <Field label="Supplier Name" value={supplierForm.name} onChange={(value) => setSupplierForm((prev) => ({ ...prev, name: value }))} />
            <Field label="KRA PIN" value={supplierForm.kra_pin} onChange={(value) => setSupplierForm((prev) => ({ ...prev, kra_pin: value }))} />
            <Field label="Contact" value={supplierForm.contact} onChange={(value) => setSupplierForm((prev) => ({ ...prev, contact: value }))} />
            <Field label="Email" value={supplierForm.email} onChange={(value) => setSupplierForm((prev) => ({ ...prev, email: value }))} />
            <Field label="Phone" value={supplierForm.phone} onChange={(value) => setSupplierForm((prev) => ({ ...prev, phone: value }))} />
            <Field label="Payment Terms" value={supplierForm.payment_terms} onChange={(value) => setSupplierForm((prev) => ({ ...prev, payment_terms: value }))} />
            <Field label="Credit Limit" type="number" value={supplierForm.credit_limit} onChange={(value) => setSupplierForm((prev) => ({ ...prev, credit_limit: value }))} />
            <Field label="Balance" type="number" value={supplierForm.balance} onChange={(value) => setSupplierForm((prev) => ({ ...prev, balance: value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupplierDialogOpen(false)} disabled={supplierSaving}>
              Cancel
            </Button>
            <Button onClick={saveSupplier} disabled={supplierSaving}>
              {supplierSaving ? "Saving..." : supplierEditing ? "Save Changes" : "Create Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reqOpen} onOpenChange={setReqOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New purchase requisition</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Item</Label>
              <Select value={reqForm.item_id} onValueChange={(v) => setReqForm((p) => ({ ...p, item_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                <SelectContent>
                  {reqItems.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input type="number" min={1} value={reqForm.quantity} onChange={(e) => setReqForm((p) => ({ ...p, quantity: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Required date</Label>
              <Input type="date" value={reqForm.required_date} onChange={(e) => setReqForm((p) => ({ ...p, required_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={reqForm.notes} onChange={(e) => setReqForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReqOpen(false)}>Cancel</Button>
            <Button disabled={reqSaving || !reqForm.item_id} onClick={() => {
              if (!token) return;
              setReqSaving(true);
              void createRequisition(token, {
                required_date: reqForm.required_date || undefined,
                notes: reqForm.notes || undefined,
                lines: [{ item_id: reqForm.item_id, quantity: Number(reqForm.quantity) }],
              })
                .then(() => { toast.success("Requisition created"); setReqOpen(false); return loadRequisitions(); })
                .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
                .finally(() => setReqSaving(false));
            }}>
              {reqSaving ? "Saving…" : "Create PR"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewPoDialog({
  suppliers,
  onCompleted,
}: {
  suppliers: BackendSupplier[];
  onCompleted: () => void | Promise<void>;
}) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(10);
  const [unitCost, setUnitCost] = useState("");
  const [expectedDate, setExpectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !token) return;
    setLoading(true);
    void Promise.all([fetchMasterItems(token), fetchWarehouses(token)])
      .then(([itemRows, whRows]) => {
        setItems(itemRows);
        setWarehouses(whRows);
        setVendorId(String(suppliers[0]?.id ?? ""));
        setWarehouseId(String(whRows[0]?.id ?? ""));
        const first = itemRows[0];
        setItemId(first?.id ?? "");
        setUnitCost(String(first?.standard_cost ?? ""));
      })
      .catch(() => toast.error("Unable to load PO form data"))
      .finally(() => setLoading(false));
  }, [open, token, suppliers]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !vendorId || !warehouseId || !itemId) return;
    const cost = Number(unitCost);
    if (cost <= 0 || qty < 1) {
      toast.error("Enter valid quantity and unit cost");
      return;
    }
    setSaving(true);
    try {
      await createPurchaseOrder(token, {
        vendor_id: vendorId,
        warehouse_id: warehouseId,
        expected_date: expectedDate,
        notes: notes.trim() || undefined,
        lines: [{ item_id: itemId, quantity: qty, unit_cost: cost }],
      });
      toast.success("Purchase order created");
      await onCompleted();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to create PO");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New PO
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>Create a PO against a supplier and warehouse.</DialogDescription>
          </DialogHeader>
          {loading ? (
            <p className="py-6 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-3 py-4">
              <div className="space-y-1.5">
                <Label>Supplier</Label>
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Warehouse</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Item</Label>
                <Select value={itemId} onValueChange={(id) => {
                  setItemId(id);
                  const item = items.find((i) => i.id === id);
                  if (item) setUnitCost(String(item.standard_cost ?? ""));
                }}>
                  <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                  <SelectContent>
                    {items.map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Unit cost</Label>
                  <Input type="number" min={0} step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Expected date</Label>
                <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || loading}>{saving ? "Creating…" : "Create PO"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
