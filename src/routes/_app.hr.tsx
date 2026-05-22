import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { employees } from "@/lib/mock-data";
import { KES } from "@/lib/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, FileDown, ArrowUpDown } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { payrollVariance } from "@/lib/smartSignals";
import { exportWorkbook } from "@/lib/excel";
import { trackEvent } from "@/lib/event-tracker";
import { useState } from "react";

export const Route = createFileRoute("/_app/hr")({
  component: HRPage,
  head: () => ({ meta: [{ title: "HR & Payroll - Ayawin Enterprise ERP" }] }),
});

function payeKE(gross: number) {
  let tax = 0;
  let rem = gross;
  const bands: [number, number][] = [
    [24000, 0.1],
    [8333, 0.25],
    [467667, 0.3],
    [Infinity, 0.325],
  ];
  for (const [band, rate] of bands) {
    const take = Math.min(rem, band);
    tax += take * rate;
    rem -= take;
    if (rem <= 0) break;
  }
  return Math.max(0, tax - 2400);
}
function nssf(g: number) {
  return Math.min(g * 0.06, 4320);
}
function nhif(g: number) {
  return Math.max(300, g * 0.0275);
}
function housing(g: number) {
  return g * 0.015;
}

function HRPage() {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("all");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const employeeRows = employees
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
        rows: employees
          .filter((e) => e.status === "Active")
          .map((e) => {
            const paye = payeKE(e.salary);
            const nssfValue = nssf(e.salary);
            const nhifValue = nhif(e.salary);
            const housingValue = housing(e.salary);
            const net = e.salary - paye - nssfValue - nhifValue - housingValue;
            return {
              Name: e.name,
              Gross: e.salary,
              PAYE: paye,
              NSSF: nssfValue,
              NHIF: nhifValue,
              "Housing Levy": housingValue,
              Net: net,
            };
          }),
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Human Resources"
        description="Employees, attendance, leave and Kenya statutory payroll."
        actions={<Button className="bg-navy text-navy-foreground hover:bg-navy/90" onClick={exportHR}><Plus className="mr-2 h-4 w-4" />Export XLSX</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Employees", v: String(employees.length) },
          { l: "On Leave", v: "1" },
          { l: "Payroll Total", v: KES(employees.reduce((sum, e) => sum + e.salary, 0)) },
          { l: "Active Contracts", v: "8" },
        ].map((k) => (
          <Card key={k.l}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
              <div className="mt-1 font-display text-2xl font-bold">{k.v}</div>
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
                    {Array.from(new Set(employees.map((e) => e.department))).map((d) => (
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
                        <StatusBadge status={e.status} />
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
              <div className="mb-3 text-sm text-muted-foreground">Daily attendance register - 21/05/2026</div>
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
                  {[
                    ["Grace Wanjiku", "Sales", "08:02", "17:16", "Present"],
                    ["Brian Otieno", "Sales", "08:18", "On route", "Present"],
                    ["Faith Achieng", "Warehouse", "07:44", "17:05", "Present"],
                    ["Mercy Wambui", "Sales", "-", "-", "On Leave"],
                  ].map((row) => (
                    <TableRow key={row[0]}>
                      <TableCell className="font-medium">{row[0]}</TableCell>
                      <TableCell>{row[1]}</TableCell>
                      <TableCell>{row[2]}</TableCell>
                      <TableCell>{row[3]}</TableCell>
                      <TableCell><StatusBadge status={row[4]} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">Payroll Run - May 2026</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void trackEvent({
                      action: "payslip_export_requested",
                      entityType: "payroll",
                      entityId: "may-2026",
                      details: { employees: employees.filter((e) => e.status === "Active").length },
                      scenario: "hr",
                      context: { department, sort, q },
                    });
                    exportHR();
                  }}
                >
                  <FileDown className="mr-2 h-3.5 w-3.5" />
                  Generate Payslips (XLSX)
                </Button>
              </div>
              <div className="mb-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                Verify any payroll run that deviates from the last three months before posting.
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees
                    .filter((e) => e.status === "Active")
                    .map((e) => {
                      const paye = payeKE(e.salary);
                      const nssfValue = nssf(e.salary);
                      const nhifValue = nhif(e.salary);
                      const housingValue = housing(e.salary);
                      const net = e.salary - paye - nssfValue - nhifValue - housingValue;
                      const variance = payrollVariance(e.name);

                      return (
                        <TableRow key={e.id}>
                          <TableCell className="font-medium">{e.name}</TableCell>
                          <TableCell className="text-right">{KES(e.salary)}</TableCell>
                          <TableCell className="text-right text-xs">{KES(paye)}</TableCell>
                          <TableCell className="text-right text-xs">{KES(nssfValue)}</TableCell>
                          <TableCell className="text-right text-xs">{KES(nhifValue)}</TableCell>
                          <TableCell className="text-right text-xs">{KES(housingValue)}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {KES(net)}
                            {variance?.flag && <div className="text-[10px] text-warning">{variance.message}</div>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recruitment" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 text-sm text-muted-foreground">Open requisitions and candidate pipeline.</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Candidates</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ["Accounts Assistant", "Finance", "6", "Shortlisting", "Open"],
                    ["Delivery Driver", "Logistics", "12", "Interviews", "Open"],
                    ["Warehouse Clerk", "Warehouse", "4", "Offer", "Pending"],
                  ].map((row) => (
                    <TableRow key={row[0]}>
                      <TableCell className="font-medium">{row[0]}</TableCell>
                      <TableCell>{row[1]}</TableCell>
                      <TableCell>{row[2]}</TableCell>
                      <TableCell>{row[3]}</TableCell>
                      <TableCell><StatusBadge status={row[4]} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leave" className="mt-4">
            <Card>
              <CardContent className="p-4">
                <div className="mb-3 text-xs text-muted-foreground print:hidden">
                  Print-friendly payslip output is available via the export button above or your browser print dialog.
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
                  <TableRow>
                    <TableCell>Mercy Wambui</TableCell>
                    <TableCell>Annual</TableCell>
                    <TableCell>18/05/2026</TableCell>
                    <TableCell>30/05/2026</TableCell>
                    <TableCell>10</TableCell>
                    <TableCell>
                      <StatusBadge status="Approved" />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Brian Otieno</TableCell>
                    <TableCell>Sick</TableCell>
                    <TableCell>12/05/2026</TableCell>
                    <TableCell>13/05/2026</TableCell>
                    <TableCell>2</TableCell>
                    <TableCell>
                      <StatusBadge status="Approved" />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Faith Achieng</TableCell>
                    <TableCell>Annual</TableCell>
                    <TableCell>05/06/2026</TableCell>
                    <TableCell>12/06/2026</TableCell>
                    <TableCell>6</TableCell>
                    <TableCell>
                      <StatusBadge status="Pending" />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
