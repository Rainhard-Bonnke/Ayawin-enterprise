import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  convertQuotationToOrder,
  createQuotation,
  fetchActiveCustomers,
  fetchMasterItems,
  fetchQuotations,
  fetchWarehouses,
  type BackendCustomer,
  type BackendMasterItem,
  type BackendQuotation,
  type BackendWarehouse,
} from "@/lib/api";
import { KES, fmtDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SalesQuotationsPanel({ onOrderCreated }: { onOrderCreated?: () => void }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<BackendQuotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<BackendCustomer[]>([]);
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(10);
  const [unitPrice, setUnitPrice] = useState("");
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [convertWarehouseId, setConvertWarehouseId] = useState("");

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setRows(await fetchQuotations(token));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load quotations");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!open || !token) return;
    setFormLoading(true);
    void Promise.all([fetchActiveCustomers(token), fetchMasterItems(token), fetchWarehouses(token)])
      .then(([c, i, w]) => {
        setCustomers(c);
        setItems(i);
        setWarehouses(w);
        const firstCustomer = c[0]?.id ? String(c[0].id) : "";
        const firstItem = i[0]?.id ?? "";
        setCustomerId(firstCustomer);
        setItemId(firstItem);
        setUnitPrice(String(i[0]?.standard_cost ?? ""));
      })
      .catch(() => {
        toast.error("Could not load customers or products for quotation");
        setCustomers([]);
        setItems([]);
      })
      .finally(() => setFormLoading(false));
  }, [open, token]);

  const submit = async () => {
    if (!token || !customerId || !itemId) {
      toast.error("Select a customer and product");
      return;
    }
    const price = Number(unitPrice);
    if (price <= 0) {
      toast.error("Unit price must be greater than zero");
      return;
    }
    setSaving(true);
    try {
      await createQuotation(token, {
        customer_id: customerId,
        valid_until: validUntil.trim() || undefined,
        lines: [{ item_id: itemId, quantity: Number(qty) || 1, unit_price: price }],
      });
      toast.success("Quotation created");
      setOpen(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create quotation");
    } finally {
      setSaving(false);
    }
  };

  const convert = async (quoteId: string) => {
    if (!token) return;
    const wh = convertWarehouseId || warehouses[0]?.id;
    if (!wh) {
      toast.error("Select a warehouse before converting");
      return;
    }
    try {
      await convertQuotationToOrder(token, quoteId, String(wh));
      toast.success("Draft sales order created — confirm it when stock is available");
      await reload();
      onOrderCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not convert quotation");
    }
  };

  useEffect(() => {
    if (!token) return;
    void fetchWarehouses(token)
      .then((w) => {
        setWarehouses(w);
        if (w[0]?.id) setConvertWarehouseId(String(w[0].id));
      })
      .catch(() => setWarehouses([]));
  }, [token]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {warehouses.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="convert-wh" className="text-muted-foreground">
                Convert to warehouse
              </Label>
              <Select value={convertWarehouseId} onValueChange={setConvertWarehouseId}>
                <SelectTrigger id="convert-wh" className="h-8 w-[200px]">
                  <SelectValue placeholder="Warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={String(w.id)} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                New quotation
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create quotation</DialogTitle>
                <DialogDescription>Quote includes VAT and excise based on product category.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                {formLoading ? (
                  <p className="text-sm text-muted-foreground">Loading customers and products…</p>
                ) : null}
                <div>
                  <Label>Customer</Label>
                  <Select value={customerId} onValueChange={setCustomerId} disabled={formLoading}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Product</Label>
                  <Select
                    value={itemId}
                    disabled={formLoading}
                    onValueChange={(id) => {
                      setItemId(id);
                      const item = items.find((i) => i.id === id);
                      if (item) setUnitPrice(String(item.standard_cost));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.item_code} — {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Qty</Label>
                    <Input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                  </div>
                  <div>
                    <Label>Unit price</Label>
                    <Input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
                  </div>
                  <div>
                    <Label>Valid until</Label>
                    <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => void submit()}
                  disabled={saving || formLoading || !customerId || !itemId}
                >
                  {saving ? "Saving…" : "Save quotation"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quote #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Loading quotations…
                </TableCell>
              </TableRow>
            ) : (
              rows.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="font-mono text-xs">{q.quote_no}</TableCell>
                  <TableCell>{q.customer_name}</TableCell>
                  <TableCell>
                    <StatusBadge status={q.status} />
                  </TableCell>
                  <TableCell>{q.valid_until ? fmtDate(q.valid_until) : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{KES(q.total_amount)}</TableCell>
                  <TableCell className="text-right">
                    {["draft", "sent", "accepted"].includes(q.status.toLowerCase()) && (
                      <Button size="sm" variant="secondary" onClick={() => void convert(q.id)}>
                        Convert to order
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No quotations yet — create one to send to a customer.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
