import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, FileSpreadsheet, FileDown } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { useMemo, useState } from "react";
import { QuietNote } from "@/components/QuietNote";
import { exportWorkbook } from "@/lib/excel";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Reports & Analytics - Ayawin Enterprise ERP" }] }),
});

const groups = [
  { title: "Sales", items: ["Daily Sales", "Sales by Product", "Sales by Customer", "Sales by Rep", "Commission Report"] },
  { title: "Inventory", items: ["Stock on Hand", "Stock Movement", "Stock Valuation (FIFO)", "Expiring Stock", "Low Stock Alert"] },
  { title: "Finance", items: ["Profit & Loss", "Balance Sheet", "Cash Flow", "Trial Balance", "Bank Reconciliation"] },
  { title: "KRA Compliance", items: ["VAT Return (16%)", "Excise Duty Return", "Withholding Tax", "ETR Reconciliation"] },
  { title: "Operations", items: ["Delivery Performance", "Driver Performance", "Customer Aging", "Supplier Aging"] },
];

function ReportsPage() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const entries = useMemo(
    () =>
      groups
        .flatMap((g) => g.items.map((item) => ({ group: g.title, title: item })))
        .filter((r) => {
          const text = `${r.group} ${r.title}`.toLowerCase();
          return (group === "all" || r.group === group) && text.includes(q.toLowerCase());
        }),
    [group, q],
  );

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const paged = entries.slice((page - 1) * pageSize, page * pageSize);
  const exportReports = () => {
    exportWorkbook("ayawin-enterprise-reports.xlsx", [
      {
        name: "Report Index",
        rows: entries.map((entry) => ({
          Group: entry.group,
          Report: entry.title,
        })),
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        description="Export all reports as Excel with KRA-ready templates."
        actions={<Button variant="outline" onClick={exportReports}>Export XLSX</Button>}
      />

      <QuietNote
        scenario="reports"
        contextKey={`${group}-${q}`}
        context={{ groups, entries }}
        className="mb-4"
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <SearchBar value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search reports..." />
          <Select value={group} onValueChange={(value) => { setGroup(value); setPage(1); }}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.title} value={g.title}>
                  {g.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto text-xs text-muted-foreground">
            Showing {paged.length} of {entries.length} reports
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {paged.map((report) => (
          <Card key={`${report.group}-${report.title}`}>
            <CardHeader>
              <CardTitle className="font-display text-base">{report.group}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between rounded-md border border-border p-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-navy" />
                  {report.title}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="XLSX">
                    <FileDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="XLSX">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {paged.length === 0 && (
        <Card className="mt-4">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No reports match your filters.
          </CardContent>
        </Card>
      )}

      <ListPagination
        page={page}
        totalPages={totalPages}
        totalItems={entries.length}
        pageSize={pageSize}
        onPageChange={setPage}
      />
    </div>
  );
}
