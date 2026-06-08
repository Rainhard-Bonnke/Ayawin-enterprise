/** Lightweight heuristics from live balances/status — no mock-data dependency. */

export function customerHealthFromBalances(
  balance: number,
  creditLimit: number,
  options?: { hasOverdue?: boolean; activeOrders?: number },
) {
  if (!Number.isFinite(creditLimit) || creditLimit <= 0) {
    return { label: "Unknown", tone: "muted" as const, score: 50 };
  }
  const util = (balance / creditLimit) * 100;
  const overdueInvoice = options?.hasOverdue ?? false;
  const activeOrders = options?.activeOrders ?? 0;
  const score = Math.max(10, Math.min(100, 100 - util * 0.55 - (overdueInvoice ? 20 : 0) + activeOrders * 2));

  if (score >= 75) return { label: "Healthy", tone: "success" as const, score: Math.round(score) };
  if (score >= 50) return { label: "Watch", tone: "warning" as const, score: Math.round(score) };
  return { label: "Risk", tone: "destructive" as const, score: Math.round(score) };
}

export function supplierScoreFromBalances(balance: number, creditLimit: number) {
  if (!Number.isFinite(balance) || !Number.isFinite(creditLimit) || creditLimit <= 0) {
    return { score: 60, label: "Average" };
  }

  const balancePressure = (balance / creditLimit) * 100;
  const score = Math.max(25, Math.min(100, 95 - balancePressure * 0.3));
  return { score: Math.round(score), label: score >= 80 ? "Strong" : score >= 60 ? "Stable" : "Watch" };
}

export function invoiceRiskFromStatus(status: string) {
  const s = status.toLowerCase();
  if (s === "overdue") {
    return { label: "High delay risk", tone: "warning" as const, expectedDays: 17 };
  }
  if (s === "paid") {
    return { label: "Settled", tone: "success" as const, expectedDays: 0 };
  }
  if (s === "sent" || s === "partial") {
    return { label: "On track", tone: "success" as const, expectedDays: 14 };
  }
  return { label: "Normal", tone: "muted" as const, expectedDays: 14 };
}
