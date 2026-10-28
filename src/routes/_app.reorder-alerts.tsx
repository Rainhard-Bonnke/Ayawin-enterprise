import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { fetchInventoryReorderAlerts } from "@/lib/api";

const columns = [
  { key: "item_name", label: "Item" },
  { key: "item_code", label: "Code" },
  { key: "warehouse_name", label: "Warehouse" },
  { key: "quantity", label: "On hand", align: "right" as const },
  { key: "reorder_point", label: "Reorder at", align: "right" as const },
];
const load = async (token: string): Promise<RegisterRow[]> => (await fetchInventoryReorderAlerts(token)).map((row) => ({ ...row }));

export const Route = createFileRoute("/_app/reorder-alerts")({
  component: () => <ResourceRegisterPage title="Reorder alerts" description="Items at or below their configured reorder level." columns={columns} load={load} actionLabel="Open inventory" actionTo="/inventory" countLabel="Items to replenish" />,
  head: () => ({ meta: [{ title: "Reorder Alerts - Ayawin Stock Solution" }] }),
});
