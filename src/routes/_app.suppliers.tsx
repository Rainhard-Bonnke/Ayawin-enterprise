import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { fetchSuppliers } from "@/lib/api";

const columns = [
  { key: "name", label: "Supplier" },
  { key: "contact", label: "Contact" },
  { key: "phone", label: "Phone" },
  { key: "payment_terms", label: "Terms" },
  { key: "balance", label: "Balance (KES)", align: "right" as const },
];
const load = async (token: string): Promise<RegisterRow[]> => (await fetchSuppliers(token)).map((row) => ({ ...row }));

export const Route = createFileRoute("/_app/suppliers")({
  component: () => <ResourceRegisterPage title="Suppliers" description="Supplier contacts, payment terms, and balances." columns={columns} load={load} actionLabel="Create purchase order" actionTo="/procurement" countLabel="Suppliers" />,
  head: () => ({ meta: [{ title: "Suppliers - Ayawin Stock Solution" }] }),
});
