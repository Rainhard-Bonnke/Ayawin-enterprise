import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Download, FileDown } from "lucide-react";
import { useState } from "react";
import { salesOrders, customers, products } from "@/lib/mock-data";
import { KES, fmtDate } from "@/lib/format";
import { SearchBar } from "@/components/SearchBar";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/sales")({
  component: SalesPage,
  head: () => ({ meta: [{ title: "Sales & Orders — Martin Enterprise ERP" }] }),
});

function SalesPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const filtered = salesOrders.filter((o) =>
    (status === "all" || o.status === status) &&
    (o.id.toLowerCase().includes(query.toLowerCase()) || o.customer.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div>
      <PageHeader
        title="Sales & Orders"
        description="Manage quotations, sales orders, dispatches and returns."
        actions={
          <>
            <Button variant="outline"><FileDown className="mr-2 h-4 w-4" />Export</Button>
            <NewOrderDialog />
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

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchBar value={query} onChange={setQuery} placeholder="Search by order # or customer..." />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {["Draft", "Confirmed", "Dispatched", "Delivered", "Invoiced"].map((s) =>
                  <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="ml-auto"><Download className="mr-2 h-3.5 w-3.5" />PDF</Button>
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
              {filtered.map((o) => (
                <TableRow key={o.id} className="cursor-pointer hover:bg-muted/40">
                  <TableCell className="font-mono text-xs">{o.id}</TableCell>
                  <TableCell>{fmtDate(o.date)}</TableCell>
                  <TableCell className="font-medium">{o.customer}</TableCell>
                  <TableCell className="text-muted-foreground">{o.rep}</TableCell>
                  <TableCell className="text-right">{o.items}</TableCell>
                  <TableCell className="text-right font-semibold">{KES(o.total)}</TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No orders match your filters.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function NewOrderDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-navy text-navy-foreground hover:bg-navy/90"><Plus className="mr-2 h-4 w-4" />New Sales Order</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Create Sales Order</DialogTitle>
          <DialogDescription>Draft a new order. KRA-compliant invoice generates on confirmation.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Customer</Label>
            <Select>
              <SelectTrigger><SelectValue placeholder="Select customer..." /></SelectTrigger>
              <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Price tier</Label>
            <Select defaultValue="wholesale">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="retail">Retail</SelectItem>
                <SelectItem value="wholesale">Wholesale</SelectItem>
                <SelectItem value="distributor">Distributor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Delivery date</Label>
            <Input type="date" defaultValue="2026-05-22" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Product</Label>
            <Select>
              <SelectTrigger><SelectValue placeholder="Add product..." /></SelectTrigger>
              <SelectContent>{products.slice(0, 8).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — {KES(p.wholesalePrice)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <Input type="number" defaultValue={10} />
          </div>
          <div className="space-y-1.5">
            <Label>Discount (%)</Label>
            <Input type="number" defaultValue={0} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Save as draft</Button>
          <Button className="bg-navy text-navy-foreground hover:bg-navy/90" onClick={() => { toast.success("Sales order created"); setOpen(false); }}>
            Confirm order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
