import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileDown, RefreshCw } from "lucide-react";
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
import { useList } from "@/lib/queryHooks";
import { KES } from "@/lib/format";
import { exportWorkbook } from "@/lib/excel";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/inventory-valuation")({
  component: InventoryValuationPage,
  head: () => ({ meta: [{ title: "Stock Valuation - Ayawin Stock Solution" }] }),
});

function InventoryValuationPage() {
  const { token } = useAuth();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const valuationQuery = useList(
    queryKeys.inventory.valuation(asOf),
    async ({ signal }) => v1Api.inventory.valuationReconciliation(token!, asOf, signal),
    { enabled: Boolean(token && asOf) },
  );
  const report = valuationQuery.data;
  const balanced = report ? Math.abs(Number(report.variance)) < 0.005 : false;
  const exportReport = () => {
    if (!report) return;
    exportWorkbook(`stock-valuation-${asOf}.xlsx`, [
      {
        name: "Inventory Valuation",
        rows: report.items.map((item) => ({
          SKU: item.item_code,
          Item: item.item_name,
          "On hand value": item.on_hand_value,
          "In transit value": item.in_transit_value,
          "Total stock value": item.stock_value,
        })),
      },
      {
        name: "GL Reconciliation",
        rows: [
          {
            "As of": report.as_of,
            "Inventory account": report.inventory_account,
            "Stock value": report.stock_value,
            "GL value": report.gl_value,
            Variance: report.variance,
          },
        ],
      },
    ]);
  };

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Stock valuation"
        description="Reconcile ledger-derived on-hand and in-transit inventory against the posted inventory control account."
        actions={
          <Button variant="outline" disabled={!report} onClick={exportReport}>
            <FileDown className="mr-2 h-4 w-4" />
            Export XLSX
          </Button>
        }
      />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="w-52 space-y-1.5">
            <Label htmlFor="valuation-as-of">Valuation date</Label>
            <Input
              id="valuation-as-of"
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
            />
          </div>
          <Button
            variant="outline"
            disabled={valuationQuery.isFetching}
            onClick={() => void valuationQuery.refetch()}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${valuationQuery.isFetching ? "animate-spin" : ""}`}
            />
            Reconcile
          </Button>
          {report && (
            <Badge variant={balanced ? "default" : "destructive"} className="h-9 gap-1 px-3">
              {balanced ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              {balanced ? "Balanced to the cent" : "Variance requires review"}
            </Badge>
          )}
        </CardContent>
      </Card>
      {valuationQuery.isError && (
        <p role="alert" className="text-sm text-destructive">
          {valuationQuery.error.message}
        </p>
      )}
      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="As of" value={report.as_of} />
            <Metric label="On hand + in transit" value={KES(report.stock_value)} />
            <Metric
              label={`GL inventory · ${report.inventory_account}`}
              value={KES(report.gl_value)}
            />
            <Metric label="Variance" value={KES(report.variance)} danger={!balanced} />
          </div>
          <Card>
            <CardContent className="p-4">
              <h2 className="mb-3 font-semibold">By item</h2>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">In transit</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.items.map((item) => (
                      <TableRow key={item.item_id}>
                        <TableCell className="font-mono text-xs">{item.item_code}</TableCell>
                        <TableCell>{item.item_name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {KES(item.on_hand_value)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {KES(item.in_transit_value)}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {KES(item.stock_value)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!report.items.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                          No inventory movement is recorded on this date.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          {report.unposted_movement_types.length > 0 && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <h2 className="font-semibold">Known unjournaled movement classes</h2>
                <p className="text-sm text-muted-foreground">
                  A zero total variance is a reconciliation check, not proof that every operational
                  movement is journaled.
                </p>
                {report.unposted_movement_types.map((entry) => (
                  <div key={entry.reference_type} className="border-t border-border pt-2 text-sm">
                    <span className="font-medium">{entry.reference_type.replaceAll("_", " ")}</span>
                    <p className="text-muted-foreground">{entry.reason}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
        <div
          className={`mt-1 text-xl font-semibold tabular-nums ${danger ? "text-destructive" : ""}`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
