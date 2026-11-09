export function BrandMark({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <img
          src="/ayawin-wordmark.svg"
          alt="Ayawin Stock Solutions"
          className="h-8 w-auto max-w-[12rem] object-contain"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center">
      <img
        src="/ayawin-wordmark.svg"
        alt="Ayawin Stock Solutions"
        className="h-12 w-auto max-w-[13rem] object-contain"
      />
    </div>
  );
}
