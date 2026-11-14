import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Download, FileDown, ArrowUpDown } from "lucide-react";
import { useEffect, useState } from "react";
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
import { useAuth } from "@/lib/auth";
import { canPerformSalesAction } from "@/lib/rbac";
import { queryKeys } from "@/lib/queryKeys";
import { EMPTY_ARRAY, useList } from "@/lib/queryHooks";
import { useUrlSearchParam } from "@/lib/urlSearchState";
import type {
  BackendCustomer,
  BackendMasterItem,
  BackendSalesOrder,
  BackendWarehouse,
  SalesAnalytics,
  SalesOrderDetail,
} from "@/lib/api-types";
import {
  normalizeMasterCustomer,
  normalizeMasterItem,
  normalizeMasterWarehouse,
  v1Api,
} from "@/lib/api-v1";
import { useSalesWorkflow } from "@/features/sales/hooks/useSalesWorkflow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { salesOrderSchema } from "@/lib/schemas/sales";

export const Route = createFileRoute("/_app/sales")({
  component: SalesPage,
  head: () => ({ meta: [{ title: "Sales & Orders - Ayawin Stock Solution" }] }),
});

function SalesPage() {
  const { token, user } = useAuth();
  const {
    createSalesOrder,
    confirmSalesOrder,
    cancelSalesOrder,
    createInvoiceFromSalesOrder,
    createSalesPickList,
    confirmSalesPickList,
    dispatchSalesOrder,
    fetchSalesOrderDetail,
  } = useSalesWorkflow();
  const canCreateOrder = canPerformSalesAction(user, "sales.order.create");
  const canApproveOrder = canPerformSalesAction(user, "sales.order.approve");
  const canPostDelivery = canPerformSalesAction(user, "sales.delivery.post");
  const canCreateInvoice = canPerformSalesAction(user, "sales.invoice.create");
  const salesOrdersQuery = useList(
    queryKeys.sales.orders(user?.id),
    async ({ signal }) => {
      const data = await v1Api.sales.orders(token!, 25, signal);
      const statusMap: Record<string, BackendSalesOrder["status"]> = {
        draft: "Draft",
        confirmed: "Confirmed",
        partial: "Partial",
        delivered: "Delivered",
        invoiced: "Invoiced",
        cancelled: "Cancelled",
      };
      return data.map((row) => {
        const orderStatus = String(row.status || "draft").toLowerCase();
        return {
          id: String(row.order_no || row.id),
          internal_id: String(row.id),
          date: String(row.order_date || "").slice(0, 10),
          customer: String(row.customer_name || ""),
          rep: "—",
          items: 0,
          total: Number(row.total_amount || 0),
          status: statusMap[orderStatus] || "Draft",
        };
      });
    },
    { enabled: Boolean(token), refetchInterval: 60_000, refetchIntervalInBackground: false },
  );
  const rows = salesOrdersQuery.data ?? [];
  const salesOrdersError = salesOrdersQuery.error;
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);
  const loading = salesOrdersQuery.isPending;
  const [query, setQuery] = useUrlSearchParam("q", "");
  const [status, setStatus] = useUrlSearchParam("status", "all");
  const [sort, setSort] = useUrlSearchParam("sort", "date");
  const [pageValue, setPageValue] = useUrlSearchParam("page", "1");
  const page = Math.max(1, Number(pageValue) || 1);
  const setPage = (next: number) => setPageValue(String(Math.max(1, next)));
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [view, setView] = useState(() => hash.replace(/^#/, "") || "orders");
  const [detail, setDetail] = useState<SalesOrderDetail | null>(null);
  const [pickWorkflow, setPickWorkflow] = useState<{
    orderId: string;
    orderNo: string;
    pickList: Record<string, unknown> & {
      id: string;
      pick_no: string;
      status: string;
      lines: Record<string, unknown>[];
    };
  } | null>(null);
  const [confirmedPickLines, setConfirmedPickLines] = useState<string[]>([]);
  const analyticsQuery = useList(
    queryKeys.salesReports.list({ report: "overview", userId: user?.id }),
    async ({ signal }) => (await v1Api.sales.analytics(token!, signal)) as SalesAnalytics,
    { enabled: Boolean(token) && view === "credit" },
  );
  const analytics = analyticsQuery.data ?? null;
  const pageSize = 5;

  const reloadSalesOrders = async () => {
    if (!token) return;
    await salesOrdersQuery.refetch();
    setPage(1);
  };

  useEffect(() => {
    if (salesOrdersError) {
      toast.error(
        salesOrdersError instanceof Error
          ? salesOrdersError.message
          : "Unable to load sales orders",
      );
    }
  }, [salesOrdersError]);

  useEffect(() => {
    const nextView = hash.replace(/^#/, "");
    if (["orders", "credit"].includes(nextView)) setView(nextView);
  }, [hash]);

  const filtered = rows
    .filter(
      (o) =>
        (status === "all" || o.status === status) &&
        (o.id.toLowerCase().includes(query.toLowerCase()) ||
          o.customer.toLowerCase().includes(query.toLowerCase())),
    )
    .sort((a, b) => {
      if (sort === "total") return b.total - a.total;
      if (sort === "status") return a.status.localeCompare(b.status);
      return b.date.localeCompare(a.date);
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const exportSales = () => {
    void trackEvent({
      action: "sales_export_xlsx",
      entityType: "report",
      entityId: "sales",
      details: { rows: filtered.length },
      scenario: "sales",
      context: { query, status, sort, rows: filtered.length },
    });
    exportWorkbook("ayawin-stock-solution-sales.xlsx", [
      {
        name: "Sales Orders",
        rows: filtered.map((o) => ({
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

  const processOrder = async (order: BackendSalesOrder): Promise<boolean> => {
    if (!token || !order.internal_id) return false;
    setProcessingOrderId(order.id);
    try {
      const currentStatus = order.status;
      if (currentStatus === "Draft") {
        const confirmed = await confirmSalesOrder(token, order.internal_id);
        if (!confirmed.ok) throw new Error("Order confirmation failed.");
        toast.success(`${order.id} confirmed. Warehouse picking is next.`);
        await reloadSalesOrders();
        return true;
      }
      if (currentStatus === "Confirmed" || currentStatus === "Partial") {
        const pickList = await createSalesPickList(token, order.internal_id);
        setConfirmedPickLines(
          pickList.status === "picked" ? pickList.lines.map((line) => String(line.id)) : [],
        );
        setPickWorkflow({ orderId: order.internal_id, orderNo: order.id, pickList });
        return true;
      }
      if (currentStatus === "Delivered") {
        await createInvoiceFromSalesOrder(token, order.internal_id);
        toast.success(`Invoice created for ${order.id}.`);
        await reloadSalesOrders();
        return true;
      }
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not process order");
      return false;
    } finally {
      setProcessingOrderId(null);
    }
  };

  const confirmPick = async () => {
    if (!token || !pickWorkflow) return;
    const lines = pickWorkflow.pickList.lines.map((line) => ({
      pick_list_line_id: String(line.id),
      quantity_picked: Number(line.quantity_to_pick),
    }));
    try {
      const pickList = await confirmSalesPickList(token, pickWorkflow.pickList.id, lines);
      setPickWorkflow({ ...pickWorkflow, pickList });
      setConfirmedPickLines(pickList.lines.map((line) => String(line.id)));
      toast.success(`${pickList.pick_no} confirmed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to confirm picks");
    }
  };

  const dispatchPickedOrder = async () => {
    if (!token || !pickWorkflow || pickWorkflow.pickList.status !== "picked") return;
    try {
      await dispatchSalesOrder(token, pickWorkflow.orderId, pickWorkflow.pickList.id);
      toast.success(`${pickWorkflow.orderNo} dispatched`);
      setPickWorkflow(null);
      setConfirmedPickLines([]);
      await reloadSalesOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not dispatch picked goods");
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
            {canCreateOrder && <NewOrderDialog onCompleted={reloadSalesOrders} />}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            l: "Open Orders",
            v: String(
              (analytics?.orders_by_status || [])
                .filter((r) => !["invoiced", "cancelled"].includes(r.status.toLowerCase()))
                .reduce((sum, r) => sum + r.count, 0),
            ),
            t: "Draft and confirmed",
          },
          {
            l: "In Transit",
            v: String(
              analytics?.orders_by_status.find((r) => r.status.toLowerCase() === "partial")
                ?.count || 0,
            ),
            t: "Awaiting delivery",
          },
          {
            l: "Invoiced (MTD)",
            v: KES(
              Number(
                analytics?.invoices_by_status.reduce((sum, r) => sum + Number(r.total || 0), 0) ||
                  0,
              ),
            ),
            t: "Live invoice total",
          },
          {
            l: "Pipeline Forecast",
            v: KES(Number(analytics?.pipeline_forecast || 0)),
            t: "Weighted open opportunities",
          },
        ].map((k) => (
          <Card key={k.l}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
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

      <Tabs
        value={view}
        onValueChange={(value) => {
          setView(value);
          window.history.replaceState({}, "", `${window.location.pathname}#${value}`);
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="orders">Orders & fulfilment</TabsTrigger>
          <TabsTrigger value="credit">Credit & pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="credit">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold">Order status summary</h2>
                <div className="mt-4 grid gap-2">
                  {(analytics?.orders_by_status || []).map((row) => (
                    <div
                      key={row.status}
                      className="flex items-center justify-between border-b border-border py-2 text-sm"
                    >
                      <span className="capitalize">{row.status}</span>
                      <span className="font-medium">
                        {row.count} orders · {KES(Number(row.total || 0))}
                      </span>
                    </div>
                  ))}
                  {!analytics && (
                    <p className="text-sm text-muted-foreground">
                      Sign in to load live sales analytics.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold">Invoice exposure</h2>
                <div className="mt-4 grid gap-2">
                  {(analytics?.invoices_by_status || []).map((row) => (
                    <div
                      key={row.status}
                      className="flex items-center justify-between border-b border-border py-2 text-sm"
                    >
                      <span className="capitalize">{row.status}</span>
                      <span className="font-medium">
                        {row.count} invoices · {KES(Number(row.total || 0))}
                      </span>
                    </div>
                  ))}
                  <div className="mt-3 flex items-center justify-between rounded-md bg-muted p-3 text-sm">
                    <span>Weighted pipeline</span>
                    <strong>{KES(Number(analytics?.pipeline_forecast || 0))}</strong>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="orders">
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
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {["Draft", "Confirmed", "Dispatched", "Delivered", "Invoiced"].map((s) => (
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
                          onClick={async () => {
                            if (!token || !o.internal_id) return;
                            try {
                              setDetail(await fetchSalesOrderDetail(token, o.internal_id));
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : "Unable to load order details",
                              );
                            }
                          }}
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
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {((o.status === "Draft" && canApproveOrder) ||
                                ((o.status === "Confirmed" || o.status === "Partial") &&
                                  canPostDelivery) ||
                                (o.status === "Delivered" && canCreateInvoice)) &&
                                o.internal_id && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={processingOrderId === o.id}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void processOrder(o);
                                    }}
                                  >
                                    {processingOrderId === o.id
                                      ? "Working…"
                                      : o.status === "Draft"
                                        ? "Confirm order"
                                        : o.status === "Delivered"
                                          ? "Create invoice"
                                          : "Prepare pick list"}
                                  </Button>
                                )}
                              {["Draft", "Confirmed", "Partial"].includes(o.status) &&
                                o.internal_id && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={processingOrderId === o.id}
                                    onClick={async (event) => {
                                      event.stopPropagation();
                                      if (
                                        !token ||
                                        !window.confirm(
                                          `Cancel ${o.id}? Any remaining stock reservation will be released.`,
                                        )
                                      )
                                        return;
                                      try {
                                        await cancelSalesOrder(token, o.internal_id!);
                                        toast.success(
                                          `${o.id} cancelled and remaining reserved stock released`,
                                        );
                                        await reloadSalesOrders();
                                      } catch (error) {
                                        toast.error(
                                          error instanceof Error
                                            ? error.message
                                            : "Could not cancel this order",
                                        );
                                      }
                                    }}
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
                totalItems={filtered.length}
                pageSize={pageSize}
                onPageChange={setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!pickWorkflow}
        onOpenChange={(open) => {
          if (!open) {
            setPickWorkflow(null);
            setConfirmedPickLines([]);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          {pickWorkflow && (
            <>
              <DialogHeader>
                <DialogTitle>Pick list {pickWorkflow.pickList.pick_no}</DialogTitle>
                <DialogDescription>
                  Order {pickWorkflow.orderNo} · Confirm each complete required quantity before
                  dispatch.
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Picked</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Required</TableHead>
                      <TableHead className="text-right">Picked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pickWorkflow.pickList.lines.map((line) => {
                      const lineId = String(line.id);
                      const isChecked = confirmedPickLines.includes(lineId);
                      return (
                        <TableRow key={lineId}>
                          <TableCell>
                            <input
                              aria-label={`Confirm pick ${String(line.item_name || line.item_code)}`}
                              type="checkbox"
                              checked={isChecked}
                              disabled={pickWorkflow.pickList.status !== "open"}
                              onChange={(event) =>
                                setConfirmedPickLines((current) =>
                                  event.target.checked
                                    ? [...current, lineId]
                                    : current.filter((id) => id !== lineId),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {String(line.item_code || "")} {String(line.item_name || "")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(line.quantity_to_pick)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pickWorkflow.pickList.status === "picked"
                              ? Number(line.quantity_picked)
                              : isChecked
                                ? Number(line.quantity_to_pick)
                                : 0}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!pickWorkflow.pickList.lines.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                          No open reserved quantities are available to pick.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <DialogFooter>
                {pickWorkflow.pickList.status === "open" ? (
                  <Button
                    disabled={
                      !pickWorkflow.pickList.lines.length ||
                      confirmedPickLines.length !== pickWorkflow.pickList.lines.length
                    }
                    onClick={() => void confirmPick()}
                  >
                    Confirm all picked quantities
                  </Button>
                ) : (
                  <Button
                    disabled={pickWorkflow.pickList.status !== "picked"}
                    onClick={() => void dispatchPickedOrder()}
                  >
                    Dispatch picked goods
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>Sales Order {detail.order_no}</DialogTitle>
                <DialogDescription>
                  {detail.customer_name || "Customer"} · Ordered {detail.order_date || "—"} ·{" "}
                  Required by {detail.required_date || "—"} · {detail.status || ""}
                </DialogDescription>
              </DialogHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Invoiced</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        {line.item_code || ""} {line.item_name || ""}
                      </TableCell>
                      <TableCell className="text-right">{line.quantity}</TableCell>
                      <TableCell className="text-right">{line.qty_delivered || 0}</TableCell>
                      <TableCell className="text-right">{line.qty_invoiced || 0}</TableCell>
                      <TableCell className="text-right">{KES(line.unit_price)}</TableCell>
                      <TableCell className="text-right">
                        {KES(line.line_total || line.quantity * line.unit_price)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DialogFooter>
                <div className="mr-auto text-sm font-semibold">
                  Total: {KES(detail.total_amount || 0)}
                </div>
                <Button variant="outline" onClick={() => setDetail(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewOrderDialog({ onCompleted }: { onCompleted: () => void | Promise<void> }) {
  const { token } = useAuth();
  const { createSalesOrder } = useSalesWorkflow();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(10);
  const [unitPrice, setUnitPrice] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [requiredDate, setRequiredDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 2);
    return date.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState("");

  const formSetupQuery = useList(
    queryKeys.sales.orderFormSetup(),
    async ({ signal }) => {
      const [customerRows, itemRows, warehouseRows] = await Promise.all([
        v1Api.master.customers(token!, "", signal),
        v1Api.master.items(token!, 200, signal),
        v1Api.master.warehouses(token!, signal),
      ]);
      return {
        customers: customerRows.map(normalizeMasterCustomer) as BackendCustomer[],
        items: itemRows.map(normalizeMasterItem) as BackendMasterItem[],
        warehouses: warehouseRows.map(normalizeMasterWarehouse) as BackendWarehouse[],
      };
    },
    { enabled: Boolean(open && token) },
  );
  const apiCustomers = formSetupQuery.data?.customers ?? EMPTY_ARRAY;
  const apiItems = formSetupQuery.data?.items ?? EMPTY_ARRAY;
  const apiWarehouses = formSetupQuery.data?.warehouses ?? EMPTY_ARRAY;
  const formLoading = formSetupQuery.isPending;

  useEffect(() => {
    if (!open || !formSetupQuery.data) return;
    const firstItem = apiItems[0];
    setCustomerId((current) => current || String(apiCustomers[0]?.id ?? ""));
    setWarehouseId((current) => current || String(apiWarehouses[0]?.id ?? ""));
    setItemId((current) => current || firstItem?.id || "");
    setUnitPrice((current) => current || String(firstItem?.standard_cost ?? ""));
  }, [open, formSetupQuery.data, apiItems, apiCustomers, apiWarehouses]);

  const selectedCustomer = apiCustomers.find((c) => String(c.id) === customerId);
  const selectedItem = apiItems.find((i) => i.id === itemId);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    const price = Number(unitPrice) || selectedItem?.standard_cost || 0;
    const validation = salesOrderSchema.safeParse({
      customer_id: customerId,
      warehouse_id: warehouseId,
      order_date: orderDate,
      required_date: requiredDate,
      notes: notes.trim(),
      lines: [{ item_id: itemId, quantity: qty, unit_price: price }],
    });
    if (!validation.success) {
      notify(
        "Invalid sales order",
        validation.error.issues[0]?.message || "Check the order details and try again.",
      );
      return;
    }
    setSaving(true);
    try {
      const created = await createSalesOrder(token, {
        customer_id: customerId,
        warehouse_id: warehouseId,
        order_date: orderDate,
        required_date: requiredDate,
        notes: notes.trim() || undefined,
        lines: [{ item_id: itemId, quantity: qty, unit_price: price }],
      });
      const createdId = created.id;
      const createdTotal = created.total;
      notify("Sales order created", `${createdId} saved to the database.`);
      void trackEvent({
        action: "sales_order_created",
        entityType: "sales_order",
        entityId: createdId,
        details: { customerId, itemId, qty, orderDate, requiredDate },
        scenario: "sales",
        context: { customerId, itemId, qty, total: createdTotal },
      });
      if (selectedCustomer?.email) {
        if (token)
          void triggerEmailNotification(token, {
            recipient: selectedCustomer.email,
            subject: `Order ${createdId}`,
            message: `Sales order ${createdId} has been created for ${selectedCustomer.name}.`,
          });
      }
      await onCompleted();
      setOpen(false);
    } catch (error) {
      notify(
        "Could not create order",
        error instanceof Error ? error.message : "Unable to save sales order.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Sales Order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
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
          <div className="space-y-1.5">
            <Label htmlFor="required-date">Required delivery date</Label>
            <Input
              id="required-date"
              type="date"
              min={orderDate}
              value={requiredDate}
              onChange={(event) => setRequiredDate(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="product">Product</Label>
            <Select
              value={itemId}
              onValueChange={(id) => {
                setItemId(id);
                const item = apiItems.find((i) => i.id === id);
                if (item) setUnitPrice(String(item.standard_cost));
              }}
              disabled={formLoading}
            >
              <SelectTrigger id="product">
                <SelectValue placeholder="Add product..." />
              </SelectTrigger>
              <SelectContent>
                {apiItems.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.item_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qty">Quantity</Label>
            <Input
              id="qty"
              type="number"
              min={1}
              step={1}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              required
            />
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
        <DialogFooter>
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
