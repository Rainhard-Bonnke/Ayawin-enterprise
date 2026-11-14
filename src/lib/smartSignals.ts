export function customerHealth(balance: number, creditLimit: number) {
  if (!Number.isFinite(balance) || !Number.isFinite(creditLimit) || creditLimit <= 0) {
    return { label: "Unknown", tone: "muted" as const, score: 50 };
  }

  const utilization = Math.max(0, (balance / creditLimit) * 100);
  const score = Math.max(10, Math.min(100, Math.round(100 - utilization)));
  if (score >= 75) return { label: "Healthy", tone: "success" as const, score };
  if (score >= 50) return { label: "Watch", tone: "warning" as const, score };
  return { label: "Risk", tone: "destructive" as const, score };
}

export function supplierScoreFromBalances(balance: number, creditLimit: number) {
  if (!Number.isFinite(balance) || !Number.isFinite(creditLimit) || creditLimit <= 0) {
    return { score: 60, label: "Average" };
  }

  const balancePressure = (balance / creditLimit) * 100;
  const score = Math.max(25, Math.min(100, 95 - balancePressure * 0.3));
  return {
    score: Math.round(score),
    label: score >= 80 ? "Strong" : score >= 60 ? "Stable" : "Watch",
  };
}

export function invoiceRisk(status: string, dueDate: string) {
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === "paid") return { label: "Settled", tone: "success" as const };
  if (normalizedStatus === "cancelled") return { label: "Cancelled", tone: "muted" as const };

  const due = new Date(`${dueDate}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (normalizedStatus === "overdue" || (Number.isFinite(due) && due < today.getTime())) {
    return { label: "Overdue", tone: "warning" as const };
  }
  return { label: "On track", tone: "success" as const };
}
