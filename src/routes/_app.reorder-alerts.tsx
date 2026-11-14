import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardPlus, RefreshCw, Save } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { v1Api } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";
import { useAction, useList } from "@/lib/queryHooks";
import { KES } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/reorder-alerts")({
  component: ReorderSuggestionsPage,
  head: () => ({ meta: [{ title: "Reorder Alerts - Ayawin Stock Solution" }] }),
});

type Suggestion = Record<string, unknown> & { item_id: string; warehouse_id: string };
const value = (row: Suggestion, key: string) => Number(row[key] || 0);

function ReorderSuggestionsPage() {
  const { token, user } = useAuth();
  const canEditMaster =
    user?.role === "Admin" || user?.permissions?.includes("master_data.edit") === true;
  const canCreateRequisition =
    user?.role === "Admin" || user?.permissions?.includes("procurement.create") === true;
  const suggestionQuery = useList(
    queryKeys.inventory.reorderAlerts(),
    async ({ signal }) => {
      const [suggestions, vendors] = await Promise.all([
        v1Api.inventory.reorderSuggestions(token!, 1000, signal),
        v1Api.master.vendors(token!, signal),
      ]);
      return { suggestions: suggestions as Suggestion[], vendors };
    },
    { enabled: Boolean(token) },
  );
  const suggestions = suggestionQuery.data?.suggestions ?? [];
  const vendors = suggestionQuery.data?.vendors ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const saveItem = useAction({
    mutationFn: (input: {
      id: string;
      preferred_vendor_id: string;
      supplier_lead_time_days: number;
      minimum_stock: number;
      maximum_stock: number | null;
    }) =>
      v1Api.master.updateItem(token!, input.id, {
        preferred_vendor_id: input.preferred_vendor_id,
        supplier_lead_time_days: input.supplier_lead_time_days,
        minimum_stock: input.minimum_stock,
        maximum_stock: input.maximum_stock,
      }),
    invalidate: [queryKeys.inventory.reorderAlerts()],
  });
  const createRequisition = useAction({
    mutationFn: (payload: Record<string, unknown>) =>
      v1Api.procurement.createPurchaseRequisition(token!, payload),
    invalidate: [queryKeys.procurement.purchaseRequisitions()],
  });
  const selectedRows = suggestions.filter((row) =>
    selected.includes(`${row.warehouse_id}:${row.item_id}`),
  );

  const createGroupedRequisitions = async () => {
    const groups = new Map<string, Suggestion[]>();
    for (const row of selectedRows) {
      const vendorId = String(row.preferred_vendor_id || "");
      if (!vendorId) {
        toast.error(
          `${String(row.item_code)} has no preferred supplier. Save one before creating a requisition.`,
        );
        return;
      }
      const groupKey = `${vendorId}:${row.warehouse_id}`;
      groups.set(groupKey, [...(groups.get(groupKey) || []), row]);
    }
    if (!groups.size) return toast.error("Select at least one replenishment suggestion.");
    let created = 0;
    for (const [groupKey, lines] of groups) {
      const vendorId = groupKey.split(":")[0];
      const leadTime = Math.max(...lines.map((line) => value(line, "supplier_lead_time_days")));
      const requiredDate = new Date();
      requiredDate.setDate(requiredDate.getDate() + leadTime);
      await createRequisition.mutateAsync({
        vendor_id: vendorId,
        required_date: requiredDate.toISOString().slice(0, 10),
        notes: `Generated from inventory reorder suggestions for ${lines[0].warehouse_name}`,
        lines: lines.map((line) => ({
          item_id: line.item_id,
          warehouse_id: line.warehouse_id,
          quantity: value(line, "suggested_quantity"),
          estimated_unit_cost: value(line, "estimated_unit_cost"),
        })),
      });
      created += 1;
    }
    toast.success(
      `${created} supplier-grouped purchase requisition${created === 1 ? "" : "s"} created`,
    );
    setSelected([]);
    await suggestionQuery.refetch();
  };

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Reorder suggestions"
        description="Suggested purchase quantities account for available stock, reservations, open purchase supply, recent usage and supplier lead time."
        actions={
          <Button
            variant="outline"
            disabled={suggestionQuery.isFetching}
            onClick={() => void suggestionQuery.refetch()}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${suggestionQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        }
      />
      {suggestionQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {suggestionQuery.error.message}
        </p>
      )}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="font-semibold">{suggestions.length} replenishment suggestions</div>
            <div className="text-sm text-muted-foreground">
              Select lines with a preferred supplier to draft one requisition per supplier.
            </div>
          </div>
          <Button
            disabled={!canCreateRequisition || !selectedRows.length || createRequisition.isPending}
            onClick={() => void createGroupedRequisitions()}
          >
            <ClipboardPlus className="mr-2 h-4 w-4" />
            {createRequisition.isPending
              ? "Creating…"
              : `Create grouped requisitions${selectedRows.length ? ` · ${selectedRows.length}` : ""}`}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="overflow-x-auto p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Select</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">On order</TableHead>
                <TableHead className="text-right">Avg/day</TableHead>
                <TableHead className="text-right">Suggest</TableHead>
                <TableHead>Preferred supplier</TableHead>
                <TableHead>Lead days</TableHead>
                <TableHead>Minimum / maximum</TableHead>
                <TableHead>Settings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map((row) => {
                const key = `${row.warehouse_id}:${row.item_id}`;
                return (
                  <SuggestionRow
                    key={key}
                    row={row}
                    vendors={vendors}
                    editable={canEditMaster}
                    selected={selected.includes(key)}
                    onSelect={(checked) =>
                      setSelected((current) =>
                        checked ? [...current, key] : current.filter((entry) => entry !== key),
                      )
                    }
                    onSave={(settings) =>
                      saveItem
                        .mutateAsync({ id: row.item_id, ...settings })
                        .then(() =>
                          toast.success(`${String(row.item_code)} replenishment settings saved`),
                        )
                        .catch((error: unknown) =>
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Unable to save replenishment settings",
                          ),
                        )
                    }
                  />
                );
              })}
              {!suggestionQuery.isPending && !suggestions.length && (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                    No items are currently below minimum after reservations and open supply.
                  </TableCell>
                </TableRow>
              )}
              {suggestionQuery.isPending && (
                <TableRow>
                  <TableCell colSpan={11} className="h-24 text-center text-muted-foreground">
                    Calculating replenishment suggestions…
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SuggestionRow({
  row,
  vendors,
  editable,
  selected,
  onSelect,
  onSave,
}: {
  row: Suggestion;
  vendors: Array<{ id: string; name: string }>;
  editable: boolean;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onSave: (settings: {
    preferred_vendor_id: string;
    supplier_lead_time_days: number;
    minimum_stock: number;
    maximum_stock: number | null;
  }) => Promise<unknown>;
}) {
  const [supplier, setSupplier] = useState(String(row.preferred_vendor_id || ""));
  const [lead, setLead] = useState(String(row.supplier_lead_time_days || 0));
  const [minimum, setMinimum] = useState(String(row.minimum_stock || row.reorder_point || 0));
  const [maximum, setMaximum] = useState(String(row.maximum_stock ?? ""));
  const [saving, setSaving] = useState(false);
  const preferredVendorName =
    typeof row.preferred_vendor_name === "string" ? row.preferred_vendor_name : "";
  return (
    <TableRow>
      <TableCell>
        <input
          aria-label={`Select ${String(row.item_code)} for requisition`}
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
        />
      </TableCell>
      <TableCell className="font-medium">
        {String(row.item_code)}
        <div className="text-xs text-muted-foreground">{String(row.item_name)}</div>
      </TableCell>
      <TableCell>{String(row.warehouse_name)}</TableCell>
      <TableCell className="text-right">{value(row, "available_quantity")}</TableCell>
      <TableCell className="text-right">{value(row, "on_order_quantity")}</TableCell>
      <TableCell className="text-right">{value(row, "average_daily_usage").toFixed(2)}</TableCell>
      <TableCell className="text-right font-semibold">
        {value(row, "suggested_quantity")}
        <div className="text-xs font-normal text-muted-foreground">
          {KES(value(row, "estimated_unit_cost"))} / unit
        </div>
      </TableCell>
      <TableCell>
        <select
          aria-label={`Preferred supplier ${String(row.item_code)}`}
          className="h-9 min-w-36 rounded-md border border-input bg-background px-2 text-sm"
          value={supplier}
          disabled={!editable}
          onChange={(event) => setSupplier(event.target.value)}
        >
          <option value="">Select supplier</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </select>
        {preferredVendorName && (
          <Badge className="ml-1" variant="outline">
            {preferredVendorName}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <Input
          className="w-20"
          aria-label={`Lead time ${String(row.item_code)}`}
          type="number"
          min="0"
          value={lead}
          disabled={!editable}
          onChange={(event) => setLead(event.target.value)}
        />
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Input
            className="w-20"
            aria-label={`Minimum stock ${String(row.item_code)}`}
            type="number"
            min="0"
            value={minimum}
            disabled={!editable}
            onChange={(event) => setMinimum(event.target.value)}
          />
          <Input
            className="w-20"
            aria-label={`Maximum stock ${String(row.item_code)}`}
            type="number"
            min="0"
            placeholder="Max"
            value={maximum}
            disabled={!editable}
            onChange={(event) => setMaximum(event.target.value)}
          />
        </div>
      </TableCell>
      <TableCell>
        {editable ? (
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={async () => {
              const nextValue = Number(lead);
              const minimumValue = Number(minimum);
              const maximumValue = maximum === "" ? null : Number(maximum);
              if (!Number.isFinite(nextValue) || !Number.isFinite(minimumValue)) {
                toast.error("Lead time and minimum stock must be valid numbers.");
                return;
              }
              setSaving(true);
              try {
                await onSave({
                  preferred_vendor_id: supplier,
                  supplier_lead_time_days: nextValue,
                  minimum_stock: minimumValue,
                  maximum_stock: maximumValue,
                });
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Unable to save replenishment settings",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save className="mr-1 h-4 w-4" />
            {saving ? "Saving…" : "Save"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Read-only</span>
        )}
      </TableCell>
    </TableRow>
  );
}
