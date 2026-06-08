import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KES } from "@/lib/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, FileDown, ArrowUpDown, Upload } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackEvent } from "@/lib/event-tracker";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  approveLeaveApplication,
  createLeaveApplication,
  createPayrollRun,
  fetchAttendance,
  importAttendanceRows,
  fetchHrEmployees,
  fetchLeaveApplications,
  fetchLeaveCalendar,
  fetchLeaveTypes,
  downloadPayslipPdf,
  fetchPayrollPayslips,
  fetchPayrollRuns,
  postPayrollRun,
  type AttendanceRow,
  type BackendEmployee,
  type LeaveApplicationRow,
  type PayrollRunRow,
  type PayslipRow,
} from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/hr")({
  component: HRPage,
  head: () => ({ meta: [{ title: "HR & Payroll - Ayawin Stock Solutions ERP" }] }),
});

function parseAttendanceCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function HRPage() {
  const { token } = useAuth();
  const [apiEmployees, setApiEmployees] = useState<BackendEmployee[] | null>(null);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRunRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [payslips, setPayslips] = useState<PayslipRow[]>([]);
  const [leaveApps, setLeaveApps] = useState<LeaveApplicationRow[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ employee_id: "", leave_type_id: "", start_date: "", end_date: "", reason: "" });
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [leaveCalendar, setLeaveCalendar] = useState<Array<{
    date: string;
    available_count: number;
    on_leave_count: number;
    is_holiday: boolean;
    on_leave: Array<{ name: string; department: string }>;
  }>>([]);
  const [payrollBusy, setPayrollBusy] = useState(false);
  const [attendanceImporting, setAttendanceImporting] = useState(false);
  const attendanceFileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("all");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const loadAttendance = useCallback(() => {
    if (!token) return;
    fetchAttendance(token)
      .then(setAttendanceRows)
      .catch(() => setAttendanceRows([]));
  }, [token]);

  const loadPayrollRuns = useCallback(() => {
    if (!token) return;
    fetchPayrollRuns(token)
      .then((runs) => {
        setPayrollRuns(runs);
        setSelectedRunId((current) => {
          if (current && runs.some((r) => r.id === current)) return current;
          return runs[0]?.id || "";
        });
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Unable to load payroll runs"));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchHrEmployees(token)
      .then((rows) => setApiEmployees(rows))
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Unable to load HR employees");
        setApiEmployees([]);
      });
    loadPayrollRuns();
    fetchLeaveApplications(token)
      .then(setLeaveApps)
      .catch(() => setLeaveApps([]));
    fetchLeaveTypes(token)
      .then((rows) => setLeaveTypes(rows.map((r) => ({ id: String(r.id), name: String(r.name || "Leave") }))))
      .catch(() => setLeaveTypes([]));
    loadAttendance();
    const from = new Date().toISOString().slice(0, 10);
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 13);
    void fetchLeaveCalendar(token, from, toDate.toISOString().slice(0, 10))
      .then((c) => setLeaveCalendar(c.days || []))
      .catch(() => setLeaveCalendar([]));
  }, [token, loadPayrollRuns]);

  useEffect(() => {
    if (!token || !selectedRunId) {
      setPayslips([]);
      return;
    }
    fetchPayrollPayslips(token, selectedRunId)
      .then(setPayslips)
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Unable to load payslips");
        setPayslips([]);
      });
  }, [token, selectedRunId]);

  const selectedRun = payrollRuns.find((r) => r.id === selectedRunId);
  const payrollMonthLabel = selectedRun?.payrollMonth || new Date().toISOString().slice(0, 7);

  const handleRunPayroll = async () => {
    if (!token) return;
    setPayrollBusy(true);
    try {
      const month = `${payrollMonthLabel}-01`;
      await createPayrollRun(token, month);
      toast.success("Payroll calculated for active employees.");
      loadPayrollRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payroll run failed");
    } finally {
      setPayrollBusy(false);
    }
  };

  const handlePostPayroll = async () => {
    if (!token || !selectedRunId) return;
    setPayrollBusy(true);
    try {
      await postPayrollRun(token, selectedRunId);
      toast.success("Payroll posted to the general ledger.");
      loadPayrollRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not post payroll");
    } finally {
      setPayrollBusy(false);
    }
  };

  const sourceEmployees = (apiEmployees ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    department: e.department,
    role: e.role,
    salary: e.salary,
    status: e.status,
  }));

  const employeeRows = sourceEmployees
    .filter((e) => (department === "all" || e.department === department) && (e.name.toLowerCase().includes(q.toLowerCase()) || e.role.toLowerCase().includes(q.toLowerCase())))
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
    exportWorkbook("ayawin-enterprise-hr.xlsx", [
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
      {
        name: "Payroll",
        rows: payslips.map((p) => ({
          Code: p.employeeCode,
          Name: p.employeeName,
          Gross: p.gross,
          PAYE: p.paye,
          NSSF: p.nssf,
          NHIF: p.nhif,
          "Housing Levy": p.housingLevy,
          Net: p.net,
        })),
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Human Resources"
        description="Employees, attendance, leave and Kenya statutory payroll."
        actions={<Button onClick={exportHR}><Plus className="mr-2 h-4 w-4" />Export XLSX</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Employees", v: String(sourceEmployees.length) },
          { l: "Leave requests", v: String(leaveApps.filter((l) => l.status.toLowerCase() === "pending").length) },
          { l: "Payroll net (run)", v: KES(payslips.reduce((sum, p) => sum + p.net, 0)) },
          { l: "Active Contracts", v: String(sourceEmployees.filter((e) => e.status === "Active").length) },
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

      <Tabs defaultValue="employees">
        <TabsList>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
          <TabsTrigger value="recruitment">Recruitment</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="calendar">Team calendar</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <SearchBar value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search employee or role..." />
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {Array.from(new Set(sourceEmployees.map((e) => e.department))).map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
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
                        <StatusBadge status={e.profileComplete === false ? "Incomplete" : e.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {paged.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        No employees match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <ListPagination page={page} totalPages={totalPages} totalItems={employeeRows.length} pageSize={pageSize} onPageChange={setPage} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Attendance register from the database. Import CSV with columns: employee_code, attendance_date, check_in, check_out, hours_worked, status.
                </p>
                <div>
                  <input
                    ref={attendanceFileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file || !token) return;
                      setAttendanceImporting(true);
                      void file
                        .text()
                        .then((text) => {
                          const parsed = parseAttendanceCsv(text);
                          const rows = parsed.map((r) => ({
                            employee_code: r.employee_code || r.code,
                            attendance_date: r.attendance_date || r.date,
                            check_in: r.check_in || r.clock_in || null,
                            check_out: r.check_out || r.clock_out || null,
                            hours_worked: Number(r.hours_worked || r.hours || 8),
                            overtime_hours: Number(r.overtime_hours || 0),
                            status: r.status || "present",
                          }));
                          const bad = rows.findIndex((r) => !r.employee_code || !r.attendance_date);
                          if (bad >= 0) {
                            toast.error(`Row ${bad + 2}: employee_code and attendance_date are required`);
                            return Promise.resolve(null);
                          }
                          return importAttendanceRows(token, rows);
                        })
                        .then((result) => {
                          if (!result) return;
                          toast.success(`Imported ${result.imported} attendance row(s)`);
                          loadAttendance();
                        })
                        .catch((err) =>
                          toast.error(err instanceof Error ? err.message : "Attendance import failed"),
                        )
                        .finally(() => {
                          setAttendanceImporting(false);
                          if (attendanceFileRef.current) attendanceFileRef.current.value = "";
                        });
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={attendanceImporting}
                    onClick={() => attendanceFileRef.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {attendanceImporting ? "Importing…" : "Import CSV"}
                  </Button>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Clock In</TableHead>
                    <TableHead>Clock Out</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendanceRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs">{row.date}</TableCell>
                      <TableCell className="font-medium">{row.employeeName}</TableCell>
                      <TableCell>{row.department}</TableCell>
                      <TableCell>{row.checkIn}</TableCell>
                      <TableCell>{row.checkOut}</TableCell>
                      <TableCell><StatusBadge status={row.status} /></TableCell>
                    </TableRow>
                  ))}
                  {attendanceRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        No attendance records yet. Use Import CSV above.
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
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={selectedRunId || "none"} onValueChange={(v) => v !== "none" && setSelectedRunId(v)}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="Select payroll run" />
                    </SelectTrigger>
                    <SelectContent>
                      {payrollRuns.length === 0 && <SelectItem value="none">No runs yet</SelectItem>}
                      {payrollRuns.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.runNo} ({r.payrollMonth}) — {r.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">
                    {payslips.length} payslip{payslips.length === 1 ? "" : "s"}
                    {selectedRun?.status === "posted" ? " · Posted to GL" : ""}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={payrollBusy} onClick={() => void handleRunPayroll()}>
                    Run payroll ({payrollMonthLabel})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={payrollBusy || !selectedRunId || selectedRun?.status === "posted"}
                    onClick={() => void handlePostPayroll()}
                  >
                    Post to GL
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void trackEvent({
                        action: "payslip_export_requested",
                        entityType: "payroll",
                        entityId: selectedRunId || "none",
                        details: { payslips: payslips.length },
                        scenario: "hr",
                        context: { department, sort, q },
                      });
                      exportHR();
                    }}
                  >
                    <FileDown className="mr-2 h-3.5 w-3.5" />
                    Export payslips (XLSX)
                  </Button>
                </div>
              </div>
              <div className="mb-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                Payroll uses Kenya statutory bands from server config (PAYE, NHIF, NSSF, housing levy). Review before posting to GL.
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">PAYE</TableHead>
                    <TableHead className="text-right">NSSF</TableHead>
                    <TableHead className="text-right">NHIF</TableHead>
                    <TableHead className="text-right">Housing Levy</TableHead>
                    <TableHead className="text-right">Net Pay</TableHead>
                    <TableHead className="text-right">PDF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {p.employeeName}
                        <div className="text-[10px] text-muted-foreground">{p.employeeCode}</div>
                      </TableCell>
                      <TableCell className="text-right">{KES(p.gross)}</TableCell>
                      <TableCell className="text-right text-xs">{KES(p.paye)}</TableCell>
                      <TableCell className="text-right text-xs">{KES(p.nssf)}</TableCell>
                      <TableCell className="text-right text-xs">{KES(p.nhif)}</TableCell>
                      <TableCell className="text-right text-xs">{KES(p.housingLevy)}</TableCell>
                      <TableCell className="text-right font-semibold">{KES(p.net)}</TableCell>
                      <TableCell className="text-right">
                        {selectedRunId && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              if (!token) return;
                              try {
                                await downloadPayslipPdf(token, selectedRunId, p.id, p.employeeCode);
                                toast.success("Payslip PDF downloaded");
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "PDF failed");
                              }
                            }}
                          >
                            <FileDown className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {payslips.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                        No payslips for this run. Click &quot;Run payroll&quot; to calculate from active employee contracts.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recruitment" className="mt-4">
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Recruitment and applicant tracking are not yet exposed in the API. Use leave and employee master data for workforce planning.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 text-sm text-muted-foreground">Team availability — next 14 days (approved leave).</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">On leave</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaveCalendar.map((day) => (
                    <TableRow key={day.date}>
                      <TableCell>{day.date}</TableCell>
                      <TableCell className="text-right">{day.available_count}</TableCell>
                      <TableCell className="text-right">{day.on_leave_count}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {day.is_holiday ? "Public holiday" : day.on_leave.map((p) => p.name).join(", ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {leaveCalendar.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                        No calendar data for this period.
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
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">Leave applications from the HR API.</div>
                <Button size="sm" onClick={() => setLeaveDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Apply for Leave
                </Button>
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
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaveApps.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.employeeName}</TableCell>
                      <TableCell>{row.leaveType}</TableCell>
                      <TableCell>{row.startDate}</TableCell>
                      <TableCell>{row.endDate}</TableCell>
                      <TableCell>{row.days}</TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {row.status.toLowerCase() === "pending" && token && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              void approveLeaveApplication(token, row.id)
                                .then(() => {
                                  toast.success("Leave approved");
                                  return fetchLeaveApplications(token);
                                })
                                .then(setLeaveApps)
                                .catch((err) => toast.error(err instanceof Error ? err.message : "Unable to approve"));
                            }}
                          >
                            Approve
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {leaveApps.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                        No leave applications on file.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply for Leave</DialogTitle>
            <DialogDescription>Submit a leave application for approval.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={leaveForm.employee_id} onValueChange={(v) => setLeaveForm((p) => ({ ...p, employee_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {(apiEmployees || []).map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Leave type</Label>
              <Select value={leaveForm.leave_type_id} onValueChange={(v) => setLeaveForm((p) => ({ ...p, leave_type_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" value={leaveForm.start_date} onChange={(e) => setLeaveForm((p) => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>End date</Label>
                <Input type="date" value={leaveForm.end_date} onChange={(e) => setLeaveForm((p) => ({ ...p, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Input value={leaveForm.reason} onChange={(e) => setLeaveForm((p) => ({ ...p, reason: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaveDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={leaveSaving || !leaveForm.employee_id || !leaveForm.leave_type_id || !leaveForm.start_date || !leaveForm.end_date}
              onClick={() => {
                if (!token) return;
                setLeaveSaving(true);
                const days = Math.max(1, Math.ceil((new Date(leaveForm.end_date).getTime() - new Date(leaveForm.start_date).getTime()) / 86400000) + 1);
                void createLeaveApplication(token, { ...leaveForm, days_requested: days })
                  .then(() => {
                    toast.success("Leave application submitted");
                    setLeaveDialogOpen(false);
                    return fetchLeaveApplications(token);
                  })
                  .then(setLeaveApps)
                  .catch((err) => toast.error(err instanceof Error ? err.message : "Unable to submit leave"))
                  .finally(() => setLeaveSaving(false));
              }}
            >
              {leaveSaving ? "Submitting…" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
