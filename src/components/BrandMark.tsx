import { Wine, Droplets } from "lucide-react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-navy text-gold shadow-[0_10px_30px_rgba(10,22,40,0.35)]">
        <span className="absolute left-1.5 top-1.5 text-[10px] font-bold tracking-[0.3em] text-gold/80">
          ME
        </span>
        <Wine className="absolute bottom-1.5 left-1.5 h-4 w-4 opacity-90" />
        <Droplets className="absolute right-1.5 top-1.5 h-4 w-4 opacity-90" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="font-display text-lg font-bold text-foreground">Ayawin Enterprise ERP</div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold">Kenya Beverage Operations</div>
        </div>
      )}
    </div>
  );
}
