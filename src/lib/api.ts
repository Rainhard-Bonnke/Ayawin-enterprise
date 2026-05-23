import { customers, products, purchaseOrders, salesOrders, suppliers, users, warehouses } from "./mock-data";
import { demoRoleAccounts } from "./rbac";

export type User = {
  id: number;
  username: string;
  full_name: string | null;
  email: string;
  role: string;
};

const apiBase = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
const CLIENT_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.DEV;
const DEMO_USERS = new Set(["admin", "admin@company.local", ...Object.keys(demoRoleAccounts)]);

const isDemoToken = (token: string) => token.startsWith("demo:");

const seededUsers = (): BackendUser[] =>
  [
    ...users.map((user, index) => ({
      id: index + 1,
      username: user.email.split("@")[0],
      full_name: user.name,
      email: user.email,
      role: user.role,
      status: user.status.toLowerCase(),
      phone: `+254 700 000 00${index + 1}`,
      two_factor_enabled: ["Admin", "Manager", "Accountant"].includes(user.role),
      last_login: user.lastLogin,
    })),
    {
      id: 101,
      username: "hr",
      full_name: "HR Officer Demo User",
      email: "hr@martin.co.ke",
      role: "HR Officer",
      status: "active",
      phone: "+254 700 000 101",
      two_factor_enabled: true,
      last_login: "2026-05-21T09:10:00",
    },
    {
      id: 102,
      username: "store",
      full_name: "Store Manager Demo User",
      email: "store@martin.co.ke",
      role: "Store Manager",
      status: "active",
      phone: "+254 700 000 102",
      two_factor_enabled: true,
      last_login: "2026-05-21T08:40:00",
    },
  ];

const seededCustomers = (): BackendCustomer[] =>
  customers.map((customer, index) => ({
    id: index + 1,
    name: customer.name,
    kra_pin: customer.kraPin,
    contact: customer.phone,
    email: customer.email,
    address: customer.location,
    location: customer.location,
    type: customer.segment,
    segment: customer.segment,
    credit_limit: customer.creditLimit,
    payment_terms: customer.terms,
    balance: customer.balance,
  }));

const seededSuppliers = (): BackendSupplier[] =>
  suppliers.map((supplier, index) => ({
    id: index + 1,
    name: supplier.name,
    kra_pin: supplier.kraPin,
    contact: supplier.phone,
    email: supplier.email,
    phone: supplier.phone,
    payment_terms: supplier.terms,
    credit_limit: supplier.creditLimit,
    balance: supplier.balance,
  }));

const seededWarehouses = (): BackendWarehouse[] =>
  warehouses.map((warehouse, index) => ({
    id: index + 1,
    name: warehouse.name,
    address: warehouse.location,
    manager: warehouse.manager,
    phone: `+254 711 100 10${index}`,
  }));

const seededInventoryItems = (): BackendInventoryItem[] =>
  products.map((product, index) => {
    const warehouse = warehouses.find((row) => row.name === product.warehouse) ?? warehouses[0];
    return {
      product_id: index + 1,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      category: product.category,
      brand: product.brand,
      abv: product.abv,
      pack_size: product.packSize,
      cost_price: product.costPrice,
      retail_price: product.retailPrice,
      min_stock: product.minStock,
      warehouse_id: warehouses.findIndex((row) => row.name === warehouse.name) + 1,
      warehouse: warehouse.name,
      stock: product.stock,
      expiry_date: product.expiry,
    };
  });

function buildDemoSession(email: string): { token: string; user: User } {
  const normalized = email.trim().toLowerCase();
  const resolvedEmail = normalized === "admin" ? "admin@martin.co.ke" : email.trim();
  const role = demoRoleAccounts[resolvedEmail.toLowerCase()] ?? "Admin";

  return {
    token: `demo:${resolvedEmail}:${role}`,
    user: {
      id: 0,
      username: resolvedEmail.split("@")[0],
      full_name: role === "Admin" ? "System Administrator" : `${role} Demo User`,
      email: resolvedEmail,
      role,
    },
  };
}

function buildUrl(path: string) {
  return `${apiBase}${path}`;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json();
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as { error?: string; message?: string };
    throw new Error(data.error || data.message || response.statusText || "Request failed");
  }

  const text = await response.text();
  throw new Error(text || response.statusText || "Request failed");
}

export async function loginRequest(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if ((import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.DEV) && password === "demo" && DEMO_USERS.has(normalizedEmail)) {
    return buildDemoSession(email);
  }

  try {
    const response = await fetch(buildUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    return handleResponse<{ token: string; user: User }>(response);
  } catch {
    throw new Error("Authentication service is unavailable. Start the backend and try again.");
  }
}

export async function fetchCurrentUser(token: string) {
  const response = await fetch(buildUrl("/api/auth/me"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse<User>(response);
}

export type BackendUser = {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  phone?: string | null;
  two_factor_enabled?: boolean;
  last_login?: string | null;
};

export async function fetchUsers(token: string) {
  if (isDemoToken(token)) return seededUsers();

  try {
    const response = await fetch(buildUrl("/api/users"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return handleResponse<BackendUser[]>(response);
  } catch {
    if (CLIENT_DEMO_MODE) return seededUsers();
    throw new Error('Authentication service is unavailable. Start the backend and try again.');
  }
}

export async function createUser(token: string, payload: { username: string; full_name: string; email: string; role: string; phone?: string }) {
  if (isDemoToken(token)) {
    return {
      id: Date.now(),
      username: payload.username,
      full_name: payload.full_name,
      email: payload.email,
      role: payload.role,
      status: "active",
      phone: payload.phone ?? null,
      two_factor_enabled: false,
      last_login: null,
    };
  }

  const response = await fetch(buildUrl("/api/users"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<BackendUser>(response);
}

export async function updateUser(token: string, id: number, payload: { status?: string; role?: string; two_factor_enabled?: boolean }) {
  if (isDemoToken(token)) {
    const existing = seededUsers().find((user) => user.id === id) ?? seededUsers()[0];
    return { ...existing, ...payload };
  }

  const response = await fetch(buildUrl(`/api/users/${id}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<BackendUser>(response);
}

export type BackendCustomer = {
  id: number;
  name: string;
  kra_pin: string;
  contact?: string | null;
  email?: string | null;
  address?: string | null;
  location?: string | null;
  type?: string | null;
  segment?: string | null;
  credit_limit: number;
  payment_terms?: string | null;
  balance: number;
};

export async function fetchCustomers(token: string) {
  if (isDemoToken(token)) return seededCustomers();

  try {
    const response = await fetch(buildUrl("/api/customers"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return handleResponse<BackendCustomer[]>(response);
  } catch {
    return seededCustomers();
  }
}

export async function createCustomer(
  token: string,
  payload: {
    name: string;
    kra_pin: string;
    contact?: string;
    email?: string;
    address?: string;
    location?: string;
    type?: string;
    segment?: string;
    credit_limit?: number;
    payment_terms?: string;
    balance?: number;
  },
) {
  if (isDemoToken(token)) {
    return {
      id: Date.now(),
      name: payload.name,
      kra_pin: payload.kra_pin,
      contact: payload.contact ?? null,
      email: payload.email ?? null,
      address: payload.address ?? null,
      location: payload.location ?? null,
      type: payload.type ?? payload.segment ?? null,
      segment: payload.segment ?? payload.type ?? null,
      credit_limit: payload.credit_limit ?? 0,
      payment_terms: payload.payment_terms ?? null,
      balance: payload.balance ?? 0,
    };
  }

  const response = await fetch(buildUrl("/api/customers"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<BackendCustomer>(response);
}

export async function updateCustomer(
  token: string,
  id: number,
  payload: Partial<{
    name: string;
    kra_pin: string;
    contact: string;
    email: string;
    address: string;
    location: string;
    type: string;
    segment: string;
    credit_limit: number;
    payment_terms: string;
    balance: number;
  }>,
) {
  if (isDemoToken(token)) {
    const existing = seededCustomers().find((customer) => customer.id === id) ?? seededCustomers()[0];
    return { ...existing, ...payload };
  }

  const response = await fetch(buildUrl(`/api/customers/${id}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<BackendCustomer>(response);
}

export async function deleteCustomer(token: string, id: number) {
  if (isDemoToken(token)) return { ok: true as const };

  const response = await fetch(buildUrl(`/api/customers/${id}`), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return handleResponse<{ ok: true }>(response);
}

export type BackendSupplier = {
  id: number;
  name: string;
  kra_pin: string;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
  payment_terms?: string | null;
  credit_limit: number;
  balance: number;
};

export async function fetchSuppliers(token: string) {
  if (isDemoToken(token)) return seededSuppliers();

  try {
    const response = await fetch(buildUrl("/api/suppliers"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return handleResponse<BackendSupplier[]>(response);
  } catch {
    return seededSuppliers();
  }
}

export async function createSupplier(
  token: string,
  payload: {
    name: string;
    kra_pin: string;
    contact?: string;
    email?: string;
    phone?: string;
    payment_terms?: string;
    credit_limit?: number;
    balance?: number;
  },
) {
  if (isDemoToken(token)) {
    return {
      id: Date.now(),
      name: payload.name,
      kra_pin: payload.kra_pin,
      contact: payload.contact ?? null,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      payment_terms: payload.payment_terms ?? null,
      credit_limit: payload.credit_limit ?? 0,
      balance: payload.balance ?? 0,
    };
  }

  const response = await fetch(buildUrl("/api/suppliers"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<BackendSupplier>(response);
}

export async function updateSupplier(
  token: string,
  id: number,
  payload: Partial<{
    name: string;
    kra_pin: string;
    contact: string;
    email: string;
    phone: string;
    payment_terms: string;
    credit_limit: number;
    balance: number;
  }>,
) {
  if (isDemoToken(token)) {
    const existing = seededSuppliers().find((supplier) => supplier.id === id) ?? seededSuppliers()[0];
    return { ...existing, ...payload };
  }

  const response = await fetch(buildUrl(`/api/suppliers/${id}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<BackendSupplier>(response);
}

export async function deleteSupplier(token: string, id: number) {
  if (isDemoToken(token)) return { ok: true as const };

  const response = await fetch(buildUrl(`/api/suppliers/${id}`), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return handleResponse<{ ok: true }>(response);
}

export type BackendWarehouse = {
  id: number;
  name: string;
  address: string;
  manager?: string | null;
  phone?: string | null;
};

export async function fetchWarehouses(token: string) {
  if (isDemoToken(token)) return seededWarehouses();

  try {
    const response = await fetch(buildUrl("/api/warehouses"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return handleResponse<BackendWarehouse[]>(response);
  } catch {
    return seededWarehouses();
  }
}

export type BackendInventoryItem = {
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
  warehouse_id: number;
  warehouse: string;
  stock: number;
  expiry_date?: string | null;
};

export async function fetchInventoryItems(token: string) {
  if (isDemoToken(token)) return seededInventoryItems();

  try {
    const response = await fetch(buildUrl("/api/inventory/items"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return handleResponse<BackendInventoryItem[]>(response);
  } catch {
    return seededInventoryItems();
  }
}

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

export async function createProductSaleWorkflow(token: string, payload: ProductSaleWorkflowPayload) {
  if (isDemoToken(token)) {
    const item = payload.items[0];
    const product = products.find((row) => row.sku === item?.sku);
    const customer = customers.find((row) => row.kraPin === payload.customer_kra_pin);
    const subtotal = (product?.wholesalePrice ?? 0) * (item?.quantity ?? 0) * (1 - payload.discount_percent / 100);
    const excise = (product?.litresPerUnit ?? 0) * (item?.quantity ?? 0) * (product?.category === "Beer" ? 121.85 : product?.category === "Spirits" ? 356.28 : product?.category === "Wine" ? 229.85 : product?.category === "Soft Drinks" ? 10.68 : 0);
    const vat = (subtotal + excise) * 0.16;

    return {
      order_number: `SO-DEMO-${Date.now()}`,
      invoice_number: `INV-DEMO-${Date.now()}`,
      etr_number: `ETR-DEMO-${Date.now()}`,
      subtotal,
      excise,
      vat,
      total: subtotal + excise + vat,
      paid: Boolean(payload.payment_method),
      customer: customer?.name,
    } as ProductSaleWorkflowResult & { customer?: string };
  }

  const response = await fetch(buildUrl("/api/sales/product-sale"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<ProductSaleWorkflowResult>(response);
}

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
  recentTransactions: Array<{ id: string; date: string; customer: string; rep: string; total: number; status: string }>;
};

export type BackendSalesOrder = {
  id: string;
  date: string;
  customer: string;
  rep: string;
  items: number;
  total: number;
  status: "Draft" | "Confirmed" | "Dispatched" | "Delivered" | "Invoiced";
};

export async function fetchSalesOrders(token: string) {
  if (isDemoToken(token)) return salesOrders;

  try {
    const response = await fetch(buildUrl("/api/sales/orders"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return handleResponse<BackendSalesOrder[]>(response);
  } catch {
    return salesOrders;
  }
}

export async function fetchDashboardSummary(token: string) {
  if (isDemoToken(token)) throw new Error("Demo mode uses local dashboard data");

  const response = await fetch(buildUrl("/api/dashboard/summary"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<DashboardSummary>(response);
}

export type BackendPurchaseOrder = {
  id: string;
  internal_id: number;
  date: string;
  supplier: string;
  warehouse: string;
  items: number;
  total: number;
  status: "Draft" | "Approved" | "Sent" | "Received" | "Invoiced" | "Cancelled";
};

export async function fetchPurchaseOrders(token: string) {
  if (isDemoToken(token)) return purchaseOrders;

  try {
    const response = await fetch(buildUrl("/api/procurement/purchase-orders"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return handleResponse<BackendPurchaseOrder[]>(response);
  } catch {
    return purchaseOrders;
  }
}

export async function createPurchaseOrder(
  token: string,
  payload: {
    supplier_id: number;
    warehouse_id: number;
    status?: "Draft" | "Approved" | "Sent";
    items: Array<{ sku: string; quantity: number; unit_cost: number }>;
  },
) {
  if (isDemoToken(token)) return { ok: true as const };

  const response = await fetch(buildUrl("/api/procurement/purchase-orders"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ id: string; status: string; total: number }>(response);
}

export async function updatePurchaseOrderStatus(token: string, internalId: number, status: BackendPurchaseOrder["status"]) {
  if (isDemoToken(token)) return { ok: true as const };

  const response = await fetch(buildUrl(`/api/procurement/purchase-orders/${internalId}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });
  return handleResponse<{ ok: true; id: string; status: string }>(response);
}

export async function receivePurchaseOrder(token: string, internalId: number, received_by: string) {
  if (isDemoToken(token)) return { ok: true as const, grn_number: `GRN-DEMO-${Date.now()}` };

  const response = await fetch(buildUrl(`/api/procurement/purchase-orders/${internalId}/receive`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ received_by }),
  });
  return handleResponse<{ ok: true; grn_number: string; po_number: string; received_items: number }>(response);
}
