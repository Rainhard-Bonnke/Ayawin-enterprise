import { ArrowRight } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useList } from "@/lib/queryHooks";

export type RegisterRow = Record<string, unknown>;
export type RegisterColumn = { key: string; label: string; align?: "left" | "right" };
const EMPTY_REGISTER_ROWS: RegisterRow[] = [];

export function ResourceRegisterPage({
  title,
  description,
  columns,
  load,
  queryKey,
  actionLabel,
  actionTo,
  countLabel = "Records",
}: {
  title: string;
  description: string;
  columns: RegisterColumn[];
  load: (token: string, signal?: AbortSignal) => Promise<RegisterRow[]>;
  queryKey?: readonly unknown[];
  actionLabel?: string;
  actionTo?: string;
  countLabel?: string;
}) {
  const { token, user } = useAuth();
  const registerQuery = useList(
    [...(queryKey ?? ["register", title]), user?.id],
    ({ signal }) => load(token!, signal),
    { enabled: Boolean(token) },
  );
  const rows = registerQuery.data ?? EMPTY_REGISTER_ROWS;
  const loading = registerQuery.isPending;

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title={title}
        description={description}
        actions={
          actionLabel && actionTo ? (
            <Button asChild className="rounded-lg">
              <a href={actionTo}>
                {actionLabel}
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          ) : undefined
        }
      />
      <Card className="rounded-2xl border-border/70 bg-background/70 shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="text-2xl font-semibold tabular-nums">
                {loading ? "—" : rows.length}
              </div>
              <div className="text-xs text-muted-foreground">{countLabel}</div>
            </div>
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            countLabel={title}
            exportFilename={`${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.xlsx`}
            loading={loading}
            error={registerQuery.isError ? registerQuery.error : null}
            onRetry={() => void registerQuery.refetch()}
            emptyMessage={`No ${title.toLowerCase()} records yet.`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
