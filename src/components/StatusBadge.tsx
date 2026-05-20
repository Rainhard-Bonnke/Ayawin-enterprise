import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const map: Record<string, string> = {
  // generic
  Active: "bg-success/15 text-success border-success/30",
  Inactive: "bg-muted text-muted-foreground border-border",
  "On Leave": "bg-warning/15 text-warning border-warning/30",
  // sales
  Draft: "bg-muted text-muted-foreground border-border",
  Confirmed: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  Approved: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  Sent: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  Dispatched: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  "In Transit": "bg-amber-500/15 text-amber-700 border-amber-500/30",
  Pending: "bg-muted text-muted-foreground border-border",
  Delivered: "bg-success/15 text-success border-success/30",
  Received: "bg-success/15 text-success border-success/30",
  Paid: "bg-success/15 text-success border-success/30",
  Invoiced: "bg-success/15 text-success border-success/30",
  Overdue: "bg-destructive/15 text-destructive border-destructive/30",
  Failed: "bg-destructive/15 text-destructive border-destructive/30",
  Cancelled: "bg-destructive/15 text-destructive border-destructive/30",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", map[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </Badge>
  );
}
