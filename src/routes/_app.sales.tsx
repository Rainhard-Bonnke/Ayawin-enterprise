import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Download, FileDown, ArrowUpDown } from "lucide-react";
import { useEffect, useState } from "react";
import { salesOrders, customers, products } from "@/lib/mock-data";
import { KES, fmtDate } from "@/lib/format";
import { SearchBar } from "@/components/SearchBar";
import { StatusBadge } from "@/components/StatusBadge";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { Badge } from "@/components/ui/badge";
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
import { createProductSaleWorkflow, fetchSalesOrders, type BackendSalesOrder } from "@/lib/api";

export const Route = createFileRoute("/_app/sales")({
  component: SalesPage,
  head: () => ({ meta: [{ title: "Sales & Orders - Ayawin Enterprise ERP" }] }),
});

function SalesPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<BackendSalesOrder[]>(salesOrders);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const reloadSalesOrders = async () => {
    if (!token) return;
    const data = await fetchSalesOrders(token);
    setRows(data);
  };

  useEffect(() => {
    void reloadSalesOrders();
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
              <div className="mt-1 font-display text-2xl font-bold">{k.v}</div>
              <div className="text-xs text-muted-foreground">{k.t}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <QuietNote
        scenario="sales"
        contextKey={`${query}-${status}-${sort}`}
        context={{ query, status, sort, orders: paged, customers, products }}
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
              </TableRow>
            </TableHeader>
            <TableBody>
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
                </TableRow>
              ))}
              {paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No orders match your filters.
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
    </div>
  );
}

function NewOrderDialog({ onCompleted }: { onCompleted: () => void | Promise<void> }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState("");
  const [product, setProduct] = useState("");
  const [priceTier, setPriceTier] = useState<"retail" | "wholesale" | "distributor">("wholesale");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [saving, setSaving] = useState(false);
  const [qty, setQty] = useState(10);
  const [discount, setDiscount] = useState(0);
  const [deliveryDate, setDeliveryDate] = useState("2026-05-22");
  const selectedCustomer = customers.find((c) => c.id === customer);
  const recommendedProduct =
    selectedCustomer?.segment === "Supermarket"
      ? products.find((p) => p.category === "Soft Drinks")
      : selectedCustomer?.segment === "Bar/Restaurant"
        ? products.find((p) => p.category === "Beer")
        : products.find((p) => p.category === "Beer");
  const discountWarning = discount > 15 ? "This margin is below your usual floor for this customer tier." : null;
  const upsellLine =
    product && product.toLowerCase().includes("tusker")
      ? "Customers who ordered this also added Krest Tonic."
      : null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selectedProduct = products.find((p) => p.id === product);
    if (!token || !selectedCustomer || !selectedProduct || qty < 1 || discount < 0 || discount > 100) return;
    setSaving(true);
    try {
      const result = await createProductSaleWorkflow(token, {
        customer_kra_pin: selectedCustomer.kraPin,
        warehouse: selectedProduct.warehouse,
        discount_percent: discount,
        payment_method: paymentMethod === "credit" ? undefined : paymentMethod,
        items: [{ sku: selectedProduct.sku, quantity: qty, price_tier: priceTier }],
      });
      notify("Sale workflow completed", `${result.order_number} generated invoice ${result.invoice_number}.`);
      void trackEvent({
        action: "sales_order_created",
        entityType: "sales_order",
        entityId: result.order_number,
        details: { customer, product, qty, discount, deliveryDate, invoice: result.invoice_number },
        scenario: "sales",
        context: { customer, product, qty, discount, deliveryDate, total: result.total },
      });
      void triggerEmailNotification({
        recipient: selectedCustomer.email,
        subject: `Invoice ${result.invoice_number}`,
        message: `Invoice ${result.invoice_number} has been generated for ${selectedCustomer.name}.`,
      });
      await onCompleted();
      setOpen(false);
    } catch (error) {
      notify("Sale workflow failed", error instanceof Error ? error.message : "Unable to complete sale workflow.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-navy text-navy-foreground hover:bg-navy/90">
          <Plus className="mr-2 h-4 w-4" />
          New Sales Order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Create Sales Order</DialogTitle>
          <DialogDescription>
            Draft a new order. KRA-compliant invoice generates on confirmation.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 py-2 sm:grid-cols-2" id="sales-order-form" onSubmit={submit}>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="customer">Customer</Label>
            <Select value={customer} onValueChange={setCustomer}>
              <SelectTrigger id="customer">
                <SelectValue placeholder="Select customer..." />
              </SelectTrigger>
              <SelectContent>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCustomer && (
              <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground">
                <span>{selectedCustomer.segment}</span>
                <span>•</span>
                <span>{selectedCustomer.location}</span>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Price tier</Label>
            <Select value={priceTier} onValueChange={(value) => setPriceTier(value as typeof priceTier)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="retail">Retail</SelectItem>
                <SelectItem value="wholesale">Wholesale</SelectItem>
                <SelectItem value="distributor">Distributor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Payment</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Credit invoice" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="credit">Credit invoice</SelectItem>
                <SelectItem value="M-Pesa">M-Pesa</SelectItem>
                <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                <SelectItem value="Cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delivery-date">Delivery date</Label>
            <Input
              id="delivery-date"
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="product">Product</Label>
            <Select value={product} onValueChange={setProduct}>
              <SelectTrigger id="product">
                <SelectValue placeholder="Add product..." />
              </SelectTrigger>
              <SelectContent>
                {products.slice(0, 8).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} - {KES(p.wholesalePrice)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!product && recommendedProduct && (
              <div className="pt-2 text-xs text-gold">
                Suggested line: {recommendedProduct.name} at {KES(recommendedProduct.wholesalePrice)}
              </div>
            )}
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
            {selectedCustomer && (
              <div className="pt-2 text-xs text-muted-foreground">
                This account usually moves mixed beverage cases in larger batches.
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="discount">Discount (%)</Label>
            <Input
              id="discount"
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              required
            />
            {discountWarning ? <div className="pt-2 text-xs text-warning">{discountWarning}</div> : null}
          </div>
          {upsellLine && (
            <div className="sm:col-span-2">
              <Badge variant="outline" className="border-gold/30 bg-gold/10 text-gold">
                {upsellLine}
              </Badge>
            </div>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Save as draft
          </Button>
          <Button type="submit" form="sales-order-form" className="bg-navy text-navy-foreground hover:bg-navy/90" disabled={saving}>
            {saving ? "Processing..." : "Confirm order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
