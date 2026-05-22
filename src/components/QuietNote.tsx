import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchInsight } from "@/lib/intelligence";

type QuietNoteProps = {
  scenario:
    | "dashboard"
    | "sales"
    | "invoice"
    | "inventory"
    | "procurement"
    | "customers"
    | "delivery"
    | "reports"
    | "accounting"
    | "hr";
  contextKey: string;
  context: unknown;
  className?: string;
};

export function QuietNote({ scenario, contextKey, context, className }: QuietNoteProps) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setText(null);
    void fetchInsight(scenario, context).then((next) => {
      if (!active) return;
      setText(next);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [scenario, contextKey]);

  if (!loading && !text) {
    return null;
  }

  return (
    <Card className={className}>
      <CardContent className="p-4">
        {text ? (
          <div className="text-sm leading-6 text-muted-foreground">{text}</div>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
