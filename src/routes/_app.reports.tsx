import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, FileSpreadsheet, FileDown, Sparkles, LoaderCircle, ShieldCheck } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { useEffect, useMemo, useState } from "react";
import { QuietNote } from "@/components/QuietNote";
import { exportWorkbook } from "@/lib/excel";
import { useAuth } from "@/lib/auth";
import { fetchReportKpis, fetchReportLibrary, runStandardReport } from "@/lib/api";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { v1Api } from "@/lib/api-v1";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Reports & Analytics - Ayawin Stock Solution" }] }),
});

const groups: Array<{ title: string; items: string[] }> = [];

function ReportsPage() {
  const { token } = useAuth();
  const [library, setLibrary] = useState<Array<{
    code: string;
    group: string;
    title: string;
  }> | null>(null);
  const [selectedReport, setSelectedReport] = useState<{ code: string; title: string } | null>(
    null,
  );
  const [reportRows, setReportRows] = useState<Record<string, unknown>[]>([]);
  const [kpis, setKpis] = useState<Array<Record<string, unknown>>>([]);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("all");
  const [page, setPage] = useState(1);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<Awaited<ReturnType<typeof v1Api.inventory.analyzeBusiness>> | null>(null);
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
    exportWorkbook("ayawin-stock-solution-reports.xlsx", [
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

  const askAssistant = async (question = aiQuestion) => {
    if (!token || aiLoading) return;
    setAiLoading(true);
    try {
      const result = await v1Api.inventory.analyzeBusiness(token, question.trim());
      setAiResult(result);
      setAiQuestion(question);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to analyze ERP data");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        description="Export all reports as Excel with KRA-ready templates."
        actions={
          <Button variant="outline" onClick={exportReports}>
            Export XLSX
          </Button>
        }
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
          return (
            <Card key={label}>
              <CardContent className="p-4">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {label}
                </div>
                <div className="mt-1 text-2xl font-bold">
                  {typeof value === "number" ? value.toLocaleString() : String(value)}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mb-5 overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.08] via-card to-cyan-500/[0.06] shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="h-5 w-5 text-primary" /> Ayawin AI business analyst</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Ask for a management summary or review of sales, delivery, stock, driver counts, procurement, finance, assets and people totals your role can access. When a model provider is configured, your question and these aggregated totals are sent to it.</p>
            </div>
            <Badge variant="outline" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Read-only analysis</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Textarea
              value={aiQuestion}
              onChange={(event) => setAiQuestion(event.target.value.slice(0, 1000))}
              placeholder="Example: What are the biggest operational risks I should review today?"
              className="min-h-[76px] flex-1 bg-background/80"
              maxLength={1000}
              aria-label="Ask the AI business analyst"
            />
            <Button className="sm:self-end" disabled={aiLoading} onClick={() => void askAssistant()}>
              {aiLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {aiLoading ? "Analyzing…" : "Analyze"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {["Give me a management overview", "What needs attention in inventory?", "Review overdue receivables and operational risks"].map((prompt) => (
              <Button key={prompt} size="sm" variant="outline" disabled={aiLoading} onClick={() => void askAssistant(prompt)}>{prompt}</Button>
            ))}
          </div>
          {aiResult && (
            <div className="space-y-3 rounded-xl border border-border/80 bg-background/90 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Analysis</div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{aiResult.mode === "model" ? `${aiResult.provider} · ${aiResult.model}` : "Local rules"}</Badge>
                  <span className="text-xs text-muted-foreground">As of {new Date(aiResult.snapshot.asOf).toLocaleString()}</span>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-6">{aiResult.answer}</p>
              {aiResult.observations.length > 0 && (
                <div className="grid gap-2 md:grid-cols-2">
                  {aiResult.observations.map((item, index) => (
                    <div key={`${item.title}-${index}`} className="rounded-lg border border-border p-3">
                      <div className="mb-1 flex items-center justify-between gap-2"><span className="text-sm font-semibold">{item.title}</span><Badge variant={item.priority === "high" ? "destructive" : "outline"}>{item.priority}</Badge></div>
                      <p className="text-sm text-muted-foreground">{item.detail}</p>
                      {item.evidence.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Evidence: {item.evidence.join(", ")}</p>}
                    </div>
                  ))}
                </div>
              )}
              {aiResult.actions.length > 0 && <div><div className="mb-1 text-sm font-semibold">Suggested next steps</div><ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">{aiResult.actions.map((action, index) => <li key={`${action}-${index}`}>{action}</li>)}</ul></div>}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                <span>Only aggregated data permitted for your role was included. With a model provider, this snapshot and your question are sent to that provider. Review source records before acting.</span>
                <span>Sources: {aiResult.snapshot.sections.map((section) => section.name.replaceAll("_", " ")).join(" · ") || "none"}</span>
              </div>
              {aiResult.note && <p className="text-xs text-muted-foreground">{aiResult.note}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <SearchBar
            value={q}
            onChange={(value) => {
              setQ(value);
              setPage(1);
            }}
            placeholder="Search reports..."
          />
          <Select
            value={group}
            onValueChange={(value) => {
              setGroup(value);
              setPage(1);
            }}
          >
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Run report"
                    onClick={() => void runReport(report)}
                  >
                    <FileDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Run report"
                    onClick={() => void runReport(report)}
                  >
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
          <CardHeader>
            <CardTitle>{selectedReport.title} results</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-4">
            {reportRows.length ? (
              <Table rows={reportRows} />
            ) : (
              <p className="text-sm text-muted-foreground">This report returned no rows.</p>
            )}
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
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left">
          {columns.map((column) => (
            <th key={column} className="px-3 py-2 font-medium">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="border-b border-border/60">
            {columns.map((column) => (
              <td key={column} className="px-3 py-2">
                {String(row[column] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
