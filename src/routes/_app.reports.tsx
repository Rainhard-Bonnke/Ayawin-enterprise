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
import {
  downloadReportExport,
  fetchReportKpiReconcile,
  fetchReportLibrary,
  type DashboardDatePreset,
  type ReportRunOptions,
} from "@/lib/api";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Reports & Analytics - Ayawin Stock Solutions ERP" }] }),
});

type ReportEntry = { code: string; group: string; title: string };

const DATE_PRESETS: { value: DashboardDatePreset; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "mtd", label: "Month to date" },
  { value: "6m", label: "Last 6 months" },
  { value: "ytd", label: "Year to date" },
];

function ReportsPage() {
  const { token } = useAuth();
  const [library, setLibrary] = useState<ReportEntry[] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [page, setPage] = useState(1);
  const [preset, setPreset] = useState<DashboardDatePreset>("6m");
  const [comparePrior, setComparePrior] = useState(false);
  const [kpiOk, setKpiOk] = useState<boolean | null>(null);
  const pageSize = 8;

  const reportOpts = useMemo((): ReportRunOptions => {
    const opts: ReportRunOptions = { preset };
    if (comparePrior) opts.compare_prior = true;
    return opts;
  }, [preset, comparePrior]);

  useEffect(() => {
    if (!token) return;
    fetchReportLibrary(token)
      .then((rows) => {
        setLibrary(rows.map((r) => ({ code: r.code, group: r.category, title: r.name })));
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Unable to load report library");
        setLibrary([]);
      });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchReportKpiReconcile(token, reportOpts)
      .then((data) => setKpiOk(data.all_matched))
      .catch(() => setKpiOk(null));
  }, [token, reportOpts]);

  const catalog = library ?? [];
  const groupOptions = Array.from(new Set(catalog.map((c) => c.group))).sort();

  const entries = useMemo(
    () =>
      catalog.filter((r) => {
        const text = `${r.group} ${r.title} ${r.code}`.toLowerCase();
        return (group === "all" || r.group === group) && text.includes(q.toLowerCase());
      }),
    [catalog, group, q],
  );

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const paged = entries.slice((page - 1) * pageSize, page * pageSize);
  const periodLabel = DATE_PRESETS.find((p) => p.value === preset)?.label ?? preset;

  const exportIndex = () => {
    exportWorkbook("ayawin-enterprise-reports.xlsx", [
      {
        name: "Report Index",
        rows: entries.map((entry) => ({
          Code: entry.code,
          Group: entry.group,
          Report: entry.title,
        })),
      },
    ]);
  };

  const runOptsFor = (report: ReportEntry): ReportRunOptions => {
    const opts = { ...reportOpts };
    if (report.code === "RPT-COMPARE" || report.title.toLowerCase().includes("comparative")) {
      opts.compare_prior = true;
    }
    return opts;
  };

  const handleExport = async (report: ReportEntry, format: "xlsx" | "csv" | "pdf") => {
    if (!token) return;
    setRunning(report.code);
    try {
      const ext = format === "xlsx" ? "xlsx" : format === "pdf" ? "pdf" : "csv";
      await downloadReportExport(
        token,
        report.code,
        format,
        `${report.code}.${ext}`,
        runOptsFor(report),
      );
      toast.success(`${report.title} ${ext.toUpperCase()} downloaded`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setRunning(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        description="Run saved reports from the ERP library with live PostgreSQL data and server-side exports."
        actions={<Button variant="outline" onClick={exportIndex}>Export index (XLSX)</Button>}
      />

      {kpiOk !== null && (
        <div
          className={`mb-4 rounded-md border px-4 py-2 text-sm ${
            kpiOk ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {kpiOk
            ? "Report KPIs match dashboard totals for the selected period."
            : "Some report metrics differ from dashboard KPIs — run RPT-KPI-RECON for details."}
        </div>
      )}

      <QuietNote
        scenario="reports"
        contextKey={`${group}-${q}-${preset}`}
        context={{ groups: groupOptions, entries, preset }}
        className="mb-4"
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
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
          <Select value={preset} onValueChange={(v) => setPreset(v as DashboardDatePreset)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Checkbox
              id="compare-prior"
              checked={comparePrior}
              onCheckedChange={(v) => setComparePrior(v === true)}
            />
            <Label htmlFor="compare-prior" className="text-sm font-normal cursor-pointer">
              Compare prior period
            </Label>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            Period: {periodLabel} · {paged.length} of {entries.length} reports
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {paged.map((report) => (
          <Card key={report.code}>
            <CardHeader>
              <CardTitle className="text-base">{report.group}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between rounded-md border border-border p-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-navy" />
                  <div>
                    <div>{report.title}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{report.code}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Download XLSX (server)"
                    disabled={running === report.code}
                    onClick={() => void handleExport(report, "xlsx")}
                  >
                    <FileDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Download CSV"
                    disabled={running === report.code}
                    onClick={() => void handleExport(report, "csv")}
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Download PDF"
                    disabled={running === report.code}
                    onClick={() => void handleExport(report, "pdf")}
                  >
                    <FileText className="h-3.5 w-3.5" />
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
