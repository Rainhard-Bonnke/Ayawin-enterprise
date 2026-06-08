import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { isV1Enabled } from "@/lib/api-v1";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useLiveEvents } from "@/hooks/useLiveEvents";

export function LiveConnectivityBadge() {
  const { token } = useAuth();
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const liveSession = Boolean(token && !token.startsWith("demo:") && isV1Enabled());
  const { connected: wsConnected, reconnecting } = useLiveEvents(liveSession);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const label = !online
    ? "Offline"
    : reconnecting
      ? "Reconnecting…"
      : liveSession && wsConnected
        ? "Live"
        : liveSession
          ? "Polling"
          : "Demo / API off";
  const tone = !online
    ? "border-warning/30 bg-warning/8 text-warning"
    : reconnecting
      ? "border-warning/30 bg-warning/8 text-warning"
      : liveSession && wsConnected
        ? "border-success/30 bg-success/8 text-success"
        : liveSession
          ? "border-primary/30 bg-primary/8 text-primary"
          : "border-muted-foreground/30 bg-muted/40 text-muted-foreground";

  return (
    <Badge variant="outline" className={cn("hidden h-7 rounded-full px-2.5 text-[11px] font-medium sm:inline-flex", tone)}>
      <span
        className={cn(
          "mr-1.5 inline-block h-1.5 w-1.5 rounded-full",
          !online ? "bg-warning" : liveSession ? "bg-success" : "bg-muted-foreground",
        )}
      />
      {label}
    </Badge>
  );
}
