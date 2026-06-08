import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  createCreditNote,
  fetchActiveCustomers,
  fetchCreditNotes,
  fetchMasterItems,
  fetchSalesInvoices,
  fetchWarehouses,
  type BackendCustomer,
  type BackendInvoice,
  type BackendMasterItem,
  type BackendWarehouse,
} from "@/lib/api";
import { KES } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { SalesProductSearch } from "@/components/SalesProductSearch";

export function SalesReturnsPanel() {
  const { token } = useAuth();
  const [creditNotes, setCreditNotes] = useState<Array<Record<string, unknown>>>([]);
  const [invoices, setInvoices] = useState<BackendInvoice[]>([]);
  const [customers, setCustomers] = useState<BackendCustomer[]>([]);
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    customer_id: "",
    invoice_id: "",
    item_id: "",
    warehouse_id: "",
    quantity: "1",
    unit_price: "",
    reason: "",
  });

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [cn, inv, cust, it, wh] = await Promise.all([
        fetchCreditNotes(token),
        fetchSalesInvoices(token, { limit: 200, page: 1 }),
        fetchActiveCustomers(token),
        fetchMasterItems(token),
        fetchWarehouses(token),
      ]);
      setCreditNotes(cn);
      setInvoices(inv.rows.filter((i) => !["Draft", "Cancelled"].includes(i.status)));
      setCustomers(cust);
      setItems(it);
      setWarehouses(wh);
      setForm((f) => ({
        ...f,
        customer_id: f.customer_id || String(cust[0]?.id ?? ""),
        item_id: f.item_id || it[0]?.id || "",
        warehouse_id: f.warehouse_id || String(wh[0]?.id ?? ""),
        unit_price: f.unit_price || String(it[0]?.standard_cost ?? ""),
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load returns data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const submitReturn = async () => {
    if (!token || !form.customer_id || !form.item_id || !form.reason.trim()) {
      toast.error("Customer, product, and reason are required");
      return;
    }
    const qty = Number(form.quantity);
    const price = Number(form.unit_price);
    if (qty <= 0 || price < 0) {
      toast.error("Enter valid quantity and unit price");
      return;
    }
    setSaving(true);
    try {
      await createCreditNote(token, {
        customer_id: form.customer_id,
        invoice_id: form.invoice_id || undefined,
        reason: form.reason.trim(),
        warehouse_id: form.warehouse_id || undefined,
        lines: [{ item_id: form.item_id, quantity: qty, unit_price: price }],
      });
      toast.success("Return posted — credit note created and stock reversed");
      setOpen(false);
      setForm((f) => ({ ...f, reason: "", quantity: "1" }));
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post return");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Return orders post a credit note and receive stock back into the selected warehouse.
          </p>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">New return</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Sales return</DialogTitle>
                <DialogDescription>Creates a credit note and reverses stock into the warehouse.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="space-y-1.5">
                  <Label>Customer</Label>
                  <Select
                    value={form.customer_id}
                    onValueChange={(v) => setForm((p) => ({ ...p, customer_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={String(c.id)} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Link invoice (optional)</Label>
                  <Select
                    value={form.invoice_id || "_none"}
                    onValueChange={(v) => setForm((p) => ({ ...p, invoice_id: v === "_none" ? "" : v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">None</SelectItem>
                      {invoices.map((inv) => (
                        <SelectItem key={String(inv.internal_id || inv.id)} value={String(inv.internal_id || inv.id)}>
                          {inv.id} — {inv.customer}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Product</Label>
                  <SalesProductSearch
                    items={items}
                    value={form.item_id}
                    onValueChange={(id) => {
                      const item = items.find((i) => i.id === id);
                      setForm((p) => ({
                        ...p,
                        item_id: id,
                        unit_price: item ? String(item.standard_cost) : p.unit_price,
                      }));
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Qty</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.quantity}
                      onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Unit price</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.unit_price}
                      onChange={(e) => setForm((p) => ({ ...p, unit_price: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Warehouse</Label>
                  <Select
                    value={form.warehouse_id}
                    onValueChange={(v) => setForm((p) => ({ ...p, warehouse_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
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
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Input
                    value={form.reason}
                    onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                    placeholder="Damaged goods, wrong delivery…"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void submitReturn()} disabled={saving}>
                  {saving ? "Posting…" : "Post return"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Credit note</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : creditNotes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  No returns yet.
                </TableCell>
              </TableRow>
            ) : (
              creditNotes.map((cn) => (
                <TableRow key={String(cn.id)}>
                  <TableCell className="font-mono text-xs">{String(cn.credit_note_no || cn.id)}</TableCell>
                  <TableCell>{String(cn.customer_name || "—")}</TableCell>
                  <TableCell className="text-right">{KES(Number(cn.total_amount || 0))}</TableCell>
                  <TableCell>
                    <StatusBadge status={String(cn.status || "posted")} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
