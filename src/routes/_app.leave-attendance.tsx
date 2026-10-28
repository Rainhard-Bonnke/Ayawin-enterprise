import { createFileRoute } from "@tanstack/react-router";
import { ResourceRegisterPage, type RegisterRow } from "@/components/ResourceRegisterPage";
import { fetchLeaveApplications } from "@/lib/api";

const columns = [
  { key: "application_no", label: "Request #" },
  { key: "first_name", label: "Employee" },
  { key: "leave_type_name", label: "Leave type" },
  { key: "start_date", label: "From" },
  { key: "end_date", label: "To" },
  { key: "days_requested", label: "Days", align: "right" as const },
  { key: "status", label: "Status" },
];
const load = (token: string): Promise<RegisterRow[]> => fetchLeaveApplications(token);

export const Route = createFileRoute("/_app/leave-attendance")({
  component: () => <ResourceRegisterPage title="Leave & attendance" description="Review employee leave requests and their approval status." columns={columns} load={load} actionLabel="Open employee records" actionTo="/hr" countLabel="Leave requests" />,
  head: () => ({ meta: [{ title: "Leave & Attendance - Ayawin Stock Solution" }] }),
});
