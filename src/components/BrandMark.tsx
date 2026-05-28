/** Text branding; add logo image here when ready. */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return <span className="text-sm font-semibold">Ayawin</span>;
  }

  return (
    <div>
      <div className="text-sm font-semibold">Ayawin Enterprise ERP</div>
      <div className="text-xs text-muted-foreground">Beverage distribution</div>
    </div>
  );
}
