import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Download, FileDown, ArrowUpDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SalesQuotationsPanel } from "@/components/SalesQuotationsPanel";
import { SalesReturnsPanel } from "@/components/SalesReturnsPanel";
import { SalesProductSearch } from "@/components/SalesProductSearch";
import { maxDiscountPercentForRole } from "@/lib/discountCaps";
import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribeLiveEvents } from "@/hooks/useLiveEvents";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { toast } from "sonner";
import { KES, fmtDate } from "@/lib/format";
import { SearchBar } from "@/components/SearchBar";
import { StatusBadge } from "@/components/StatusBadge";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { exportWorkbook } from "@/lib/excel";
import { trackEvent } from "@/lib/event-tracker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify, triggerEmailNotification } from "@/lib/notifications";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { PermissionGate } from "@/components/PermissionGate";
import {
  createInvoiceFromSalesOrder,
  createSalesOrder,
  cancelSalesOrder,
  confirmSalesOrder,
  dispatchSalesOrder,
  fetchActiveCustomers,
  fetchInventoryItems,
  fetchMasterItems,
  fetchSalesDiscountCap,
  previewSalesOrderTotals,
  resolveSalesUnitPrice,
  checkSalesAtp,
  fetchSalesOrderDetail,
  fetchSalesAnalytics,
  fetchSalesOrders,
  fetchWarehouses,
  type BackendCustomer,
  type BackendMasterItem,
  type BackendSalesOrder,
  type BackendWarehouse,
  type SalesOrderDetail,
} from "@/lib/api";

export const Route = createFileRoute("/_app/sales")({
  component: SalesPage,
  head: () => ({ meta: [{ title: "Sales & Orders - Ayawin Stock Solutions ERP" }] }),
});

function SalesPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<BackendSalesOrder[]>([]);
  const [warehouseIds, setWarehouseIds] = useState<string[]>([]);
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);
  const [processingAll, setProcessingAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [orderStats, setOrderStats] = useState<
    Array<{ status: string; count: number; total: number }>
  >([]);
  const pageSize = 25;
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [orderDetail, setOrderDetail] = useState<SalesOrderDetail | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BackendSalesOrder | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const reloadSalesOrders = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const statusParam =
        status === "all"
          ? undefined
          : {
              Draft: "draft",
              Confirmed: "confirmed",
              Approved: "confirmed",
              "In Transit": "partial",
              Dispatched: "partial",
              Delivered: "delivered",
              Invoiced: "invoiced",
              Cancelled: "cancelled",
            }[status];
      const { rows: data, total } = await fetchSalesOrders(token, {
        page,
        limit: pageSize,
        q: query.trim() || undefined,
        status: statusParam,
      });
      setRows(data);
      setListTotal(total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load sales orders");
      setRows([]);
      setListTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token, page, pageSize, query, status]);

  useEffect(() => {
    void reloadSalesOrders();
  }, [reloadSalesOrders]);

  useEffect(() => {
    if (!token) return;
    void fetchSalesAnalytics(token)
      .then((data) => {
        const rows =
          (data?.orders_by_status as Array<{ status: string; count: number; total: number }>) ?? [];
        setOrderStats(rows);
      })
      .catch(() => setOrderStats([]));
  }, [token, loading]);

  useRealtimeSync(() => void reloadSalesOrders(), { enabled: Boolean(token) });

  useEffect(() => {
    return subscribeLiveEvents((ev) => {
      if (
        ev.type === "invoice.updated" ||
        ev.type === "payment.received" ||
        ev.type === "inventory.updated" ||
        ev.type === "sales_order.confirmed"
      ) {
        void reloadSalesOrders();
      }
    });
  }, [reloadSalesOrders]);

  useEffect(() => {
    if (!token) return;
    void fetchWarehouses(token)
      .then((whs) => setWarehouseIds(whs.map((w) => String(w.id))))
      .catch(() => setWarehouseIds([]));
  }, [token]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sort === "total") return b.total - a.total;
      if (sort === "status") return a.status.localeCompare(b.status);
      return b.date.localeCompare(a.date);
    });
  }, [rows, sort]);

  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const paged = sorted;

  const salesKpis = useMemo(() => {
    const count = (statuses: string[]) =>
      orderStats
        .filter((r) => statuses.includes(String(r.status).toLowerCase()))
        .reduce((s, r) => s + Number(r.count || 0), 0);
    const sum = (statuses: string[]) =>
      orderStats
        .filter((r) => statuses.includes(String(r.status).toLowerCase()))
        .reduce((s, r) => s + Number(r.total || 0), 0);
    const open = count(["draft", "confirmed", "partial", "approved"]);
    const draft = count(["draft"]);
    const confirmed = count(["confirmed"]);
    const inTransit = count(["partial"]);
    const invoicedN = count(["invoiced"]);
    const invoicedTotal = sum(["invoiced"]);
    const totalOrders = orderStats.reduce((s, r) => s + Number(r.count || 0), 0);
    const totalValue = orderStats.reduce((s, r) => s + Number(r.total || 0), 0);
    const avg = totalOrders ? totalValue / totalOrders : 0;
    return [
      { l: "Open Orders", v: String(open), t: `${confirmed} confirmed, ${draft} draft` },
      { l: "In Transit", v: String(inTransit), t: "Awaiting delivery" },
      { l: "Invoiced total", v: KES(invoicedTotal), t: `${invoicedN} orders` },
      { l: "Avg Order Value", v: KES(avg), t: `${listTotal.toLocaleString()} orders in system` },
    ];
  }, [orderStats, listTotal]);

  const exportSales = () => {
    void trackEvent({
      action: "sales_export_xlsx",
      entityType: "report",
      entityId: "sales",
      details: { rows: listTotal },
      scenario: "sales",
      context: { query, status, sort, rows: listTotal },
    });
    exportWorkbook("ayawin-enterprise-sales.xlsx", [
      {
        name: "Sales Orders",
        rows: sorted.map((o) => ({
          "Order #": o.id,
          Date: fmtDate(o.date),
          Customer: o.customer,
          "Sales Rep": o.rep,
          Items: o.items,
          Total: o.total,
          Status: o.status,
        })),
      },
    ]);
  };

  const openOrderDetail = (order: BackendSalesOrder) => {
    if (!token || !order.internal_id) return;
    setDetailOpen(true);
    setDetailLoading(true);
    setOrderDetail(null);
    void fetchSalesOrderDetail(token, order.internal_id)
      .then(setOrderDetail)
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Unable to load order");
        setDetailOpen(false);
      })
      .finally(() => setDetailLoading(false));
  };

  const advanceOrderStep = async (order: BackendSalesOrder): Promise<boolean> => {
    if (!token || !order.internal_id) return false;
    const firstWarehouse = warehouseIds[0] || "";
    if (!firstWarehouse && (order.status === "Confirmed" || order.status === "Partial")) {
      toast.error("No warehouse found to dispatch from.");
      return false;
    }

    setProcessingOrderId(order.id);
    try {
      if (order.status === "Draft") {
        const confirmed = await confirmSalesOrder(token, order.internal_id);
        if (!confirmed.ok) throw new Error("Order confirmation failed.");
        toast.success(`${order.id} confirmed`);
      } else if (order.status === "Confirmed" || order.status === "Partial") {
        await dispatchSalesOrder(token, order.internal_id, firstWarehouse);
        toast.success(`${order.id} dispatched / delivered`);
      } else if (order.status === "Delivered") {
        await createInvoiceFromSalesOrder(token, order.internal_id);
        toast.success(`Invoice created for ${order.id}`);
      } else {
        toast.message("No further workflow step for this order.");
        return false;
      }
      await reloadSalesOrders();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not advance order");
      return false;
    } finally {
      setProcessingOrderId(null);
    }
  };

  const processAllReadyOrders = async () => {
    if (!token) return;
    const ready = sorted.filter(
      (o) =>
        o.internal_id &&
        (o.status === "Draft" ||
          o.status === "Confirmed" ||
          o.status === "Partial" ||
          o.status === "Delivered"),
    );
    if (!ready.length) {
      toast.message("No ready orders to process.");
      return;
    }
    if (!warehouseIds[0]) {
      toast.error("No warehouse found to process orders.");
      return;
    }

    setProcessingAll(true);
    let success = 0;
    let failed = 0;
    for (const order of ready) {
      const ok = await advanceOrderStep(order);
      if (ok) {
        success += 1;
      } else {
        failed += 1;
      }
    }
    setProcessingAll(false);
    await reloadSalesOrders();
    if (failed > 0) {
      toast.warning(`Processed ${success} orders, ${failed} failed.`);
    } else {
      toast.success(`Processed ${success} orders successfully.`);
    }
  };

  return (
    <div>
      <PageHeader
        title="Sales & Orders"
        description="Manage quotations, sales orders, dispatches and returns."
        actions={
          <>
            <Button variant="outline" onClick={exportSales}>
              <FileDown className="mr-2 h-4 w-4" />
              Export XLSX
            </Button>
            <Button
              variant="outline"
              disabled={processingAll}
              onClick={() => {
                void processAllReadyOrders();
              }}
            >
              {processingAll ? "Processing orders..." : "Process All Ready"}
            </Button>
            <NewOrderDialog onCompleted={reloadSalesOrders} />
          </>
        }
      />

      <Tabs defaultValue="orders" className="mt-2">
        <TabsList>
          <TabsTrigger value="orders">Sales orders</TabsTrigger>
          <TabsTrigger value="quotations">Quotations</TabsTrigger>
          <TabsTrigger value="returns">Returns</TabsTrigger>
        </TabsList>
        <TabsContent value="quotations" className="mt-4">
          <SalesQuotationsPanel onOrderCreated={() => void reloadSalesOrders()} />
        </TabsContent>
        <TabsContent value="returns" className="mt-4">
          <SalesReturnsPanel />
        </TabsContent>
        <TabsContent value="orders" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {salesKpis.map((k) => (
              <Card key={k.l}>
                <CardContent className="p-4">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    {k.l}
                  </div>
                  <div className="mt-1 text-2xl font-bold">{k.v}</div>
                  <div className="text-xs text-muted-foreground">{k.t}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <QuietNote
            scenario="sales"
            contextKey={`${query}-${status}-${sort}`}
            context={{ query, status, sort, orders: paged, orderCount: rows.length }}
            className="mb-4"
          />

          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <SearchBar
                  value={query}
                  onChange={(value) => {
                    setQuery(value);
                    setPage(1);
                  }}
                  placeholder="Search by order # or customer..."
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
                    {["Draft", "Confirmed", "Partial", "Delivered", "Invoiced", "Cancelled"].map(
                      (s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ),
                    )}
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
                <Button variant="outline" size="sm" className="ml-auto" onClick={exportSales}>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  XLSX
                </Button>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Sales Rep</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        Loading sales orders…
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {paged.map((o) => (
                        <TableRow
                          key={o.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => openOrderDetail(o)}
                        >
                          <TableCell className="font-mono text-xs">{o.id}</TableCell>
                          <TableCell>{fmtDate(o.date)}</TableCell>
                          <TableCell className="font-medium">{o.customer}</TableCell>
                          <TableCell className="text-muted-foreground">{o.rep}</TableCell>
                          <TableCell className="text-right">{o.items}</TableCell>
                          <TableCell className="text-right font-semibold">{KES(o.total)}</TableCell>
                          <TableCell>
                            <StatusBadge status={o.status} />
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-2">
                              {["Draft", "Confirmed", "Partial", "Delivered"].includes(o.status) &&
                                o.internal_id && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={processingOrderId === o.id}
                                    onClick={() => void advanceOrderStep(o)}
                                  >
                                    {processingOrderId === o.id
                                      ? "Working…"
                                      : o.status === "Draft"
                                        ? "Confirm"
                                        : o.status === "Delivered"
                                          ? "Invoice"
                                          : "Dispatch"}
                                  </Button>
                                )}
                              {o.internal_id && !["Invoiced", "Cancelled"].includes(o.status) && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setCancelTarget(o)}
                                >
                                  Cancel
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {paged.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            className="py-10 text-center text-sm text-muted-foreground"
                          >
                            No orders yet. Create a sales order to see it here.
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )}
                </TableBody>
              </Table>
              <ListPagination
                page={page}
                totalPages={totalPages}
                totalItems={listTotal}
                pageSize={pageSize}
                onPageChange={setPage}
              />
            </CardContent>
          </Card>

          <AlertDialog
            open={Boolean(cancelTarget)}
            onOpenChange={(open) => !open && setCancelTarget(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel sales order?</AlertDialogTitle>
                <AlertDialogDescription>
                  {cancelTarget
                    ? `Order ${cancelTarget.id} will be cancelled and stock reversed where applicable.`
                    : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={cancelling}>Keep order</AlertDialogCancel>
                <AlertDialogAction
                  disabled={cancelling}
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!token || !cancelTarget?.internal_id) return;
                    setCancelling(true);
                    try {
                      await cancelSalesOrder(
                        token,
                        cancelTarget.internal_id,
                        "Cancelled from sales desk",
                      );
                      toast.success(`Order ${cancelTarget.id} cancelled`);
                      setCancelTarget(null);
                      await reloadSalesOrders();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not cancel order");
                    } finally {
                      setCancelling(false);
                    }
                  }}
                >
                  {cancelling ? "Cancelling…" : "Cancel order"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>
      </Tabs>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{orderDetail?.order_no || "Sales order"}</DialogTitle>
            <DialogDescription>
              {orderDetail
                ? `${orderDetail.customer_name} · ${fmtDate(orderDetail.order_date)} · ${orderDetail.warehouse_name}`
                : "Order lines and fulfillment status"}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading order…</p>
          ) : orderDetail ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={orderDetail.status} />
                <span className="text-sm font-semibold">{KES(orderDetail.total_amount)}</span>
              </div>
              {orderDetail.notes && (
                <p className="text-sm text-muted-foreground">{orderDetail.notes}</p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Invoiced</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                    <TableHead className="text-right">Line</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderDetail.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="font-mono text-xs">{line.item_code}</div>
                        <div className="text-sm">{line.item_name}</div>
                      </TableCell>
                      <TableCell className="text-right">{line.quantity}</TableCell>
                      <TableCell className="text-right">{line.qty_delivered}</TableCell>
                      <TableCell className="text-right">{line.qty_invoiced}</TableCell>
                      <TableCell className="text-right">{KES(line.unit_price)}</TableCell>
                      <TableCell className="text-right">{KES(line.line_total)}</TableCell>
                    </TableRow>
                  ))}
                  {orderDetail.lines.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No line items
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewOrderDialog({ onCompleted }: { onCompleted: () => void | Promise<void> }) {
  const { token, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [apiCustomers, setApiCustomers] = useState<BackendCustomer[]>([]);
  const [apiItems, setApiItems] = useState<BackendMasterItem[]>([]);
  const [apiWarehouses, setApiWarehouses] = useState<BackendWarehouse[]>([]);
  const [stockAvailable, setStockAvailable] = useState<number | null>(null);
  const [maxDiscount, setMaxDiscount] = useState(5);
  const [priceTier, setPriceTier] = useState<string | null>(null);
  const [totalsPreview, setTotalsPreview] = useState<{
    subtotal: number;
    exciseAmount: number;
    taxAmount: number;
    total: number;
  } | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(10);
  const [unitPrice, setUnitPrice] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !token) return;
    setFormLoading(true);
    void Promise.all([
      fetchActiveCustomers(token),
      fetchMasterItems(token),
      fetchWarehouses(token),
      fetchSalesDiscountCap(token).catch(() => ({
        max_discount_percent: maxDiscountPercentForRole(user?.role, user?.permissions),
      })),
    ])
      .then(([cust, items, whs, cap]) => {
        setApiCustomers(cust);
        setApiItems(items.filter((i) => i.is_active !== false));
        setApiWarehouses(whs);
        setMaxDiscount(Number(cap.max_discount_percent ?? 5));
        const firstItem = items[0];
        setCustomerId(String(cust[0]?.id ?? ""));
        setWarehouseId(String(whs[0]?.id ?? ""));
        setItemId(firstItem?.id ?? "");
        setUnitPrice(String(firstItem?.standard_cost ?? ""));
      })
      .catch((err) => {
        notify(
          "Could not load form",
          err instanceof Error ? err.message : "Unable to load customers or products.",
        );
      })
      .finally(() => setFormLoading(false));
  }, [open, token, user?.role, user?.permissions]);

  useEffect(() => {
    if (!token || !customerId || !itemId || !open) return;
    void resolveSalesUnitPrice(token, customerId, itemId)
      .then((p) => {
        setUnitPrice(String(p.unit_price));
        setPriceTier(p.price_tier);
      })
      .catch(() => setPriceTier(null));
  }, [token, customerId, itemId, open]);

  useEffect(() => {
    if (!token || !warehouseId || !itemId || !open) return;
    void fetchInventoryItems(token)
      .then((rows) => {
        const row = rows.find(
          (r) => String(r.item_id) === itemId && String(r.warehouse_id) === warehouseId,
        );
        setStockAvailable(row ? Number(row.stock ?? 0) : 0);
      })
      .catch(() => setStockAvailable(null));
  }, [token, warehouseId, itemId, open]);

  useEffect(() => {
    if (!token || !customerId || !itemId || qty < 1 || !open) return;
    const price = Number(unitPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    void previewSalesOrderTotals(token, {
      customer_id: customerId,
      lines: [
        { item_id: itemId, quantity: qty, unit_price: price, discount_percent: discountPercent },
      ],
    })
      .then(setTotalsPreview)
      .catch(() => setTotalsPreview(null));
  }, [token, customerId, itemId, qty, unitPrice, discountPercent, open]);

  const selectedCustomer = apiCustomers.find((c) => String(c.id) === customerId);
  const selectedItem = apiItems.find((i) => i.id === itemId);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !customerId || !warehouseId || !itemId || qty < 1) return;
    if (discountPercent > maxDiscount) {
      notify("Discount too high", `Your role allows up to ${maxDiscount}% discount.`);
      return;
    }
    if (stockAvailable != null && qty > stockAvailable) {
      notify("Insufficient stock", `Only ${stockAvailable} units available in this warehouse.`);
      return;
    }
    const price = Number(unitPrice) || selectedItem?.standard_cost || 0;
    if (price <= 0) {
      notify("Invalid price", "Enter a unit price greater than zero.");
      return;
    }
    setSaving(true);
    try {
      const atp = await checkSalesAtp(token, warehouseId, [{ item_id: itemId, quantity: qty }]);
      if (!atp.ok) {
        notify("Insufficient stock", "ATP check failed for this warehouse.");
        return;
      }
      const created = await createSalesOrder(token, {
        customer_id: customerId,
        warehouse_id: warehouseId,
        order_date: orderDate,
        notes: notes.trim() || undefined,
        sales_rep_id: user?.id ? String(user.id) : undefined,
        lines: [
          { item_id: itemId, quantity: qty, unit_price: price, discount_percent: discountPercent },
        ],
      });
      notify("Sales order created", `${created.id} saved to the database.`);
      void trackEvent({
        action: "sales_order_created",
        entityType: "sales_order",
        entityId: created.id,
        details: { customerId, itemId, qty, orderDate },
        scenario: "sales",
        context: { customerId, itemId, qty, total: created.total },
      });
      if (selectedCustomer?.email) {
        void triggerEmailNotification({
          recipient: selectedCustomer.email,
          subject: `Order ${created.id}`,
          message: `Sales order ${created.id} has been created for ${selectedCustomer.name}.`,
        });
      }
      await onCompleted();
      setOpen(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to save sales order.";
      notify(
        msg.toLowerCase().includes("credit limit")
          ? "Credit limit exceeded"
          : "Could not create order",
        msg,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <PermissionGate permission="sales.create">
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Sales Order
          </Button>
        </DialogTrigger>
      </PermissionGate>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6">
          <DialogHeader>
            <DialogTitle>Create Sales Order</DialogTitle>
            <DialogDescription>
              Draft a new order. KRA-compliant invoice generates on confirmation.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4 py-2 sm:grid-cols-2" id="sales-order-form" onSubmit={submit}>
            {formLoading ? (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Loading customers and products…
              </p>
            ) : null}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="customer">Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId} disabled={formLoading}>
                <SelectTrigger id="customer">
                  <SelectValue placeholder="Select customer..." />
                </SelectTrigger>
                <SelectContent>
                  {apiCustomers.map((c) => (
                    <SelectItem key={String(c.id)} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCustomer && (
                <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground">
                  <span>{selectedCustomer.segment || selectedCustomer.type}</span>
                  {priceTier && (
                    <>
                      <span>•</span>
                      <span className="capitalize">Price tier: {priceTier}</span>
                    </>
                  )}
                  <span>•</span>
                  <span>{selectedCustomer.location}</span>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Warehouse</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId} disabled={formLoading}>
                <SelectTrigger>
                  <SelectValue placeholder="Warehouse..." />
                </SelectTrigger>
                <SelectContent>
                  {apiWarehouses.map((w) => (
                    <SelectItem key={String(w.id)} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="order-date">Order date</Label>
              <Input
                id="order-date"
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="product">Product</Label>
              <SalesProductSearch
                id="product"
                items={apiItems}
                value={itemId}
                onValueChange={setItemId}
                disabled={formLoading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qty">Quantity</Label>
              <Input
                id="qty"
                type="number"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setQty(Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1);
                }}
                required
              />
              {stockAvailable != null ? (
                <p
                  className={
                    stockAvailable < qty
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {stockAvailable === 0
                    ? "No stock in this warehouse — use Inventory → Stock in or pick another warehouse."
                    : `Available in warehouse: ${stockAvailable} (order above this will fail ATP check)`}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Enter order quantity (checked against warehouse stock on save).
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit-price">Unit price (KES)</Label>
              <Input
                id="unit-price"
                type="number"
                min={0.01}
                step={0.01}
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="discount">Discount %</Label>
              <Input
                id="discount"
                type="number"
                min={0}
                max={maxDiscount}
                step={0.1}
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Max {maxDiscount}% for your role</p>
            </div>
            {totalsPreview && (
              <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-xs sm:col-span-2">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{KES(totalsPreview.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Excise</span>
                  <span>{KES(totalsPreview.exciseAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>VAT (16%)</span>
                  <span>{KES(totalsPreview.taxAmount)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{KES(totalsPreview.total)}</span>
                </div>
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </form>
        </div>
        <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="sales-order-form"
            disabled={saving || formLoading || !apiItems.length}
          >
            {saving ? "Saving..." : "Create draft order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
