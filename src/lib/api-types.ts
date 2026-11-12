/** Shared API contract types. Runtime requests live in the versioned client. */

export type User = {
  id: string | number;
  username: string;
  full_name: string | null;
  email: string;
  role: string;
  permissions?: string[];
  mfa_enabled?: boolean;
};

export type BackendUser = {
  id: string | number;
  username: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  phone?: string | null;
  two_factor_enabled?: boolean;
  last_login?: string | null;
};

export type BackendCustomer = {
  id: string | number;
  name: string;
  kra_pin: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  location?: string | null;
  type?: string | null;
  segment?: string | null;
  credit_limit: number;
  payment_terms?: string | null;
  balance: number;
};

export type BackendSupplier = {
  id: string | number;
  name: string;
  kra_pin: string;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  payment_terms?: string | null;
  credit_limit: number;
  balance: number;
};

export type SupplierBill = {
  id: string;
  bill_no: string;
  supplier_invoice_no: string;
  vendor_id: string;
  vendor_name: string;
  bill_date: string;
  due_date: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  journal_id?: string | null;
  status: string;
  display_status?: string;
  days_overdue: number;
  purchase_order_id?: string | null;
  goods_receipt_id?: string | null;
  po_number?: string | null;
  grn_number?: string | null;
};

export type BackendWarehouse = {
  id: string | number;
  code?: string;
  name: string;
  address: string;
  city?: string | null;
  manager?: string | null;
  phone?: string | null;
  is_active?: boolean;
};

export type BackendMasterItem = {
  id: string;
  item_code: string;
  name: string;
  barcode?: string | null;
  standard_cost: number;
  reorder_point: number;
  tax_group_id?: string | null;
  lot_tracking_enabled: boolean;
  is_stock_item: boolean;
  is_active: boolean;
  etims_item_classification_code?: string | null;
  etims_item_code?: string | null;
  etims_item_type_code?: string | null;
  etims_origin_country_code?: string | null;
  etims_packaging_unit_code?: string | null;
  etims_package_quantity?: number | null;
  etims_quantity_unit_code?: string | null;
  etims_tax_type_code?: string | null;
  etims_sync_status?: "unmapped" | "pending" | "synced" | "failed";
};

export type BackendTaxGroup = {
  id: string;
  code: string;
  name: string;
  tax_treatment: "standard" | "zero_rated" | "exempt" | "out_of_scope";
};

export type BackendTaxRate = {
  id: string;
  code: string;
  name: string;
  rate: number;
  tax_type: string;
  basis: string;
  effective_from: string;
  effective_to?: string | null;
  tax_groups: string[];
};

export type BackendInventoryItem = {
  item_id: string;
  product_id: number;
  name: string;
  sku: string;
  barcode?: string | null;
  category: string;
  brand?: string | null;
  abv: number;
  pack_size?: string | null;
  cost_price: number;
  retail_price: number;
  min_stock: number;
  warehouse_id: string;
  warehouse: string;
  stock: number;
  reserved_quantity?: number;
  available_quantity?: number;
  expiry_date?: string | null;
};

export type ProductSaleWorkflowPayload = {
  customer_kra_pin: string;
  warehouse: string;
  discount_percent: number;
  payment_method?: string;
  items: Array<{
    sku: string;
    quantity: number;
    price_tier: "retail" | "wholesale" | "distributor";
  }>;
};

export type ProductSaleWorkflowResult = {
  order_number: string;
  invoice_number: string;
  etr_number: string;
  subtotal: number;
  excise: number;
  vat: number;
  total: number;
  paid: boolean;
};

export type DashboardSummary = {
  kpis: {
    todays_sales: number;
    revenue_mtd: number;
    pending_orders: number;
    outstanding_invoices: number;
  };
  monthlyRevenue: Array<{ month: string; revenue: number }>;
  topProducts: Array<{ name: string; units: number }>;
  salesByCategory: Array<{ name: string; value: number }>;
  alerts: Array<{ type: string; severity: string; message: string }>;
  integrationExceptions: IntegrationException[];
  recentTransactions: Array<{
    id: string;
    date: string;
    customer: string;
    rep: string;
    total: number;
    status: string;
  }>;
};

export type IntegrationException = {
  id: string;
  type: string;
  source_id: string;
  reference: string | null;
  status: string;
  attempt_count: number;
  age_seconds: number;
  last_error: string | null;
  manually_retryable: boolean;
};

export type BackendSalesOrder = {
  id: string;
  internal_id?: string;
  date: string;
  customer: string;
  rep: string;
  items: number;
  total: number;
  status: "Draft" | "Confirmed" | "Partial" | "Dispatched" | "Delivered" | "Invoiced" | "Cancelled";
};

export type SalesOrderDetail = {
  id: string;
  order_no: string;
  customer_name?: string;
  order_date?: string;
  required_date?: string;
  status?: string;
  total_amount?: number;
  notes?: string | null;
  lines: Array<{
    id: string;
    item_code?: string;
    item_name?: string;
    quantity: number;
    qty_delivered?: number;
    qty_invoiced?: number;
    unit_price: number;
    line_total?: number;
  }>;
};

export type SalesAnalytics = {
  orders_by_status: Array<{ status: string; count: number; total: number }>;
  invoices_by_status: Array<{ status: string; count: number; total: number }>;
  pipeline_forecast: number;
};

export type BackendPurchaseOrder = {
  id: string;
  internal_id: string | number;
  date: string;
  supplier: string;
  warehouse: string;
  items: number;
  total: number;
  status: "Draft" | "Approved" | "Sent" | "Received" | "Partial" | "Invoiced" | "Cancelled";
};

export type BackendGoodsReceipt = {
  id: string;
  grn_number: string;
  po_number?: string;
  receipt_date?: string;
  status?: string;
  notes?: string | null;
  vendor_id?: string;
  vendor_name?: string;
  purchase_order_id?: string;
};

export type BackendGoodsReceiptLine = {
  goods_receipt_line_id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  unbilled_quantity: number;
};

export type BackendGoodsReceiptDetail = BackendGoodsReceipt & {
  purchase_order_id: string;
  vendor_id: string;
  vendor_name: string;
  lines: BackendGoodsReceiptLine[];
};

export type BackendInventoryLot = {
  id: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  item_id: string;
  item_code: string;
  item_name: string;
  batch_no: string;
  expiry_date: string;
  days_to_expiry: number;
  quantity: number;
  available_quantity: number;
  quarantined_quantity: number;
  unit_cost: number;
};

export type BackendEmployee = {
  id: string;
  name: string;
  email?: string | null;
  user_id?: string | null;
  department: string;
  role: string;
  salary: number;
  status: string;
};

export type PayrollRun = {
  id: string;
  payroll_month: string;
  status: string;
  employee_count: number;
  total_gross?: number;
  total_net?: number;
};

export type PayslipRow = {
  id: string;
  employee_code?: string;
  first_name?: string;
  last_name?: string;
  gross_pay: number;
  paye: number;
  shif: number;
  nhif: number;
  nssf: number;
  nssf_tier1?: number;
  nssf_tier2?: number;
  nssf_employer?: number;
  housing_levy: number;
  housing_levy_employer?: number;
  taxable_income?: number;
  personal_relief?: number;
  insurance_relief?: number;
  employer_cost?: number;
  net_pay: number;
};

export type PayrollRemittance = {
    id: string;
    agency_code: string;
    agency_name: string;
    amount_due: number;
    amount_paid: number;
    outstanding_amount: number;
    due_date?: string | null;
    status: string;
    payroll_month: string;
    posted_payment_count: number;
  };

export type ReportLibraryEntry = { code: string; name: string; category: string };

export type BackendInvoice = {
  id: string;
  internalId?: string;
  date: string;
  due: string;
  customer: string;
  kraPin: string;
  etr: string;
  etimsStatus: string;
  subtotal: number;
  excise: number;
  vat: number;
  total: number;
  status: "Draft" | "Sent" | "Paid" | "Overdue" | "Cancelled";
};

export type BackendDelivery = {
  id: string;
  delivery_no: string;
  order_no?: string;
  delivery_date?: string;
  status?: string;
  driver_name?: string | null;
  vehicle_no?: string | null;
  route?: string | null;
};

export type AuditLogRow = {
  id: string | number;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
};

export type AccountingJournalRow = {
  d: string;
  a: string;
  desc: string;
  db: number;
  cr: number;
};

export type AccountingSnapshot = {
  journalRows: AccountingJournalRow[];
  pnl: Array<{ month: string; revenue: number; expenses: number }>;
};

export type FinancePeriod = {
  id: string;
  name: string;
  code?: string;
  status: string;
  start_date?: string;
  end_date?: string;
};

export type FinanceReportLine = {
  account_code: string;
  account_name: string;
  account_type?: string;
  amount?: number;
  period_debit?: number;
  period_credit?: number;
  balance?: number;
};

export type FinanceWorkspace = {
  periods: FinancePeriod[];
  trialBalance: {
    lines: FinanceReportLine[];
    totals: { period_debit: number; period_credit: number };
  };
  balanceSheet: FinanceReportLine[];
  profitLoss: { lines: FinanceReportLine[]; net_profit: number };
};

export type BankStatementLine = {
  id: string;
  line_no: number;
  transaction_date: string;
  reference?: string | null;
  description: string;
  debit: number;
  credit: number;
  journal_line_id?: string | null;
  journal_no?: string | null;
  matched_entry_date?: string | null;
  matched_account_code?: string | null;
};

export type BankLedgerCandidate = {
  journal_line_id: string;
  journal_no: string;
  entry_date: string;
  reference_no?: string | null;
  journal_description?: string | null;
  line_description?: string | null;
  debit: number;
  credit: number;
  account_code: string;
  account_name: string;
};

export type BankReconciliation = {
  id: string;
  bank_account_id: string;
  account_code: string;
  account_name: string;
  currency_code?: string;
  statement_reference: string;
  statement_start: string;
  statement_end: string;
  opening_balance: number;
  closing_balance: number;
  status: "draft" | "reconciled";
  line_count: number;
  matched_count: number;
  lines?: BankStatementLine[];
  outstanding_book_lines?: BankLedgerCandidate[];
};
