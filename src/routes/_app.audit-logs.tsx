import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { SearchBar } from "@/components/SearchBar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListPagination } from "@/components/ListPagination";
import { useAuth } from "@/lib/auth";
import { fetchAuditLogs, type AuditLogRow } from "@/lib/api";

export const Route = createFileRoute("/_app/audit-logs")({
  component: AuditLogsPage,
  head: () => ({ meta: [{ title: "Audit Logs - Ayawin Enterprise ERP" }] }),
});

function AuditLogsPage() {
  const { token } = useAuth();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    if (!token) return;
    void fetchAuditLogs(token, q, 100)
      .then(setRows)
      .catch(() => setRows([]));
  }, [token, q]);

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
            <SearchBar value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search action, entity, or id..." />
            <div className="ml-auto text-xs text-muted-foreground">
              {filtered.length} events
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
              {paged.map((row) => (
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
              ))}
            </TableBody>
          </Table>
          <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
