import { cn } from "@/lib/utils";

const LOGO_SRC = "/ayawin-logo.png?v=2";

export function BrandMark({ compact = false, inverted = false }: { compact?: boolean; inverted?: boolean }) {
  return (
    <div className="flex shrink-0 items-center">
      <img
        src={LOGO_SRC}
        alt="Ayawin Stock Solutions"
        className={cn(
          "h-auto w-auto object-contain object-left drop-shadow-sm",
          compact ? "max-h-7 max-w-[128px]" : "max-h-10 max-w-[188px]",
          inverted && "brightness-0 invert opacity-95",
        )}
        decoding="async"
      />
    </div>
  );
}
