import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { fetchGoodsReceipts } from "@/lib/api";

const columns = [
  { key: "grn_number", label: "Receipt #" },
  { key: "po_number", label: "Purchase order" },
  { key: "receipt_date", label: "Received on" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" },
];
const load = async (token: string): Promise<RegisterRow[]> => (await fetchGoodsReceipts(token)).map((row) => ({ ...row }));

export const Route = createFileRoute("/_app/goods-received")({
  component: () => <ResourceRegisterPage title="Goods received" description="Review deliveries received against supplier purchase orders." columns={columns} load={load} actionLabel="Open purchase orders" actionTo="/procurement" countLabel="Goods receipts" />,
  head: () => ({ meta: [{ title: "Goods Received - Ayawin Stock Solution" }] }),
});
