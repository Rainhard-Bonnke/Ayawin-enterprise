import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { products, warehouses } from "@/lib/mock-data";
import { KES, fmtDate } from "@/lib/format";
import { SearchBar } from "@/components/SearchBar";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, ArrowLeftRight, ScanBarcode, AlertTriangle } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_app/inventory")({
  component: InventoryPage,
  head: () => ({ meta: [{ title: "Inventory — Martin Enterprise ERP" }] }),
});

function InventoryPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [wh, setWh] = useState("all");
  const filtered = products.filter((p) =>
    (cat === "all" || p.category === cat) &&
    (wh === "all" || p.warehouse === wh) &&
    (p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase()))
  );

  const totalValue = products.reduce((s, p) => s + p.stock * p.costPrice, 0);
  const lowStock = products.filter((p) => p.stock < p.minStock).length;

  return (
    <div>
      <PageHeader
        title="Inventory & Warehouse"
        description="Stock levels, batch tracking, FIFO/FEFO costing across 3 warehouses."
        actions={
          <>
            <Button variant="outline"><ScanBarcode className="mr-2 h-4 w-4" />Scan barcode</Button>
            <Button variant="outline"><ArrowLeftRight className="mr-2 h-4 w-4" />Transfer</Button>
            <Button className="bg-navy text-navy-foreground hover:bg-navy/90"><Plus className="mr-2 h-4 w-4" />Stock In</Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Stock Value", v: KES(totalValue) },
          { l: "SKUs", v: String(products.length) },
          { l: "Warehouses", v: String(warehouses.length) },
          { l: "Low Stock", v: String(lowStock), warn: true },
        ].map((k) => (
          <Card key={k.l}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
              <div className={`mt-1 font-display text-2xl font-bold ${k.warn ? "text-destructive" : ""}`}>{k.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchBar value={q} onChange={setQ} placeholder="Search SKU or product name..." />
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {["Beer", "Spirits", "Wine", "Soft Drinks", "Water", "Juice"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={wh} onValueChange={setWh}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All warehouses</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.name}>{w.name}</SelectItem>)}
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
              {filtered.map((p) => {
                const low = p.stock < p.minStock;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.brand} · {p.abv}% ABV</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{p.category}</Badge></TableCell>
                    <TableCell className="text-xs">{p.packSize}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.warehouse}</TableCell>
                    <TableCell className="text-right">{KES(p.costPrice)}</TableCell>
                    <TableCell className="text-right">{KES(p.retailPrice)}</TableCell>
                    <TableCell className="text-right">
                      <span className={low ? "font-bold text-destructive" : "font-medium"}>{p.stock}</span>
                      {low && <AlertTriangle className="ml-1 inline h-3 w-3 text-destructive" />}
                      <div className="text-xs text-muted-foreground">min {p.minStock}</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(p.expiry)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
