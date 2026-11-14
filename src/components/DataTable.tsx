import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Columns3, Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { exportWorkbook } from "@/lib/excel";
import { useUrlSearchParam } from "@/lib/urlSearchState";

export type DataTableColumn<Row> = {
  key: keyof Row & string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  searchable?: boolean;
  value?: (row: Row) => unknown;
  render?: (row: Row) => ReactNode;
};

type DataTableProps<Row extends Record<string, unknown>> = {
  rows: Row[];
  columns: DataTableColumn<Row>[];
  exportFilename: string;
  countLabel?: string;
  pageSize?: number;
  loading?: boolean;
  error?: string | Error | null;
  onRetry?: () => void;
  emptyMessage?: string;
};

function valueFor<Row extends Record<string, unknown>>(row: Row, column: DataTableColumn<Row>) {
  return column.value ? column.value(row) : row[column.key];
}

function compareValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function DataTable<Row extends Record<string, unknown>>({
  rows,
  columns,
  exportFilename,
  countLabel = "records",
  pageSize = 10,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = "No records yet.",
}: DataTableProps<Row>) {
  const [query, setQuery] = useUrlSearchParam("q");
  const [pageParam, setPageParam] = useUrlSearchParam("page", "1");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"ascending" | "descending">("ascending");
  const [visibleKeys, setVisibleKeys] = useState(
    () => new Set(columns.map((column) => column.key)),
  );
  const visibleColumns = columns.filter((column) => visibleKeys.has(column.key));

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = needle
      ? rows.filter((row) =>
          columns.some(
            (column) =>
              column.searchable !== false &&
              String(valueFor(row, column) ?? "")
                .toLocaleLowerCase()
                .includes(needle),
          ),
        )
      : rows;
    if (!sortKey) return filtered;

    const sortColumn = columns.find((column) => column.key === sortKey);
    if (!sortColumn) return filtered;
    return [...filtered].sort((left, right) => {
      const result = compareValues(valueFor(left, sortColumn), valueFor(right, sortColumn));
      return sortDirection === "ascending" ? result : -result;
    });
  }, [columns, query, rows, sortDirection, sortKey]);

  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / safePageSize));
  const requestedPage = Math.max(1, Number.parseInt(pageParam, 10) || 1);
  const currentPage = Math.min(requestedPage, pageCount);
  const pageRows = filteredRows.slice((currentPage - 1) * safePageSize, currentPage * safePageSize);
  const firstRow = filteredRows.length ? (currentPage - 1) * safePageSize + 1 : 0;
  const lastRow = Math.min(currentPage * safePageSize, filteredRows.length);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "ascending" ? "descending" : "ascending"));
    } else {
      setSortKey(key);
      setSortDirection("ascending");
    }
  };

  const setColumnVisible = (key: string, checked: boolean) => {
    setVisibleKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else if (next.size > 1) next.delete(key);
      return next;
    });
  };

  const exportRows = async () => {
    const exportColumns = visibleColumns;
    await exportWorkbook(exportFilename, [
      {
        name: "Records",
        rows: filteredRows.map((row) =>
          Object.fromEntries(exportColumns.map((column) => [column.label, valueFor(row, column)])),
        ),
      },
    ]);
  };

  const visibleCount = Math.max(1, visibleColumns.length);
  const errorMessage = error instanceof Error ? error.message : error;

  return (
    <section className="space-y-3" aria-label="Records table">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label={`Search ${countLabel}`}
            placeholder={`Search ${countLabel}...`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPageParam("1");
            }}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                aria-label="Choose columns"
                title="Choose columns"
              >
                <Columns3 aria-hidden="true" />
                <span>Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((column) => {
                const checked = visibleKeys.has(column.key);
                return (
                  <DropdownMenuCheckboxItem
                    key={column.key}
                    checked={checked}
                    disabled={checked && visibleKeys.size === 1}
                    onCheckedChange={(nextChecked) => setColumnVisible(column.key, nextChecked)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            aria-label="Export records"
            title="Export filtered records"
            disabled={loading || filteredRows.length === 0}
            onClick={() => void exportRows()}
          >
            <Download aria-hidden="true" />
            <span>Export</span>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border/70">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.map((column) => {
                const activeSort = sortKey === column.key;
                const direction = activeSort ? sortDirection : "none";
                return (
                  <TableHead
                    key={column.key}
                    aria-sort={direction}
                    className={column.align === "right" ? "text-right" : undefined}
                  >
                    {column.sortable === false ? (
                      column.label
                    ) : (
                      <button
                        type="button"
                        aria-label={`Sort by ${column.label}`}
                        title={`Sort by ${column.label}`}
                        onClick={() => toggleSort(column.key)}
                        className="inline-flex items-center gap-1.5"
                      >
                        {column.label}
                        {activeSort ? (
                          sortDirection === "ascending" ? (
                            <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5 opacity-50" />
                        )}
                      </button>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell
                  colSpan={visibleCount}
                  className="h-28 text-center text-muted-foreground"
                >
                  Loading records…
                </TableCell>
              </TableRow>
            )}
            {!loading && errorMessage && (
              <TableRow>
                <TableCell
                  colSpan={visibleCount}
                  className="h-28 text-center text-destructive"
                  role="alert"
                >
                  <span>{errorMessage}</span>
                  {onRetry && (
                    <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
                      Retry
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )}
            {!loading && !errorMessage && filteredRows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={visibleCount}
                  className="h-28 text-center text-muted-foreground"
                >
                  {query.trim() ? "No records match your search." : emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              !errorMessage &&
              pageRows.map((row, index) => (
                <TableRow key={String(row.id ?? `${currentPage}-${index}`)}>
                  {visibleColumns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={column.align === "right" ? "text-right tabular-nums" : undefined}
                    >
                      {column.render ? column.render(row) : String(valueFor(row, column) ?? "—")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span aria-live="polite">
          Showing {firstRow}–{lastRow} of {filteredRows.length} {countLabel.toLowerCase()}
        </span>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <span>
            Page {currentPage} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous page"
            title="Previous page"
            disabled={currentPage <= 1}
            onClick={() => setPageParam(String(currentPage - 1))}
          >
            <ChevronDown aria-hidden="true" className="rotate-90" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next page"
            title="Next page"
            disabled={currentPage >= pageCount}
            onClick={() => setPageParam(String(currentPage + 1))}
          >
            <ChevronDown aria-hidden="true" className="-rotate-90" />
          </Button>
        </div>
      </div>
    </section>
  );
}
