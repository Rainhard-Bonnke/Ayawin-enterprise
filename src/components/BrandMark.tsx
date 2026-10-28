export function BrandMark({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md border border-amber-400/45 bg-amber-400/10 text-[11px] font-bold tracking-[0.16em] text-amber-200">
          A
        </div>
        <span className="text-sm font-semibold tracking-[0.06em] text-sidebar-foreground">Ayawin Stock Solution</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-400/45 bg-amber-400/10 text-sm font-bold tracking-[0.18em] text-amber-200 shadow-sm">
        A
      </div>
      <div className="leading-tight">
        <div className="text-[0.78rem] font-semibold tracking-[0.22em] text-sidebar-foreground/65 uppercase">
          Ayawin
        </div>
        <div className="text-sm font-semibold tracking-[0.02em] text-sidebar-foreground">
          Stock Solution
        </div>
      </div>
    </div>
  );
}
