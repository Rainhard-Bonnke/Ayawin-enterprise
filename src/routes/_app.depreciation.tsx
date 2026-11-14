import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { fetchFixedAssetDepreciation } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";

const columns = [
  { key: "asset_code", label: "Asset code" },
  { key: "name", label: "Asset" },
  { key: "acquisition_date", label: "Acquired" },
  { key: "acquisition_cost", label: "Cost (KES)", align: "right" as const },
  { key: "monthly_depreciation", label: "Monthly depreciation (KES)", align: "right" as const },
  { key: "status", label: "Status" },
];
const load = async (token: string, signal?: AbortSignal): Promise<RegisterRow[]> => {
  const summary = await fetchFixedAssetDepreciation(token, undefined, signal);
  return summary.rows.map((asset) => ({
    ...asset,
    monthly_depreciation: Number(asset.monthly_depreciation).toFixed(2),
  }));
};

export const Route = createFileRoute("/_app/depreciation")({
  component: () => (
    <ResourceRegisterPage
      title="Depreciation"
      description="Straight-line monthly depreciation estimates based on each asset's useful life."
      columns={columns}
      load={load}
      queryKey={queryKeys.assets.depreciation()}
      actionLabel="Open asset register"
      actionTo="/assets"
      countLabel="Assets being depreciated"
    />
  ),
  head: () => ({ meta: [{ title: "Depreciation - Ayawin Stock Solution" }] }),
});
