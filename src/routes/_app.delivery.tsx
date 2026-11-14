import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { AttachmentPanel } from "@/components/AttachmentPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Truck, MapPin, Upload, ArrowUpDown, Printer } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { Badge } from "@/components/ui/badge";
import { exportWorkbook } from "@/lib/excel";
import { trackEvent } from "@/lib/event-tracker";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { v1Api } from "@/lib/api-v1";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import { useAction, useList } from "@/lib/queryHooks";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useUrlSearchParam } from "@/lib/urlSearchState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/delivery")({
  component: DeliveryPage,
  head: () => ({ meta: [{ title: "Delivery & Logistics - Ayawin Stock Solution" }] }),
});

function DeliveryPage() {
  const { token, user } = useAuth();
  type ProofLine = {
    delivery_line_id: string;
    item_id: string;
    item_name: string;
    quantity: number;
    delivered_quantity: number;
    short_quantity: number;
    damaged_quantity: number;
    customer_accepted_quantity: number;
  };
  type ProofRecord = {
    id: string;
    delivery_no: string;
    order_no: string;
    customer_name: string;
    status: string;
    route_code?: string | null;
    proof_status: string;
    customer_confirmed: boolean;
    proof_note?: string | null;
    lines: ProofLine[];
    attachments: Array<{
      id: string;
      file_name: string;
      content_type: string;
      byte_size: number;
      sha256: string;
      created_at: string;
    }>;
  };
  const [proofRecord, setProofRecord] = useState<ProofRecord | null>(null);
  const [proofLines, setProofLines] = useState<ProofLine[]>([]);
  const [proofNote, setProofNote] = useState("");
  const [routeCode, setRouteCode] = useState("");
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [proofLoading, setProofLoading] = useState(false);
  const [proofSaving, setProofSaving] = useState(false);
  const [attachmentSaving, setAttachmentSaving] = useState(false);
  const deliveriesQuery = useList(
    queryKeys.deliveries.list(user?.id),
    async ({ signal }) =>
      (await v1Api.sales.deliveries(token!, signal)).map((row) => ({
        ...row,
        id: String(row.id),
        delivery_no: String(row.delivery_no || row.id),
        order_no: row.order_no ? String(row.order_no) : undefined,
        delivery_date: row.delivery_date ? String(row.delivery_date).slice(0, 10) : undefined,
        status: row.status ? String(row.status) : undefined,
        driver_name: row.driver_name ? String(row.driver_name) : null,
        vehicle_no: row.vehicle_no ? String(row.vehicle_no) : null,
        route: row.route ? String(row.route) : null,
      })),
    { enabled: Boolean(token) },
  );
  const deliveries = deliveriesQuery.data ?? [];
  const loading = deliveriesQuery.isPending || deliveriesQuery.isFetching;
  const saveProofAction = useAction({
    mutationFn: (input: { deliveryId: string; body: Record<string, unknown> }) =>
      v1Api.sales.recordDeliveryProof(token!, input.deliveryId, input.body),
    invalidate: [queryKeys.deliveries.list(user?.id)],
  });
  const [q, setQ] = useUrlSearchParam("q");
  const [status, setStatus] = useUrlSearchParam("status", "all");
  const [sort, setSort] = useUrlSearchParam("sort", "date");
  const [pageText, setPageText] = useUrlSearchParam("page", "1");
  const page = Math.max(1, Number(pageText) || 1);
  const setPage = (next: number) => setPageText(String(next));
  const pageSize = 5;
  const filtered = deliveries
    .filter(
      (d) =>
        (status === "all" || d.status === status) &&
        `${d.delivery_no} ${d.order_no || ""}`.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === "status") return String(a.status).localeCompare(String(b.status));
      return String(b.delivery_date || "").localeCompare(String(a.delivery_date || ""));
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const routeHints = Array.from(
    new Set(deliveries.map((delivery) => delivery.route).filter(Boolean)),
  ).slice(0, 3) as string[];
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const activeDeliveries = deliveries.filter(
    (delivery) =>
      !["delivered", "cancelled", "failed"].includes(String(delivery.status).toLowerCase()),
  );
  const deliveryMetrics = [
    {
      label: "In Transit",
      value: deliveries.filter((delivery) => String(delivery.status).toLowerCase() === "in transit")
        .length,
    },
    {
      label: "Delivered Today",
      value: deliveries.filter(
        (delivery) =>
          String(delivery.status).toLowerCase() === "delivered" &&
          delivery.delivery_date === todayKey,
      ).length,
    },
    {
      label: "Pending",
      value: deliveries.filter((delivery) =>
        ["pending", "draft"].includes(String(delivery.status).toLowerCase()),
      ).length,
    },
    {
      label: "Active Vehicles",
      value: new Set(activeDeliveries.map((delivery) => delivery.vehicle_no).filter(Boolean)).size,
    },
  ];
  const exportDeliveries = () => {
    void trackEvent({
      action: "delivery_export_xlsx",
      entityType: "report",
      entityId: "delivery",
      details: { rows: filtered.length },
      scenario: "delivery",
      context: { q, status, sort, rows: filtered.length },
    });
    exportWorkbook("ayawin-stock-solution-deliveries.xlsx", [
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

  const openProof = async (delivery: (typeof deliveries)[number]) => {
    if (!token) return;
    setProofLoading(true);
    try {
      const record = await v1Api.sales.deliveryProof(token, delivery.id);
      setProofRecord(record);
      setProofLines(
        record.lines.map((line) => ({
          ...line,
          delivered_quantity: Number(line.delivered_quantity || line.quantity),
          short_quantity: Number(line.short_quantity || 0),
          damaged_quantity: Number(line.damaged_quantity || 0),
          customer_accepted_quantity: Number(line.customer_accepted_quantity || line.quantity),
        })),
      );
      setProofNote(record.proof_note || "");
      setRouteCode(record.route_code || delivery.route || "");
      setCustomerConfirmed(Boolean(record.customer_confirmed));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load delivery proof");
    } finally {
      setProofLoading(false);
    }
  };

  const saveProof = async () => {
    if (!token || !proofRecord) return;
    setProofSaving(true);
    try {
      await saveProofAction.mutateAsync({
        deliveryId: proofRecord.id,
        body: {
          route_code: routeCode.trim() || undefined,
          customer_confirmed: customerConfirmed,
          delivered_at: customerConfirmed ? new Date().toISOString() : undefined,
          proof_note: proofNote.trim() || undefined,
          lines: proofLines.map(
            ({
              delivery_line_id,
              delivered_quantity,
              short_quantity,
              damaged_quantity,
              customer_accepted_quantity,
            }) => ({
              delivery_line_id,
              delivered_quantity,
              short_quantity,
              damaged_quantity,
              customer_accepted_quantity,
            }),
          ),
        },
      });
      toast.success("Delivery proof recorded");
      setProofRecord(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to record delivery proof");
    } finally {
      setProofSaving(false);
    }
  };

  const uploadProofAttachment = async (file?: File) => {
    if (!token || !proofRecord || !file) return;
    setAttachmentSaving(true);
    try {
      await v1Api.sales.uploadDeliveryProofAttachment(token, proofRecord.id, file);
      const refreshed = await v1Api.sales.deliveryProof(token, proofRecord.id);
      setProofRecord(refreshed);
      toast.success("Proof attachment saved securely");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save proof attachment");
    } finally {
      setAttachmentSaving(false);
    }
  };

  const downloadProofAttachment = async (
    attachment: NonNullable<ProofRecord["attachments"]>[number],
  ) => {
    if (!token || !proofRecord) return;
    try {
      const blob = await v1Api.sales.downloadDeliveryProofAttachment(
        token,
        proofRecord.id,
        attachment.id,
      );
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = attachment.file_name;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to download proof attachment");
    }
  };

  return (
    <div>
      <PageHeader
        title="Delivery & Logistics"
        description="Delivery dispatch, route details and customer proof of delivery."
        actions={
          <>
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
              }}
            >
              <Truck className="mr-2 h-4 w-4" />
              Schedule Delivery
            </Button>
          </>
        }
      />

      {deliveriesQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {deliveriesQuery.error.message}{" "}
          <Button variant="ghost" size="sm" onClick={() => void deliveriesQuery.refetch()}>
            Retry
          </Button>
        </p>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {deliveryMetrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {metric.label}
              </div>
              <div className="mt-1 text-2xl font-bold">{loading ? "—" : metric.value}</div>
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
          <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Route sequence
          </div>
          <div className="flex flex-wrap gap-2">
            {routeHints.map((route) => (
              <Badge key={route} variant="outline" className="">
                {route}
              </Badge>
            ))}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            Delivery batches are grouped by geography so dispatch can accept or rearrange the
            sequence.
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
              placeholder="Search delivery or customer..."
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {["Pending", "In Transit", "Delivered", "Failed"].map((s) => (
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
                <TableHead>Driver / Vehicle</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>POD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Loading live deliveries…
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((d) => (
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
                          onClick={() => void openProof(d)}
                        >
                          View
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => void openProof(d)}
                        >
                          <Upload className="mr-1 h-3 w-3" />
                          Record proof
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
              {paged.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No deliveries match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <ListPagination
            page={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(proofRecord) || proofLoading}
        onOpenChange={(open) => {
          if (!open && !proofSaving) setProofRecord(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Proof of delivery</DialogTitle>
            <DialogDescription>
              {proofRecord
                ? `${proofRecord.delivery_no} · ${proofRecord.customer_name} · Order ${proofRecord.order_no}`
                : "Loading delivery details…"}
            </DialogDescription>
          </DialogHeader>
          {proofRecord && (
            <div className="grid gap-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  Route code
                  <Input value={routeCode} onChange={(event) => setRouteCode(event.target.value)} />
                </label>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={customerConfirmed}
                    onChange={(event) => setCustomerConfirmed(event.target.checked)}
                  />
                  Customer confirmed receipt
                </label>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Delivered</TableHead>
                      <TableHead>Short</TableHead>
                      <TableHead>Damaged</TableHead>
                      <TableHead>Accepted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proofLines.map((line, index) => (
                      <TableRow key={line.delivery_line_id}>
                        <TableCell className="min-w-36">{line.item_name}</TableCell>
                        <TableCell>{line.quantity}</TableCell>
                        {(
                          [
                            "delivered_quantity",
                            "short_quantity",
                            "damaged_quantity",
                            "customer_accepted_quantity",
                          ] as const
                        ).map((field) => (
                          <TableCell key={field} className="min-w-24">
                            <Input
                              aria-label={`${line.item_name} ${field.replaceAll("_", " ")}`}
                              type="number"
                              min="0"
                              max={line.quantity}
                              step="0.01"
                              value={line[field]}
                              onChange={(event) => {
                                const value = Number(event.target.value);
                                setProofLines((current) =>
                                  current.map((entry, row) =>
                                    row === index
                                      ? { ...entry, [field]: Number.isFinite(value) ? value : 0 }
                                      : entry,
                                  ),
                                );
                              }}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <label className="grid gap-1 text-sm">
                Delivery notes / discrepancy details
                <Textarea
                  value={proofNote}
                  onChange={(event) => setProofNote(event.target.value)}
                  placeholder="Record shortages, damages or customer comments"
                />
              </label>
              <AttachmentPanel
                title="Signed documents and delivery photos"
                description="JPEG, PNG, WebP or PDF · up to 5 MB each · maximum 10 files per delivery"
                attachments={proofRecord.attachments}
                uploading={attachmentSaving}
                onUpload={(file) => void uploadProofAttachment(file)}
                onDownload={(attachment) => void downloadProofAttachment(attachment)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProofRecord(null)} disabled={proofSaving}>
              Close
            </Button>
            {proofRecord && (
              <Button onClick={() => void saveProof()} disabled={proofSaving}>
                {proofSaving ? "Saving…" : "Save proof"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
