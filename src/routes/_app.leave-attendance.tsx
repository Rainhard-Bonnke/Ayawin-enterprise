import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { v1Api } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";

const columns = [
  { key: "application_no", label: "Request #" },
  { key: "first_name", label: "Employee" },
  { key: "leave_type_name", label: "Leave type" },
  { key: "start_date", label: "From" },
  { key: "end_date", label: "To" },
  { key: "days_requested", label: "Days", align: "right" as const },
  { key: "status", label: "Status" },
];
const load = (token: string, signal?: AbortSignal): Promise<RegisterRow[]> =>
  v1Api.hr.leaveApplications(token, signal);

export const Route = createFileRoute("/_app/leave-attendance")({
  component: () => (
    <ResourceRegisterPage
      title="Leave & attendance"
      description="Review employee leave requests and their approval status."
      columns={columns}
      load={load}
      queryKey={queryKeys.hr.leaveApplications()}
      actionLabel="Open employee records"
      actionTo="/hr"
      countLabel="Leave requests"
    />
  ),
  head: () => ({ meta: [{ title: "Leave & Attendance - Ayawin Stock Solution" }] }),
});
