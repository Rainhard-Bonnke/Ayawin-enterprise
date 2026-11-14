import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, BriefcaseBusiness, Building2, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { KES } from "@/lib/format";
import { fetchFixedAssets } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";
import { useList } from "@/lib/queryHooks";

function monthlyDepreciation(asset: {
  acquisition_cost: number | string;
  residual_value: number | string;
  useful_life_months: number | string;
}) {
  const cost = Number(asset.acquisition_cost || 0);
  const residual = Number(asset.residual_value || 0);
  const lifeMonths = Math.max(1, Number(asset.useful_life_months || 1));
  return Math.max(0, cost - residual) / lifeMonths;
}

export const Route = createFileRoute("/_app/fixed-assets")({
  component: FixedAssetsOverviewPage,
  head: () => ({ meta: [{ title: "Fixed Assets - Ayawin Stock Solution" }] }),
});

function FixedAssetsOverviewPage() {
  const { token } = useAuth();
  const assetsQuery = useList(
    queryKeys.assets.list(),
    ({ signal }) => fetchFixedAssets(token!, signal),
    { enabled: Boolean(token) },
  );

  const assets = assetsQuery.data ?? [];
  const activeAssets = assets.filter((asset) => asset.status === "active");
  const registeredValue = activeAssets.reduce(
    (sum, asset) => sum + Number(asset.acquisition_cost || 0),
    0,
  );
  const monthlyDep = activeAssets.reduce((sum, asset) => sum + monthlyDepreciation(asset), 0);
  const disposedCount = assets.filter((asset) => asset.status !== "active").length;

  const categorySummary = Object.entries(
    activeAssets.reduce<Record<string, { count: number; value: number }>>((acc, asset) => {
      const key = asset.category || "General";
      acc[key] = acc[key] || { count: 0, value: 0 };
      acc[key].count += 1;
      acc[key].value += Number(asset.acquisition_cost || 0);
      return acc;
    }, {}),
  ).map(([category, totals]) => ({ category, count: totals.count, value: totals.value }));

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Fixed Assets"
        description="Track asset values, depreciation exposure, and policy readiness across the active register."
        actions={
          <Button asChild variant="outline">
            <Link to="/assets">
              Open asset register
              <ArrowUpRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Registered assets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{activeAssets.length}</div>
            <div className="text-sm text-muted-foreground">Active in the register</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gross value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{KES(registeredValue)}</div>
            <div className="text-sm text-muted-foreground">Capitalized cost</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly depreciation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{KES(monthlyDep)}</div>
            <div className="text-sm text-muted-foreground">Straight-line estimate</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Asset actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{disposedCount}</div>
            <div className="text-sm text-muted-foreground">Disposed or retired</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Category value mix</CardTitle>
              <Badge variant="secondary">{categorySummary.length} categories</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Assets</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categorySummary.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      No active assets yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  categorySummary.map((row) => (
                    <TableRow key={row.category}>
                      <TableCell className="font-medium">{row.category}</TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                      <TableCell className="text-right">{KES(row.value)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Policy controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
              <BriefcaseBusiness className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <div className="font-medium">Acquisition approval</div>
                <div className="text-muted-foreground">
                  Capitalization threshold and source documentation remain review checkpoints.
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
              <Building2 className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <div className="font-medium">Custody and transfer</div>
                <div className="text-muted-foreground">
                  Branch and custodian changes should be logged before depreciation follows the new
                  owner.
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
              <TrendingDown className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <div className="font-medium">Depreciation run</div>
                <div className="text-muted-foreground">
                  Each month-end review should match the register to the GL and the approved
                  useful-life policy.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
