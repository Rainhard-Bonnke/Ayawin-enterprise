const apiBase = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

export async function fetchInsight(scenario: string, context: unknown) {
  try {
    const response = await fetch(`${apiBase}/api/intelligence/insight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario, context }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { insight?: string | null; confidence?: number };
    if (!data.insight || (data.confidence ?? 0) < 0.85) return null;
    return data.insight;
  } catch {
    return null;
  }
}
