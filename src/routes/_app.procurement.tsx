import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { purchaseOrders, suppliers } from "@/lib/mock-data";
import { KES, fmtDate } from "@/lib/format";
import { SearchBar } from "@/components/SearchBar";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_app/procurement")({
  component: Procurement,
  head: () => ({ meta: [{ title: "Procurement — Martin Enterprise ERP" }] }),
});

function Procurement() {
  const [q, setQ] = useState("");
  return (
    <div>
      <PageHeader
        title="Procurement & Suppliers"
        description="Manage purchase orders, GRNs and supplier payments."
        actions={<Button className="bg-navy text-navy-foreground hover:bg-navy/90"><Plus className="mr-2 h-4 w-4" />New PO</Button>}
      />

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="mt-4">
          <Card><CardContent className="p-4">
            <SearchBar value={q} onChange={setQ} placeholder="Search PO or supplier..." />
            <Table className="mt-4">
              <TableHeader><TableRow>
                <TableHead>PO #</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead>
                <TableHead className="text-right">Items</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {purchaseOrders.filter((p) => p.id.toLowerCase().includes(q.toLowerCase()) || p.supplier.toLowerCase().includes(q.toLowerCase())).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.id}</TableCell>
                    <TableCell>{fmtDate(p.date)}</TableCell>
                    <TableCell className="font-medium">{p.supplier}</TableCell>
                    <TableCell className="text-right">{p.items}</TableCell>
                    <TableCell className="text-right font-semibold">{KES(p.total)}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Supplier</TableHead><TableHead>KRA PIN</TableHead><TableHead>Contact</TableHead>
                <TableHead>Terms</TableHead><TableHead className="text-right">Credit Limit</TableHead><TableHead className="text-right">Balance</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="font-mono text-xs">{s.kraPin}</TableCell>
                    <TableCell className="text-xs">{s.email}<br /><span className="text-muted-foreground">{s.phone}</span></TableCell>
                    <TableCell>{s.terms}</TableCell>
                    <TableCell className="text-right">{KES(s.creditLimit)}</TableCell>
                    <TableCell className="text-right font-semibold">{KES(s.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
