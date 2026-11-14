import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { v1Api } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";

const columns = [
  { key: "name", label: "Supplier" },
  { key: "contact", label: "Contact" },
  { key: "phone", label: "Phone" },
  { key: "payment_terms", label: "Terms" },
  { key: "balance", label: "Balance (KES)", align: "right" as const },
];
const load = async (token: string, signal?: AbortSignal): Promise<RegisterRow[]> =>
  (await v1Api.master.vendors(token, signal)).map((vendor) => ({
    id: vendor.id,
    name: vendor.name,
    contact: vendor.contact_name,
    phone: vendor.phone,
    payment_terms: null,
    balance: 0,
  }));

export const Route = createFileRoute("/_app/suppliers")({
  component: () => (
    <ResourceRegisterPage
      title="Suppliers"
      description="Supplier contacts, payment terms, and balances."
      columns={columns}
      load={load}
      queryKey={queryKeys.suppliers.list()}
      actionLabel="Create purchase order"
      actionTo="/procurement"
      countLabel="Suppliers"
    />
  ),
  head: () => ({ meta: [{ title: "Suppliers - Ayawin Stock Solution" }] }),
});
