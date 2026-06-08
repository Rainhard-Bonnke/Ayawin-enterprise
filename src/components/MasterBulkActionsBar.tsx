import { useState } from "react";
import { Download, Power, PowerOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import {
  masterBulkDelete,
  masterBulkExport,
  masterBulkStatus,
  type MasterBulkEntity,
} from "@/lib/api-v1";
import { toast } from "sonner";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

type Props = {
  token: string | null;
  entity: MasterBulkEntity;
  selectedIds: string[];
  onComplete: () => void | Promise<void>;
  onClearSelection: () => void;
};

export function MasterBulkActionsBar({ token, entity, selectedIds, onComplete, onClearSelection }: Props) {
  const [busy, setBusy] = useState(false);
  const count = selectedIds.length;

  if (!count) return null;

  const run = async (fn: () => Promise<void>) => {
    if (!token) return;
    setBusy(true);
    try {
      await fn();
      onClearSelection();
      await onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">{count} selected</span>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const blob = await masterBulkExport(token!, entity, selectedIds);
            downloadBlob(blob, `${entity}-export.csv`);
            toast.success("Export downloaded");
          })
        }
      >
        <Download className="mr-1.5 h-3.5 w-3.5" />
        Export CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await masterBulkStatus(token!, entity, selectedIds, true);
            toast.success(`Activated ${result.updated} record(s)`);
            if (result.updated < count) toast.warning("Some records could not be updated");
          })
        }
      >
        <Power className="mr-1.5 h-3.5 w-3.5" />
        Activate
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await masterBulkStatus(token!, entity, selectedIds, false);
            toast.success(`Deactivated ${result.updated} record(s)`);
          })
        }
      >
        <PowerOff className="mr-1.5 h-3.5 w-3.5" />
        Deactivate
      </Button>
      <ConfirmActionDialog
        title={`Delete ${count} record(s)?`}
        description="Soft-deletes selected records. Records with open transactions may be skipped."
        confirmLabel="Delete selected"
        onConfirm={() =>
          run(async () => {
            const result = await masterBulkDelete(token!, entity, selectedIds);
            if (result.errors.length) {
              toast.warning(`Deleted ${result.deleted}; ${result.errors.length} failed`);
            } else {
              toast.success(`Deleted ${result.deleted} record(s)`);
            }
          })
        }
      >
        <Button variant="destructive" size="sm" disabled={busy}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>
      </ConfirmActionDialog>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onClearSelection}>
        Clear
      </Button>
    </div>
  );
}

export function useMasterRowSelection<T extends { id: string }>(rows: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  };

  const clear = () => setSelected(new Set());

  return {
    selectedIds: [...selected],
    isSelected: (id: string) => selected.has(id),
    allSelected: rows.length > 0 && selected.size === rows.length,
    toggle,
    toggleAll,
    clear,
  };
}
