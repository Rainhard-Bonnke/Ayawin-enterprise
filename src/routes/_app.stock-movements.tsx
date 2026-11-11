import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { v1Api } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";

const columns = [
  { key: "movement_date", label: "Date" },
  { key: "item_name", label: "Item" },
  { key: "warehouse_code", label: "Warehouse" },
  { key: "movement_type", label: "Movement" },
  { key: "quantity", label: "Quantity", align: "right" as const },
  { key: "reference_type", label: "Reference" },
];
const load = (token: string, signal?: AbortSignal) => v1Api.inventory.movements(token, 100, signal);

export const Route = createFileRoute("/_app/stock-movements")({
  component: () => <ResourceRegisterPage title="Stock movements" description="An audit trail of receipts, issues, transfers, and stock adjustments." columns={columns} load={load} queryKey={queryKeys.inventory.movements()} actionLabel="View stock on hand" actionTo="/inventory" countLabel="Movements" />,
  head: () => ({ meta: [{ title: "Stock Movements - Ayawin Stock Solution" }] }),
});
