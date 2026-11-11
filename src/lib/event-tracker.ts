import { apiV1Fetch } from "@/lib/api-v1";

const apiBase = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

type EventPayload = {
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  scenario?: string;
  context?: unknown;
};

export async function trackEvent(payload: EventPayload) {
  try {
    return await apiV1Fetch<{ ok: boolean; audited: boolean; insight: null; confidence: number }>("/audit/events", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}
