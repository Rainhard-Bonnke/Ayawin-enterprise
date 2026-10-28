import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { fetchFixedAssets } from "@/lib/api-v1";

const columns = [
  { key: "asset_code", label: "Asset code" },
  { key: "name", label: "Asset" },
  { key: "acquisition_date", label: "Acquired" },
  { key: "acquisition_cost", label: "Cost (KES)", align: "right" as const },
  { key: "monthly_depreciation", label: "Monthly depreciation (KES)", align: "right" as const },
  { key: "status", label: "Status" },
];
const load = async (token: string): Promise<RegisterRow[]> => (await fetchFixedAssets(token)).map((asset) => ({
  ...asset,
  monthly_depreciation: (Math.max(0, Number(asset.acquisition_cost) - Number(asset.residual_value)) / Math.max(1, Number(asset.useful_life_months))).toFixed(2),
}));

export const Route = createFileRoute("/_app/depreciation")({
  component: () => <ResourceRegisterPage title="Depreciation" description="Straight-line monthly depreciation estimates based on each asset's useful life." columns={columns} load={load} actionLabel="Open asset register" actionTo="/assets" countLabel="Assets being depreciated" />,
  head: () => ({ meta: [{ title: "Depreciation - Ayawin Stock Solution" }] }),
});
