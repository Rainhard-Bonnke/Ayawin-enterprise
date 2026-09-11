import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, FileSpreadsheet, FileDown } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { useEffect, useMemo, useState } from "react";
import { QuietNote } from "@/components/QuietNote";
import { exportWorkbook } from "@/lib/excel";
import { useAuth } from "@/lib/auth";
import { fetchReportKpis, fetchReportLibrary, runStandardReport } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Reports & Analytics - Ayawin Enterprise ERP" }] }),
});

const groups: Array<{ title: string; items: string[] }> = [];

function ReportsPage() {
  const { token } = useAuth();
  const [library, setLibrary] = useState<Array<{ code: string; group: string; title: string }> | null>(null);
  const [selectedReport, setSelectedReport] = useState<{ code: string; title: string } | null>(null);
  const [reportRows, setReportRows] = useState<Record<string, unknown>[]>([]);
  const [kpis, setKpis] = useState<Array<Record<string, unknown>>>([]);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 8;

  useEffect(() => {
    if (!token) return;
    fetchReportLibrary(token)
      .then(async (rows) => {
        setLibrary(rows.map((r) => ({ code: r.code, group: r.category, title: r.name })));
        const liveKpis = await fetchReportKpis(token);
        setKpis(liveKpis);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Unable to load report library");
        setLibrary([]);
      });
  }, [token]);

  const catalog = library ?? [];
  const groupOptions = Array.from(new Set(catalog.map((c) => c.group))).sort();

  const entries = useMemo(
    () =>
      catalog.filter((r) => {
        const text = `${r.group} ${r.title}`.toLowerCase();
        return (group === "all" || r.group === group) && text.includes(q.toLowerCase());
      }),
    [catalog, group, q],
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

  const runReport = async (report: { code: string; title: string }) => {
    if (!token) return;
    try {
      const result = await runStandardReport(token, report.code);
      setSelectedReport(report);
      setReportRows(result.rows || []);
      toast.success(`${report.title} loaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to run report");
    }
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
        context={{ groups: groupOptions, entries }}
        className="mb-4"
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.slice(0, 4).map((kpi, index) => {
          const label = String(kpi.label || kpi.name || kpi.code || `KPI ${index + 1}`);
          const value = kpi.value ?? kpi.amount ?? kpi.total ?? "—";
          return <Card key={label}><CardContent className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold">{typeof value === "number" ? value.toLocaleString() : String(value)}</div></CardContent></Card>;
        })}
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <SearchBar value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search reports..." />
          <Select value={group} onValueChange={(value) => { setGroup(value); setPage(1); }}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {groupOptions.map((groupName) => (
                <SelectItem key={groupName} value={groupName}>
                  {groupName}
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
              <CardTitle className="text-base">{report.group}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between rounded-md border border-border p-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-navy" />
                  {report.title}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Run report" onClick={() => void runReport(report)}>
                    <FileDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Run report" onClick={() => void runReport(report)}>
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedReport && (
        <Card className="mt-4">
          <CardHeader><CardTitle>{selectedReport.title} results</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-4">
            {reportRows.length ? <Table rows={reportRows} /> : <p className="text-sm text-muted-foreground">This report returned no rows.</p>}
          </CardContent>
        </Card>
      )}

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

function Table({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = Object.keys(rows[0] || {});
  return <table className="w-full text-sm"><thead><tr className="border-b border-border text-left">{columns.map((column) => <th key={column} className="px-3 py-2 font-medium">{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b border-border/60">{columns.map((column) => <td key={column} className="px-3 py-2">{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table>;
}
