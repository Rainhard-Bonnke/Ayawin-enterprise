import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { v1Api } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";

const columns = [
  { key: "payroll_month", label: "Payroll month" },
  { key: "employee_count", label: "Employees", align: "right" as const },
  { key: "total_gross", label: "Gross pay (KES)", align: "right" as const },
  { key: "total_net", label: "Net pay (KES)", align: "right" as const },
  { key: "status", label: "Status" },
];
const load = async (token: string, signal?: AbortSignal): Promise<RegisterRow[]> =>
  (await v1Api.hr.payrollRuns(token, signal)).map((run) => ({
    id: String(run.id),
    payroll_month: String(run.payroll_month || ""),
    status: String(run.status || "draft"),
    employee_count: Number(run.employee_count || 0),
    total_gross: Number(run.total_gross || 0),
    total_net: Number(run.total_net || 0),
  }));

export const Route = createFileRoute("/_app/payroll")({
  component: () => <ResourceRegisterPage title="Payroll" description="Payroll runs, employee totals, and posting status by month." columns={columns} load={load} queryKey={queryKeys.hr.payrollRuns()} actionLabel="Open HR workspace" actionTo="/hr" countLabel="Payroll runs" />,
  head: () => ({ meta: [{ title: "Payroll - Ayawin Stock Solution" }] }),
});
