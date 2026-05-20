import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { employees } from "@/lib/mock-data";
import { KES } from "@/lib/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, FileDown } from "lucide-react";

export const Route = createFileRoute("/_app/hr")({
  component: HRPage,
  head: () => ({ meta: [{ title: "HR & Payroll — Martin Enterprise ERP" }] }),
});

// Approx Kenya statutory deductions
function payeKE(gross: number) {
  let tax = 0;
  let rem = gross;
  const bands: [number, number][] = [[24000, 0.1], [8333, 0.25], [467667, 0.3], [Infinity, 0.325]];
  for (const [band, rate] of bands) {
    const take = Math.min(rem, band);
    tax += take * rate;
    rem -= take;
    if (rem <= 0) break;
  }
  return Math.max(0, tax - 2400); // personal relief
}
function nssf(g: number) { return Math.min(g * 0.06, 4320); }
function shif(g: number) { return Math.max(300, g * 0.0275); }
function housing(g: number) { return g * 0.015; }

function HRPage() {
  return (
    <div>
      <PageHeader
        title="Human Resources"
        description="Employees, attendance, leave & Kenya-statutory payroll."
        actions={<Button className="bg-navy text-navy-foreground hover:bg-navy/90"><Plus className="mr-2 h-4 w-4" />Add Employee</Button>}
      />

      <Tabs defaultValue="employees">
        <TabsList>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="payroll">Payroll</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="mt-4">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader><TableRow>
                <TableHead>ID</TableHead><TableHead>Name</TableHead><TableHead>Department</TableHead>
                <TableHead>Role</TableHead><TableHead className="text-right">Gross Salary</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {employees.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.id}</TableCell>
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell>{e.department}</TableCell>
                    <TableCell>{e.role}</TableCell>
                    <TableCell className="text-right">{KES(e.salary)}</TableCell>
                    <TableCell><StatusBadge status={e.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="payroll" className="mt-4">
          <Card><CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm text-muted-foreground">Payroll Run — May 2026</div>
              <Button variant="outline" size="sm"><FileDown className="mr-2 h-3.5 w-3.5" />Generate Payslips (PDF)</Button>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">PAYE</TableHead>
                <TableHead className="text-right">NSSF</TableHead>
                <TableHead className="text-right">SHIF</TableHead>
                <TableHead className="text-right">Housing Levy</TableHead>
                <TableHead className="text-right">Net Pay</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {employees.filter((e) => e.status === "Active").map((e) => {
                  const p = payeKE(e.salary), n = nssf(e.salary), s = shif(e.salary), h = housing(e.salary);
                  const net = e.salary - p - n - s - h;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell className="text-right">{KES(e.salary)}</TableCell>
                      <TableCell className="text-right text-xs">{KES(p)}</TableCell>
                      <TableCell className="text-right text-xs">{KES(n)}</TableCell>
                      <TableCell className="text-right text-xs">{KES(s)}</TableCell>
                      <TableCell className="text-right text-xs">{KES(h)}</TableCell>
                      <TableCell className="text-right font-semibold">{KES(net)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="leave" className="mt-4">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>From</TableHead>
                <TableHead>To</TableHead><TableHead>Days</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                <TableRow><TableCell>Mercy Wambui</TableCell><TableCell>Annual</TableCell><TableCell>18/05/2026</TableCell><TableCell>30/05/2026</TableCell><TableCell>10</TableCell><TableCell><StatusBadge status="Approved" /></TableCell></TableRow>
                <TableRow><TableCell>Brian Otieno</TableCell><TableCell>Sick</TableCell><TableCell>12/05/2026</TableCell><TableCell>13/05/2026</TableCell><TableCell>2</TableCell><TableCell><StatusBadge status="Approved" /></TableCell></TableRow>
                <TableRow><TableCell>Faith Achieng</TableCell><TableCell>Annual</TableCell><TableCell>05/06/2026</TableCell><TableCell>12/06/2026</TableCell><TableCell>6</TableCell><TableCell><StatusBadge status="Pending" /></TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
