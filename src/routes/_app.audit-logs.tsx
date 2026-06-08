import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { SearchBar } from "@/components/SearchBar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListPagination } from "@/components/ListPagination";
import { useAuth } from "@/lib/auth";
import { fetchAuditLogs, type AuditLogRow } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/audit-logs")({
  component: AuditLogsPage,
  head: () => ({ meta: [{ title: "Audit Logs - Ayawin Stock Solutions ERP" }] }),
});

function AuditLogsPage() {
  const { token } = useAuth();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const load = useCallback(() => {
    if (!token) return Promise.resolve();
    setLoading(true);
    return fetchAuditLogs(token, q, 100)
      .then(setRows)
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Unable to load audit logs");
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [token, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => rows, [rows]);
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
            <div className="ml-auto text-xs text-muted-foreground">
              {loading ? "Loading…" : `${filtered.length} events`}
            </div>
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
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    Loading audit trail…
                  </TableCell>
                </TableRow>
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No audit events yet. Actions such as login, master data changes, and postings will appear here.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">{new Date(row.created_at).toLocaleString("en-GB")}</TableCell>
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
                ))
              )}
            </TableBody>
          </Table>
          <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
