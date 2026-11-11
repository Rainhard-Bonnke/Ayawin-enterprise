import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { v1Api } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";

const columns = [
  { key: "item_name", label: "Item" },
  { key: "item_code", label: "Code" },
  { key: "warehouse_name", label: "Warehouse" },
  { key: "quantity", label: "On hand", align: "right" as const },
  { key: "reorder_point", label: "Reorder at", align: "right" as const },
];
const load = (token: string, signal?: AbortSignal): Promise<RegisterRow[]> =>
  v1Api.inventory.reorderAlerts(token, 50, signal);

export const Route = createFileRoute("/_app/reorder-alerts")({
  component: () => <ResourceRegisterPage title="Reorder alerts" description="Items at or below their configured reorder level." columns={columns} load={load} queryKey={queryKeys.inventory.reorderAlerts()} actionLabel="Open inventory" actionTo="/inventory" countLabel="Items to replenish" />,
  head: () => ({ meta: [{ title: "Reorder Alerts - Ayawin Stock Solution" }] }),
});
