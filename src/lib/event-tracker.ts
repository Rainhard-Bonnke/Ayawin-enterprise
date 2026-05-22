const apiBase = import.meta.env.VITE_API_BASE || "";

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
    const token = localStorage.getItem("ayawin-enterprise-token");
    if (!token) return null;

    const response = await fetch(`${apiBase}/api/events/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
