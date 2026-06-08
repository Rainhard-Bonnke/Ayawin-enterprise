import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function AiBadge({ className, label = "AI" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-cyan-600 dark:text-cyan-300",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
      <Sparkles className="h-3 w-3 opacity-80" aria-hidden />
      {label}
    </span>
  );
}
