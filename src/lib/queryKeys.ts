export const queryKeys = {
  settings: {
    workspace: (userId?: string | number) => ["settings", "workspace", userId] as const,
  },
  masterData: {
    list: (entity: string) => ["master-data", entity] as const,
  },
  dashboard: {
    summary: (userId?: string | number) => ["dashboard", "summary", userId] as const,
  },
  deliveries: {
    list: (userId?: string | number) => ["deliveries", "list", userId] as const,
  },
  accounting: {
    workspaceLists: () => ["accounting", "workspace"] as const,
    snapshotLists: () => ["accounting", "snapshot"] as const,
    taxReturnLists: () => ["accounting", "tax-returns"] as const,
    workspace: (userId?: string | number, periodId?: string) =>
      ["accounting", "workspace", userId, periodId] as const,
    snapshot: (userId?: string | number) => ["accounting", "snapshot", userId] as const,
    taxReturns: (userId?: string | number) => ["accounting", "tax-returns", userId] as const,
    closeChecklist: (periodId: string) => ["accounting", "close-checklist", periodId] as const,
    journals: (filters: Record<string, unknown> = {}) =>
      ["accounting", "journals", filters] as const,
    trialBalance: (filters: Record<string, unknown> = {}) =>
      ["accounting", "trial-balance", filters] as const,
  },
  assets: {
    list: (filters: Record<string, unknown> = {}) => ["assets", "list", filters] as const,
    depreciation: (asOfDate = "") => ["assets", "depreciation", asOfDate] as const,
  },
  approvals: {
    inbox: () => ["approvals", "inbox"] as const,
    history: (documentType: string, documentId: string) =>
      ["approvals", "history", documentType, documentId] as const,
  },
  branches: {
    list: () => ["branches", "list"] as const,
  },
  documents: {
    detail: (type: string, id: string) => ["documents", type, id] as const,
    list: (type: string, filters: Record<string, unknown> = {}) =>
      ["documents", type, filters] as const,
  },
  employees: {
    list: (filters: Record<string, unknown> = {}) => ["employees", "list", filters] as const,
  },
  finance: {
    reports: (report: string, filters: Record<string, unknown> = {}) =>
      ["finance", report, filters] as const,
    budgetForecast: (filters: Record<string, unknown> = {}) =>
      ["finance", "budget-forecast", filters] as const,
    fxRevaluations: () => ["finance", "fx-revaluations"] as const,
    bankReconciliations: () => ["finance", "bank-reconciliations"] as const,
    bankReconciliation: (id: string) => ["finance", "bank-reconciliation", id] as const,
    cashBook: (filters: Record<string, unknown> = {}) => ["finance", "cash-book", filters] as const,
  },
  notifications: {
    list: () => ["notifications", "list"] as const,
  },
  payables: {
    snapshot: () => ["payables", "snapshot"] as const,
  },
  organization: {
    tree: () => ["organization", "tree"] as const,
  },
  procurementReports: {
    list: (filters: Record<string, unknown> = {}) => ["procurement", "reports", filters] as const,
  },
  receivables: {
    snapshot: () => ["receivables", "snapshot"] as const,
  },
  salesReports: {
    list: (filters: Record<string, unknown> = {}) => ["sales", "reports", filters] as const,
  },
  reports: {
    catalog: () => ["reports", "catalog"] as const,
    run: (code?: string) => ["reports", "run", code] as const,
  },
  inventory: {
    movements: () => ["inventory", "movements"] as const,
    posCatalog: (search = "") => ["inventory", "pos-catalog", search] as const,
    posSetup: () => ["inventory", "pos-setup"] as const,
    adjustments: () => ["inventory", "adjustments"] as const,
    countSetup: () => ["inventory", "count-setup"] as const,
    driverWorkspace: (userId?: string | number) =>
      ["inventory", "driver-workspace", userId] as const,
    reorderAlerts: () => ["inventory", "reorder-alerts"] as const,
    masterItems: () => ["inventory", "master-items"] as const,
    lots: (includeExpired: boolean) => ["inventory", "lots", includeExpired] as const,
    analysis: (days: number, warehouseId: string) =>
      ["inventory", "analysis", days, warehouseId] as const,
    lotSetup: () => ["inventory", "lot-setup"] as const,
    stockSnapshot: (warehouseId: string) => ["inventory", "stock", warehouseId] as const,
    valuation: (asOf: string) => ["inventory", "valuation", asOf] as const,
    warehouses: () => ["inventory", "warehouses"] as const,
    workspace: () => ["inventory", "workspace"] as const,
    findings: () => ["inventory", "findings"] as const,
    materialIssues: () => ["inventory", "material-issues"] as const,
    materialRequisitions: () => ["inventory", "material-requisitions"] as const,
    materialReturns: () => ["inventory", "material-returns"] as const,
    quarantine: () => ["inventory", "quarantine"] as const,
    transfers: () => ["inventory", "transfers"] as const,
  },
  hr: {
    selfService: (userId?: string | number) => ["hr", "self-service", userId] as const,
    employees: (userId?: string | number) => ["hr", "employees", userId] as const,
    attendance: (userId?: string | number) => ["hr", "attendance", userId] as const,
    payrollDetail: (runId: string) => ["hr", "payroll-detail", runId] as const,
    recruitmentOverview: () => ["hr", "recruitment-overview"] as const,
    employeeOnboarding: (employeeId: string) => ["hr", "employee-onboarding", employeeId] as const,
    employeeDocuments: (employeeId: string) => ["hr", "employee-documents", employeeId] as const,
    leaveApplications: () => ["hr", "leave-applications"] as const,
    payrollRuns: () => ["hr", "payroll-runs"] as const,
  },
  audit: {
    logs: (query: string, userId?: string) => ["audit", "logs", userId, query] as const,
  },
  procurement: {
    orders: () => ["procurement", "orders"] as const,
    goodsReceipts: () => ["procurement", "goods-receipts"] as const,
    purchaseRequisitions: () => ["procurement", "purchase-requisitions"] as const,
    supplierCredits: () => ["procurement", "supplier-credits"] as const,
  },
  suppliers: {
    list: () => ["suppliers", "list"] as const,
  },
  users: {
    list: () => ["users", "list"] as const,
    roles: (userId?: string | number) => ["users", "roles", userId] as const,
    security: (userId?: string | number) => ["users", "security", userId] as const,
  },
  customers: {
    list: () => ["customers", "list"] as const,
  },
  crm: {
    leads: (filters: Record<string, unknown> = {}) => ["crm", "leads", filters] as const,
    opportunities: () => ["crm", "opportunities"] as const,
    quotes: (filters: Record<string, unknown> = {}) => ["crm", "quotes", filters] as const,
    activities: () => ["crm", "activities"] as const,
  },
  sales: {
    orderFormSetup: (userId?: string | number) => ["sales", "order-form-setup", userId] as const,
    orderLists: () => ["sales", "orders"] as const,
    posTaxPreview: (
      lines: Array<{ item_id: string; quantity: number; unit_price: number }>,
      date?: string,
    ) => ["sales", "pos-tax-preview", date, lines] as const,
    orders: (userId?: string | number) => ["sales", "orders", userId] as const,
    order: (id: string) => ["sales", "order", id] as const,
    customerCreditNotes: () => ["sales", "customer-credit-notes"] as const,
    routeClosures: (routeDate?: string, userId?: string | number) =>
      ["sales", "route-closures", routeDate, userId] as const,
  },
  tax: {
    summary: () => ["tax", "summary"] as const,
    withholdingCategories: () => ["tax", "withholding", "categories"] as const,
    withholdingObligations: () => ["tax", "withholding", "obligations"] as const,
  },
  expenses: {
    summary: () => ["expenses", "summary"] as const,
    categories: () => ["expenses", "categories"] as const,
  },
  invoices: {
    lists: () => ["sales", "invoices"] as const,
    createSetup: (userId?: string | number) => ["sales", "invoice-create-setup", userId] as const,
    list: (userId?: string | number) => ["sales", "invoices", userId] as const,
    detail: (id: string) => ["sales", "invoice", id] as const,
    taxPreview: (
      lines: Array<{ item_id: string; quantity: number; unit_price: number }>,
      date?: string,
    ) => ["sales", "invoice-tax-preview", date, lines] as const,
  },
};
