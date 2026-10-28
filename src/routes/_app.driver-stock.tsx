import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, PackageCheck, Plus, RefreshCw, Truck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import {
  v1Api,
  type DriverStockRow,
  type FleetLocation,
  type FleetStocktake,
  type FleetStocktakeDetail,
} from "@/lib/api-v1";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/driver-stock")({
  component: DriverStockPage,
  head: () => ({ meta: [{ title: "Driver Stock & Counts - Ayawin Stock Solution" }] }),
});

type DriverUser = { id: string; full_name: string; email: string };
type StockItemOption = { id: string; item_code: string; name: string };

function DriverStockPage() {
  const { token, user } = useAuth();
  const [locations, setLocations] = useState<FleetLocation[]>([]);
  const [vehicleStock, setVehicleStock] = useState<DriverStockRow[]>([]);
  const [items, setItems] = useState<StockItemOption[]>([]);
  const [drivers, setDrivers] = useState<DriverUser[]>([]);
  const [counts, setCounts] = useState<FleetStocktake[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState<FleetStocktakeDetail | null>(null);
  const [draftCounts, setDraftCounts] = useState<Record<string, string>>({});
  const [countNote, setCountNote] = useState("");
  const [vehicleForm, setVehicleForm] = useState({
    code: "",
    name: "",
    vehicle_registration: "",
    assigned_driver_user_id: "",
  });
  const [loadForm, setLoadForm] = useState({
    from_warehouse_id: "",
    to_vehicle_id: "",
    item_id: "",
    quantity: "",
  });
  const [countLocationId, setCountLocationId] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  const canLoad = user?.permissions?.includes("fleet.load") || user?.role === "Admin";
  const canCount = user?.permissions?.includes("fleet.count") || user?.role === "Admin";
  const canApprove = user?.permissions?.includes("fleet.approve") || user?.role === "Admin";
  const isDriver = String(user?.role || "")
    .toLowerCase()
    .includes("driver");
  const warehouses = useMemo(
    () => locations.filter((location) => location.location_type === "warehouse"),
    [locations],
  );
  const vehicles = useMemo(
    () => locations.filter((location) => location.location_type === "vehicle"),
    [locations],
  );

  const loadWorkspace = async () => {
    if (!token || token.startsWith("demo:")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextLocations, nextCounts, nextVehicleStock] = await Promise.all([
        v1Api.inventory.fleetLocations(token),
        v1Api.inventory.stocktakes(token),
        v1Api.inventory.fleetVehicleStock(token),
      ]);
      setLocations(nextLocations);
      setCounts(nextCounts);
      setVehicleStock(nextVehicleStock);
      const catalog = await v1Api.inventory.fleetItems(token);
      setItems(
        catalog.map((row) => ({
          id: String(row.id),
          item_code: String(row.item_code),
          name: String(row.name),
        })),
      );
      if (canLoad) setDrivers(await v1Api.inventory.fleetDrivers(token));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load driver stock workspace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, [token]);

  const createVehicle = async () => {
    if (!token) return;
    if (
      !vehicleForm.code.trim() ||
      !vehicleForm.name.trim() ||
      !vehicleForm.vehicle_registration.trim() ||
      !vehicleForm.assigned_driver_user_id
    ) {
      toast.error("Enter a vehicle code, name, registration and assigned driver");
      return;
    }
    setSaving(true);
    try {
      await v1Api.inventory.createVehicleLocation(token, vehicleForm);
      setVehicleForm({ code: "", name: "", vehicle_registration: "", assigned_driver_user_id: "" });
      toast.success("Vehicle added as a stock location");
      await loadWorkspace();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create vehicle");
    } finally {
      setSaving(false);
    }
  };

  const loadVehicle = async () => {
    if (!token) return;
    const quantity = Number(loadForm.quantity);
    if (
      !loadForm.from_warehouse_id ||
      !loadForm.to_vehicle_id ||
      !loadForm.item_id ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      toast.error("Choose a source warehouse, vehicle, product and positive quantity");
      return;
    }
    setSaving(true);
    try {
      const transfer = await v1Api.inventory.dispatchTransfer(token, {
        from_warehouse_id: loadForm.from_warehouse_id,
        to_warehouse_id: loadForm.to_vehicle_id,
        lines: [{ item_id: loadForm.item_id, quantity }],
        notes: `Driver vehicle load: ${vehicles.find((vehicle) => vehicle.id === loadForm.to_vehicle_id)?.vehicle_registration || "vehicle"}`,
      });
      toast.success(`Vehicle stock loaded · ${transfer.transfer_no}`);
      setLoadForm((form) => ({ ...form, quantity: "" }));
      await loadWorkspace();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Vehicle load failed");
    } finally {
      setSaving(false);
    }
  };

  const startCount = async (warehouseId: string) => {
    if (!token || !warehouseId) {
      toast.error("Choose a stock location");
      return;
    }
    setSaving(true);
    try {
      const started = await v1Api.inventory.startStocktake(
        token,
        warehouseId,
        "Physical stock count",
      );
      const detail = await v1Api.inventory.stocktake(token, started.id);
      setDraftCounts(Object.fromEntries(detail.lines.map((line) => [line.id, ""])));
      setCountNote("");
      setSession(detail);
      setCountLocationId(warehouseId);
      await loadWorkspace();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start stock count");
    } finally {
      setSaving(false);
    }
  };

  const openCount = async (count: FleetStocktake) => {
    if (!token) return;
    setSaving(true);
    try {
      const detail = await v1Api.inventory.stocktake(token, count.id);
      setSession(detail);
      setReviewNote("");
      setDraftCounts(
        Object.fromEntries(
          detail.lines.map((line) => [
            line.id,
            line.counted_quantity == null ? "" : String(line.counted_quantity),
          ]),
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open stock count");
    } finally {
      setSaving(false);
    }
  };

  const submitCount = async () => {
    if (!token || !session) return;
    const missing = session.lines.find((line) => !draftCounts[line.id]?.trim());
    if (missing) {
      toast.error(`Enter a count for ${missing.item_code}; use 0 when none is on hand`);
      return;
    }
    setSaving(true);
    try {
      await v1Api.inventory.submitStocktake(
        token,
        session.id,
        session.lines.map((line) => ({
          line_id: line.id,
          counted_quantity: Number(draftCounts[line.id]),
          notes: countNote.trim() || undefined,
        })),
      );
      toast.success("Count submitted for supervisor review");
      setSession(null);
      await loadWorkspace();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit count");
    } finally {
      setSaving(false);
    }
  };

  const reviewCount = async (decision: "approve" | "reject") => {
    if (!token || !session) return;
    setSaving(true);
    try {
      const result = await v1Api.inventory.reviewStocktake(
        token,
        session.id,
        decision,
        reviewNote.trim() || undefined,
      );
      if (result.status === "recount_required") {
        toast.error(result.review_note || "Stock moved since count began. Start a fresh count.");
      } else {
        toast.success(
          decision === "approve"
            ? "Count approved; variances posted to the stock ledger"
            : "Count rejected without stock movement",
        );
      }
      setSession(null);
      await loadWorkspace();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to review stock count");
    } finally {
      setSaving(false);
    }
  };

  const statusVariant = (status: string) =>
    status === "posted"
      ? "default"
      : status === "submitted" || status === "recount_required"
        ? "destructive"
        : "outline";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Driver & Warehouse Stock"
        description="Load stock from a warehouse to a driver’s vehicle, count it blind, then route any variance to a supervisor before posting."
        actions={
          <Button variant="outline" onClick={() => void loadWorkspace()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {!isDriver && canLoad && (
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary/10 p-2 text-primary">
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold">Register a vehicle stock location</h2>
                  <p className="text-sm text-muted-foreground">
                    Each vehicle keeps its own stock balance in the warehouse ledger.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Location code</Label>
                  <Input
                    value={vehicleForm.code}
                    onChange={(e) => setVehicleForm((form) => ({ ...form, code: e.target.value }))}
                    placeholder="VAN-01"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Vehicle name</Label>
                  <Input
                    value={vehicleForm.name}
                    onChange={(e) => setVehicleForm((form) => ({ ...form, name: e.target.value }))}
                    placeholder="Nairobi delivery van 1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Registration</Label>
                  <Input
                    value={vehicleForm.vehicle_registration}
                    onChange={(e) =>
                      setVehicleForm((form) => ({ ...form, vehicle_registration: e.target.value }))
                    }
                    placeholder="KDA 123A"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Assigned driver</Label>
                  <Select
                    value={vehicleForm.assigned_driver_user_id}
                    onValueChange={(value) =>
                      setVehicleForm((form) => ({ ...form, assigned_driver_user_id: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select driver" />
                    </SelectTrigger>
                    <SelectContent>
                      {drivers.map((driver) => (
                        <SelectItem key={driver.id} value={driver.id}>
                          {driver.full_name} · {driver.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                onClick={() => void createVehicle()}
                disabled={saving || drivers.length === 0}
              >
                <Plus className="mr-2 h-4 w-4" />
                Create vehicle location
              </Button>
              {drivers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Create an active user with the Driver role before assigning a vehicle.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {!isDriver && canLoad && (
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-700">
                  <PackageCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold">Load a delivery vehicle</h2>
                  <p className="text-sm text-muted-foreground">
                    Posting the load transfers stock out of the warehouse and into the vehicle
                    location.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>From warehouse</Label>
                  <Select
                    value={loadForm.from_warehouse_id}
                    onValueChange={(value) =>
                      setLoadForm((form) => ({ ...form, from_warehouse_id: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Source warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Driver vehicle</Label>
                  <Select
                    value={loadForm.to_vehicle_id}
                    onValueChange={(value) =>
                      setLoadForm((form) => ({ ...form, to_vehicle_id: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Vehicle" />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicles.map((vehicle) => (
                        <SelectItem key={vehicle.id} value={vehicle.id}>
                          {vehicle.vehicle_registration} · {vehicle.driver_name || vehicle.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Product</Label>
                  <Select
                    value={loadForm.item_id}
                    onValueChange={(value) => setLoadForm((form) => ({ ...form, item_id: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Product" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.item_code} · {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={loadForm.quantity}
                    onChange={(e) => setLoadForm((form) => ({ ...form, quantity: e.target.value }))}
                    placeholder="Cases / base units"
                  />
                </div>
              </div>
              <Button
                onClick={() => void loadVehicle()}
                disabled={saving || vehicles.length === 0 || warehouses.length === 0}
              >
                <Truck className="mr-2 h-4 w-4" />
                Post vehicle load
              </Button>
            </CardContent>
          </Card>
        )}

        {isDriver && (
          <Card className="xl:col-span-2">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <h2 className="font-semibold">My vehicle stock</h2>
                <p className="text-sm text-muted-foreground">
                  Your stock location is assigned by the warehouse manager. Count the physical
                  products before submitting your route close.
                </p>
              </div>
              <Badge variant="outline">
                {vehicles.length} assigned vehicle{vehicles.length === 1 ? "" : "s"}
              </Badge>
            </CardContent>
          </Card>
        )}

        <Card className="xl:col-span-2">
          <CardContent className="p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold">Vehicle and warehouse locations</h2>
                <p className="text-sm text-muted-foreground">
                  Deliveries should be dispatched from the vehicle that carries the stock.
                </p>
              </div>
              {canCount && (
                <div className="flex w-full gap-2 sm:w-auto">
                  <Select value={countLocationId} onValueChange={setCountLocationId}>
                    <SelectTrigger className="min-w-52">
                      <SelectValue placeholder="Choose location to count" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.location_type === "vehicle" ? "Vehicle · " : "Warehouse · "}
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => void startCount(countLocationId)}
                    disabled={saving || !countLocationId}
                  >
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Start physical count
                  </Button>
                </div>
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Location</TableHead>
                  <TableHead>Code / registration</TableHead>
                  <TableHead>Assigned driver</TableHead>
                  <TableHead>Location type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((location) => (
                  <TableRow key={location.id}>
                    <TableCell className="font-medium">{location.name}</TableCell>
                    <TableCell>{location.vehicle_registration || location.code}</TableCell>
                    <TableCell>{location.driver_name || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{location.location_type}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && locations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      No stock locations are assigned to this account.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardContent className="p-5">
            <div className="mb-4">
              <h2 className="font-semibold">Stock currently on vehicles</h2>
              <p className="text-sm text-muted-foreground">
                This is the system balance by vehicle; use a physical count to record what is
                actually on the vehicle.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">System quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicleStock
                  .filter((row) => Number(row.quantity) !== 0)
                  .map((row) => (
                    <TableRow key={`${row.warehouse_id}-${row.item_id}`}>
                      <TableCell>{row.vehicle_registration || row.vehicle_name}</TableCell>
                      <TableCell className="font-mono text-xs">{row.item_code}</TableCell>
                      <TableCell>{row.item_name}</TableCell>
                      <TableCell>{row.uom_code || "—"}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {Number(row.quantity)}
                      </TableCell>
                    </TableRow>
                  ))}
                {!loading &&
                  vehicleStock.filter((row) => Number(row.quantity) !== 0).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No stock is currently recorded on assigned vehicles.
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardContent className="p-5">
            <div className="mb-4">
              <h2 className="font-semibold">Physical count sessions</h2>
              <p className="text-sm text-muted-foreground">
                Blind entry protects the count. The expected balance and variance are revealed to
                reviewers after submission.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Count</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Variance lines</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {counts.map((count) => (
                  <TableRow key={count.id}>
                    <TableCell className="font-mono text-xs">{count.count_no}</TableCell>
                    <TableCell>{count.location_name}</TableCell>
                    <TableCell>{new Date(count.created_at).toLocaleString()}</TableCell>
                    <TableCell>{count.line_count || 0}</TableCell>
                    <TableCell>
                      {count.status === "counting"
                        ? "Hidden until submitted"
                        : (count.variance_count ?? 0)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(count.status)}>
                        {count.status.replaceAll("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {count.status === "counting" && canCount && (
                        <Button size="sm" variant="outline" onClick={() => void openCount(count)}>
                          Enter count
                        </Button>
                      )}
                      {count.status === "submitted" && canApprove && (
                        <Button size="sm" onClick={() => void openCount(count)}>
                          Review
                        </Button>
                      )}
                      {count.status === "recount_required" && (
                        <span className="text-xs text-muted-foreground">Recount required</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && counts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      No stock counts yet. Start a count for a warehouse or a driver vehicle.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={Boolean(session)}
        onOpenChange={(open) => {
          if (!open && !saving) setSession(null);
        }}
      >
        <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col">
          <DialogHeader>
            <DialogTitle>
              {session?.count_no} · {session?.location_name}
            </DialogTitle>
            <DialogDescription>
              {session?.status === "counting"
                ? "Count what is physically present. Expected stock is hidden until you submit."
                : "Compare the submitted physical quantities with the frozen expected snapshot."}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  {session?.status !== "counting" && canApprove && (
                    <TableHead className="text-right">Expected</TableHead>
                  )}
                  <TableHead className="text-right">Physical count</TableHead>
                  {session?.status !== "counting" && canApprove && (
                    <TableHead className="text-right">Variance</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {session?.lines.map((line) => {
                  const variance =
                    Number(line.counted_quantity || 0) - Number(line.expected_quantity || 0);
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="font-mono text-xs">{line.item_code}</TableCell>
                      <TableCell>{line.item_name}</TableCell>
                      {session.status !== "counting" && canApprove && (
                        <TableCell className="text-right">{line.expected_quantity}</TableCell>
                      )}
                      <TableCell className="text-right">
                        {session.status === "counting" && canCount ? (
                          <Input
                            aria-label={`Physical count ${line.item_code}`}
                            className="ml-auto w-32 text-right"
                            type="number"
                            min="0"
                            step="any"
                            value={draftCounts[line.id] ?? ""}
                            onChange={(e) =>
                              setDraftCounts((draft) => ({ ...draft, [line.id]: e.target.value }))
                            }
                          />
                        ) : (
                          line.counted_quantity
                        )}
                        {line.uom_code && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {line.uom_code}
                          </span>
                        )}
                      </TableCell>
                      {session.status !== "counting" && canApprove && (
                        <TableCell
                          className={`text-right font-semibold ${variance < 0 ? "text-destructive" : variance > 0 ? "text-emerald-700" : ""}`}
                        >
                          {variance > 0 ? "+" : ""}
                          {variance}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {session?.status === "counting" && (
            <div className="space-y-1.5">
              <Label>Count notes (optional)</Label>
              <Input
                value={countNote}
                onChange={(e) => setCountNote(e.target.value)}
                placeholder="Seal number, recount note, or count context"
              />
            </div>
          )}
          {session?.status === "submitted" && canApprove && (
            <div className="space-y-1.5">
              <Label>Review note</Label>
              <Input
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Required for rejection; optional for approval"
              />
            </div>
          )}
          {session?.status === "recount_required" && (
            <div className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-900">
              {session.review_note ||
                "Stock moved after the count started. Start a fresh count; no variances were posted."}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSession(null)} disabled={saving}>
              Close
            </Button>
            {session?.status === "counting" && canCount && (
              <Button onClick={() => void submitCount()} disabled={saving}>
                Submit for review
              </Button>
            )}
            {session?.status === "submitted" && canApprove && (
              <>
                <Button
                  variant="outline"
                  onClick={() => void reviewCount("reject")}
                  disabled={saving}
                >
                  Reject / recount
                </Button>
                <Button onClick={() => void reviewCount("approve")} disabled={saving}>
                  Approve and post variances
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
