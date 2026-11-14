import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { apiV1Fetch } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";

const columns = [
  { key: "requisition_no", label: "Requisition #" },
  { key: "required_date", label: "Required" },
  { key: "status", label: "Status" },
  { key: "line_count", label: "Lines" },
  { key: "notes", label: "Notes" },
];

const load = async (token: string, signal?: AbortSignal): Promise<RegisterRow[]> =>
  (
    await apiV1Fetch<Array<Record<string, unknown>>>(
      "/procurement/purchase-requisitions",
      { signal },
      token,
    )
  ).map((row) => ({
    id: String(row.id),
    requisition_no: String(row.requisition_no || row.id),
    required_date: row.required_date ? String(row.required_date).slice(0, 10) : null,
    status: row.status ? String(row.status) : "draft",
    line_count: Number(row.line_count ?? 0),
    notes: row.notes ? String(row.notes) : null,
  }));

export const Route = createFileRoute("/_app/purchase-requisitions")({
  component: () => (
    <ResourceRegisterPage
      title="Purchase requisitions"
      description="Review buying needs raised by the business before they are approved into supplier orders."
      columns={columns}
      load={load}
      queryKey={queryKeys.procurement.purchaseRequisitions()}
      actionLabel="Open procurement"
      actionTo="/procurement"
      countLabel="Requisitions"
    />
  ),
  head: () => ({ meta: [{ title: "Purchase Requisitions - Ayawin Stock Solution" }] }),
});
