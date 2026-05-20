import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { deliveries } from "@/lib/mock-data";
import { fmtDate } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Truck, MapPin, Upload } from "lucide-react";

export const Route = createFileRoute("/_app/delivery")({
  component: DeliveryPage,
  head: () => ({ meta: [{ title: "Delivery & Logistics — Martin Enterprise ERP" }] }),
});

function DeliveryPage() {
  return (
    <div>
      <PageHeader
        title="Delivery & Logistics"
        description="Driver assignments, route planning, proof of delivery."
        actions={<Button className="bg-navy text-navy-foreground hover:bg-navy/90"><Truck className="mr-2 h-4 w-4" />Schedule Delivery</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          { l: "In Transit", v: "1" },
          { l: "Delivered Today", v: "3" },
          { l: "Pending", v: "1" },
          { l: "Active Vehicles", v: "2" },
        ].map((k) => (
          <Card key={k.l}><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
            <div className="mt-1 font-display text-2xl font-bold">{k.v}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Delivery #</TableHead><TableHead>Order #</TableHead><TableHead>Customer</TableHead>
              <TableHead>Driver / Vehicle</TableHead><TableHead>Route</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>POD</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.id}</TableCell>
                  <TableCell className="font-mono text-xs">{d.order}</TableCell>
                  <TableCell className="font-medium">{d.customer}</TableCell>
                  <TableCell className="text-xs">{d.driver}<br /><span className="text-muted-foreground">{d.vehicle}</span></TableCell>
                  <TableCell className="text-xs"><MapPin className="mr-1 inline h-3 w-3 text-muted-foreground" />{d.route}</TableCell>
                  <TableCell>{fmtDate(d.date)}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell>
                    {d.status === "Delivered" ? (
                      <Button variant="ghost" size="sm" className="h-7 text-xs">View</Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-7 text-xs"><Upload className="mr-1 h-3 w-3" />Upload</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
