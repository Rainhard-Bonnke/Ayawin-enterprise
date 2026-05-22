import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Plus, ScanBarcode } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchBar } from "@/components/SearchBar";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { exportWorkbook } from "@/lib/excel";
import { trackEvent } from "@/lib/event-tracker";
import { KES, fmtDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { fetchInventoryItems, fetchWarehouses, type BackendInventoryItem, type BackendWarehouse } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/inventory")({
  component: InventoryPage,
  head: () => ({ meta: [{ title: "Inventory - Ayawin Enterprise ERP" }] }),
});

function InventoryPage() {
  const { token } = useAuth();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [wh, setWh] = useState("all");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BackendInventoryItem[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);

  const pageSize = 6;

  const loadInventory = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [inv, whs] = await Promise.all([fetchInventoryItems(token), fetchWarehouses(token)]);
      setItems(inv);
      setWarehouses(whs);
    } catch {
      setItems([]);
      setWarehouses([]);
      toast.error("Unable to load inventory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInventory();
  }, [token]);

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

  const totalValue = useMemo(() => filtered.reduce((sum, row) => sum + Number(row.stock || 0) * Number(row.cost_price || 0), 0), [filtered]);
  const lowStockCount = useMemo(() => filtered.filter((row) => Number(row.stock || 0) < Number(row.min_stock || 0)).length, [filtered]);
  const skuCount = useMemo(() => new Set(items.map((row) => row.sku)).size, [items]);

  const reorderDraft = useMemo(
    () =>
      filtered
        .filter((row) => Number(row.stock || 0) < Number(row.min_stock || 0))
        .slice(0, 12)
        .map((row) => ({
          sku: row.sku,
          product: row.name,
          warehouse: row.warehouse,
          qty: Math.max(0, Number(row.min_stock || 0) * 2 - Number(row.stock || 0)),
        })),
    [filtered],
  );

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
            <Button
              variant="outline"
              onClick={() => {
                void trackEvent({
                  action: "inventory_transfer_opened",
                  entityType: "transfer",
                  entityId: "draft",
                  details: { q, cat, wh, sort },
                  scenario: "inventory",
                  context: { q, cat, wh, sort },
                });
              }}
            >
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Transfer
            </Button>
            <Button
              className="bg-navy text-navy-foreground hover:bg-navy/90"
              onClick={() => {
                void trackEvent({
                  action: "inventory_stockin_opened",
                  entityType: "stock_movement",
                  entityId: "draft",
                  details: { q, cat, wh, sort },
                  scenario: "inventory",
                  context: { q, cat, wh, sort, reorderDraft },
                });
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Stock In
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
              <div className="mt-1 font-display text-2xl font-bold">{k.v}</div>
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
                <div className="text-xs text-muted-foreground">Items below dynamic threshold (min stock x2)</div>
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
              placeholder="Search SKU, barcode or product name..."
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
                  <TableRow key={`${p.product_id}-${p.warehouse_id}`}>
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
    </div>
  );
}

