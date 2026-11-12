import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";

export function LiveConnectivityBadge() {
  const { token } = useAuth();
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const liveSession = Boolean(token);

  if (liveSession && online) {
    return (
      <Badge variant="outline" className="border-emerald-300 text-emerald-700">
        Live API
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-amber-300 text-amber-700">
      Offline/Non-live
    </Badge>
  );
}
