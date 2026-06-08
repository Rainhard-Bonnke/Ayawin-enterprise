import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { subscribeLiveEvents } from "@/hooks/useLiveEvents";
import { AlertTriangle, ArrowLeftRight, Plus, ScanBarcode } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchBar } from "@/components/SearchBar";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { exportWorkbook } from "@/lib/excel";
import { trackEvent } from "@/lib/event-tracker";
import { KES, fmtDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import {
  createStockAdjustment,
  createStockIn,
  createStockTransfer,
  fetchAdjustmentReasonCodes,
  fetchInventoryCatalog,
  fetchInventoryItems,
  fetchInventoryMovements,
  fetchInventoryReorderAlerts,
  fetchInventoryValuation,
  fetchStockAdjustments,
  lookupInventoryBarcode,
  postStockAdjustment,
  fetchMasterItems,
  fetchWarehouses,
  type BackendInventoryItem,
  type BackendMasterItem,
  type BackendWarehouse,
} from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/inventory")({
  component: InventoryPage,
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  head: () => ({ meta: [{ title: "Inventory - Ayawin Stock Solutions ERP" }] }),
});

function InventoryPage() {
  const { token, user } = useAuth();
  const { q: searchQ } = Route.useSearch();
  const [q, setQ] = useState(searchQ || "");
  const [cat, setCat] = useState("all");
  const [wh, setWh] = useState("all");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BackendInventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [masterItems, setMasterItems] = useState<BackendMasterItem[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [stockInOpen, setStockInOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjustments, setAdjustments] = useState<Array<Record<string, unknown>>>([]);
  const [adjForm, setAdjForm] = useState({
    warehouse_id: "",
    item_id: "",
    quantity_delta: "",
    reason: "",
    reason_code: "CYCLE_COUNT",
  });
  const [reasonCodes, setReasonCodes] = useState<Array<{ code: string; label: string }>>([]);
  const [valuationTotal, setValuationTotal] = useState<number | null>(null);
  const [reorderAlerts, setReorderAlerts] = useState<Array<Record<string, unknown>>>([]);
  const [movements, setMovements] = useState<Array<Record<string, unknown>>>([]);
  const [saving, setSaving] = useState(false);
  const [transferForm, setTransferForm] = useState({
    from_warehouse_id: "",
    to_warehouse_id: "",
    item_id: "",
    quantity: "",
    notes: "",
  });
  const [stockInForm, setStockInForm] = useState({
    warehouse_id: "",
    item_id: "",
    quantity: "",
    unit_cost: "",
    notes: "",
    batch_no: "",
    expiry_date: "",
  });

  const pageSize = 6;

  useEffect(() => {
    if (searchQ) setQ(searchQ);
  }, [searchQ]);

  const loadCatalog = async () => {
    if (!token) return [];
    try {
      const catalog = await fetchMasterItems(token);
      setMasterItems(catalog);
      return catalog;
    } catch {
      setMasterItems([]);
      return [];
    }
  };

  const loadInventory = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const whs = await fetchWarehouses(token);
      const catalogWh = wh !== "all" ? wh : String(whs[0]?.id ?? "");
      const [inv, valuation, alerts, mv] = await Promise.all([
        catalogWh
          ? fetchInventoryCatalog(token, catalogWh).catch(() => fetchInventoryItems(token))
          : fetchInventoryItems(token),
        fetchInventoryValuation(token, catalogWh || undefined).catch(() => null),
        fetchInventoryReorderAlerts(token).catch(() => []),
        fetchInventoryMovements(token, { limit: 25 }).catch(() => []),
      ]);
      const whName = whs.find((w) => String(w.id) === catalogWh)?.name ?? "";
      setItems(
        inv.map((row) => ({
          ...row,
          warehouse: row.warehouse || whName,
          warehouse_id: row.warehouse_id || catalogWh,
        })),
      );
      setWarehouses(whs);
      setValuationTotal(valuation ? Number(valuation.totals?.total_value || 0) : null);
      setReorderAlerts(alerts);
      setMovements(mv);
    } catch {
      setItems([]);
      setWarehouses([]);
      toast.error("Unable to load inventory");
    } finally {
      setLoading(false);
    }
  };

  const refreshInventory = useCallback(() => {
    void loadInventory();
  }, [token]);

  useEffect(() => {
    refreshInventory();
  }, [refreshInventory, wh]);

  useRealtimeSync(refreshInventory, { enabled: Boolean(token) });

  const loadAdjustments = useCallback(async () => {
    if (!token) return;
    try {
      setAdjustments(await fetchStockAdjustments(token));
    } catch {
      setAdjustments([]);
    }
  }, [token]);

  useEffect(() => {
    void loadAdjustments();
  }, [loadAdjustments]);

  useEffect(() => {
    return subscribeLiveEvents((ev) => {
      if (ev.type === "inventory.updated" || ev.type === "sales_order.confirmed") {
        refreshInventory();
        void loadAdjustments();
      }
    });
  }, [refreshInventory, loadAdjustments]);

  const filtered = useMemo(
    () =>
      items
        .filter((p) => {
          const matchesCategory = cat === "all" || p.category === cat;
          const matchesWarehouse = wh === "all" || p.warehouse === wh;
          const query = q.toLowerCase();
          const matchesQuery =
            p.name.toLowerCase().includes(query) ||
            p.sku.toLowerCase().includes(query) ||
            (p.barcode || "").toLowerCase().includes(query);
          return matchesCategory && matchesWarehouse && matchesQuery;
        })
        .sort((a, b) => {
          if (sort === "stock") return Number(a.stock) - Number(b.stock);
          if (sort === "expiry") return String(a.expiry_date || "").localeCompare(String(b.expiry_date || ""));
          return a.name.localeCompare(b.name);
        }),
    [items, q, cat, wh, sort],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const totalValue = useMemo(() => {
    if (valuationTotal != null) return valuationTotal;
    return filtered.reduce((sum, row) => sum + Number(row.stock_value ?? Number(row.stock || 0) * Number(row.cost_price || 0)), 0);
  }, [filtered, valuationTotal]);
  const lowStockCount = useMemo(() => filtered.filter((row) => Number(row.stock || 0) < Number(row.min_stock || 0)).length, [filtered]);
  const skuCount = useMemo(() => new Set(items.map((row) => row.sku)).size, [items]);

  const reorderDraft = useMemo(() => {
    if (reorderAlerts.length > 0) {
      return reorderAlerts.slice(0, 12).map((row) => ({
        sku: String(row.item_code || ""),
        product: String(row.item_name || ""),
        warehouse: String(row.warehouse_name || ""),
        qty: Math.max(0, Number(row.reorder_point || 0) - Number(row.quantity || 0)),
      }));
    }
    return filtered
      .filter((row) => Number(row.stock || 0) <= Number(row.min_stock || 0) && Number(row.min_stock || 0) > 0)
      .slice(0, 12)
      .map((row) => ({
        sku: row.sku,
        product: row.name,
        warehouse: row.warehouse,
        qty: Math.max(0, Number(row.min_stock || 0) - Number(row.stock || 0)),
      }));
  }, [filtered, reorderAlerts]);

  const expiringSoon = useMemo(() => {
    const now = Date.now();
    return filtered
      .filter((row) => {
        if (!row.expiry_date) return false;
        const expiry = new Date(row.expiry_date).getTime();
        const daysLeft = (expiry - now) / 86400000;
        return daysLeft <= 45;
      })
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)))
      .slice(0, 6);
  }, [filtered]);

  const openTransfer = async () => {
    if (!token) return;
    const first = filtered[0];
    const catalog = await loadCatalog();
    setTransferForm({
      from_warehouse_id: warehouses.find((w) => w.name === first?.warehouse)?.id?.toString() || warehouses[0]?.id?.toString() || "",
      to_warehouse_id: warehouses[1]?.id?.toString() || warehouses[0]?.id?.toString() || "",
      item_id: first?.item_id || catalog[0]?.id || "",
      quantity: "1",
      notes: "",
    });
    setTransferOpen(true);
  };

  const openStockIn = async () => {
    if (!token) return;
    try {
      const catalog = await loadCatalog();
      if (!warehouses.length) {
        toast.error("No warehouse found. Add one under Master Data → Warehouses.");
        return;
      }
      if (!catalog.length) {
        toast.error("No products found. Add an item under Master Data → Items first.");
        return;
      }
      setStockInForm({
        warehouse_id: warehouses[0]?.id?.toString() || "",
        item_id: catalog[0]?.id || "",
        quantity: "1",
        unit_cost: catalog[0] ? String(catalog[0].standard_cost) : "",
        notes: "",
        batch_no: "",
        expiry_date: "",
      });
      setStockInOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load products for stock in");
    }
  };

  const submitTransfer = async () => {
    if (!token) return;
    const qty = Number(transferForm.quantity);
    if (!transferForm.from_warehouse_id || !transferForm.to_warehouse_id || !transferForm.item_id || qty <= 0) {
      toast.error("Fill from/to warehouse, item, and quantity");
      return;
    }
    if (transferForm.from_warehouse_id === transferForm.to_warehouse_id) {
      toast.error("Choose different source and destination warehouses");
      return;
    }
    setSaving(true);
    try {
      const result = await createStockTransfer(token, {
        from_warehouse_id: transferForm.from_warehouse_id,
        to_warehouse_id: transferForm.to_warehouse_id,
        lines: [{ item_id: transferForm.item_id, quantity: qty }],
        notes: transferForm.notes || undefined,
      });
      toast.success(`Transfer posted: ${result.transfer_no}`);
      setTransferOpen(false);
      setPage(1);
      await loadInventory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setSaving(false);
    }
  };

  const submitStockIn = async () => {
    if (!token) return;
    const qty = Number(stockInForm.quantity);
    if (!stockInForm.warehouse_id || !stockInForm.item_id || qty <= 0) {
      toast.error("Warehouse, item, and quantity are required");
      return;
    }
    setSaving(true);
    try {
      await createStockIn(token, {
        warehouse_id: stockInForm.warehouse_id,
        item_id: stockInForm.item_id,
        quantity: qty,
        unit_cost: Number(stockInForm.unit_cost) || undefined,
        notes: stockInForm.notes || undefined,
        batch_no: stockInForm.batch_no.trim() || undefined,
        expiry_date: stockInForm.expiry_date || undefined,
      });
      toast.success("Stock received into warehouse");
      setStockInOpen(false);
      setPage(1);
      await loadInventory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stock in failed";
      toast.error(msg.includes("Forbidden") ? "You do not have permission to receive stock. Sign in as admin." : msg);
    } finally {
      setSaving(false);
    }
  };

  const exportInventory = () => {
    void trackEvent({
      action: "inventory_export_xlsx",
      entityType: "report",
      entityId: "inventory",
      details: { rows: filtered.length },
      scenario: "inventory",
      context: { q, cat, wh, sort, rows: filtered.length },
    });

    exportWorkbook("ayawin-enterprise-inventory.xlsx", [
      {
        name: "Inventory",
        rows: filtered.map((p) => ({
          SKU: p.sku,
          Product: p.name,
          Brand: p.brand ?? "",
          Category: p.category,
          "Pack Size": p.pack_size ?? "",
          Warehouse: p.warehouse,
          Stock: Number(p.stock || 0),
          "Min Stock": Number(p.min_stock || 0),
          "Cost Price": Number(p.cost_price || 0),
          "Retail Price": Number(p.retail_price || 0),
          Expiry: p.expiry_date ? fmtDate(p.expiry_date) : "",
          Barcode: p.barcode ?? "",
        })),
      },
      {
        name: "Reorder Draft",
        rows: reorderDraft.map((row) => ({ SKU: row.sku, Product: row.product, Warehouse: row.warehouse, Quantity: row.qty })),
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Inventory & Warehouse"
        description="Stock levels, batch tracking, FIFO/FEFO costing across 3 warehouses."
        actions={
          <>
            <Button variant="outline" onClick={exportInventory}>
              <ScanBarcode className="mr-2 h-4 w-4" />
              Export XLSX
            </Button>
            <Button variant="outline" onClick={() => void openTransfer()} disabled={warehouses.length < 2}>
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Transfer
            </Button>
            <Button onClick={() => void openStockIn()} disabled={warehouses.length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Stock In
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const catalog = await loadCatalog();
                if (token && reasonCodes.length === 0) {
                  try {
                    setReasonCodes(await fetchAdjustmentReasonCodes(token));
                  } catch {
                    setReasonCodes([{ code: "CYCLE_COUNT", label: "Cycle count variance" }]);
                  }
                }
                setAdjForm({
                  warehouse_id: warehouses[0]?.id?.toString() || "",
                  item_id: catalog[0]?.id || "",
                  quantity_delta: "-1",
                  reason: "Physical count variance",
                  reason_code: "CYCLE_COUNT",
                });
                setAdjOpen(true);
              }}
            >
              Stock adjustment
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Stock Value", v: KES(totalValue) },
          { l: "SKUs", v: String(skuCount) },
          { l: "Low Stock", v: String(lowStockCount) },
          { l: "Expiring Soon", v: String(expiringSoon.length) },
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
        scenario="inventory"
        contextKey={`${q}-${cat}-${wh}-${sort}-${paged.length}`}
        context={{ q, cat, wh, sort, items: paged, lowStockCount, expiringSoon: expiringSoon.length }}
        className="mb-4"
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Reorder Draft</div>
                <div className="text-xs text-muted-foreground">Items at or below reorder point (server alerts)</div>
              </div>
              <Badge variant="outline">{reorderDraft.length}</Badge>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              {reorderDraft.slice(0, 4).map((row) => (
                <div key={`${row.sku}-${row.warehouse}`} className="rounded-lg border border-border/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{row.product}</div>
                    <div className="text-xs text-muted-foreground">{row.warehouse}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">Suggested qty: {row.qty}</div>
                </div>
              ))}
              {reorderDraft.length === 0 && (
                <div className="rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">No items require reordering right now.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Expiry Watch</div>
                <div className="text-xs text-muted-foreground">Batches with 45 days or less remaining</div>
              </div>
              <Badge variant="outline">{expiringSoon.length}</Badge>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              {expiringSoon.slice(0, 4).map((row) => (
                <div key={`${row.sku}-${row.warehouse}`} className="rounded-lg border border-border/60 p-2">
                  <div className="font-medium">{row.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.warehouse} · {row.expiry_date ? fmtDate(row.expiry_date) : "-"}
                  </div>
                </div>
              ))}
              {expiringSoon.length === 0 && (
                <div className="rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">No batches are near expiry.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchBar
              value={q}
              onChange={(value) => {
                setQ(value);
                setPage(1);
              }}
              onKeyDown={async (e) => {
                if (e.key !== "Enter" || !token || !q.trim()) return;
                try {
                  const hits = await lookupInventoryBarcode(token, q.trim());
                  if (hits.length === 1) {
                    const hit = hits[0];
                    setQ(String(hit.item_code || hit.barcode || q));
                    if (hit.warehouse_id) setWh(String(hit.warehouse_name || "all"));
                  } else if (hits.length > 1) {
                    toast.message(`${hits.length} products match this barcode/SKU`);
                  }
                } catch {
                  /* local filter still applies */
                }
              }}
              placeholder="Search SKU, barcode or product name (Enter for barcode lookup)..."
            />
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {["Beer", "Spirits", "Wine", "Soft Drinks", "Water", "Juice"].map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={wh} onValueChange={setWh}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All warehouses</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.name}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort by name</SelectItem>
                <SelectItem value="stock">Lowest stock</SelectItem>
                <SelectItem value="expiry">Earliest expiry</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Pack</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Retail</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Expiry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    Loading inventory...
                  </TableCell>
                </TableRow>
              ) : paged.map((p) => {
                const low = Number(p.stock || 0) < Number(p.min_stock || 0);
                return (
                  <TableRow key={`${p.item_id}-${p.warehouse_id}`}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.brand || "-"} | {Number(p.abv || 0)}% ABV
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.category}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{p.pack_size || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.warehouse}</TableCell>
                    <TableCell className="text-right">{KES(Number(p.cost_price || 0))}</TableCell>
                    <TableCell className="text-right">{KES(Number(p.retail_price || 0))}</TableCell>
                    <TableCell className="text-right">
                      <span className={low ? "font-bold text-destructive" : "font-medium"}>{Number(p.stock || 0)}</span>
                      {low && <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />}
                      <div className="text-xs text-muted-foreground">min {Number(p.min_stock || 0)}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.expiry_date ? fmtDate(p.expiry_date) : "-"}</TableCell>
                  </TableRow>
                );
              })}
              {!loading && paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    No stock items match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <ListPagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Warehouse transfer</DialogTitle>
            <DialogDescription>Move stock between warehouses (posted immediately).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>From warehouse</Label>
              <Select value={transferForm.from_warehouse_id} onValueChange={(v) => setTransferForm((p) => ({ ...p, from_warehouse_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>To warehouse</Label>
              <Select value={transferForm.to_warehouse_id} onValueChange={(v) => setTransferForm((p) => ({ ...p, to_warehouse_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Item</Label>
              <Select value={transferForm.item_id} onValueChange={(v) => setTransferForm((p) => ({ ...p, item_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
                <SelectContent>
                  {masterItems.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.item_code} — {i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input type="number" min={0.01} step="any" value={transferForm.quantity} onChange={(e) => setTransferForm((p) => ({ ...p, quantity: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button onClick={submitTransfer} disabled={saving}>{saving ? "Posting…" : "Post transfer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stockInOpen} onOpenChange={setStockInOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Stock in</DialogTitle>
            <DialogDescription>
              Receive quantity into a warehouse. New products: add under{" "}
              <Link to="/master-data" className="underline" onClick={() => setStockInOpen(false)}>Master Data</Link> first.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Warehouse</Label>
              <Select value={stockInForm.warehouse_id} onValueChange={(v) => setStockInForm((p) => ({ ...p, warehouse_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Warehouse" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Item</Label>
              <Select value={stockInForm.item_id} onValueChange={(v) => setStockInForm((p) => ({ ...p, item_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
                <SelectContent>
                  {masterItems.map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.item_code} — {i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input type="number" min={0.01} step="any" value={stockInForm.quantity} onChange={(e) => setStockInForm((p) => ({ ...p, quantity: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Unit cost (optional)</Label>
                <Input type="number" min={0} step="any" value={stockInForm.unit_cost} onChange={(e) => setStockInForm((p) => ({ ...p, unit_cost: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Batch / lot no.</Label>
                <Input value={stockInForm.batch_no} onChange={(e) => setStockInForm((p) => ({ ...p, batch_no: e.target.value }))} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry date</Label>
                <Input type="date" value={stockInForm.expiry_date} onChange={(e) => setStockInForm((p) => ({ ...p, expiry_date: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockInOpen(false)}>Cancel</Button>
            <Button onClick={submitStockIn} disabled={saving}>{saving ? "Saving…" : "Receive stock"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="mt-4">
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Recent stock movements</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Batch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((mv) => (
                <TableRow key={String(mv.id)}>
                  <TableCell className="text-xs">{mv.movement_date ? fmtDate(String(mv.movement_date)) : "-"}</TableCell>
                  <TableCell className="text-xs">{String(mv.item_code || "")}</TableCell>
                  <TableCell className="text-xs">{String(mv.warehouse_name || "")}</TableCell>
                  <TableCell className="text-xs">{String(mv.movement_type)}</TableCell>
                  <TableCell className="text-right text-xs">{Number(mv.quantity || 0)}</TableCell>
                  <TableCell className="text-xs">{String(mv.batch_no || "-")}</TableCell>
                </TableRow>
              ))}
              {movements.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No movements recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Stock adjustments (draft → post)</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Adjustment #</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map((adj) => (
                <TableRow key={String(adj.id)}>
                  <TableCell className="font-mono text-xs">{String(adj.adjustment_no)}</TableCell>
                  <TableCell>{String(adj.warehouse_name || "")}</TableCell>
                  <TableCell className="max-w-[180px] truncate">{String(adj.reason || "")}</TableCell>
                  <TableCell>{String(adj.status)}</TableCell>
                  <TableCell className="text-right">
                    {adj.status === "draft" && user?.id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          if (!token) return;
                          try {
                            await postStockAdjustment(token, String(adj.id), String(user.id));
                            toast.success("Adjustment posted");
                            await Promise.all([loadInventory(), loadAdjustments()]);
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Could not post adjustment");
                          }
                        }}
                      >
                        Post
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {adjustments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No adjustments — create one when physical count differs from system.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stock adjustment</DialogTitle>
            <DialogDescription>Use negative quantity to reduce stock; positive to increase. Requires approval to post.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Warehouse</Label>
              <Select value={adjForm.warehouse_id} onValueChange={(v) => setAdjForm((p) => ({ ...p, warehouse_id: v }))}>
                <SelectTrigger>
                  <SelectValue />
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
            <div>
              <Label>Item</Label>
              <Select value={adjForm.item_id} onValueChange={(v) => setAdjForm((p) => ({ ...p, item_id: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {masterItems.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.item_code} — {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quantity change (+/-)</Label>
              <Input
                type="number"
                value={adjForm.quantity_delta}
                onChange={(e) => setAdjForm((p) => ({ ...p, quantity_delta: e.target.value }))}
              />
            </div>
            <div>
              <Label>Reason code</Label>
              <Select value={adjForm.reason_code} onValueChange={(v) => setAdjForm((p) => ({ ...p, reason_code: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(reasonCodes.length ? reasonCodes : [{ code: "CYCLE_COUNT", label: "Cycle count variance" }]).map((rc) => (
                    <SelectItem key={rc.code} value={rc.code}>
                      {rc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={adjForm.reason} onChange={(e) => setAdjForm((p) => ({ ...p, reason: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                if (!token || !adjForm.reason.trim()) {
                  toast.error("Reason is required");
                  return;
                }
                const delta = Number(adjForm.quantity_delta);
                if (!delta || delta === 0) {
                  toast.error("Enter a non-zero quantity change");
                  return;
                }
                setSaving(true);
                try {
                  await createStockAdjustment(token, {
                    warehouse_id: adjForm.warehouse_id,
                    reason: adjForm.reason.trim(),
                    reason_code: adjForm.reason_code,
                    lines: [{ item_id: adjForm.item_id, quantity_delta: delta }],
                  });
                  toast.success("Draft adjustment created — post when approved");
                  setAdjOpen(false);
                  await loadAdjustments();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not create adjustment");
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
            >
              Save draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

