import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { fetchPayrollRuns } from "@/lib/api";

const columns = [
  { key: "payroll_month", label: "Payroll month" },
  { key: "employee_count", label: "Employees", align: "right" as const },
  { key: "total_gross", label: "Gross pay (KES)", align: "right" as const },
  { key: "total_net", label: "Net pay (KES)", align: "right" as const },
  { key: "status", label: "Status" },
];
const load = async (token: string): Promise<RegisterRow[]> => (await fetchPayrollRuns(token)).map((run) => ({ ...run }));

export const Route = createFileRoute("/_app/payroll")({
  component: () => <ResourceRegisterPage title="Payroll" description="Payroll runs, employee totals, and posting status by month." columns={columns} load={load} actionLabel="Open HR workspace" actionTo="/hr" countLabel="Payroll runs" />,
  head: () => ({ meta: [{ title: "Payroll - Ayawin Stock Solution" }] }),
});
