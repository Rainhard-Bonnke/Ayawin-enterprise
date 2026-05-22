import { toast } from "sonner";

const apiBase = import.meta.env.VITE_API_BASE || "";

export function notify(message: string, description?: string) {
  toast.success(message, description ? { description } : undefined);
}

export async function triggerEmailNotification(payload: {
  recipient: string;
  subject: string;
  message: string;
}) {
  try {
    await fetch(`${apiBase}/api/notifications/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Ignore transport failures in local demo mode.
  }
}
