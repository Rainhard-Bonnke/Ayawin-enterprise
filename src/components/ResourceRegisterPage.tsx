import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export type RegisterRow = Record<string, unknown>;
export type RegisterColumn = { key: string; label: string; align?: "left" | "right" };

export function ResourceRegisterPage({
  title,
  description,
  columns,
  load,
  actionLabel,
  actionTo,
  countLabel = "Records",
}: {
  title: string;
  description: string;
  columns: RegisterColumn[];
  load: (token: string) => Promise<RegisterRow[]>;
  actionLabel?: string;
  actionTo?: string;
  countLabel?: string;
}) {
  const { token } = useAuth();
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let current = true;
    if (!token) return;
    setLoading(true);
    void load(token)
      .then((data) => {
        if (current) setRows(data);
      })
      .catch((error: unknown) => {
        if (!current) return;
        setRows([]);
        toast.error(error instanceof Error ? error.message : `Unable to load ${title.toLowerCase()}`);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [token, load, title]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(needle)),
    );
  }, [columns, query, rows]);

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title={title}
        description={description}
        actions={actionLabel && actionTo ? (
          <Button asChild className="rounded-lg">
            <a href={actionTo}>{actionLabel}<ArrowRight className="ml-2 h-4 w-4" /></a>
          </Button>
        ) : undefined}
      />
      <Card className="rounded-2xl border-border/70 bg-background/70 shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="text-2xl font-semibold tabular-nums">{loading ? "—" : filtered.length}</div>
              <div className="text-xs text-muted-foreground">{countLabel}</div>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} className="pl-9" />
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <Table>
              <TableHeader><TableRow>{columns.map((column) => <TableHead key={column.key} className={column.align === "right" ? "text-right" : undefined}>{column.label}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {filtered.map((row, index) => (
                  <TableRow key={String(row.id ?? index)}>
                    {columns.map((column) => <TableCell key={column.key} className={column.align === "right" ? "text-right tabular-nums" : undefined}>{String(row[column.key] ?? "—")}</TableCell>)}
                  </TableRow>
                ))}
                {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={columns.length} className="h-32 text-center text-sm text-muted-foreground">{query ? "No records match your search." : `No ${title.toLowerCase()} records yet.`}</TableCell></TableRow>}
                {loading && <TableRow><TableCell colSpan={columns.length} className="h-32 text-center text-sm text-muted-foreground">Loading {title.toLowerCase()}…</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
