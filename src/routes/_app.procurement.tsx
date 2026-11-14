import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchBar } from "@/components/SearchBar";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { KES, fmtDate } from "@/lib/format";
import { exportWorkbook } from "@/lib/excel";
import { supplierScoreFromBalances } from "@/lib/smartSignals";
import { trackEvent } from "@/lib/event-tracker";
import { useAuth } from "@/lib/auth";
import {
  type BackendPurchaseOrder,
  type BackendGoodsReceipt,
  type BackendSupplier,
} from "@/lib/api-types";
import { masterCreate, masterDelete, masterUpdate, v1Api } from "@/lib/api-v1";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import { EMPTY_ARRAY, useAction, useList } from "@/lib/queryHooks";
import { useUrlSearchParam } from "@/lib/urlSearchState";

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

type ReceivingLine = {
  po_line_id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  ordered_quantity: number;
  received_before: number;
  remaining_quantity: number;
  unit_cost: number;
  lot_tracking_enabled: boolean;
  expiry_tracking_enabled: boolean;
  receive_quantity: string;
  batch_no: string;
  expiry_date: string;
  inspection_status: "accept" | "quarantine" | "reject";
  inspection_reason: string;
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
  head: () => ({ meta: [{ title: "Procurement - Ayawin Stock Solution" }] }),
});

function Procurement() {
  const { token } = useAuth();
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [tab, setTab] = useState(() => hash.replace(/^#/, "") || "purchase-orders");
  const [q, setQ] = useUrlSearchParam("q", "");
  const [status, setStatus] = useUrlSearchParam("status", "all");
  const [sort, setSort] = useUrlSearchParam("sort", "date");
  const [pageValue, setPageValue] = useUrlSearchParam("page", "1");
  const page = Math.max(1, Number(pageValue) || 1);
  const setPage = (next: number) => setPageValue(String(Math.max(1, next)));
  const ordersQuery = useList(
    queryKeys.procurement.orders(),
    async ({ signal }) => {
      const rows = await v1Api.procurement.purchaseOrders(token!, signal);
      const statusMap: Record<string, BackendPurchaseOrder["status"]> = {
        draft: "Draft",
        submitted: "Sent",
        approved: "Approved",
        sent: "Sent",
        partial: "Approved",
        received: "Received",
        closed: "Received",
        cancelled: "Cancelled",
      };
      return rows.map((row) => {
        const status = String(row.status || "draft").toLowerCase();
        return {
          id: String(row.po_number || row.id),
          internal_id: String(row.id),
          date: String(row.order_date || row.created_at || "").slice(0, 10),
          supplier: String(row.vendor_name || ""),
          warehouse: String(row.warehouse_name || ""),
          items: 0,
          total: Number(row.total_amount || 0),
          status: statusMap[status] || "Draft",
        };
      });
    },
    { enabled: Boolean(token) },
  );
  const supplierQuery = useList(
    queryKeys.suppliers.list(),
    async ({ signal }) => {
      const rows = await v1Api.master.vendors(token!, signal);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        kra_pin: row.tax_id || "",
        contact: row.contact_name,
        email: row.email,
        phone: row.phone,
        payment_terms: null,
        credit_limit: Number(row.credit_limit || 0),
        balance: 0,
      }));
    },
    { enabled: Boolean(token) && tab === "suppliers" },
  );
  const receiptsQuery = useList(
    queryKeys.procurement.goodsReceipts(),
    async ({ signal }) => {
      const rows = await v1Api.procurement.goodsReceipts(token!, signal);
      return rows.map((row) => ({
        id: String(row.id),
        grn_number: String(row.grn_number || row.id),
        po_number: row.po_number ? String(row.po_number) : undefined,
        receipt_date: row.received_date ? String(row.received_date).slice(0, 10) : undefined,
        status: row.status ? String(row.status) : undefined,
        notes: row.notes ? String(row.notes) : null,
        vendor_id: row.vendor_id ? String(row.vendor_id) : undefined,
        vendor_name: row.vendor_name ? String(row.vendor_name) : undefined,
        purchase_order_id: row.purchase_order_id ? String(row.purchase_order_id) : undefined,
      }));
    },
    { enabled: Boolean(token) && tab === "receipts" },
  );
  const approveOrderAction = useAction({
    mutationFn: (id: string) => v1Api.procurement.approvePurchaseOrder(token!, id),
    invalidate: [queryKeys.procurement.orders()],
  });
  const receiveOrderAction = useAction({
    mutationFn: (input: {
      purchaseOrderId: string;
      receivedDate: string;
      notes: string;
      lines: ReceivingLine[];
    }) =>
      v1Api.procurement.receivePurchaseOrder(token!, input.purchaseOrderId, {
        received_date: input.receivedDate,
        notes: input.notes,
        lines: input.lines
          .filter((line) => Number(line.receive_quantity) > 0)
          .map((line) => ({
            po_line_id: line.po_line_id,
            item_id: line.item_id,
            quantity: Number(line.receive_quantity),
            unit_cost: line.unit_cost,
            batch_no: line.batch_no.trim() || undefined,
            expiry_date: line.expiry_date || undefined,
            inspection_status: line.inspection_status,
            inspection_reason: line.inspection_reason.trim() || undefined,
          })),
      }),
    invalidate: [
      queryKeys.procurement.orders(),
      queryKeys.procurement.goodsReceipts(),
      queryKeys.inventory.workspace(),
    ],
  });
  const orders = ordersQuery.data ?? EMPTY_ARRAY;
  const suppliers = supplierQuery.data ?? EMPTY_ARRAY;
  const receipts = receiptsQuery.data ?? [];
  const ordersLoading = ordersQuery.isPending;
  const suppliersLoading = supplierQuery.isPending;
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierEditing, setSupplierEditing] = useState<BackendSupplier | null>(null);
  const [supplierForm, setSupplierForm] = useState<SupplierFormState>(emptySupplierForm());
  const [receivingOrder, setReceivingOrder] = useState<Record<string, unknown> | null>(null);
  const [receivingLines, setReceivingLines] = useState<ReceivingLine[]>([]);
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptNotes, setReceiptNotes] = useState("");
  const [receiptSaving, setReceiptSaving] = useState(false);

  const pageSize = 5;

  const loadSuppliers = async () => {
    await supplierQuery.refetch();
  };
  const loadOrders = async () => {
    await ordersQuery.refetch();
  };

  useEffect(() => {
    const nextTab = hash.replace(/^#/, "");
    if (["purchase-orders", "receipts", "suppliers"].includes(nextTab)) setTab(nextTab);
  }, [hash]);

  const orderRows = useMemo(
    () =>
      orders
        .filter(
          (p) =>
            (status === "all" || p.status === status) &&
            (p.id.toLowerCase().includes(q.toLowerCase()) ||
              p.supplier.toLowerCase().includes(q.toLowerCase())),
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

  const setOrderStatus = async (
    row: BackendPurchaseOrder,
    nextStatus: BackendPurchaseOrder["status"],
  ) => {
    if (!token) return;
    const internalId = row.internal_id;
    if (!internalId) {
      toast.error("This purchase order is not connected to the database");
      return;
    }

    try {
      if (nextStatus !== "Approved")
        throw new Error("This action is not supported by the live purchase-order workflow.");
      await approveOrderAction.mutateAsync(String(internalId));
      toast.success(`Status set to ${nextStatus}`);
      setPage(1);
      await loadOrders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to update status");
    }
  };

  const receiveOrder = async (row: BackendPurchaseOrder) => {
    if (!token) return;
    const internalId = row.internal_id;
    if (!internalId) {
      toast.error("This purchase order is not connected to the database");
      return;
    }

    try {
      const purchaseOrder = await v1Api.procurement.purchaseOrder(token, String(internalId));
      const lines = (purchaseOrder.lines || [])
        .map((line) => {
          const ordered = Number(line.quantity || 0);
          const received = Number(line.qty_received || 0);
          return {
            po_line_id: String(line.id),
            item_id: String(line.item_id),
            item_code: String(line.item_code || ""),
            item_name: String(line.item_name || ""),
            ordered_quantity: ordered,
            received_before: received,
            remaining_quantity: Math.max(0, ordered - received),
            unit_cost: Number(line.unit_cost || 0),
            lot_tracking_enabled: line.lot_tracking_enabled === true,
            expiry_tracking_enabled: line.expiry_tracking_enabled === true,
            receive_quantity: String(Math.max(0, ordered - received)),
            batch_no: "",
            expiry_date: "",
            inspection_status: "accept",
            inspection_reason: "",
          } satisfies ReceivingLine;
        })
        .filter((line) => line.remaining_quantity > 0);
      if (!lines.length)
        throw new Error("This purchase order has no outstanding quantities to receive.");
      setReceivingOrder(purchaseOrder);
      setReceivingLines(lines);
      setReceivedDate(new Date().toISOString().slice(0, 10));
      setReceiptNotes("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load purchase-order lines");
    }
  };

  const submitReceipt = async () => {
    if (!token || !receivingOrder) return;
    const receiving = receivingLines.filter((line) => Number(line.receive_quantity) > 0);
    if (!receiving.length)
      return toast.error("Enter a positive received quantity on at least one line.");
    for (const line of receiving) {
      const quantity = Number(line.receive_quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > line.remaining_quantity) {
        return toast.error(
          `${line.item_code} quantity must be positive and no more than the outstanding PO quantity.`,
        );
      }
      if (line.lot_tracking_enabled && !line.batch_no.trim()) {
        return toast.error(`${line.item_code} requires a batch number.`);
      }
      if ((line.lot_tracking_enabled || line.expiry_tracking_enabled) && !line.expiry_date) {
        return toast.error(`${line.item_code} requires an expiry date.`);
      }
      if (line.inspection_status !== "accept" && !line.inspection_reason.trim()) {
        return toast.error(
          `${line.item_code} needs an inspection reason when quarantined or rejected.`,
        );
      }
    }
    setReceiptSaving(true);
    try {
      const result = await receiveOrderAction.mutateAsync({
        purchaseOrderId: String(receivingOrder.id),
        receivedDate,
        notes: receiptNotes.trim(),
        lines: receiving,
      });
      toast.success(`GRN created: ${String(result.grn_number || result.id || "posted")}`);
      setReceivingOrder(null);
      await loadOrders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to receive order");
    } finally {
      setReceiptSaving(false);
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

    exportWorkbook("ayawin-stock-solution-procurement.xlsx", [
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
          const score = supplierScoreFromBalances(
            Number(s.balance || 0),
            Number(s.credit_limit || 0),
          );
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
        const updated = await masterUpdate(token, "vendors", String(supplierEditing.id), {
          name: payload.name,
          tax_id: payload.kra_pin,
          contact_name: payload.contact,
          email: payload.email,
          phone: payload.phone,
          credit_limit: payload.credit_limit,
        });
        void trackEvent({
          action: "supplier_updated",
          entityType: "supplier",
          entityId: String(updated.id),
          details: { name: updated.name, kra_pin: updated.tax_id },
          scenario: "procurement",
          context: payload,
        });
        toast.success(`Supplier ${updated.name} updated`);
      } else {
        const created = await masterCreate(token, "vendors", {
          vendor_code: payload.kra_pin || `V-${Date.now()}`,
          name: payload.name,
          tax_id: payload.kra_pin,
          contact_name: payload.contact,
          email: payload.email,
          phone: payload.phone,
          credit_limit: payload.credit_limit,
        });
        void trackEvent({
          action: "supplier_created",
          entityType: "supplier",
          entityId: String(created.id),
          details: { name: created.name, kra_pin: created.tax_id },
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
      await masterDelete(token, "vendors", String(supplier.id));
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
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            l: "Draft / Approved",
            v: `${orders.filter((row) => row.status === "Draft").length} / ${orders.filter((row) => row.status === "Approved").length}`,
          },
          { l: "Sent", v: String(orders.filter((row) => row.status === "Sent").length) },
          { l: "Received", v: String(receipts.length) },
          { l: "Suppliers", v: String(suppliers.length) },
        ].map((k) => (
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
            const score = supplierScoreFromBalances(
              Number(supplier.balance || 0),
              Number(supplier.credit_limit || 0),
            );
            return (
              <div
                key={supplier.id}
                className="rounded-xl border border-border/70 bg-background/60 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{supplier.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {supplier.kra_pin}
                    </div>
                  </div>
                  <Badge variant="outline">{score.score}</Badge>
                </div>
                <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Terms</span>
                    <span className="font-medium text-foreground">
                      {supplier.payment_terms || "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Credit</span>
                    <span className="font-medium text-foreground">
                      {KES(Number(supplier.credit_limit || 0))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Balance</span>
                    <span className="font-semibold text-foreground">
                      {KES(Number(supplier.balance || 0))}
                    </span>
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

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          window.history.replaceState({}, "", `${window.location.pathname}#${value}`);
        }}
      >
        <TabsList>
          <TabsTrigger value="purchase-orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="receipts">Goods Receipts</TabsTrigger>
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
                    {["Draft", "Approved", "Sent", "Received", "Invoiced"].map((s) => (
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
                      <TableCell
                        colSpan={8}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        Loading purchase orders...
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedOrders.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.id}</TableCell>
                        <TableCell>{fmtDate(p.date)}</TableCell>
                        <TableCell className="font-medium">{p.supplier}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.warehouse ?? "-"}
                        </TableCell>
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
                              <Button variant="ghost" size="sm" disabled={p.status !== "Draft"}>
                                Approve
                              </Button>
                            </ConfirmActionDialog>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!p.internal_id || !["Sent", "Approved"].includes(p.status)}
                              onClick={() => void receiveOrder(p)}
                            >
                              Receive
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  {!ordersLoading && pagedOrders.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        No purchase orders match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <ListPagination
                page={page}
                totalPages={totalPages}
                totalItems={orderRows.length}
                pageSize={pageSize}
                onPageChange={setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="receipts" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-4">
                <h2 className="font-semibold">Goods receipt history</h2>
                <p className="text-sm text-muted-foreground">
                  Posted receipts update stock and create the procurement audit trail.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>GRN</TableHead>
                    <TableHead>Purchase order</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-mono text-xs">{receipt.grn_number}</TableCell>
                      <TableCell>{receipt.po_number || "—"}</TableCell>
                      <TableCell>
                        {receipt.receipt_date ? fmtDate(receipt.receipt_date) : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={receipt.status || "Posted"} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!receipts.length && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        No goods receipts posted yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  Supplier directory is searchable by the same keyword bar above and sorted
                  alphabetically for quick lookup.
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
                      <TableCell
                        colSpan={8}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        Loading suppliers...
                      </TableCell>
                    </TableRow>
                  ) : (
                    supplierRows.map((s) => {
                      const score = supplierScoreFromBalances(
                        Number(s.balance || 0),
                        Number(s.credit_limit || 0),
                      );
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
                          <TableCell className="text-right">
                            {KES(Number(s.credit_limit || 0))}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {KES(Number(s.balance || 0))}
                          </TableCell>
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
                  {!suppliersLoading && supplierRows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
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

      <Dialog
        open={Boolean(receivingOrder)}
        onOpenChange={(open) => {
          if (!open && !receiptSaving) setReceivingOrder(null);
        }}
      >
        <DialogContent className="max-w-6xl">
          {receivingOrder && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Receive purchase order {String(receivingOrder.po_number || "")}
                </DialogTitle>
                <DialogDescription>
                  Enter actual received quantities. Partial receipts are allowed; excess over the
                  approved order is blocked.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="grn-received-date">Received date</Label>
                  <Input
                    id="grn-received-date"
                    type="date"
                    value={receivedDate}
                    onChange={(event) => setReceivedDate(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="grn-notes">Inspection / discrepancy notes</Label>
                  <Input
                    id="grn-notes"
                    value={receiptNotes}
                    onChange={(event) => setReceiptNotes(event.target.value)}
                    maxLength={1000}
                    placeholder="Short, damaged, rejected, or other inspection notes"
                  />
                </div>
              </div>
              <div className="max-h-[55vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Open</TableHead>
                      <TableHead>Receive now</TableHead>
                      <TableHead>Inspection</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead className="text-right">PO unit cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receivingLines.map((line, index) => (
                      <TableRow key={line.po_line_id}>
                        <TableCell className="min-w-44 font-medium">
                          {line.item_code}
                          <div className="text-xs text-muted-foreground">{line.item_name}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.ordered_quantity}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.received_before}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.remaining_quantity}
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Receive quantity ${line.item_code}`}
                            type="number"
                            min="0"
                            max={line.remaining_quantity}
                            step="0.0001"
                            value={line.receive_quantity}
                            onChange={(event) =>
                              setReceivingLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, receive_quantity: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            aria-label={`Inspection ${line.item_code}`}
                            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                            value={line.inspection_status}
                            onChange={(event) =>
                              setReceivingLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        inspection_status: event.target
                                          .value as ReceivingLine["inspection_status"],
                                      }
                                    : entry,
                                ),
                              )
                            }
                          >
                            <option value="accept">Accept</option>
                            <option value="quarantine">Quarantine</option>
                            <option value="reject">Reject</option>
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Inspection reason ${line.item_code}`}
                            value={line.inspection_reason}
                            onChange={(event) =>
                              setReceivingLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, inspection_reason: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            placeholder={
                              line.inspection_status === "accept" ? "Optional" : "Required"
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Batch ${line.item_code}`}
                            value={line.batch_no}
                            onChange={(event) =>
                              setReceivingLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, batch_no: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            placeholder={line.lot_tracking_enabled ? "Required" : "Optional"}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Expiry ${line.item_code}`}
                            type="date"
                            value={line.expiry_date}
                            onChange={(event) =>
                              setReceivingLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, expiry_date: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {KES(line.unit_cost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Items flagged for lot or expiry tracking require valid lot details. This receipt
                uses the approved PO cost; price variances need a separate review workflow.
              </p>
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={receiptSaving}
                  onClick={() => setReceivingOrder(null)}
                >
                  Cancel
                </Button>
                <Button disabled={receiptSaving} onClick={() => void submitReceipt()}>
                  {receiptSaving ? "Posting GRN…" : "Post goods receipt"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{supplierEditing ? "Edit Supplier" : "New Supplier"}</DialogTitle>
            <DialogDescription>
              Maintain supplier KRA details, payment terms, and credit limits.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <Field
              label="Supplier Name"
              value={supplierForm.name}
              onChange={(value) => setSupplierForm((prev) => ({ ...prev, name: value }))}
            />
            <Field
              label="KRA PIN"
              value={supplierForm.kra_pin}
              onChange={(value) => setSupplierForm((prev) => ({ ...prev, kra_pin: value }))}
            />
            <Field
              label="Contact"
              value={supplierForm.contact}
              onChange={(value) => setSupplierForm((prev) => ({ ...prev, contact: value }))}
            />
            <Field
              label="Email"
              value={supplierForm.email}
              onChange={(value) => setSupplierForm((prev) => ({ ...prev, email: value }))}
            />
            <Field
              label="Phone"
              value={supplierForm.phone}
              onChange={(value) => setSupplierForm((prev) => ({ ...prev, phone: value }))}
            />
            <Field
              label="Payment Terms"
              value={supplierForm.payment_terms}
              onChange={(value) => setSupplierForm((prev) => ({ ...prev, payment_terms: value }))}
            />
            <Field
              label="Credit Limit"
              type="number"
              value={supplierForm.credit_limit}
              onChange={(value) => setSupplierForm((prev) => ({ ...prev, credit_limit: value }))}
            />
            <Field
              label="Balance"
              type="number"
              value={supplierForm.balance}
              onChange={(value) => setSupplierForm((prev) => ({ ...prev, balance: value }))}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSupplierDialogOpen(false)}
              disabled={supplierSaving}
            >
              Cancel
            </Button>
            <Button onClick={saveSupplier} disabled={supplierSaving}>
              {supplierSaving ? "Saving..." : supplierEditing ? "Save Changes" : "Create Supplier"}
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
