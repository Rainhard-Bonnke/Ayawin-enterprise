import { useEffect, useState } from "react";
import { toast } from "sonner";
import { subscribeLiveEvents } from "@/hooks/useLiveEvents";
import { useAuth } from "@/lib/auth";
import { isV1Enabled } from "@/lib/api-v1";

export function LiveNotificationCenter() {
  const { token, user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const live = Boolean(token && !token.startsWith("demo:") && isV1Enabled());
  const isWarehouseFacing =
    user?.role === "Warehouse" ||
    user?.role === "Operations Manager" ||
    user?.permissions?.includes("inventory.view");

  useEffect(() => {
    if (!live) return;
    return subscribeLiveEvents((ev) => {
      if (ev.type === "sales_order.confirmed" && isWarehouseFacing) {
        const orderNo = String(ev.data?.order_no || ev.data?.order_id || "order");
        toast.info(`New confirmed order: ${orderNo}`, { duration: 8000 });
        setPendingCount((n) => n + 1);
      }
      if (ev.type === "stock.low") {
        const name = String(ev.data?.item_name || ev.data?.item_code || "item");
        toast.warning(`Low stock: ${name}`, { duration: 10000 });
        setPendingCount((n) => n + 1);
      }
      if (ev.type === "payment.received") {
        const inv = String(ev.data?.invoice_no || ev.data?.invoice_id || "invoice");
        toast.success(`Payment received — ${inv}`, { duration: 6000 });
      }
    });
  }, [live, isWarehouseFacing]);

  useEffect(() => {
    const onNavigate = () => setPendingCount(0);
    window.addEventListener("focus", onNavigate);
    return () => window.removeEventListener("focus", onNavigate);
  }, []);

  if (!live || pendingCount === 0) return null;

  return (
    <span
      className="pointer-events-none absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground"
      aria-hidden
    >
      {pendingCount > 9 ? "9+" : pendingCount}
    </span>
  );
}
