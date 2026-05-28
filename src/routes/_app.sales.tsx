import { createFileRoute } from "@tanstack/react-router";
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
import {
  createInvoiceFromSalesOrder,
  createSalesOrder,
  confirmSalesOrder,
  dispatchSalesOrder,
  fetchCustomers,
  fetchMasterItems,
  fetchSalesOrders,
  fetchWarehouses,
  type BackendCustomer,
  type BackendMasterItem,
  type BackendSalesOrder,
  type BackendWarehouse,
} from "@/lib/api";

export const Route = createFileRoute("/_app/sales")({
  component: SalesPage,
  head: () => ({ meta: [{ title: "Sales & Orders - Ayawin Enterprise ERP" }] }),
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
  const pageSize = 5;

  const reloadSalesOrders = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await fetchSalesOrders(token);
      setRows(data);
      setPage(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load sales orders");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reloadSalesOrders();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void fetchWarehouses(token)
      .then((whs) => setWarehouseIds(whs.map((w) => String(w.id))))
      .catch(() => setWarehouseIds([]));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const id = window.setInterval(() => {
      void reloadSalesOrders();
    }, 20000);
    return () => window.clearInterval(id);
  }, [token]);

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
    exportWorkbook("ayawin-enterprise-sales.xlsx", [
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
    const firstWarehouse = warehouseIds[0] || "";
    if (!firstWarehouse) {
      toast.error("No warehouse found to process the order.");
      return;
    }

    setProcessingOrderId(order.id);
    try {
      let currentStatus = order.status;
      if (currentStatus === "Draft") {
        const confirmed = await confirmSalesOrder(token, order.internal_id);
        if (!confirmed.ok) throw new Error("Order confirmation failed.");
        currentStatus = "Confirmed";
      }
      if (currentStatus === "Confirmed") {
        await dispatchSalesOrder(token, order.internal_id, firstWarehouse);
        currentStatus = "Delivered";
      }
      if (currentStatus === "Delivered") {
        await createInvoiceFromSalesOrder(token, order.internal_id);
      }
      toast.success(`${order.id} processed to invoice.`);
      await reloadSalesOrders();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not process order");
      return false;
    } finally {
      setProcessingOrderId(null);
    }
  };

  const processAllReadyOrders = async () => {
    if (!token) return;
    const ready = filtered.filter(
      (o) =>
        o.internal_id &&
        (o.status === "Draft" || o.status === "Confirmed" || o.status === "Delivered"),
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
      const ok = await processOrder(order);
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

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Open Orders", v: "14", t: "5 confirmed, 9 draft" },
          { l: "In Transit", v: "3", t: "Awaiting delivery" },
          { l: "Invoiced (MTD)", v: KES(7280000), t: "42 orders" },
          { l: "Avg Order Value", v: KES(286500), t: "+8% vs last month" },
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
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    Loading sales orders…
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {paged.map((o) => (
                    <TableRow key={o.id} className="cursor-pointer hover:bg-muted/40">
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
                          {o.status === "Draft" && o.internal_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                if (!token) return;
                                try {
                                  const result = await confirmSalesOrder(token, o.internal_id);
                                  if (result.ok) {
                                    toast.success(`${o.id} confirmed`);
                                    await reloadSalesOrders();
                                  } else {
                                    toast.error("Order confirmation failed");
                                  }
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Could not confirm order");
                                }
                              }}
                            >
                              Confirm
                            </Button>
                          )}
                          {(o.status === "Draft" || o.status === "Confirmed" || o.status === "Delivered") &&
                            o.internal_id && (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={processingOrderId === o.id}
                                onClick={() => void processOrder(o)}
                              >
                                {processingOrderId === o.id ? "Processing..." : "Process Order"}
                              </Button>
                            )}
                          {o.status === "Confirmed" && o.internal_id && (
                            <Button
                              size="sm"
                              onClick={async () => {
                                if (!token) return;
                                try {
                                  const firstWarehouse = warehouseIds[0] || "";
                                  if (!firstWarehouse) {
                                    toast.error("No warehouse found to dispatch from.");
                                    return;
                                  }
                                  await dispatchSalesOrder(token, o.internal_id, firstWarehouse);
                                  toast.success(`${o.id} dispatched`);
                                  await reloadSalesOrders();
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Could not dispatch order");
                                }
                              }}
                            >
                              Dispatch
                            </Button>
                          )}
                          {o.status === "Delivered" && o.internal_id && (
                            <Button
                              size="sm"
                              onClick={async () => {
                                if (!token) return;
                                try {
                                  await createInvoiceFromSalesOrder(token, o.internal_id);
                                  toast.success(`Invoice created for ${o.id}`);
                                  await reloadSalesOrders();
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Could not create invoice");
                                }
                              }}
                            >
                              Create Invoice
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {paged.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
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
    </div>
  );
}

function NewOrderDialog({ onCompleted }: { onCompleted: () => void | Promise<void> }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [apiCustomers, setApiCustomers] = useState<BackendCustomer[]>([]);
  const [apiItems, setApiItems] = useState<BackendMasterItem[]>([]);
  const [apiWarehouses, setApiWarehouses] = useState<BackendWarehouse[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(10);
  const [unitPrice, setUnitPrice] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !token) return;
    setFormLoading(true);
    void Promise.all([fetchCustomers(token), fetchMasterItems(token), fetchWarehouses(token)])
      .then(([cust, items, whs]) => {
        setApiCustomers(cust);
        setApiItems(items);
        setApiWarehouses(whs);
        const firstItem = items[0];
        setCustomerId(String(cust[0]?.id ?? ""));
        setWarehouseId(String(whs[0]?.id ?? ""));
        setItemId(firstItem?.id ?? "");
        setUnitPrice(String(firstItem?.standard_cost ?? ""));
      })
      .catch((err) => {
        notify("Could not load form", err instanceof Error ? err.message : "Unable to load customers or products.");
      })
      .finally(() => setFormLoading(false));
  }, [open, token]);

  const selectedCustomer = apiCustomers.find((c) => String(c.id) === customerId);
  const selectedItem = apiItems.find((i) => i.id === itemId);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !customerId || !warehouseId || !itemId || qty < 1) return;
    const price = Number(unitPrice) || selectedItem?.standard_cost || 0;
    if (price <= 0) {
      notify("Invalid price", "Enter a unit price greater than zero.");
      return;
    }
    setSaving(true);
    try {
      const created = await createSalesOrder(token, {
        customer_id: customerId,
        warehouse_id: warehouseId,
        order_date: orderDate,
        notes: notes.trim() || undefined,
        lines: [{ item_id: itemId, quantity: qty, unit_price: price }],
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
      notify("Could not create order", error instanceof Error ? error.message : "Unable to save sales order.");
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
            <p className="text-sm text-muted-foreground sm:col-span-2">Loading customers and products…</p>
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
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="sales-order-form" disabled={saving || formLoading || !apiItems.length}>
            {saving ? "Saving..." : "Create draft order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
