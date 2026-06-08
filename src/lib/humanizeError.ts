/** Map API / network errors to user-facing copy (no raw status codes in UI). */

const STATUS_MESSAGES: Record<number, string> = {
  400: "We couldn't process that request. Check the form and try again.",
  401: "Your session expired. Please sign in again.",
  403: "You don't have permission to do that.",
  404: "That record was not found. It may have been removed.",
  409: "This action conflicts with existing data. Refresh and try again.",
  422: "Some fields need correction before we can continue.",
  429: "Too many requests. Wait a moment and try again.",
  500: "Something went wrong on our side. Try again shortly.",
  502: "The server is temporarily unavailable. Try again in a minute.",
  503: "The service is busy. Please try again shortly.",
};

const CODE_HINTS: Record<string, string> = {
  VALIDATION: "Please check the highlighted fields.",
  CREDIT_LIMIT: "This order exceeds the customer's credit limit.",
  INSUFFICIENT_STOCK: "There isn't enough stock for this quantity.",
  ETIMS: "eTIMS submission failed. You can retry from the invoice.",
};

function stripHtml(text: string) {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function humanizeError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!err) return fallback;
  const raw = err instanceof Error ? err.message : String(err);
  const msg = stripHtml(raw);

  const statusMatch = msg.match(/\b([45]\d{2})\b/) || msg.match(/^HTTP\s*(\d{3})/i);
  if (statusMatch) {
    const code = Number(statusMatch[1]);
    if (STATUS_MESSAGES[code]) return STATUS_MESSAGES[code];
  }

  for (const [key, hint] of Object.entries(CODE_HINTS)) {
    if (msg.includes(key)) return hint;
  }

  if (/ECONNREFUSED|fetch failed|Failed to fetch|network/i.test(msg)) {
    return "Can't reach the server. Check that the API is running and try again.";
  }
  if (/EADDRINUSE|listen/i.test(msg)) return "The API port is in use. Restart the backend.";
  if (/jwt|token|unauthorized/i.test(msg)) return STATUS_MESSAGES[401];
  if (/permission|forbidden/i.test(msg)) return STATUS_MESSAGES[403];
  if (/not found/i.test(msg)) return STATUS_MESSAGES[404];

  if (msg.length > 180) return fallback;
  if (/^[A-Z_]{3,}$/.test(msg)) return fallback;
  return msg || fallback;
}
