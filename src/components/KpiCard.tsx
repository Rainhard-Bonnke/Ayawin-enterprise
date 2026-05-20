import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiCard({
  label, value, icon: Icon, delta, accent = false,
}: { label: string; value: string; icon: LucideIcon; delta?: number; accent?: boolean }) {
  return (
    <Card className={cn(
      "relative overflow-hidden border-border/60 transition-shadow hover:shadow-md",
      accent && "border-gold/40 bg-gradient-to-br from-card to-gold/5",
    )}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-2 font-display text-2xl font-bold text-foreground">{value}</div>
            {typeof delta === "number" && (
              <div className={cn(
                "mt-2 flex items-center gap-1 text-xs font-medium",
                delta >= 0 ? "text-success" : "text-destructive",
              )}>
                {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {Math.abs(delta)}% vs last period
              </div>
            )}
          </div>
          <div className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg",
            accent ? "bg-gold text-gold-foreground" : "bg-navy text-navy-foreground",
          )}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
