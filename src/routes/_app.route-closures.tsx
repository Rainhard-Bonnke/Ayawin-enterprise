import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardCheck, RefreshCw, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { v1Api, type RouteClosureRecord } from "@/lib/api-v1";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/route-closures")({
  component: RouteClosuresPage,
  head: () => ({ meta: [{ title: "Route Closures - Ayawin Stock Solution" }] }),
});

type DriverOption = { id: string; full_name: string; email: string };
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: string | number | undefined) =>
  `KES ${Number(value || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function RouteClosuresPage() {
  const { token, user } = useAuth();
  const permissions = user?.permissions || [];
  const isAdmin = user?.role === "Admin";
  const isDriver = String(user?.role || "")
    .toLowerCase()
    .includes("driver");
  const canSubmit =
    isAdmin || permissions.includes("fleet.count") || permissions.includes("sales.create");
  const canReview =
    isAdmin || permissions.includes("fleet.approve") || permissions.includes("sales.approve");
  const canChooseDriver = !isDriver && (isAdmin || permissions.includes("fleet.load"));
  const [closures, setClosures] = useState<RouteClosureRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [routeCode, setRouteCode] = useState("");
  const [routeDate, setRouteDate] = useState(today());
  const [driverId, setDriverId] = useState(user?.id || "");
  const [declaredCollection, setDeclaredCollection] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const loadWorkspace = useCallback(async () => {
    if (!token || token.startsWith("demo:")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextClosures, nextDrivers] = await Promise.all([
        v1Api.sales.routeClosures(token, { route_date: routeDate }),
        canChooseDriver ? v1Api.sales.routeDrivers(token).catch(() => []) : Promise.resolve([]),
      ]);
      setClosures(nextClosures);
      setDrivers(nextDrivers);
      if (!driverId && isDriver && user?.id) setDriverId(user.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load route closures");
    } finally {
      setLoading(false);
    }
  }, [token, routeDate, canChooseDriver, driverId, isDriver, user?.id]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const submitClose = async () => {
    if (!token) return;
    const amount = Number(declaredCollection);
    if (!routeCode.trim() || !driverId || !Number.isFinite(amount) || amount < 0) {
      toast.error("Enter a route, driver and valid declared collection");
      return;
    }
    setSaving(true);
    try {
      await v1Api.sales.submitRouteClosure(token, {
        route_code: routeCode.trim(),
        route_date: routeDate,
        driver_user_id: isDriver ? user?.id || "" : driverId,
        declared_collection: amount,
        note: closeNote.trim() || undefined,
      });
      toast.success("Route close submitted for review");
      setDeclaredCollection("");
      setCloseNote("");
      await loadWorkspace();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit route close");
    } finally {
      setSaving(false);
    }
  };

  const review = async (closure: RouteClosureRecord, decision: "approve" | "reject") => {
    if (!token) return;
    setSaving(true);
    try {
      await v1Api.sales.reviewRouteClosure(
        token,
        closure.id,
        decision,
        reviewNotes[closure.id] || "",
      );
      toast.success(decision === "approve" ? "Route close approved" : "Route close rejected");
      setReviewNotes((current) => ({ ...current, [closure.id]: "" }));
      await loadWorkspace();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to review route close");
    } finally {
      setSaving(false);
    }
  };

  const submitted = closures.filter((closure) => closure.status === "submitted");
  const exceptions = submitted.filter(
    (closure) =>
      Number(closure.proof_pending_count) > 0 ||
      Number(closure.discrepancy_count) > 0 ||
      Math.abs(Number(closure.collection_variance)) > 0.005,
  );

  return (
    <div>
      <PageHeader
        title="Route closures"
        description="Reconcile customer proof, declared cash and posted receipts before closing a delivery route."
        actions={
          <Button variant="outline" onClick={() => void loadWorkspace()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="Route close summary">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase text-muted-foreground">Submitted</div>
            <div className="mt-1 text-2xl font-semibold">{submitted.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              Needs attention
            </div>
            <div className="mt-1 text-2xl font-semibold text-amber-700">{exceptions.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              Approved today
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {closures.filter((closure) => closure.status === "approved").length}
            </div>
          </CardContent>
        </Card>
      </section>

      {canSubmit && (
        <section className="mb-6 border-y border-border py-5">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Submit route close</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="route-code">Route</Label>
              <Input
                id="route-code"
                value={routeCode}
                onChange={(event) => setRouteCode(event.target.value)}
                placeholder="e.g. NAIROBI-WEST"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="route-date">Service date</Label>
              <Input
                id="route-date"
                type="date"
                value={routeDate}
                onChange={(event) => setRouteDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Driver</Label>
              {canChooseDriver ? (
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose driver" />
                  </SelectTrigger>
                  <SelectContent>
                    {drivers.map((driver) => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={user?.full_name || user?.username || "Signed-in driver"}
                  readOnly
                  aria-label="Assigned driver"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="declared-collection">Declared collection (KES)</Label>
              <Input
                id="declared-collection"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={declaredCollection}
                onChange={(event) => setDeclaredCollection(event.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="close-note">Handover note</Label>
              <Textarea
                id="close-note"
                value={closeNote}
                onChange={(event) => setCloseNote(event.target.value)}
                placeholder="Optional handover reference or exception context"
              />
            </div>
            <Button onClick={() => void submitClose()} disabled={saving || !canSubmit}>
              <ClipboardCheck className="mr-2 h-4 w-4" /> Submit for review
            </Button>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Route close register</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Submitted route totals are refreshed against current proof and posted receipt
              allocations during review.
            </p>
          </div>
          <div className="w-44 space-y-1">
            <Label htmlFor="register-date" className="text-xs">
              Service date
            </Label>
            <Input
              id="register-date"
              type="date"
              value={routeDate}
              onChange={(event) => setRouteDate(event.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Loading route closures…
          </div>
        ) : closures.length === 0 ? (
          <div className="border-y border-border py-12 text-center text-sm text-muted-foreground">
            No route closures for this service date.
          </div>
        ) : (
          <div className="overflow-x-auto border-y border-border">
            <table className="w-full min-w-245 text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 font-medium">Route / driver</th>
                  <th className="px-3 py-3 font-medium">Deliveries</th>
                  <th className="px-3 py-3 font-medium">Invoice value</th>
                  <th className="px-3 py-3 font-medium">Receipts matched</th>
                  <th className="px-3 py-3 font-medium">Declared cash</th>
                  <th className="px-3 py-3 font-medium">Variance</th>
                  <th className="px-3 py-3 font-medium">Exceptions</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Review</th>
                </tr>
              </thead>
              <tbody>
                {closures.map((closure) => {
                  const variance = Number(closure.collection_variance || 0);
                  const needsNote =
                    Math.abs(variance) > 0.005 || Number(closure.discrepancy_count) > 0;
                  const note = reviewNotes[closure.id] || "";
                  return (
                    <tr key={closure.id} className="border-t border-border align-top">
                      <td className="px-3 py-3">
                        <div className="font-semibold">{closure.route_code}</div>
                        <div className="text-xs text-muted-foreground">
                          {closure.driver_name || "Driver"}
                        </div>
                      </td>
                      <td className="px-3 py-3">{closure.delivery_count}</td>
                      <td className="px-3 py-3 tabular-nums">{money(closure.invoice_value)}</td>
                      <td className="px-3 py-3 tabular-nums">
                        {money(closure.matched_collection)}
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {money(closure.declared_collection)}
                      </td>
                      <td
                        className={`px-3 py-3 tabular-nums ${Math.abs(variance) > 0.005 ? "font-semibold text-amber-700" : ""}`}
                      >
                        {money(variance)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {Number(closure.proof_pending_count) > 0 && (
                            <Badge variant="outline">
                              {closure.proof_pending_count} proof pending
                            </Badge>
                          )}
                          {Number(closure.discrepancy_count) > 0 && (
                            <Badge variant="outline">
                              {closure.discrepancy_count} discrepancies
                            </Badge>
                          )}
                          {Math.abs(variance) > 0.005 && (
                            <Badge variant="outline">Cash variance</Badge>
                          )}
                          {!Number(closure.proof_pending_count) &&
                            !Number(closure.discrepancy_count) &&
                            Math.abs(variance) <= 0.005 && (
                              <span className="text-muted-foreground">None</span>
                            )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={closure.status} />
                      </td>
                      <td className="px-3 py-3">
                        {canReview && closure.status === "submitted" ? (
                          <div className="min-w-52 space-y-2">
                            <Textarea
                              aria-label={`Review note for ${closure.route_code}`}
                              value={note}
                              onChange={(event) =>
                                setReviewNotes((current) => ({
                                  ...current,
                                  [closure.id]: event.target.value,
                                }))
                              }
                              placeholder={
                                needsNote ? "Required to approve variance" : "Review note"
                              }
                              className="min-h-16"
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => void review(closure, "approve")}
                                disabled={
                                  saving ||
                                  Number(closure.proof_pending_count) > 0 ||
                                  (needsNote && !note.trim())
                                }
                              >
                                <Check className="mr-1 h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void review(closure, "reject")}
                                disabled={saving || !note.trim()}
                              >
                                <X className="mr-1 h-3.5 w-3.5" /> Reject
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {closure.review_note || closure.close_note || "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
