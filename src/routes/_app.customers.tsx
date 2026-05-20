import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { customers } from "@/lib/mock-data";
import { KES } from "@/lib/format";
import { SearchBar } from "@/components/SearchBar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_app/customers")({
  component: CustomersPage,
  head: () => ({ meta: [{ title: "Customers (CRM) — Martin Enterprise ERP" }] }),
});

function CustomersPage() {
  const [q, setQ] = useState("");
  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(q.toLowerCase()) || c.location.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div>
      <PageHeader
        title="Customer Relationship Management"
        description="Bars, restaurants, supermarkets, wholesalers and distributors."
        actions={<Button className="bg-navy text-navy-foreground hover:bg-navy/90"><Plus className="mr-2 h-4 w-4" />Add Customer</Button>}
      />

      <Card>
        <CardContent className="p-4">
          <SearchBar value={q} onChange={setQ} placeholder="Search customer or location..." />
          <Table className="mt-4">
            <TableHeader><TableRow>
              <TableHead>Customer</TableHead><TableHead>Segment</TableHead><TableHead>KRA PIN</TableHead>
              <TableHead>Location</TableHead><TableHead>Terms</TableHead>
              <TableHead className="w-[200px]">Credit Utilisation</TableHead><TableHead className="text-right">Balance</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const util = Math.round((c.balance / c.creditLimit) * 100);
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.email}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{c.segment}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{c.kraPin}</TableCell>
                    <TableCell className="text-xs">{c.location}</TableCell>
                    <TableCell className="text-xs">{c.terms}</TableCell>
                    <TableCell>
                      <Progress value={util} className={util > 80 ? "[&>div]:bg-destructive" : util > 50 ? "[&>div]:bg-warning" : "[&>div]:bg-success"} />
                      <div className="mt-1 text-[10px] text-muted-foreground">{util}% of {KES(c.creditLimit)}</div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{KES(c.balance)}</TableCell>
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
