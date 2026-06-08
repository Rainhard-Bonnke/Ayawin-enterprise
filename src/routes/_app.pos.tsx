import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDown, Minus, Plus, ScanBarcode, ShoppingBag, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchBar } from "@/components/SearchBar";
import { useAuth } from "@/lib/auth";
import { KES } from "@/lib/format";
import {
  completePosSale,
  downloadPaymentReceiptPdf,
  downloadReceiptPdf,
  fetchPosCatalog,
  fetchWarehouses,
  lookupInventoryBarcode,
  previewPosTotals,
  type BackendWarehouse,
  type PosCatalogItem,
} from "@/lib/api";
import { subscribeLiveEvents } from "@/hooks/useLiveEvents";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/pos")({
  component: PosPage,
  head: () => ({ meta: [{ title: "Point of Sale - Ayawin Stock Solutions ERP" }] }),
});

type CartLine = {
  item_id: string;
  item_code: string;
  item_name: string;
  unit_price: number;
  quantity: number;
  stock: number;
};

function PosPage() {
  const { token } = useAuth();
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [catalog, setCatalog] = useState<PosCatalogItem[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [totals, setTotals] = useState<{ subtotal: number; taxAmount: number; total: number } | null>(null);
  const [lastSale, setLastSale] = useState<{ invoice_no: string; receipt_no: string | null; total: number } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const loadCatalog = useCallback(async () => {
    if (!token || !warehouseId) return;
    setLoading(true);
    try {
      const data = await fetchPosCatalog(token, warehouseId, search.trim() || undefined);
      setCatalog(data.items);
      setCustomerId(data.customer_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load products");
      setCatalog([]);
    } finally {
      setLoading(false);
    }
  }, [token, warehouseId, search]);

  useEffect(() => {
    if (!token) return;
    void fetchWarehouses(token)
      .then((whs) => {
        setWarehouses(whs);
        if (!warehouseId && whs[0]) setWarehouseId(String(whs[0].id));
      })
      .catch(() => toast.error("Unable to load warehouses"));
  }, [token]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!token) return;
    return subscribeLiveEvents((event) => {
      if (event.type === "inventory.updated" || event.type === "pos.sale_completed") {
        void loadCatalog();
      }
    });
  }, [token, loadCatalog]);

  useEffect(() => {
    if (!token || !cart.length) {
      setTotals(null);
      return;
    }
    void previewPosTotals(token, {
      customer_id: customerId ?? undefined,
      lines: cart.map((l) => ({
        item_id: l.item_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
      })),
    })
      .then((p) => setTotals({ subtotal: p.subtotal, taxAmount: p.taxAmount, total: p.total }))
      .catch(() => setTotals(null));
  }, [token, cart, customerId]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (p) =>
        p.item_name.toLowerCase().includes(q) ||
        p.item_code.toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q),
    );
  }, [catalog, search]);

  const addToCart = (item: PosCatalogItem) => {
    if (item.quantity <= 0) {
      toast.error("Out of stock", { description: `${item.item_name} has no stock in this warehouse.` });
      return;
    }
    setLastSale(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.item_id === item.item_id);
      if (existing) {
        if (existing.quantity >= item.quantity) {
          toast.error("Insufficient stock", { description: `Only ${item.quantity} available.` });
          return prev;
        }
        return prev.map((l) =>
          l.item_id === item.item_id ? { ...l, quantity: l.quantity + 1, stock: item.quantity } : l,
        );
      }
      return [
        ...prev,
        {
          item_id: item.item_id,
          item_code: item.item_code,
          item_name: item.item_name,
          unit_price: item.unit_price,
          quantity: 1,
          stock: item.quantity,
        },
      ];
    });
  };

  const updateQty = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.item_id !== itemId) return l;
          const next = l.quantity + delta;
          if (next > l.stock) {
            toast.error("Insufficient stock", { description: `Only ${l.stock} available.` });
            return l;
          }
          return { ...l, quantity: next };
        })
        .filter((l) => l.quantity > 0),
    );
  };

  const handleBarcodeScan = async (code: string) => {
    if (!token || !code.trim()) return;
    try {
      const hits = await lookupInventoryBarcode(token, code.trim());
      const hit = hits.find((h) => String(h.warehouse_id) === warehouseId) ?? hits[0];
      if (!hit) {
        toast.error("Product not found");
        return;
      }
      const catalogItem = catalog.find((c) => c.item_id === String(hit.item_id));
      if (catalogItem) {
        addToCart(catalogItem);
      } else {
        const cost = Number(hit.avg_unit_cost ?? 0);
        addToCart({
          item_id: String(hit.item_id),
          item_code: String(hit.item_code),
          item_name: String(hit.item_name),
          barcode: hit.barcode ? String(hit.barcode) : null,
          quantity: Number(hit.quantity ?? 0),
          unit_price: cost > 0 ? cost : 0,
          price_tier: "retail",
          standard_cost: cost,
          reorder_point: Number(hit.reorder_point ?? 0),
        });
      }
      setSearch("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Barcode lookup failed");
    }
  };

  const checkout = async () => {
    if (!token || !warehouseId || !cart.length) return;
    setSaving(true);
    try {
      const result = await completePosSale(token, {
        warehouse_id: warehouseId,
        customer_id: customerId ?? undefined,
        lines: cart.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
          unit_price: l.unit_price,
        })),
        payment_method: "cash",
        notes: "POS sale",
      });
      setLastSale({
        invoice_no: result.invoice_no,
        receipt_no: result.receipt_no,
        total: result.total_amount,
      });
      toast.success(`Sale complete — ${result.invoice_no}`);
      setCart([]);
      void loadCatalog();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sale failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Point of Sale"
        description="Sell from live inventory — stock reduces automatically when you complete a sale."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[180px] flex-1 space-y-1.5">
                  <Label>Warehouse</Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[200px] flex-[2] space-y-1.5">
                  <Label>Search products</Label>
                  <SearchBar value={search} onChange={setSearch} placeholder="Name, SKU, or barcode…" />
                </div>
                <div className="min-w-[200px] flex-1 space-y-1.5">
                  <Label className="flex items-center gap-1">
                    <ScanBarcode className="h-3.5 w-3.5" /> Scan barcode
                  </Label>
                  <Input
                    ref={scanRef}
                    placeholder="Scan or type barcode…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleBarcodeScan((e.target as HTMLInputElement).value);
                        (e.target as HTMLInputElement).value = "";
                      }
                    }}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading products…</p>
              ) : filteredProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No products found. Add items in Master Data and receive stock in Inventory.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredProducts.map((item) => (
                    <button
                      key={item.item_id}
                      type="button"
                      onClick={() => addToCart(item)}
                      className="rounded-lg border bg-card p-3 text-left transition hover:border-primary/50 hover:bg-muted/40"
                    >
                      <div className="font-medium leading-tight">{item.item_name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.item_code}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold">{KES(item.unit_price)}</span>
                        <Badge variant={item.quantity > 0 ? "secondary" : "destructive"}>
                          {item.quantity > 0 ? `${item.quantity} in stock` : "Out of stock"}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShoppingBag className="h-5 w-5" />
                Cart
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tap a product to add it to the cart.</p>
              ) : (
                cart.map((line) => (
                  <div key={line.item_id} className="flex items-start justify-between gap-2 border-b pb-2 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{line.item_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {KES(line.unit_price)} × {line.quantity}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(line.item_id, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-6 text-center text-sm">{line.quantity}</span>
                      <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(line.item_id, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => setCart((p) => p.filter((l) => l.item_id !== line.item_id))}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))
              )}

              {totals && (
                <div className="space-y-1 border-t pt-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{KES(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VAT</span>
                    <span>{KES(totals.taxAmount)}</span>
                  </div>
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total</span>
                    <span>{KES(totals.total)}</span>
                  </div>
                </div>
              )}

              <Button className="w-full" disabled={!cart.length || saving} onClick={() => void checkout()}>
                {saving ? "Processing…" : "Complete sale (cash)"}
              </Button>
            </CardContent>
          </Card>

          {lastSale && (
            <Card className="border-success/40 bg-success/5">
              <CardContent className="pt-4 text-sm">
                <p className="font-medium text-success">Last sale recorded</p>
                <p className="mt-1">Invoice: {lastSale.invoice_no}</p>
                {lastSale.receipt_no && <p>Receipt: {lastSale.receipt_no}</p>}
                <p className="mt-1 font-semibold">{KES(lastSale.total)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (!token) return;
                      void downloadReceiptPdf(token, lastSale.invoice_no).catch((e) =>
                        toast.error(e instanceof Error ? e.message : "Could not download invoice receipt"),
                      );
                    }}
                  >
                    <FileDown className="mr-1 h-3.5 w-3.5" />
                    Invoice PDF
                  </Button>
                  {lastSale.receipt_no && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (!token) return;
                        void downloadPaymentReceiptPdf(token, lastSale.receipt_no!).catch((e) =>
                          toast.error(e instanceof Error ? e.message : "Could not download payment receipt"),
                        );
                      }}
                    >
                      <FileDown className="mr-1 h-3.5 w-3.5" />
                      Payment receipt
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Inventory updated automatically.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
