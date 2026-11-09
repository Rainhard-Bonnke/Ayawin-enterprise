import { toast } from "sonner";
import { v1Api } from "@/lib/api-v1";

export function notify(message: string, description?: string) {
  toast.success(message, description ? { description } : undefined);
}

export async function triggerEmailNotification(
  token: string,
  payload: { recipient: string; subject: string; message: string },
) {
  try {
    const result = await v1Api.integrations.sendNotification(token, {
      channel: "email",
      to: payload.recipient,
      subject: payload.subject,
      body: payload.message,
      idempotency_key: crypto.randomUUID(),
    });
    toast.info(result.delivered ? "Email delivered" : "Email queued", {
      description: result.message,
    });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Unable to queue email notification");
  }
}
