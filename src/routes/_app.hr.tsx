import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KES } from "@/lib/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, FileDown, ArrowUpDown, History } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { exportWorkbook } from "@/lib/excel";
import { trackEvent } from "@/lib/event-tracker";
import { useEffect, useState } from "react";
import { EMPTY_ARRAY, useList, useDocument } from "@/lib/queryHooks";
import { queryKeys } from "@/lib/queryKeys";
import { useUrlSearchParam } from "@/lib/urlSearchState";
import { useAuth } from "@/lib/auth";
import {
  type BackendEmployee,
  type PayrollRun,
  type PayslipRow,
  type PayrollRemittance,
} from "@/lib/api-types";
import { v1Api } from "@/lib/api-v1";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhaseGWorkflows } from "@/features/hr/PhaseGWorkflows";

type LifecycleEmployee = { id: string; name: string };

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const Route = createFileRoute("/_app/hr")({
  component: HRPage,
  head: () => ({ meta: [{ title: "HR & Payroll - Ayawin Stock Solution" }] }),
});

function HRPage() {
  const { token, user } = useAuth();
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [payrollMonth, setPayrollMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [tab, setTab] = useState(() => hash.replace(/^#/, "") || "employees");
  const [q, setQ] = useUrlSearchParam("q", "");
  const [department, setDepartment] = useUrlSearchParam("department", "all");
  const [sort, setSort] = useUrlSearchParam("sort", "name");
  const [pageValue, setPageValue] = useUrlSearchParam("page", "1");
  const page = Math.max(1, Number(pageValue) || 1);
  const setPage = (next: number) => setPageValue(String(Math.max(1, next)));
  const [lifecycleEmployee, setLifecycleEmployee] = useState<LifecycleEmployee | null>(null);
  const [lifecycleEvents, setLifecycleEvents] = useState<Record<string, unknown>[]>([]);
  const [branches, setBranches] = useState<Record<string, unknown>[]>([]);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);
  const [lifecycleType, setLifecycleType] = useState("salary_change");
  const [lifecycleEffectiveDate, setLifecycleEffectiveDate] = useState(localDateInputValue());
  const [lifecycleForm, setLifecycleForm] = useState({
    basic_salary: "",
    house_allowance: "",
    transport_allowance: "",
    job_title: "",
    department: "",
    branch_id: "",
    reason: "",
  });
  const [lifecycleDecisionNote, setLifecycleDecisionNote] = useState("");
  const [linkingEmployee, setLinkingEmployee] = useState<LifecycleEmployee | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [onboardingEmployee, setOnboardingEmployee] = useState<LifecycleEmployee | null>(null);
  const [onboardingChecklist, setOnboardingChecklist] = useState<Record<string, boolean>>({});
  const [onboardingDocuments, setOnboardingDocuments] = useState<Record<string, unknown>[]>([]);
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [documentDraft, setDocumentDraft] = useState({
    document_type: "",
    document_name: "",
    expiry_date: "",
    status: "active",
  });
  const [documentSaving, setDocumentSaving] = useState(false);
  const pageSize = 5;
  const canRequestLifecycle = user?.role === "Admin" || user?.permissions?.includes("hr.create");
  const canApproveLifecycle = user?.role === "Admin" || user?.permissions?.includes("hr.approve");
  const employeesQuery = useList(
    queryKeys.hr.employees(user?.id),
    async ({ signal }) =>
      (await v1Api.hr.employees(token!, signal)).map((row): BackendEmployee => ({
        id: String(row.id),
        name: String(row.full_name || `${row.first_name || ""} ${row.last_name || ""}`.trim()),
        email: row.email ? String(row.email) : null,
        user_id: row.user_id ? String(row.user_id) : null,
        department: String(row.department_name || row.department || "—"),
        role: String(row.job_title || row.position || "—"),
        salary: Number(row.basic_salary || row.gross_salary || 0),
        status: String(row.status || "active").toLowerCase() === "active" ? "Active" : "Inactive",
      })),
    { enabled: Boolean(token) },
  );
  const apiEmployees = employeesQuery.data ?? [];
  const attendanceQuery = useList(
    queryKeys.hr.attendance(user?.id),
    ({ signal }) => v1Api.hr.attendance(token!, undefined, undefined, signal),
    { enabled: Boolean(token) && tab === "attendance" },
  );
  const attendance = attendanceQuery.data ?? [];
  const payrollRunsQuery = useList(
    queryKeys.hr.payrollRuns(),
    async ({ signal }) =>
      (await v1Api.hr.payrollRuns(token!, signal)).map((row): PayrollRun => ({
        id: String(row.id),
        payroll_month: String(row.payroll_month || ""),
        status: String(row.status || "draft"),
        employee_count: Number(row.employee_count || 0),
        total_gross: Number(row.total_gross || 0),
        total_net: Number(row.total_net || 0),
      })),
    { enabled: Boolean(token) && tab === "payroll" },
  );
  const payrollRuns = payrollRunsQuery.data ?? EMPTY_ARRAY;
  const recruitmentQuery = useList(
    queryKeys.hr.recruitmentOverview(),
    async ({ signal }) => {
      const [requisitions, vacancies, candidates] = await Promise.all([
        v1Api.hr.recruitmentRequisitions(token!, signal),
        v1Api.hr.recruitmentVacancies(token!, signal),
        v1Api.hr.recruitmentCandidates(token!, signal),
      ]);
      return { requisitions, vacancies, candidates };
    },
    { enabled: Boolean(token) && tab === "recruitment" },
  );
  const recruitmentData = recruitmentQuery.data ?? {
    requisitions: [],
    vacancies: [],
    candidates: [],
  };
  const leaveApplicationsQuery = useList(
    queryKeys.hr.leaveApplications(),
    ({ signal }) => v1Api.hr.leaveApplications(token!, signal),
    { enabled: Boolean(token) && tab === "leave" },
  );
  const leaveRows = leaveApplicationsQuery.data ?? [];
  const payrollDetailQuery = useDocument(
    queryKeys.hr.payrollDetail(selectedRun?.id ?? "none"),
    async ({ signal }) => {
      const runId = selectedRun!.id;
      const [slipRows, statutory, remittanceRows] = await Promise.all([
        v1Api.hr.payslips(token!, runId, signal),
        v1Api.hr.statutoryReport(token!, runId, signal),
        v1Api.hr.statutoryRemittances(token!, runId, signal),
      ]);
      const payslips = slipRows.map((row) => ({
        id: String(row.id),
        employee_code: row.employee_code ? String(row.employee_code) : undefined,
        first_name: row.first_name ? String(row.first_name) : undefined,
        last_name: row.last_name ? String(row.last_name) : undefined,
        gross_pay: Number(row.gross_pay || 0),
        paye: Number(row.paye || 0),
        shif: Number(row.shif || 0),
        nhif: Number(row.nhif || 0),
        nssf: Number(row.nssf || 0),
        nssf_tier1: Number(row.nssf_tier1 || 0),
        nssf_tier2: Number(row.nssf_tier2 || 0),
        nssf_employer: Number(row.nssf_employer || 0),
        housing_levy: Number(row.housing_levy || 0),
        housing_levy_employer: Number(row.housing_levy_employer || 0),
        taxable_income: Number(row.taxable_income || 0),
        personal_relief: Number(row.personal_relief || 0),
        insurance_relief: Number(row.insurance_relief || 0),
        employer_cost: Number(row.employer_cost || 0),
        net_pay: Number(row.net_pay || 0),
      })) as PayslipRow[];
      const remittances = remittanceRows.map((row) => ({
        id: String(row.id),
        agency_code: String(row.agency_code || ""),
        agency_name: String(row.agency_name || row.agency_code || ""),
        amount_due: Number(row.amount_due || 0),
        amount_paid: Number(row.amount_paid || 0),
        outstanding_amount: Number(row.outstanding_amount || 0),
        due_date: row.due_date ? String(row.due_date).slice(0, 10) : null,
        status: String(row.status || "due"),
        payroll_month: String(row.payroll_month || "").slice(0, 10),
        posted_payment_count: Number(row.posted_payment_count || 0),
      })) as PayrollRemittance[];
      return { payslips, statutory, remittances };
    },
    { enabled: Boolean(token && selectedRun?.id) },
  );
  const payslips = payrollDetailQuery.data?.payslips ?? [];
  const statutory = payrollDetailQuery.data?.statutory ?? null;
  const remittances = payrollDetailQuery.data?.remittances ?? [];
  useEffect(() => {
    if (tab === "payroll" && !selectedRun && payrollRuns.length) setSelectedRun(payrollRuns[0]);
  }, [tab, selectedRun, payrollRuns]);

  const openAccountLink = (employee: BackendEmployee) => {
    setLinkingEmployee({ id: employee.id, name: employee.name });
    setLinkEmail(employee.email || "");
  };

  const linkEmployeeAccount = async () => {
    if (!token || !linkingEmployee) return;
    setLinkSaving(true);
    try {
      await v1Api.hr.linkEmployeeAccount(token, linkingEmployee.id, linkEmail);
      await employeesQuery.refetch();
      setLinkingEmployee(null);
      toast.success("Employee self-service account linked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to link account");
    } finally {
      setLinkSaving(false);
    }
  };

  const openLifecycle = async (employee: LifecycleEmployee) => {
    setLifecycleEmployee(employee);
    setLifecycleEvents([]);
    setLifecycleType("salary_change");
    setLifecycleEffectiveDate(localDateInputValue());
    setLifecycleForm({
      basic_salary: "",
      house_allowance: "",
      transport_allowance: "",
      job_title: "",
      department: "",
      branch_id: "",
      reason: "",
    });
    setLifecycleDecisionNote("");
    if (!token) return;
    setLifecycleLoading(true);
    try {
      const [events, branchRows] = await Promise.all([
        v1Api.hr.lifecycleEvents(token, employee.id),
        v1Api.hr.branches(token),
      ]);
      setLifecycleEvents(events);
      setBranches(branchRows);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load employee lifecycle history",
      );
    } finally {
      setLifecycleLoading(false);
    }
  };

  const refreshLifecycle = async (employeeId: string) => {
    if (!token) return;
    setLifecycleEvents(await v1Api.hr.lifecycleEvents(token, employeeId));
  };

  const submitLifecycleRequest = async () => {
    if (!token || !lifecycleEmployee) return;
    let requestedValues: Record<string, unknown>;
    if (lifecycleType === "salary_change") {
      requestedValues = { basic_salary: Number(lifecycleForm.basic_salary) };
      if (lifecycleForm.house_allowance !== "")
        requestedValues.house_allowance = Number(lifecycleForm.house_allowance);
      if (lifecycleForm.transport_allowance !== "")
        requestedValues.transport_allowance = Number(lifecycleForm.transport_allowance);
    } else if (lifecycleType === "promotion") {
      requestedValues = {};
      if (lifecycleForm.job_title.trim())
        requestedValues.job_title = lifecycleForm.job_title.trim();
      if (lifecycleForm.department.trim())
        requestedValues.department = lifecycleForm.department.trim();
      if (lifecycleForm.basic_salary !== "")
        requestedValues.basic_salary = Number(lifecycleForm.basic_salary);
      if (lifecycleForm.house_allowance !== "")
        requestedValues.house_allowance = Number(lifecycleForm.house_allowance);
      if (lifecycleForm.transport_allowance !== "")
        requestedValues.transport_allowance = Number(lifecycleForm.transport_allowance);
    } else if (lifecycleType === "branch_transfer") {
      requestedValues = { branch_id: lifecycleForm.branch_id };
    } else if (lifecycleType === "termination") {
      requestedValues = { reason: lifecycleForm.reason.trim() };
    } else {
      requestedValues = {};
    }

    setLifecycleSaving(true);
    try {
      await v1Api.hr.requestLifecycleEvent(token, lifecycleEmployee.id, {
        event_type: lifecycleType,
        effective_date: lifecycleEffectiveDate,
        requested_values: requestedValues,
      });
      await refreshLifecycle(lifecycleEmployee.id);
      toast.success("Lifecycle request submitted for independent review");
      setLifecycleForm({
        basic_salary: "",
        house_allowance: "",
        transport_allowance: "",
        job_title: "",
        department: "",
        branch_id: "",
        reason: "",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit lifecycle request");
    } finally {
      setLifecycleSaving(false);
    }
  };

  const decideLifecycle = async (eventId: string, decision: "approved" | "rejected") => {
    if (!token || !lifecycleEmployee) return;
    setLifecycleSaving(true);
    try {
      await v1Api.hr.decideLifecycleEvent(token, eventId, decision, lifecycleDecisionNote);
      await refreshLifecycle(lifecycleEmployee.id);
      setLifecycleDecisionNote("");
      toast.success(
        decision === "approved" ? "Lifecycle request approved" : "Lifecycle request rejected",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to decide lifecycle request");
    } finally {
      setLifecycleSaving(false);
    }
  };

  const applyLifecycle = async (eventId: string) => {
    if (!token || !lifecycleEmployee) return;
    setLifecycleSaving(true);
    try {
      await v1Api.hr.applyLifecycleEvent(token, eventId);
      await Promise.all([refreshLifecycle(lifecycleEmployee.id), employeesQuery.refetch()]);
      toast.success("Approved lifecycle change applied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to apply lifecycle change");
    } finally {
      setLifecycleSaving(false);
    }
  };

  const openOnboarding = async (employee: LifecycleEmployee) => {
    setOnboardingEmployee(employee);
    setOnboardingChecklist({});
    setOnboardingDocuments([]);
    if (!token) return;
    try {
      const [onboarding, documents] = await Promise.all([
        v1Api.hr.employeeOnboarding(token, employee.id),
        v1Api.hr.employeeDocuments(token, employee.id),
      ]);
      const checklist =
        onboarding && typeof onboarding.checklist === "object" && onboarding.checklist
          ? (onboarding.checklist as Record<string, unknown>)
          : {};
      setOnboardingChecklist(
        Object.fromEntries(
          Object.entries(checklist).map(([key, value]) => [key, Boolean(value)]),
        ),
      );
      setOnboardingDocuments(documents);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load employee onboarding details",
      );
    }
  };

  const saveOnboardingChecklist = async () => {
    if (!token || !onboardingEmployee) return;
    setOnboardingSaving(true);
    try {
      const status = Object.values(onboardingChecklist).length
        ? Object.values(onboardingChecklist).every(Boolean)
          ? "completed"
          : "in_progress"
        : "in_progress";
      await v1Api.hr.updateEmployeeOnboarding(token, onboardingEmployee.id, {
        checklist: onboardingChecklist,
        document_metadata: onboardingDocuments,
        status,
      });
      toast.success("Onboarding checklist saved");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update onboarding checklist",
      );
    } finally {
      setOnboardingSaving(false);
    }
  };

  const submitEmployeeDocument = async () => {
    if (!token || !onboardingEmployee) return;
    if (!documentDraft.document_type.trim()) {
      toast.error("Select a document type");
      return;
    }
    setDocumentSaving(true);
    try {
      await v1Api.hr.createEmployeeDocument(token, onboardingEmployee.id, {
        document_type: documentDraft.document_type,
        document_name: documentDraft.document_name || documentDraft.document_type,
        expiry_date: documentDraft.expiry_date || null,
        status: documentDraft.status,
      });
      const refreshed = await v1Api.hr.employeeDocuments(token, onboardingEmployee.id);
      setOnboardingDocuments(refreshed);
      setDocumentDraft({ document_type: "", document_name: "", expiry_date: "", status: "active" });
      toast.success("Employee document added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add employee document");
    } finally {
      setDocumentSaving(false);
    }
  };

  const loadPayroll = async (run?: PayrollRun) => {
    if (!token) return;
    const refreshed = await payrollRunsQuery.refetch();
    const active = run
      ? refreshed.data?.find((row) => row.id === run.id) || run
      : refreshed.data?.[0] || null;
    setSelectedRun(active);
    if (active && active.id === selectedRun?.id) await payrollDetailQuery.refetch();
  };

  useEffect(() => {
    const nextTab = hash.replace(/^#/, "");
    if (["employees", "attendance", "payroll", "recruitment", "leave"].includes(nextTab))
      setTab(nextTab);
  }, [hash]);

  const sourceEmployees = (apiEmployees ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    email: e.email,
    user_id: e.user_id,
    department: e.department,
    role: e.role,
    salary: e.salary,
    status: e.status,
  }));

  const employeeRows = sourceEmployees
    .filter(
      (e) =>
        (department === "all" || e.department === department) &&
        (e.name.toLowerCase().includes(q.toLowerCase()) ||
          e.role.toLowerCase().includes(q.toLowerCase())),
    )
    .sort((a, b) => {
      if (sort === "salary") return b.salary - a.salary;
      if (sort === "department") return a.department.localeCompare(b.department);
      return a.name.localeCompare(b.name);
    });
  const totalPages = Math.max(1, Math.ceil(employeeRows.length / pageSize));
  const paged = employeeRows.slice((page - 1) * pageSize, page * pageSize);
  const exportHR = () => {
    void trackEvent({
      action: "hr_export_xlsx",
      entityType: "report",
      entityId: "hr",
      details: { employees: employeeRows.length },
      scenario: "hr",
      context: { q, department, sort, employees: employeeRows.length },
    });
    exportWorkbook("ayawin-stock-solution-hr.xlsx", [
      {
        name: "Employees",
        rows: employeeRows.map((e) => ({
          ID: e.id,
          Name: e.name,
          Department: e.department,
          Role: e.role,
          "Gross Salary": e.salary,
          Status: e.status,
        })),
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Human Resources"
        description="Employees, attendance, leave and Kenya statutory payroll."
        actions={
          <Button onClick={exportHR}>
            <Plus className="mr-2 h-4 w-4" />
            Export XLSX
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Employees", v: String(sourceEmployees.length) },
          { l: "On Leave", v: String(sourceEmployees.filter((e) => e.status !== "Active").length) },
          { l: "Payroll Total", v: KES(sourceEmployees.reduce((sum, e) => sum + e.salary, 0)) },
          {
            l: "Active Contracts",
            v: String(sourceEmployees.filter((e) => e.status === "Active").length),
          },
        ].map((k) => (
          <Card key={k.l}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
              <div className="mt-1 text-2xl font-bold">{k.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <QuietNote
        scenario="hr"
        contextKey={`${q}-${department}-${sort}`}
        context={{ q, department, sort, employees: employeeRows }}
        className="mb-4"
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          window.history.replaceState({}, "", `${window.location.pathname}#${value}`);
        }}
      >
        <TabsList>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
          <TabsTrigger value="recruitment">Recruitment</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="controls">HR Controls</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <SearchBar
                  value={q}
                  onChange={(value) => {
                    setQ(value);
                    setPage(1);
                  }}
                  placeholder="Search employee or role..."
                />
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {Array.from(new Set(sourceEmployees.map((e) => e.department))).map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="w-40">
                    <ArrowUpDown className="mr-2 h-4 w-4" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">Sort by name</SelectItem>
                    <SelectItem value="department">Sort by department</SelectItem>
                    <SelectItem value="salary">Sort by salary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Gross Salary</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-mono text-xs">{e.id}</TableCell>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell>{e.department}</TableCell>
                      <TableCell>{e.role}</TableCell>
                      <TableCell className="text-right">{KES(e.salary)}</TableCell>
                      <TableCell>
                        <StatusBadge status={e.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void openLifecycle({ id: e.id, name: e.name })}
                        >
                          <History className="mr-2 h-4 w-4" />
                          History
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-2"
                          onClick={() => void openOnboarding({ id: e.id, name: e.name })}
                        >
                          Onboarding
                        </Button>
                        {canApproveLifecycle && !e.user_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="ml-2"
                            onClick={() =>
                              openAccountLink({
                                id: e.id,
                                name: e.name,
                                email: e.email,
                                user_id: e.user_id,
                                department: e.department,
                                role: e.role,
                                salary: e.salary,
                                status: e.status,
                              })
                            }
                          >
                            Link login
                          </Button>
                        )}
                        {e.user_id && (
                          <span className="ml-2 text-xs text-muted-foreground">Linked</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {paged.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        No employees match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <ListPagination
                page={page}
                totalPages={totalPages}
                totalItems={employeeRows.length}
                pageSize={pageSize}
                onPageChange={setPage}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 text-sm text-muted-foreground">
                Attendance records from the time and attendance register.
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Clock In</TableHead>
                    <TableHead>Clock Out</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendance.map((row) => (
                    <TableRow key={String(row.id)}>
                      <TableCell className="font-medium">
                        {`${row.first_name || ""} ${row.last_name || ""}`.trim()}
                      </TableCell>
                      <TableCell>{String(row.department || "â€”")}</TableCell>
                      <TableCell>
                        {row.check_in ? String(row.check_in).slice(0, 5) : "â€”"}
                      </TableCell>
                      <TableCell>
                        {row.check_out ? String(row.check_out).slice(0, 5) : "â€”"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={String(row.status || "unknown")} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {attendance.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No attendance records have been imported yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={selectedRun?.id || ""}
                    onValueChange={(id) => {
                      const run = payrollRuns.find((row) => row.id === id);
                      if (run) void loadPayroll(run);
                    }}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Select payroll run" />
                    </SelectTrigger>
                    <SelectContent>
                      {payrollRuns.map((run) => (
                        <SelectItem key={run.id} value={run.id}>
                          {run.payroll_month} Â· {run.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input
                    data-slot="form-control"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    type="month"
                    value={payrollMonth}
                    onChange={(e) => setPayrollMonth(e.target.value)}
                    aria-label="Payroll month"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        const raw = await v1Api.hr.createPayrollRun(token, payrollMonth);
                        const created = {
                          id: String(raw.id),
                          payroll_month: String(raw.payroll_month || payrollMonth),
                          status: String(raw.status || "draft"),
                          employee_count: Number(raw.employee_count || 0),
                          total_gross: Number(raw.total_gross || 0),
                          total_net: Number(raw.total_net || 0),
                        } satisfies PayrollRun;
                        toast.success("Payroll run created");
                        await loadPayroll(created);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Unable to run payroll");
                      }
                    }}
                  >
                    Run payroll
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!selectedRun || payslips.length === 0}
                  onClick={() => {
                    void trackEvent({
                      action: "payslip_export_requested",
                      entityType: "payroll",
                      entityId: selectedRun?.id || "",
                      details: { employees: payslips.length },
                      scenario: "hr",
                      context: { payrollMonth: selectedRun?.payroll_month },
                    });
                    exportWorkbook(`ayawin-payslips-${selectedRun?.payroll_month || "run"}.xlsx`, [
                      {
                        name: "Payslips",
                        rows: payslips.map((slip) => ({
                          Employee:
                            `${slip.first_name || ""} ${slip.last_name || ""}`.trim() ||
                            slip.employee_code ||
                            "Employee",
                          Gross: slip.gross_pay,
                          PAYE: slip.paye,
                          SHIF: slip.shif,
                          "NSSF Tier I": slip.nssf_tier1 || 0,
                          "NSSF Tier II": slip.nssf_tier2 || 0,
                          "NSSF Employer": slip.nssf_employer || 0,
                          "Housing Levy": slip.housing_levy,
                          "Employer Housing Levy": slip.housing_levy_employer || 0,
                          "Net Pay": slip.net_pay,
                        })),
                      },
                    ]);
                  }}
                >
                  <FileDown className="mr-2 h-3.5 w-3.5" />
                  Generate Payslips (XLSX)
                </Button>
                {selectedRun?.status === "calculated" && selectedRun && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await v1Api.hr.approvePayrollRun(token, selectedRun.id);
                        toast.success("Payroll approved by a separate reviewer");
                        await loadPayroll(selectedRun);
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Unable to approve payroll",
                        );
                      }
                    }}
                  >
                    Approve run
                  </Button>
                )}
                {selectedRun?.status === "approved" && selectedRun && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await v1Api.hr.lockPayrollRun(token, selectedRun.id);
                        toast.success("Payroll run locked");
                        await loadPayroll(selectedRun);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Unable to lock payroll");
                      }
                    }}
                  >
                    Lock run
                  </Button>
                )}
                {selectedRun?.status === "locked" && selectedRun && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await v1Api.hr.postPayrollRun(token, selectedRun.id);
                        toast.success("Payroll posted to General Ledger");
                        await loadPayroll(selectedRun);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Unable to post payroll");
                      }
                    }}
                  >
                    Post to GL
                  </Button>
                )}
                {selectedRun?.status === "posted" && selectedRun && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        await v1Api.hr.releasePayrollRun(token, selectedRun.id);
                        toast.success("Payroll released for payment");
                        await loadPayroll(selectedRun);
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Unable to release payroll",
                        );
                      }
                    }}
                  >
                    Release pay
                  </Button>
                )}
                {selectedRun?.status === "released" && selectedRun && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!token) return;
                      try {
                        const blob = await v1Api.hr.payrollPaymentFile(token, selectedRun.id);
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `${selectedRun.payroll_month}-bank-payments.csv`;
                        link.click();
                        URL.revokeObjectURL(url);
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Unable to export bank payment file",
                        );
                      }
                    }}
                  >
                    <FileDown className="mr-2 h-3.5 w-3.5" />
                    Bank payment file
                  </Button>
                )}
              </div>
              <div className="mb-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                Verify any payroll run that deviates from the last three months before posting.
              </div>
              <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Employees", statutory?.employees || 0],
                  ["PAYE", statutory?.total_paye || 0],
                  ["SHIF", statutory?.total_shif || 0],
                  ["Employee NSSF", statutory?.total_nssf_employee || 0],
                  ["Employer NSSF", statutory?.total_nssf_employer || 0],
                  ["Employee housing levy", statutory?.total_housing_employee || 0],
                  ["Employer housing levy", statutory?.total_housing_employer || 0],
                  ["Total employer cost", statutory?.total_employer_cost || 0],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="mt-1 font-semibold">
                      {label === "Employees" ? value : KES(Number(value))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mb-4 rounded-xl border border-border p-3">
                <div className="mb-3 text-sm font-semibold">Statutory remittance register</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agency</TableHead>
                      <TableHead className="text-right">Due</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Payment evidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {remittances.map((remittance) => (
                      <TableRow key={remittance.id}>
                        <TableCell className="font-medium">{remittance.agency_name}</TableCell>
                        <TableCell className="text-right">{KES(remittance.amount_due)}</TableCell>
                        <TableCell className="text-right">{KES(remittance.amount_paid)}</TableCell>
                        <TableCell className="text-right">
                          {KES(remittance.outstanding_amount)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={remittance.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {remittance.posted_payment_count} posted payment
                          {remittance.posted_payment_count === 1 ? "" : "s"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!remittances.length && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-6 text-center text-sm text-muted-foreground"
                        >
                          No statutory remittance obligations are attached to this payroll run yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">PAYE</TableHead>
                    <TableHead className="text-right">NSSF</TableHead>
                    <TableHead className="text-right">SHIF</TableHead>
                    <TableHead className="text-right">Housing Levy</TableHead>
                    <TableHead className="text-right">Net Pay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.length ? (
                    payslips.map((slip) => {
                      const employeeName =
                        `${slip.first_name || ""} ${slip.last_name || ""}`.trim() ||
                        slip.employee_code ||
                        "Employee";
                      return (
                        <TableRow key={slip.id}>
                          <TableCell className="font-medium">{employeeName}</TableCell>
                          <TableCell className="text-right">{KES(slip.gross_pay)}</TableCell>
                          <TableCell className="text-right text-xs">{KES(slip.paye)}</TableCell>
                          <TableCell className="text-right text-xs">{KES(slip.nssf)}</TableCell>
                          <TableCell className="text-right text-xs">
                            {KES(slip.shif || slip.nhif)}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {KES(slip.housing_levy)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {KES(slip.net_pay)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        {selectedRun
                          ? "No payslips are attached to this payroll run."
                          : "No payroll run exists yet. Choose a month and run payroll to create one."}
                      </TableCell>
                    </TableRow>
                  )}{" "}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recruitment" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Requisitions", recruitmentData.requisitions.length],
                  ["Vacancies", recruitmentData.vacancies.length],
                  ["Candidates", recruitmentData.candidates.length],
                  ["Open roles", recruitmentData.vacancies.filter((row) => String(row.status || "open").toLowerCase() !== "closed").length],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="mt-1 text-2xl font-bold">{String(value)}</div>
                  </div>
                ))}
              </div>
              <div className="mb-3 text-sm text-muted-foreground">
                Open requisitions and candidate pipeline.
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Headcount</TableHead>
                    <TableHead>Urgency</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recruitmentData.requisitions.length ? (
                    recruitmentData.requisitions.slice(0, 8).map((row) => (
                      <TableRow key={String(row.id)}>
                        <TableCell className="font-medium">{String(row.requisition_no || "REQ-")}</TableCell>
                        <TableCell>{String(row.department_id || "—")}</TableCell>
                        <TableCell>{Number(row.headcount_needed || 1)}</TableCell>
                        <TableCell className="capitalize">{String(row.urgency || "normal")}</TableCell>
                        <TableCell>
                          <StatusBadge status={String(row.status || "draft")} />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No requisitions have been created in the live HR system yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leave" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 text-xs text-muted-foreground print:hidden">
                Review the live leave register and approval status for each employee.
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaveRows.length ? (
                    leaveRows.map((row) => (
                      <TableRow key={String(row.id)}>
                        <TableCell className="font-medium">
                          {`${String(row.first_name || "")} ${String(row.last_name || "")}`.trim() ||
                            "Employee"}
                        </TableCell>
                        <TableCell>{String(row.leave_type_name || "Leave")}</TableCell>
                        <TableCell>{String(row.start_date || "—").slice(0, 10)}</TableCell>
                        <TableCell>{String(row.end_date || "—").slice(0, 10)}</TableCell>
                        <TableCell>{Number(row.days_requested || 0)}</TableCell>
                        <TableCell>
                          <StatusBadge status={String(row.status || "pending")} />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No leave requests are present in the register yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="controls" className="mt-4">
          <PhaseGWorkflows employees={apiEmployees} />
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(lifecycleEmployee)}
        onOpenChange={(open) => {
          if (!open) setLifecycleEmployee(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Employee lifecycle</DialogTitle>
            <DialogDescription>
              {lifecycleEmployee?.name} · effective-dated changes require independent approval.
            </DialogDescription>
          </DialogHeader>

          {canRequestLifecycle && (
            <section className="space-y-4 border-b pb-5">
              <h3 className="text-sm font-semibold">Request a change</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Change type</Label>
                  <Select value={lifecycleType} onValueChange={setLifecycleType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="probation_confirmation">Confirm probation</SelectItem>
                      <SelectItem value="promotion">Promotion</SelectItem>
                      <SelectItem value="salary_change">Salary change</SelectItem>
                      <SelectItem value="branch_transfer">Branch transfer</SelectItem>
                      <SelectItem value="termination">Termination</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Effective date</Label>
                  <Input
                    type="date"
                    value={lifecycleEffectiveDate}
                    onChange={(event) => setLifecycleEffectiveDate(event.target.value)}
                  />
                </div>

                {(lifecycleType === "salary_change" || lifecycleType === "promotion") && (
                  <>
                    {lifecycleType === "promotion" && (
                      <>
                        <div className="space-y-1.5">
                          <Label>New job title</Label>
                          <Input
                            value={lifecycleForm.job_title}
                            onChange={(event) =>
                              setLifecycleForm((form) => ({
                                ...form,
                                job_title: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Department</Label>
                          <Input
                            value={lifecycleForm.department}
                            onChange={(event) =>
                              setLifecycleForm((form) => ({
                                ...form,
                                department: event.target.value,
                              }))
                            }
                          />
                        </div>
                      </>
                    )}
                    <div className="space-y-1.5">
                      <Label>
                        {lifecycleType === "promotion"
                          ? "New basic salary (optional)"
                          : "New basic salary"}
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lifecycleForm.basic_salary}
                        onChange={(event) =>
                          setLifecycleForm((form) => ({
                            ...form,
                            basic_salary: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>House allowance (optional)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lifecycleForm.house_allowance}
                        onChange={(event) =>
                          setLifecycleForm((form) => ({
                            ...form,
                            house_allowance: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Transport allowance (optional)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lifecycleForm.transport_allowance}
                        onChange={(event) =>
                          setLifecycleForm((form) => ({
                            ...form,
                            transport_allowance: event.target.value,
                          }))
                        }
                      />
                    </div>
                  </>
                )}

                {lifecycleType === "branch_transfer" && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Destination branch</Label>
                    <Select
                      value={lifecycleForm.branch_id}
                      onValueChange={(branchId) =>
                        setLifecycleForm((form) => ({ ...form, branch_id: branchId }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((branch) => (
                          <SelectItem key={String(branch.id)} value={String(branch.id)}>
                            {String(branch.name)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {lifecycleType === "termination" && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Reason</Label>
                    <Input
                      value={lifecycleForm.reason}
                      onChange={(event) =>
                        setLifecycleForm((form) => ({ ...form, reason: event.target.value }))
                      }
                      maxLength={1000}
                    />
                  </div>
                )}
              </div>
              <Button
                onClick={() => void submitLifecycleRequest()}
                disabled={lifecycleSaving || !lifecycleEffectiveDate}
              >
                {lifecycleSaving ? "Submitting..." : "Submit for approval"}
              </Button>
            </section>
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Request history</h3>
            {lifecycleLoading ? (
              <p className="text-sm text-muted-foreground">Loading lifecycle history...</p>
            ) : null}
            {!lifecycleLoading && lifecycleEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lifecycle requests recorded.</p>
            ) : null}
            {lifecycleEvents.map((event) => {
              const eventId = String(event.id);
              const status = String(event.status || "pending");
              const effectiveDate = String(event.effective_date || "").slice(0, 10);
              const eventType = String(event.event_type || "").replaceAll("_", " ");
              const values =
                event.requested_values && typeof event.requested_values === "object"
                  ? Object.entries(event.requested_values as Record<string, unknown>)
                      .map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`)
                      .join(" · ")
                  : "";
              return (
                <div key={eventId} className="space-y-3 border-b py-3 last:border-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium capitalize">{eventType}</div>
                      <div className="text-xs text-muted-foreground">
                        Effective {effectiveDate}
                        {values ? ` · ${values}` : ""}
                      </div>
                      {event.decision_note ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Review note: {String(event.decision_note)}
                        </div>
                      ) : null}
                    </div>
                    <StatusBadge status={status} />
                  </div>
                  {canApproveLifecycle && status === "pending" && (
                    <div className="flex flex-wrap gap-2">
                      <Input
                        className="min-w-56 flex-1"
                        value={lifecycleDecisionNote}
                        onChange={(inputEvent) => setLifecycleDecisionNote(inputEvent.target.value)}
                        placeholder="Decision note"
                        maxLength={1000}
                      />
                      <Button
                        size="sm"
                        disabled={lifecycleSaving || lifecycleDecisionNote.trim().length < 5}
                        onClick={() => void decideLifecycle(eventId, "approved")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={lifecycleSaving || lifecycleDecisionNote.trim().length < 5}
                        onClick={() => void decideLifecycle(eventId, "rejected")}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                  {canApproveLifecycle && status === "approved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={lifecycleSaving || effectiveDate > localDateInputValue()}
                      onClick={() => void applyLifecycle(eventId)}
                    >
                      Apply effective change
                    </Button>
                  )}
                </div>
              );
            })}
          </section>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLifecycleEmployee(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(onboardingEmployee)}
        onOpenChange={(open) => {
          if (!open) setOnboardingEmployee(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Employee onboarding</DialogTitle>
            <DialogDescription>{onboardingEmployee?.name}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 text-sm font-medium">Checklist</div>
              <div className="space-y-2">
                {Object.keys(onboardingChecklist).length ? (
                  Object.entries(onboardingChecklist).map(([key, checked]) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setOnboardingChecklist((current) => ({
                            ...current,
                            [key]: !current[key],
                          }))
                        }
                      />
                      <span className="capitalize">{key.replaceAll("_", " ")}</span>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No checklist items are available yet for this employee.
                  </p>
                )}
              </div>
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => void saveOnboardingChecklist()}>
                  {onboardingSaving ? "Saving..." : "Save checklist"}
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <div className="mb-3 text-sm font-medium">Documents</div>
              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Document type</Label>
                  <Input
                    value={documentDraft.document_type}
                    onChange={(event) =>
                      setDocumentDraft((draft) => ({ ...draft, document_type: event.target.value }))
                    }
                    placeholder="ID / certificate / contract"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Document name</Label>
                  <Input
                    value={documentDraft.document_name}
                    onChange={(event) =>
                      setDocumentDraft((draft) => ({ ...draft, document_name: event.target.value }))
                    }
                    placeholder="Optional label"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Expiry</Label>
                  <Input
                    type="date"
                    value={documentDraft.expiry_date}
                    onChange={(event) =>
                      setDocumentDraft((draft) => ({ ...draft, expiry_date: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select
                    value={documentDraft.status}
                    onValueChange={(value) =>
                      setDocumentDraft((draft) => ({ ...draft, status: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void submitEmployeeDocument()}>
                {documentSaving ? "Saving..." : "Add document"}
              </Button>

              <div className="mt-3 space-y-2">
                {onboardingDocuments.length ? (
                  onboardingDocuments.map((document) => (
                    <div key={String(document.id)} className="rounded border border-border p-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{String(document.document_type || "Document")}</span>
                        <StatusBadge status={String(document.status || "active")} />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {document.document_name ? String(document.document_name) : "—"}
                        {document.expiry_date ? ` · expires ${String(document.expiry_date).slice(0, 10)}` : ""}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No employee documents have been added.</p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOnboardingEmployee(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(linkingEmployee)}
        onOpenChange={(open) => {
          if (!open) setLinkingEmployee(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link employee login</DialogTitle>
            <DialogDescription>
              {linkingEmployee?.name} can use My Work only after linking an active account with the
              same company email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Employee login email</Label>
            <Input
              type="email"
              value={linkEmail}
              onChange={(event) => setLinkEmail(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkingEmployee(null)}>
              Cancel
            </Button>
            <Button
              disabled={linkSaving || !linkEmail.trim()}
              onClick={() => void linkEmployeeAccount()}
            >
              {linkSaving ? "Linking..." : "Link account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
