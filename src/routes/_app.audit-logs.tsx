import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { SearchBar } from "@/components/SearchBar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListPagination } from "@/components/ListPagination";

const apiBase = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

type AuditLogRow = {
  id: number;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
};

export const Route = createFileRoute("/_app/audit-logs")({
  component: AuditLogsPage,
  head: () => ({ meta: [{ title: "Audit Logs - Ayawin Enterprise ERP" }] }),
});

function AuditLogsPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    const token = localStorage.getItem("ayawin-enterprise-token");
    if (!token) return;

    void fetch(`${apiBase}/api/audit-logs?q=${encodeURIComponent(q)}&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]));
  }, [q]);

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
                    <div className="text-muted-foreground">{row.user_email || row.user_role || ""}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.action}</TableCell>
                  <TableCell className="text-xs">
                    {row.entity_type || "-"}
                    {row.entity_id ? ` / ${row.entity_id}` : ""}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.details ? JSON.stringify(row.details) : "-"}
                  </TableCell>
                </TableRow>
              ))}
              {paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No audit logs found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <ListPagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} />
        </CardContent>
      </Card>
      <div className="mt-3 text-xs text-muted-foreground">
        Currency formatting uses KES across the ERP, even in tracked operational events.
      </div>
    </div>
  );
}
