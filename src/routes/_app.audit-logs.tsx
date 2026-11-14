import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { SearchBar } from "@/components/SearchBar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListPagination } from "@/components/ListPagination";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { v1Api } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";
import { useList } from "@/lib/queryHooks";
import { useUrlSearchParam } from "@/lib/urlSearchState";

type AuditLogRow = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
};

export const Route = createFileRoute("/_app/audit-logs")({
  component: AuditLogsPage,
  head: () => ({ meta: [{ title: "Audit Logs - Ayawin Stock Solution" }] }),
});

function AuditLogsPage() {
  const { token, user } = useAuth();
  const [q, setQ] = useUrlSearchParam("q");
  const [pageText, setPageText] = useUrlSearchParam("page", "1");
  const [exportingHashChain, setExportingHashChain] = useState(false);
  const page = Math.max(1, Number(pageText) || 1);
  const setPage = (next: number) => setPageText(String(next));
  const pageSize = 10;

  const handleHashChainExport = async () => {
    if (!token) return;
    setExportingHashChain(true);
    try {
      const blob = await v1Api.audit.hashChainBlob(token);
      const csvText = await blob.text();
      const url = URL.createObjectURL(new Blob([csvText], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "audit-hash-chain.csv";
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingHashChain(false);
    }
  };
  const auditQuery = useList(
    queryKeys.audit.logs(q, user?.id === undefined ? undefined : String(user.id)),
    async ({ signal }) => {
      const result = await v1Api.audit.list(token!, q, 100, signal);
      return result.map((row): AuditLogRow => ({
        id: String(row.id),
        action: String(row.action),
        entity_type: (row.entity_type as string) || null,
        entity_id: row.entity_id == null ? null : String(row.entity_id),
        details: (row.new_values || row.old_values || null) as Record<string, unknown> | null,
        created_at: String(row.created_at),
        user_name: (row.user_name as string) || null,
        user_email: (row.user_email as string) || null,
      }));
    },
    { enabled: Boolean(token) },
  );
  const rows = auditQuery.data ?? [];
  const filtered = rows;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="System actions, export events, and backend-tracked workflow activity."
      />

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchBar
              value={q}
              onChange={(value) => {
                setQ(value);
                setPage(1);
              }}
              placeholder="Search action, entity, or id..."
            />
            <Button variant="outline" size="sm" onClick={() => void handleHashChainExport()} disabled={!token || exportingHashChain}>
              {exportingHashChain ? "Exporting..." : "Export hash chain"}
            </Button>
            <div className="ml-auto text-xs text-muted-foreground">{filtered.length} events</div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditQuery.isPending && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                    Loading audit events...
                  </TableCell>
                </TableRow>
              )}
              {auditQuery.isError && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-sm text-destructive">
                    {auditQuery.error instanceof Error
                      ? auditQuery.error.message
                      : "Unable to load audit events."}{" "}
                    <Button variant="ghost" size="sm" onClick={() => void auditQuery.refetch()}>
                      Retry
                    </Button>
                  </TableCell>
                </TableRow>
              )}
              {!auditQuery.isPending && !auditQuery.isError && paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                    No audit events found.
                  </TableCell>
                </TableRow>
              )}
              {!auditQuery.isError &&
                paged.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">
                      {new Date(row.created_at).toLocaleString("en-GB")}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{row.user_name || "System"}</div>
                      <div className="text-muted-foreground">{row.user_email || ""}</div>
                    </TableCell>
                    <TableCell className="text-xs font-medium">{row.action}</TableCell>
                    <TableCell className="text-xs">
                      {row.entity_type || "—"}
                      {row.entity_id ? ` · ${row.entity_id}` : ""}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {row.details ? JSON.stringify(row.details) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <ListPagination
            page={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
