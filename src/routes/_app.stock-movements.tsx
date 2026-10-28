import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { fetchInventoryMovements } from "@/lib/api";

const columns = [
  { key: "movement_date", label: "Date" },
  { key: "item_name", label: "Item" },
  { key: "warehouse_code", label: "Warehouse" },
  { key: "movement_type", label: "Movement" },
  { key: "quantity", label: "Quantity", align: "right" as const },
  { key: "reference_type", label: "Reference" },
];
const load = (token: string) => fetchInventoryMovements(token);

export const Route = createFileRoute("/_app/stock-movements")({
  component: () => <ResourceRegisterPage title="Stock movements" description="An audit trail of receipts, issues, transfers, and stock adjustments." columns={columns} load={load} actionLabel="View stock on hand" actionTo="/inventory" countLabel="Movements" />,
  head: () => ({ meta: [{ title: "Stock Movements - Ayawin Stock Solution" }] }),
});
