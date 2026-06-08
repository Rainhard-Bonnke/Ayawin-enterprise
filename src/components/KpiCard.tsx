import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const accents = [
  "text-primary bg-primary/10",
  "text-brand-navy bg-brand-navy/10 dark:text-foreground dark:bg-white/6",
  "text-success bg-success/10",
  "text-warning bg-warning/12",
];

export function KpiCard({
  label,
  value,
  icon: Icon,
  accentIndex = 0,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  delta?: number;
  accent?: boolean;
  accentIndex?: number;
}) {
  const accent = accents[accentIndex % accents.length];

  return (
    <Card className="overflow-hidden transition-shadow duration-300 hover:shadow-lg">
      <CardContent className="p-0">
        <div className="flex items-stretch">
          <div className="min-w-0 flex-1 p-5">
            <p className="font-mono-label text-muted-foreground">{label}</p>
            <p className="mt-2 truncate text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          </div>
          <div
            className={cn(
              "flex w-14 shrink-0 items-center justify-center border-l border-border/60",
              accent,
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
