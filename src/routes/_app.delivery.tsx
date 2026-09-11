import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, MapPin, Upload, ArrowUpDown, Printer } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { Badge } from "@/components/ui/badge";
import { deliveryRouteHint } from "@/lib/smartSignals";
import { exportWorkbook } from "@/lib/excel";
import { trackEvent } from "@/lib/event-tracker";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { fetchSalesDeliveries, type BackendDelivery } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/delivery")({
  component: DeliveryPage,
  head: () => ({ meta: [{ title: "Delivery & Logistics - Ayawin Enterprise ERP" }] }),
});

function DeliveryPage() {
  const { token } = useAuth();
  const [deliveries, setDeliveries] = useState<BackendDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  useEffect(() => {
    if (!token) return;
    void fetchSalesDeliveries(token).then(setDeliveries).catch((err) => {
      toast.error(err instanceof Error ? err.message : "Unable to load deliveries");
      setDeliveries([]);
    }).finally(() => setLoading(false));
  }, [token]);
  const filtered = deliveries
    .filter((d) => (status === "all" || d.status === status) && (`${d.delivery_no} ${d.order_no || ""}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => {
      if (sort === "status") return String(a.status).localeCompare(String(b.status));
      return String(b.delivery_date || "").localeCompare(String(a.delivery_date || ""));
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const routeHints = deliveryRouteHint();
  const exportDeliveries = () => {
    void trackEvent({
      action: "delivery_export_xlsx",
      entityType: "report",
      entityId: "delivery",
      details: { rows: filtered.length },
      scenario: "delivery",
      context: { q, status, sort, rows: filtered.length },
    });
    exportWorkbook("ayawin-enterprise-deliveries.xlsx", [
      {
        name: "Deliveries",
        rows: filtered.map((d) => ({
          "Delivery #": d.delivery_no,
          "Order #": d.order_no,
          Driver: d.driver_name,
          Vehicle: d.vehicle_no,
          Route: d.route,
          Date: d.delivery_date ? fmtDate(d.delivery_date) : "",
          Status: d.status,
        })),
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Delivery & Logistics"
        description="Driver assignments, route planning, proof of delivery and vehicle tracking."
        actions={
          <>
            <Button variant="outline" onClick={exportDeliveries}><Printer className="mr-2 h-4 w-4" />Export XLSX</Button>
            <Button
             
              onClick={() => {
                void trackEvent({
                  action: "delivery_batch_scheduled",
                  entityType: "delivery_batch",
                  entityId: "batch",
                  details: { routeHints },
                  scenario: "delivery",
                  context: { q, status, sort, routeHints },
                });
              }}
            >
              <Truck className="mr-2 h-4 w-4" />
              Schedule Delivery
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          { l: "In Transit", v: "1" },
          { l: "Delivered Today", v: "3" },
          { l: "Pending", v: "1" },
          { l: "Active Vehicles", v: "2" },
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
        scenario="delivery"
        contextKey={`${q}-${status}-${sort}`}
        context={{ q, status, sort, deliveries: paged }}
        className="mb-4"
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Route sequence</div>
          <div className="flex flex-wrap gap-2">
            {routeHints.map((route) => (
              <Badge key={route} variant="outline" className="">
                {route}
              </Badge>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Delivery batches are grouped by geography so dispatch can accept or rearrange the sequence.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchBar value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search delivery or customer..." />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {["Pending", "In Transit", "Delivered", "Failed"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-40">
                <ArrowUpDown className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Sort by date</SelectItem>
                <SelectItem value="customer">Sort by customer</SelectItem>
                <SelectItem value="status">Sort by status</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Delivery #</TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Driver / Vehicle</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>POD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">Loading live deliveries…</TableCell></TableRow> : paged.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.delivery_no}</TableCell>
                  <TableCell className="font-mono text-xs">{d.order_no || "—"}</TableCell>
                  <TableCell className="font-medium">{d.order_no || "Sales delivery"}</TableCell>
                  <TableCell className="text-xs">
                    {d.driver_name || "Unassigned"}
                    <br />
                    <span className="text-muted-foreground">{d.vehicle_no || "—"}</span>
                  </TableCell>
                  <TableCell className="text-xs">
                    <MapPin className="mr-1 inline h-3 w-3 text-muted-foreground" />
                    {d.route || "—"}
                  </TableCell>
                  <TableCell>{d.delivery_date ? fmtDate(d.delivery_date) : "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={d.status || "Pending"} />
                  </TableCell>
                  <TableCell>
                    {String(d.status).toLowerCase() === "delivered" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          void trackEvent({
                            action: "delivery_pod_viewed",
                            entityType: "delivery",
                            entityId: d.id,
                            details: { order: d.order_no },
                            scenario: "delivery",
                            context: { delivery: d },
                          });
                        }}
                      >
                        View
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          void trackEvent({
                            action: "delivery_pod_upload_opened",
                            entityType: "delivery",
                            entityId: d.id,
                            details: { order: d.order_no },
                            scenario: "delivery",
                            context: { delivery: d },
                          });
                        }}
                      >
                        <Upload className="mr-1 h-3 w-3" />
                        Upload
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    No deliveries match your filters.
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
