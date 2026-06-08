import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, MapPin, Upload, ArrowUpDown, Printer, RefreshCw } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { Badge } from "@/components/ui/badge";
import { exportWorkbook } from "@/lib/excel";
import { trackEvent } from "@/lib/event-tracker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { subscribeLiveEvents } from "@/hooks/useLiveEvents";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  fetchDeliveries,
  uploadDeliveryPod,
  fetchDeliveryDrivers,
  fetchDeliveryVehicles,
  assignDeliveryDriver,
  failDelivery,
  fetchRoutePlan,
  fetchRedeliveryTasks,
  scheduleRedeliveryTask,
  recordTripMileage,
  downloadDeliveryNotePdf,
  type DeliveryRow,
} from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_app/delivery")({
  component: DeliveryPage,
  head: () => ({ meta: [{ title: "Delivery & Logistics - Ayawin Stock Solutions ERP" }] }),
});

function DeliveryPage() {
  const { token } = useAuth();
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const [podOpen, setPodOpen] = useState(false);
  const [podTarget, setPodTarget] = useState<DeliveryRow | null>(null);
  const [podSignature, setPodSignature] = useState("");
  const [podPhotoData, setPodPhotoData] = useState<string | undefined>();
  const [podSaving, setPodSaving] = useState(false);
  const podFileRef = useRef<HTMLInputElement>(null);
  const [drivers, setDrivers] = useState<Array<Record<string, unknown>>>([]);
  const [vehicles, setVehicles] = useState<Array<Record<string, unknown>>>([]);
  const [routePlan, setRoutePlan] = useState<Array<{ group: string; label: string; zones: Array<{ label: string; deliveries: unknown[] }> }>>([]);
  const [redeliveryTasks, setRedeliveryTasks] = useState<Array<Record<string, unknown>>>([]);

  const openPodUpload = (d: DeliveryRow) => {
    setPodTarget(d);
    setPodSignature(d.podSignature || "");
    setPodPhotoData(undefined);
    setPodOpen(true);
  };

  const submitPod = async () => {
    if (!token || !podTarget) return;
    if (!podSignature.trim() && !podPhotoData) {
      toast.error("Enter recipient name or attach a photo");
      return;
    }
    setPodSaving(true);
    try {
      await uploadDeliveryPod(token, podTarget.id, {
        pod_signature: podSignature.trim() || undefined,
        pod_photo_data: podPhotoData,
      });
      toast.success("Proof of delivery saved");
      setPodOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save POD");
    } finally {
      setPodSaving(false);
    }
  };

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    fetchDeliveries(token)
      .then(setDeliveries)
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Unable to load deliveries");
        setDeliveries([]);
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useRealtimeSync(load, { enabled: Boolean(token) });

  useEffect(() => {
    return subscribeLiveEvents((ev) => {
      if (ev.type === "delivery.updated") {
        load();
      }
    });
  }, [load]);

  useEffect(() => {
    if (!token) return;
    void fetchDeliveryDrivers(token).then(setDrivers).catch(() => setDrivers([]));
    void fetchDeliveryVehicles(token).then(setVehicles).catch(() => setVehicles([]));
    void fetchRoutePlan(token).then((p) => setRoutePlan((p.routes || []) as typeof routePlan)).catch(() => setRoutePlan([]));
    void fetchRedeliveryTasks(token).then(setRedeliveryTasks).catch(() => setRedeliveryTasks([]));
  }, [token]);

  const filtered = deliveries
    .filter(
      (d) =>
        (status === "all" || d.status === status) &&
        (d.deliveryNo.toLowerCase().includes(q.toLowerCase()) ||
          d.orderNo.toLowerCase().includes(q.toLowerCase()) ||
          d.customer.toLowerCase().includes(q.toLowerCase())),
    )
    .sort((a, b) => {
      if (sort === "customer") return a.customer.localeCompare(b.customer);
      if (sort === "status") return a.status.localeCompare(b.status);
      return b.date.localeCompare(a.date);
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const pending = deliveries.filter((d) => d.status === "Pending").length;
    const deliveredToday = deliveries.filter((d) => d.status === "Delivered" && d.date === today).length;
    const delivered = deliveries.filter((d) => d.status === "Delivered").length;
    const warehouses = new Set(deliveries.map((d) => d.warehouse).filter((w) => w && w !== "—"));
    return [
      { l: "Pending", v: String(pending) },
      { l: "Delivered Today", v: String(deliveredToday) },
      { l: "Delivered (all)", v: String(delivered) },
      { l: "Warehouses", v: String(warehouses.size) },
    ];
  }, [deliveries]);

  const routeHints = useMemo(() => {
    if (routePlan.length) {
      return routePlan.flatMap((g) => g.zones.map((z) => `${g.label}: ${z.label} (${z.deliveries.length})`));
    }
    const orders = [...new Set(deliveries.map((d) => d.orderNo).filter((o) => o && o !== "—"))].slice(0, 8);
    return orders.length ? orders : ["No delivery notes yet"];
  }, [deliveries, routePlan]);

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
          "Delivery #": d.deliveryNo,
          "Order #": d.orderNo,
          Customer: d.customer,
          Warehouse: d.warehouse,
          Date: fmtDate(d.date),
          Status: d.status,
        })),
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Delivery & Logistics"
        description="Delivery notes from sales orders — live from the ERP database."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" onClick={exportDeliveries}>
              <Printer className="mr-2 h-4 w-4" />
              Export XLSX
            </Button>
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
                toast.info("Create delivery notes from Sales → Orders after confirming the order.");
              }}
            >
              <Truck className="mr-2 h-4 w-4" />
              New delivery (via Sales)
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
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
        contextKey={`${q}-${status}-${sort}-${deliveries.length}`}
        context={{ q, status, sort, deliveries: paged }}
        className="mb-4"
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Route plan (Nairobi zones / upcountry)</div>
          <div className="flex flex-wrap gap-2">
            {routeHints.map((route) => (
              <Badge key={route} variant="outline">
                {route}
              </Badge>
            ))}
          </div>
          {redeliveryTasks.length > 0 && (
            <div className="mt-3 text-sm text-amber-700 dark:text-amber-400">
              {redeliveryTasks.length} open re-delivery task(s) — schedule from the actions column.
            </div>
          )}
          <div className="mt-3 text-xs text-muted-foreground">
            Delivery notes link to sales orders. Assign drivers and record mileage per trip.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchBar
              value={q}
              onChange={(value) => {
                setQ(value);
                setPage(1);
              }}
              placeholder="Search delivery, order, or customer..."
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {["Pending", "Delivered", "Failed"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
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
                <TableHead>Warehouse</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Zone</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>POD</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.deliveryNo}</TableCell>
                  <TableCell className="font-mono text-xs">{d.orderNo}</TableCell>
                  <TableCell className="font-medium">{d.customer}</TableCell>
                  <TableCell className="text-xs">
                    <MapPin className="mr-1 inline h-3 w-3 text-muted-foreground" />
                    {d.warehouse}
                  </TableCell>
                  <TableCell>{fmtDate(d.date)}</TableCell>
                  <TableCell className="text-xs">{d.deliveryZone || "—"}</TableCell>
                  <TableCell className="text-xs">{d.driverName || "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={d.status} />
                  </TableCell>
                  <TableCell>
                    {d.hasPodPhoto || d.podSignature ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          toast.success(d.podSignature ? `Signed by: ${d.podSignature}` : "POD photo on file");
                        }}
                      >
                        View POD
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openPodUpload(d)}>
                        <Upload className="mr-1 h-3 w-3" />
                        Upload
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        if (!token) return;
                        void downloadDeliveryNotePdf(token, d.deliveryNo);
                      }}
                    >
                      PDF
                    </Button>
                    {drivers[0] && d.status !== "Failed" && (
                      <Select
                        onValueChange={(driverId) => {
                          if (!token) return;
                          void assignDeliveryDriver(token, d.id, {
                            driver_id: driverId,
                            vehicle_id: vehicles[0]?.id ? String(vehicles[0].id) : undefined,
                          })
                            .then(() => {
                              toast.success("Driver assigned");
                              load();
                            })
                            .catch((e) => toast.error(e instanceof Error ? e.message : "Assign failed"));
                        }}
                      >
                        <SelectTrigger className="h-7 w-[100px]">
                          <SelectValue placeholder="Driver" />
                        </SelectTrigger>
                        <SelectContent>
                          {drivers.map((dr) => (
                            <SelectItem key={String(dr.id)} value={String(dr.id)}>
                              {String(dr.first_name)} {String(dr.last_name)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {d.status !== "Failed" && d.status !== "Delivered" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive"
                        onClick={() => {
                          if (!token) return;
                          void failDelivery(token, d.id, "Customer unavailable")
                            .then(() => {
                              toast.success("Failed — re-delivery task created");
                              load();
                              void fetchRedeliveryTasks(token).then(setRedeliveryTasks);
                            })
                            .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"));
                        }}
                      >
                        Fail
                      </Button>
                    )}
                    {vehicles[0] && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          if (!token) return;
                          void recordTripMileage(token, {
                            vehicle_id: String(vehicles[0].id),
                            delivery_id: d.id,
                            distance_km: 12,
                            route_zone: d.deliveryZone,
                          })
                            .then(() => toast.success("Mileage logged"))
                            .catch((e) => toast.error(e instanceof Error ? e.message : "Mileage failed"));
                        }}
                      >
                        Mileage
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {loading && paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    Loading deliveries…
                  </TableCell>
                </TableRow>
              )}
              {!loading && paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                    No deliveries match your filters. Create a delivery note from a sales order.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <ListPagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Dialog open={podOpen} onOpenChange={setPodOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proof of Delivery</DialogTitle>
            <DialogDescription>
              {podTarget ? `${podTarget.deliveryNo} · ${podTarget.customer}` : "Capture delivery confirmation"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Recipient signature / name</Label>
              <Input value={podSignature} onChange={(e) => setPodSignature(e.target.value)} placeholder="Signed by…" />
            </div>
            <div className="space-y-1.5">
              <Label>Photo (optional)</Label>
              <input
                ref={podFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 800_000) {
                    toast.error("Image must be under 800KB");
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => setPodPhotoData(String(reader.result));
                  reader.readAsDataURL(file);
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => podFileRef.current?.click()}>
                Choose image
              </Button>
              {podPhotoData && <p className="text-xs text-muted-foreground">Photo attached</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPodOpen(false)}>Cancel</Button>
            <Button onClick={() => void submitPod()} disabled={podSaving}>
              {podSaving ? "Saving…" : "Save POD"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
