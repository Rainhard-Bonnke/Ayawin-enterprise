import { Sparkles } from "lucide-react";

export function AiInsightStrip({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Sparkles className="h-4 w-4" aria-hidden />
      </div>
      <p className="pt-0.5 text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Insight · </span>
        {message}
      </p>
    </div>
  );
}
