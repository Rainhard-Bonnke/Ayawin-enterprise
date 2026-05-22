import { customers, deliveries, employees, invoices, products, purchaseOrders, salesOrders, suppliers } from "@/lib/mock-data";

function sum<T>(items: T[], selector: (item: T) => number) {
  return items.reduce((acc, item) => acc + selector(item), 0);
}

export function customerHealth(customerName: string) {
  const customer = customers.find((item) => item.name === customerName);
  if (!customer) return { label: "Unknown", tone: "muted" as const, score: 50 };

  const util = (customer.balance / customer.creditLimit) * 100;
  const overdueInvoice = invoices.some((item) => item.customer === customerName && item.status === "Overdue");
  const activeOrders = salesOrders.filter((item) => item.customer === customerName).length;
  const score = Math.max(10, Math.min(100, 100 - util * 0.55 - (overdueInvoice ? 20 : 0) + activeOrders * 2));

  if (score >= 75) return { label: "Healthy", tone: "success" as const, score: Math.round(score) };
  if (score >= 50) return { label: "Watch", tone: "warning" as const, score: Math.round(score) };
  return { label: "Risk", tone: "destructive" as const, score: Math.round(score) };
}

export function supplierScore(supplierName: string) {
  const supplier = suppliers.find((item) => item.name === supplierName);
  if (!supplier) return { score: 60, label: "Average" };

  return supplierScoreFromBalances(supplier.balance, supplier.creditLimit);
}

export function supplierScoreFromBalances(balance: number, creditLimit: number) {
  if (!Number.isFinite(balance) || !Number.isFinite(creditLimit) || creditLimit <= 0) {
    return { score: 60, label: "Average" };
  }

  const balancePressure = (balance / creditLimit) * 100;
  const score = Math.max(25, Math.min(100, 95 - balancePressure * 0.3));
  return { score: Math.round(score), label: score >= 80 ? "Strong" : score >= 60 ? "Stable" : "Watch" };
}

export function suggestedOrderQuantity(productName: string) {
  const product = products.find((item) => item.name === productName);
  if (!product) return null;
  const base = Math.max(product.minStock * 2, Math.round(product.stock * 0.15));
  return Math.max(1, Math.round(base / (product.packSize.includes("24") ? 24 : 12)) * (product.packSize.includes("24") ? 24 : 12));
}

export function invoiceRisk(customerName: string) {
  const customer = customers.find((item) => item.name === customerName);
  if (!customer) return { label: "Normal", tone: "muted" as const, expectedDays: 14 };
  const util = customer.balance / customer.creditLimit;
  const overdueCount = invoices.filter((item) => item.customer === customerName && item.status === "Overdue").length;
  const expectedDays = overdueCount > 0 ? 17 : util > 0.7 ? 16 : 12;
  return {
    label: util > 0.75 || overdueCount > 0 ? "High delay risk" : "On track",
    tone: util > 0.75 || overdueCount > 0 ? ("warning" as const) : ("success" as const),
    expectedDays,
  };
}

export function inventorySignals() {
  const lowStock = products.filter((item) => item.stock < item.minStock).slice(0, 4);
  const expiringSoon = products.filter((item) => {
    const expiry = new Date(item.expiry).getTime();
    const daysLeft = (expiry - Date.now()) / 86400000;
    return daysLeft <= 45;
  }).slice(0, 4);
  const reorderDraft = lowStock.map((item) => ({
    name: item.name,
    qty: suggestedOrderQuantity(item.name) ?? item.minStock,
  }));
  return { lowStock, expiringSoon, reorderDraft };
}

export function deliveryRouteHint() {
  const todaysRoutes = deliveries
    .filter((item) => item.date === "2026-05-20")
    .map((item) => item.route)
    .slice(0, 3);
  return todaysRoutes;
}

export function payrollVariance(employeeName: string) {
  const employee = employees.find((item) => item.name === employeeName);
  if (!employee) return null;
  const base = employee.salary;
  const variance = employee.status === "On Leave" ? -0.12 : 0.04;
  return {
    flag: Math.abs(variance) > 0.1,
    message: Math.abs(variance) > 0.1 ? "Verify - this payroll is higher than usual" : "Payroll is within the normal range",
    net: Math.round(base * (1 - 0.1 - 0.06 - 0.0275 - 0.015)),
  };
}

export function cashFlowForecast() {
  const inflow = sum(invoices.filter((item) => item.status === "Sent" || item.status === "Paid"), (item) => item.total);
  const outflow = sum(purchaseOrders, (item) => item.total);
  return [
    { label: "Week 1", value: Math.round(inflow * 0.24 - outflow * 0.12) },
    { label: "Week 2", value: Math.round(inflow * 0.26 - outflow * 0.14) },
    { label: "Week 3", value: Math.round(inflow * 0.28 - outflow * 0.18) },
    { label: "Week 4", value: Math.round(inflow * 0.22 - outflow * 0.16) },
  ];
}
