export const queryKeys = {
  inventory: {
    movements: () => ["inventory", "movements"] as const,
    reorderAlerts: () => ["inventory", "reorder-alerts"] as const,
    masterItems: () => ["inventory", "master-items"] as const,
  },
  hr: {
    leaveApplications: () => ["hr", "leave-applications"] as const,
    payrollRuns: () => ["hr", "payroll-runs"] as const,
  },
  audit: {
    logs: (query: string, userId?: string) => ["audit", "logs", userId, query] as const,
  },
  procurement: {
    goodsReceipts: () => ["procurement", "goods-receipts"] as const,
  },
  suppliers: {
    list: () => ["suppliers", "list"] as const,
  },
  users: {
    list: () => ["users", "list"] as const,
  },
  customers: {
    list: () => ["customers", "list"] as const,
  },
  sales: {
    orders: (userId?: string | number) => ["sales", "orders", userId] as const,
  },
  invoices: {
    list: (userId?: string | number) => ["sales", "invoices", userId] as const,
  },
};