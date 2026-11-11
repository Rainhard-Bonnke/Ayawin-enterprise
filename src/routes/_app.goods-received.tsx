import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { v1Api } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";

const columns = [
  { key: "grn_number", label: "Receipt #" },
  { key: "po_number", label: "Purchase order" },
  { key: "receipt_date", label: "Received on" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" },
];
const load = async (token: string, signal?: AbortSignal): Promise<RegisterRow[]> =>
  (await v1Api.procurement.goodsReceipts(token, signal)).map((row) => ({
    id: String(row.id),
    grn_number: String(row.grn_number || row.id),
    po_number: row.po_number ? String(row.po_number) : null,
    receipt_date: row.received_date ? String(row.received_date).slice(0, 10) : null,
    status: row.status ? String(row.status) : null,
    notes: row.notes ? String(row.notes) : null,
  }));

export const Route = createFileRoute("/_app/goods-received")({
  component: () => <ResourceRegisterPage title="Goods received" description="Review deliveries received against supplier purchase orders." columns={columns} load={load} queryKey={queryKeys.procurement.goodsReceipts()} actionLabel="Open purchase orders" actionTo="/procurement" countLabel="Goods receipts" />,
  head: () => ({ meta: [{ title: "Goods Received - Ayawin Stock Solution" }] }),
});
