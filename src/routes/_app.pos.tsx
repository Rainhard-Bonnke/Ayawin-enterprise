import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Receipt, Search, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { KES } from "@/lib/format";
import {
  createInvoiceFromSalesOrder,
  createSalesOrder,
  confirmSalesOrder,
  cancelSalesOrder,
  dispatchSalesOrder,
  downloadReceiptPdf,
  fetchCustomers,
  fetchMasterItems,
  fetchWarehouses,
  paySalesInvoice,
  previewSalesTax,
  printReceiptPdf,
  type BackendCustomer,
  type BackendMasterItem,
  type BackendWarehouse,
} from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/pos")({
  component: PosPage,
  head: () => ({ meta: [{ title: "Point of Sale - Ayawin Stock Solution" }] }),
});

type CartLine = BackendMasterItem & { quantity: number; unit_price: number };

function PosPage() {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [customers, setCustomers] = useState<BackendCustomer[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [taxPreview, setTaxPreview] = useState<{ subtotal: number; tax_amount: number; total_amount: number } | null>(null);
  const [taxPreviewLoading, setTaxPreviewLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amountReceived, setAmountReceived] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastSale, setLastSale] = useState<{
    invoiceId: string;
    invoiceNo: string;
    orderId: string;
    total: number;
    change: number;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    Promise.all([fetchMasterItems(token, "", 60), fetchCustomers(token), fetchWarehouses(token)])
      .then(([catalog, customerRows, warehouseRows]) => {
        setItems(catalog.filter((item) => item.is_active));
        setCustomers(customerRows);
        setWarehouses(warehouseRows);
        setCustomerId(String(customerRows[0]?.id || ""));
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Unable to load POS catalog"),
      )
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token || !search.trim()) return;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void fetchMasterItems(token, search.trim(), 60)
        .then((catalog) => setItems(catalog.filter((item) => item.is_active)))
        .catch((error) =>
          toast.error(error instanceof Error ? error.message : "Unable to search catalog"),
        )
        .finally(() => setSearching(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [token, search]);

  useEffect(() => {
    if (!token || !cart.length) { setTaxPreview(null); setTaxPreviewLoading(false); return; }
    let active = true;
    setTaxPreviewLoading(true);
    void previewSalesTax(token, cart.map((line) => ({ item_id: line.id, quantity: line.quantity, unit_price: line.unit_price })))
      .then((preview) => {
        if (active) setTaxPreview({ subtotal: preview.subtotal, tax_amount: preview.tax_amount, total_amount: preview.total_amount });
      })
      .catch((error) => {
        if (active) { setTaxPreview(null); toast.error(error instanceof Error ? error.message : "Could not calculate sale tax"); }
      })
      .finally(() => { if (active) setTaxPreviewLoading(false); });
    return () => { active = false; };
  }, [cart, token]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((item) =>
        `${item.item_code} ${item.name} ${item.barcode || ""}`.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [items, search]);

  const subtotal = cart.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
  const tax = taxPreview?.tax_amount ?? 0;
  const total = taxPreview?.total_amount ?? subtotal;
  const received = Number(amountReceived || 0);
  const change = Math.max(0, received - total);

  const addItem = (item: BackendMasterItem) => {
    setLastSale(null);
    setCart((current) => {
      const existing = current.find((line) => line.id === item.id);
      if (existing)
        return current.map((line) =>
          line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      return [
        ...current,
        {
          ...item,
          quantity: 1,
          unit_price: Math.max(item.standard_cost * 1.4, item.standard_cost),
        },
      ];
    });
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity <= 0) setCart((current) => current.filter((line) => line.id !== id));
    else
      setCart((current) => current.map((line) => (line.id === id ? { ...line, quantity } : line)));
  };

  const completeSale = async () => {
    if (!token || !customerId || !warehouses[0]?.id || !cart.length) {
      toast.error("Select a customer, warehouse, and at least one item.");
      return;
    }
    if (paymentMethod === "cash" && received < total) {
      toast.error("Amount received is less than the sale total.");
      return;
    }
    if (!taxPreview || taxPreviewLoading) {
      toast.error("Wait for the tax calculation to finish before completing this sale.");
      return;
    }

    setSubmitting(true);
    try {
      const order = await createSalesOrder(token, {
        customer_id: customerId,
        warehouse_id: String(warehouses[0].id),
        notes: `POS sale by ${user?.username || "operator"}`,
        lines: cart.map((line) => ({
          item_id: line.id,
          quantity: line.quantity,
          unit_price: line.unit_price,
        })),
      });
      const saleTotal = order.total;
      if (paymentMethod === "cash" && received < saleTotal) {
        await cancelSalesOrder(token, order.internal_id);
        throw new Error("The ERP recalculated tax and cash received is below the sale total. The draft order was cancelled; review the amount and try again.");
      }
      const confirmed = await confirmSalesOrder(token, order.internal_id);
      if (!confirmed.ok)
        throw new Error(
          confirmed.reason === "atp_failed"
            ? "Insufficient stock for this sale."
            : "Sale failed credit validation.",
        );
      await dispatchSalesOrder(token, order.internal_id);
      const invoice = await createInvoiceFromSalesOrder(token, order.internal_id);
      if (paymentMethod !== "credit") {
        await paySalesInvoice(token, invoice.invoice_id, {
          amount: saleTotal,
          reference_no: `POS-${order.id}`,
          notes: `${paymentMethod} payment`,
        });
      }
      setLastSale({
        invoiceId: invoice.invoice_id,
        invoiceNo: invoice.invoice_no,
        orderId: order.id,
        total: saleTotal,
        change: Math.max(0, received - saleTotal),
      });
      setCart([]);
      setAmountReceived("");
      toast.success(`Sale ${order.id} completed`);
      try {
        await Promise.all([
          downloadReceiptPdf(token, invoice.invoice_no),
          printReceiptPdf(token, invoice.invoice_no),
        ]);
        toast.success(`Receipt ${invoice.invoice_no} downloaded and ready to print`);
      } catch (receiptError) {
        toast.error(
          receiptError instanceof Error
            ? receiptError.message
            : "Sale completed, but receipt printing failed",
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not complete sale");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">
        Loading POS catalog...
      </div>
    );

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Point of sale
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Fast checkout</h1>
          <p className="text-sm text-muted-foreground">Live stock-aware sales terminal</p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/login" })}>
          Exit POS
        </Button>
      </div>

      {lastSale && (
        <Card className="border-success/40 bg-success/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <Receipt className="h-5 w-5 text-success" />
              <div>
                <p className="font-semibold">Sale completed</p>
                <p className="text-sm text-muted-foreground">
                  Receipt {lastSale.invoiceNo} · Change {KES(lastSale.change)}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => token && void downloadReceiptPdf(token, lastSale.invoiceNo)}
              >
                Download receipt
              </Button>
              <Button
                variant="outline"
                onClick={() => token && void printReceiptPdf(token, lastSale.invoiceNo)}
              >
                Print receipt
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader className="space-y-3">
            <CardTitle>Products</CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search name, code, or barcode"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {searching && (
                <span className="absolute right-3 top-2.5 h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-primary" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addItem(item)}
                  className="rounded-lg border border-border bg-card p-4 text-left transition hover:border-primary hover:bg-accent"
                >
                  <p className="text-xs text-muted-foreground">{item.item_code}</p>
                  <p className="mt-1 font-medium">{item.name}</p>
                  <p className="mt-3 text-sm font-semibold text-primary">
                    {KES(Math.max(item.standard_cost * 1.4, item.standard_cost))}
                  </p>
                </button>
              ))}
            </div>
            {!filteredItems.length && (
              <p className="py-10 text-center text-sm text-muted-foreground">No products found.</p>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" /> Current sale
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pos-customer">Customer</Label>
              <select
                data-slot="form-control"
                id="pos-customer"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="divide-y divide-border rounded-lg border border-border">
              {cart.map((line) => (
                <div key={line.id} className="flex items-center gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{line.name}</p>
                    <p className="text-xs text-muted-foreground">{KES(line.unit_price)} each</p>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => updateQuantity(line.id, line.quantity - 1)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-5 text-center text-sm">{line.quantity}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => updateQuantity(line.id, line.quantity + 1)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => updateQuantity(line.id, 0)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              {!cart.length && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Add products to start a sale.
                </p>
              )}
            </div>
            <div className="space-y-1 border-t border-border pt-3 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{KES(subtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{taxPreviewLoading ? "Calculating tax…" : "Tax"}</span>
                <span>{KES(tax)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span>{KES(total)}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-payment">Payment method</Label>
              <select
                data-slot="form-control"
                id="pos-payment"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="mobile_money">Mobile money</option>
                <option value="credit">Credit</option>
              </select>
            </div>
            {paymentMethod !== "credit" && (
              <div className="space-y-1.5">
                <Label htmlFor="pos-received">Amount received</Label>
                <Input
                  id="pos-received"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amountReceived}
                  onChange={(event) => setAmountReceived(event.target.value)}
                  placeholder={String(total)}
                />
                <p className="text-right text-xs text-muted-foreground">Change: {KES(change)}</p>
              </div>
            )}
            <Button
              className="w-full"
              size="lg"
              disabled={submitting || !cart.length}
              onClick={completeSale}
            >
              {submitting ? "Processing sale..." : `Complete sale · ${KES(total)}`}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
