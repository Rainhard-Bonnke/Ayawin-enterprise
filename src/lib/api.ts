import { customers, products, purchaseOrders, salesOrders, suppliers, users, warehouses } from "./mock-data";
import {
  isV1Enabled,
  v1Api,
  v1Login,
  v1Logout,
  v1Me,
  apiV1Fetch,
  masterList,
  masterCreate,
  masterUpdate,
  masterDelete,
  fetchRoles as v1FetchRoles,
  importRows,
} from "./api-v1";

export type User = {
  id: string | number;
  username: string;
  full_name: string | null;
  email: string;
  role: string;
  permissions?: string[];
};

const apiBase = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

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
      item_id: `demo-item-${index + 1}`,
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
      warehouse_id: String(warehouses.findIndex((row) => row.name === warehouse.name) + 1),
      warehouse: warehouse.name,
      stock: product.stock,
      expiry_date: product.expiry,
    };
  });

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
  if (isV1Enabled()) {
    return v1Login(email, password);
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
  if (isV1Enabled() && !isDemoToken(token)) {
    return v1Me(token);
  }
  const response = await fetch(buildUrl("/api/auth/me"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return handleResponse<User>(response);
}

export async function logoutRequest(token: string) {
  if (isV1Enabled() && !isDemoToken(token)) {
    await v1Logout();
    return;
  }
}

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

function mapV1User(row: Record<string, unknown>): BackendUser {
  return {
    id: String(row.id),
    username: String(row.username || row.email?.toString().split("@")[0] || "user"),
    full_name: String(row.full_name || ""),
    email: String(row.email),
    role: String(row.role_name || row.role || "User"),
    status: String(row.status || "active"),
    phone: (row.phone as string) || null,
    two_factor_enabled: Boolean(row.mfa_enabled),
    last_login: row.last_login_at ? String(row.last_login_at) : null,
  };
}

export async function fetchUsers(token: string) {
  if (isDemoToken(token)) return seededUsers();

  if (isV1Enabled()) {
    const rows = await v1Api.users.list(token);
    return rows.map(mapV1User);
  }

  const response = await fetch(buildUrl("/api/users"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<BackendUser[]>(response);
}

export async function fetchRoles(token: string) {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  return v1FetchRoles(token);
}

export async function createUser(
  token: string,
  payload: {
    username: string;
    full_name: string;
    email: string;
    role: string;
    role_id?: string;
    phone?: string;
    password: string;
  },
) {
  if (isDemoToken(token)) {
    throw new Error("Create users against the live API (disable demo mode).");
  }

  if (isV1Enabled()) {
    let roleId = payload.role_id;
    if (!roleId) {
      const roles = await v1FetchRoles(token);
      roleId = roles.find((r) => r.name === payload.role)?.id;
    }
    const row = await apiV1Fetch<Record<string, unknown>>("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        username: payload.username,
        email: payload.email,
        full_name: payload.full_name,
        phone: payload.phone,
        role_id: roleId,
        password: payload.password,
      }),
    }, token);
    const user = mapV1User(row);
    if (!row.role_name && payload.role) user.role = payload.role;
    return user;
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

export async function updateUser(
  token: string,
  id: string | number,
  payload: { status?: string; role?: string; role_id?: string; full_name?: string; phone?: string; two_factor_enabled?: boolean },
) {
  if (isDemoToken(token)) {
    throw new Error("Update users against the live API (disable demo mode).");
  }

  if (isV1Enabled()) {
    let roleId = payload.role_id;
    if (!roleId && payload.role) {
      const roles = await v1FetchRoles(token);
      roleId = roles.find((r) => r.name === payload.role)?.id;
    }
    const row = await apiV1Fetch<Record<string, unknown>>(`/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        full_name: payload.full_name,
        phone: payload.phone,
        status: payload.status,
        role_id: roleId,
      }),
    }, token);
    return mapV1User(row);
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

function mapV1Customer(row: Record<string, unknown>): BackendCustomer {
  return {
    id: String(row.id),
    name: String(row.name),
    kra_pin: String(row.tax_id || row.kra_pin || ""),
    contact: (row.contact_name as string) || (row.phone as string) || null,
    email: (row.email as string) || null,
    address: (row.address_line1 as string) || null,
    location: (row.city as string) || null,
    type: (row.customer_type as string) || null,
    segment: (row.customer_type as string) || null,
    credit_limit: Number(row.credit_limit || 0),
    payment_terms: (row.payment_terms as string) || null,
    balance: 0,
  };
}

export type BackendCustomer = {
  id: string | number;
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
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }

  if (isV1Enabled()) {
    const rows = await v1Api.master.customers(token);
    return rows.map((row) => mapV1Customer(row));
  }

  const response = await fetch(buildUrl("/api/customers"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<BackendCustomer[]>(response);
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

  if (isV1Enabled()) {
    const code = payload.kra_pin || `C-${Date.now()}`;
    const row = await apiV1Fetch<Record<string, unknown>>("/master/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        customer_code: code,
        name: payload.name,
        tax_id: payload.kra_pin,
        email: payload.email,
        phone: payload.contact,
        address_line1: payload.address,
        city: payload.location,
        customer_type: payload.segment || payload.type,
        credit_limit: payload.credit_limit,
      }),
    }, token);
    return mapV1Customer(row);
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
  id: string | number,
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

  if (isV1Enabled()) {
    const row = await apiV1Fetch<Record<string, unknown>>(`/master/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: payload.name,
        tax_id: payload.kra_pin,
        email: payload.email,
        phone: payload.contact,
        credit_limit: payload.credit_limit,
      }),
    }, token);
    return mapV1Customer(row);
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

export async function deleteCustomer(token: string, id: string | number) {
  if (isDemoToken(token)) return { ok: true as const };

  if (isV1Enabled()) {
    await apiV1Fetch(`/master/customers/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }, token);
    return { ok: true as const };
  }

  const response = await fetch(buildUrl(`/api/customers/${id}`), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return handleResponse<{ ok: true }>(response);
}

function mapV1Supplier(row: Record<string, unknown>): BackendSupplier {
  return {
    id: String(row.id),
    name: String(row.name),
    kra_pin: String(row.tax_id || ""),
    contact: (row.contact_name as string) || null,
    email: (row.email as string) || null,
    phone: (row.phone as string) || null,
    payment_terms: null,
    credit_limit: Number(row.credit_limit || 0),
    balance: 0,
  };
}

export type BackendSupplier = {
  id: string | number;
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

  if (isV1Enabled()) {
    const rows = await v1Api.master.vendors(token);
    return rows.map(mapV1Supplier);
  }

  const response = await fetch(buildUrl("/api/suppliers"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<BackendSupplier[]>(response);
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
  if (isDemoToken(token)) throw new Error("Use live API for suppliers");

  if (isV1Enabled()) {
    const code = payload.kra_pin || `V-${Date.now()}`;
    const row = await masterCreate(token, "vendors", {
      vendor_code: code,
      name: payload.name,
      tax_id: payload.kra_pin,
      contact_name: payload.contact,
      email: payload.email,
      phone: payload.phone,
      credit_limit: payload.credit_limit,
    });
    return mapV1Supplier(row);
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
  id: string | number,
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
  if (isDemoToken(token)) throw new Error("Use live API for suppliers");

  if (isV1Enabled()) {
    const row = await masterUpdate(token, "vendors", String(id), {
      name: payload.name,
      tax_id: payload.kra_pin,
      contact_name: payload.contact,
      email: payload.email,
      phone: payload.phone,
      credit_limit: payload.credit_limit,
    });
    return mapV1Supplier(row);
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

export async function deleteSupplier(token: string, id: string | number) {
  if (isDemoToken(token)) throw new Error("Use live API for suppliers");

  if (isV1Enabled()) {
    await masterDelete(token, "vendors", String(id));
    return { ok: true as const };
  }

  const response = await fetch(buildUrl(`/api/suppliers/${id}`), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return handleResponse<{ ok: true }>(response);
}

export type BackendWarehouse = {
  id: string | number;
  code?: string;
  name: string;
  address: string;
  city?: string | null;
  manager?: string | null;
  phone?: string | null;
};

export type BackendMasterItem = {
  id: string;
  item_code: string;
  name: string;
  barcode?: string | null;
  standard_cost: number;
  reorder_point: number;
  is_active: boolean;
};

function mapV1Item(row: Record<string, unknown>): BackendMasterItem {
  return {
    id: String(row.id),
    item_code: String(row.item_code),
    name: String(row.name),
    barcode: (row.barcode as string) || null,
    standard_cost: Number(row.standard_cost || 0),
    reorder_point: Number(row.reorder_point || 0),
    is_active: row.is_active !== false,
  };
}

export async function fetchMasterItems(token: string) {
  if (isDemoToken(token)) return [];
  if (!isV1Enabled()) return [];
  const rows = await masterList(token, "items");
  return rows.map(mapV1Item);
}

export async function createMasterItem(
  token: string,
  payload: { item_code: string; name: string; barcode?: string; standard_cost?: number; reorder_point?: number },
) {
  if (isDemoToken(token)) throw new Error("Use live API for items");
  const row = await masterCreate(token, "items", payload);
  return mapV1Item(row);
}

export async function updateMasterItem(
  token: string,
  id: string,
  payload: Partial<{ name: string; barcode: string; standard_cost: number; reorder_point: number; is_active: boolean }>,
) {
  if (isDemoToken(token)) throw new Error("Use live API for items");
  const row = await masterUpdate(token, "items", id, payload);
  return mapV1Item(row);
}

export async function deleteMasterItem(token: string, id: string) {
  if (isDemoToken(token)) throw new Error("Use live API for items");
  await masterDelete(token, "items", id);
  return { ok: true as const };
}

export async function fetchWarehouses(token: string) {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }

  if (isV1Enabled()) {
    const rows = await v1Api.master.warehouses(token);
    return rows.map(mapV1Warehouse);
  }

  const response = await fetch(buildUrl("/api/warehouses"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<BackendWarehouse[]>(response);
}

function mapV1Warehouse(row: Record<string, unknown>): BackendWarehouse {
  return {
    id: String(row.id),
    code: String(row.code || ""),
    name: String(row.name),
    address: String(row.address_line1 || ""),
    city: (row.city as string) || null,
    manager: (row.manager_name as string) || null,
    phone: (row.phone as string) || null,
  };
}

export async function createWarehouse(
  token: string,
  payload: { code: string; name: string; address_line1?: string; city?: string; manager_name?: string; phone?: string },
) {
  if (isDemoToken(token)) throw new Error("Use live API for warehouses");
  if (isV1Enabled()) {
    const row = await masterCreate(token, "warehouses", payload);
    return mapV1Warehouse(row);
  }
  const response = await fetch(buildUrl("/api/warehouses"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return handleResponse<BackendWarehouse>(response);
}

export async function updateWarehouse(
  token: string,
  id: string,
  payload: Partial<{ code: string; name: string; address_line1: string; city: string; manager_name: string; phone: string }>,
) {
  if (isDemoToken(token)) throw new Error("Use live API for warehouses");
  if (isV1Enabled()) {
    const row = await masterUpdate(token, "warehouses", id, payload);
    return mapV1Warehouse(row);
  }
  const response = await fetch(buildUrl(`/api/warehouses/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return handleResponse<BackendWarehouse>(response);
}

export async function deleteWarehouse(token: string, id: string) {
  if (isDemoToken(token)) throw new Error("Use live API for warehouses");
  if (isV1Enabled()) {
    await masterDelete(token, "warehouses", id);
    return { ok: true as const };
  }
  const response = await fetch(buildUrl(`/api/warehouses/${id}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<{ ok: true }>(response);
}

export async function importMasterData(
  token: string,
  entityType: "customers" | "items" | "attendance",
  rows: Record<string, unknown>[],
  fileName?: string,
) {
  if (isDemoToken(token)) throw new Error("Use live API for imports");
  return importRows(token, entityType, rows, fileName);
}

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
  expiry_date?: string | null;
};

export async function fetchInventoryItems(token: string) {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }

  if (isV1Enabled()) {
    const rows = await v1Api.inventory.stock(token);
    return rows.map((row, index) => ({
      item_id: String(row.item_id),
      product_id: index + 1,
      name: String(row.item_name || row.name),
      sku: String(row.item_code),
      barcode: null,
      category: "",
      brand: null,
      abv: 0,
      pack_size: null,
      cost_price: Number(row.avg_unit_cost || 0),
      retail_price: Number(row.avg_unit_cost || 0) * 1.4,
      min_stock: Number(row.reorder_point || 0),
      warehouse_id: String(row.warehouse_id),
      warehouse: String(row.warehouse_name || row.warehouse_code),
      stock: Number(row.quantity || 0),
      expiry_date: null,
    }));
  }

  const response = await fetch(buildUrl("/api/inventory/items"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<BackendInventoryItem[]>(response);
}

export async function createStockIn(
  token: string,
  payload: {
    warehouse_id: string;
    item_id: string;
    quantity: number;
    unit_cost?: number;
    notes?: string;
  },
) {
  if (isDemoToken(token)) throw new Error("Sign in with the API to post stock (demo mode is read-only).");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.inventory.stockIn(token, payload);
}

export async function createStockTransfer(
  token: string,
  payload: {
    from_warehouse_id: string;
    to_warehouse_id: string;
    lines: Array<{ item_id: string; quantity: number }>;
    notes?: string;
  },
) {
  if (isDemoToken(token)) throw new Error("Sign in with the API to transfer stock (demo mode is read-only).");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.inventory.transfer(token, payload);
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
  internal_id?: string;
  date: string;
  customer: string;
  rep: string;
  items: number;
  total: number;
  status: "Draft" | "Confirmed" | "Dispatched" | "Delivered" | "Invoiced";
};

const salesStatusMap: Record<string, BackendSalesOrder["status"]> = {
  draft: "Draft",
  confirmed: "Confirmed",
  partial: "Confirmed",
  delivered: "Delivered",
  invoiced: "Invoiced",
  cancelled: "Draft",
};

export async function createSalesOrder(
  token: string,
  payload: {
    customer_id: string;
    warehouse_id: string;
    order_date?: string;
    notes?: string;
    lines: Array<{ item_id: string; quantity: number; unit_price: number }>;
  },
) {
  if (isDemoToken(token)) {
    throw new Error("Sign in with your email and password to create sales orders.");
  }
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  if (!payload.lines.length) throw new Error("Add at least one line item");
  const row = await v1Api.sales.createOrder(token, payload);
  const raw = String(row.status || "draft").toLowerCase();
  return {
    id: String(row.order_no),
    internal_id: String(row.id),
    date: String(row.order_date || "").slice(0, 10),
    customer: "",
    rep: "—",
    items: payload.lines.length,
    total: Number(row.total_amount || 0),
    status: salesStatusMap[raw] || "Draft",
  } satisfies BackendSalesOrder;
}

export async function fetchSalesOrders(token: string) {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }

  if (isV1Enabled()) {
    const rows = await v1Api.sales.orders(token);
    return rows.map((row) => {
      const raw = String(row.status || "draft").toLowerCase();
      return {
        id: String(row.order_no),
        internal_id: String(row.id),
        date: String(row.order_date || "").slice(0, 10),
        customer: String(row.customer_name || ""),
        rep: "—",
        items: 0,
        total: Number(row.total_amount || 0),
        status: salesStatusMap[raw] || "Draft",
      };
    });
  }

  const response = await fetch(buildUrl("/api/sales/orders"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<BackendSalesOrder[]>(response);
}

export async function confirmSalesOrder(token: string, internalId: string) {
  if (isDemoToken(token)) return { ok: true as const };

  if (isV1Enabled()) {
    return apiV1Fetch<{ ok: boolean }>(`/sales/orders/${internalId}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }, token);
  }

  throw new Error("Sales order confirmation requires API v1");
}

export async function dispatchSalesOrder(token: string, internalId: string, warehouseId: string) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to dispatch orders.");
  if (!isV1Enabled()) throw new Error("Sales delivery posting requires API v1");

  const order = await v1Api.sales.orderDetail(token, internalId);
  const lines = (order.lines || [])
    .map((line) => {
      const qty = Number(line.quantity || 0) - Number(line.qty_delivered || 0);
      return {
        so_line_id: String(line.id || ""),
        item_id: String(line.item_id || ""),
        quantity: qty,
      };
    })
    .filter((line) => line.so_line_id && line.item_id && line.quantity > 0);

  if (!lines.length) throw new Error("No open quantities left to dispatch for this order.");

  return v1Api.sales.createDelivery(token, {
    sales_order_id: internalId,
    warehouse_id: warehouseId,
    delivery_date: new Date().toISOString().slice(0, 10),
    lines,
  });
}

export async function createInvoiceFromSalesOrder(token: string, internalId: string) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to create invoices.");
  if (!isV1Enabled()) throw new Error("Sales invoicing requires API v1");

  const order = await v1Api.sales.orderDetail(token, internalId);
  const customerId = String(order.customer_id || "");
  if (!customerId) throw new Error("Order is missing customer_id");

  const lines = (order.lines || [])
    .map((line) => {
      const qty = Number(line.qty_delivered || 0) - Number(line.qty_invoiced || 0);
      return {
        so_line_id: String(line.id || ""),
        item_id: String(line.item_id || ""),
        quantity: qty,
        unit_price: Number(line.unit_price || 0),
      };
    })
    .filter((line) => line.so_line_id && line.item_id && line.quantity > 0);

  if (!lines.length) throw new Error("No delivered quantities left to invoice for this order.");

  return createSalesInvoice(token, {
    customer_id: customerId,
    sales_order_id: internalId,
    invoice_date: new Date().toISOString().slice(0, 10),
    lines,
  });
}

export async function fetchDashboardSummary(token: string) {
  if (isDemoToken(token)) throw new Error("Demo mode uses local dashboard data");

  if (isV1Enabled()) {
    const [dash, kpis, salesAnalytics, alerts] = await Promise.all([
      v1Api.reports.dashboard(token, "DASH-CFO"),
      v1Api.reports.kpis(token),
      v1Api.sales.analytics(token),
      v1Api.inventory.reorderAlerts(token),
    ]);
    const widgetRows = Array.isArray(dash.widgets) ? dash.widgets : [];
    const widgetMap = Object.fromEntries(widgetRows.map((w) => [w.widget, w.value]));
    return {
      kpis: {
        todays_sales: 0,
        revenue_mtd: Number(widgetMap.revenue_mtd || 0),
        pending_orders: Number(
          (Array.isArray(salesAnalytics.orders_by_status)
            ? salesAnalytics.orders_by_status.find((r: { status: string; count: number }) => r.status === "confirmed")
            : null)?.count || 0,
        ),
        outstanding_invoices: Number(widgetMap.ar_outstanding || 0),
      },
      monthlyRevenue: [{ month: "May", revenue: Number(widgetMap.revenue_mtd || 0) }],
      topProducts: [],
      salesByCategory: [],
      alerts: alerts.map((a) => ({
        type: "stock",
        severity: "warning",
        message: `Low stock: ${a.item_name} (${a.warehouse_name})`,
      })),
      recentTransactions: [],
    } satisfies DashboardSummary;
  }

  const response = await fetch(buildUrl("/api/dashboard/summary"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<DashboardSummary>(response);
}

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

function mapV1PurchaseOrder(row: Record<string, unknown>): BackendPurchaseOrder {
  const statusMap: Record<string, BackendPurchaseOrder["status"]> = {
    draft: "Draft",
    submitted: "Sent",
    approved: "Approved",
    sent: "Sent",
    partial: "Approved",
    received: "Received",
    closed: "Received",
    cancelled: "Cancelled",
  };
  const raw = String(row.status || "draft").toLowerCase();
  return {
    id: String(row.po_number),
    internal_id: String(row.id),
    date: String(row.order_date || row.created_at || "").slice(0, 10),
    supplier: String(row.vendor_name || ""),
    warehouse: String(row.warehouse_name || ""),
    items: 0,
    total: Number(row.total_amount || 0),
    status: statusMap[raw] || "Draft",
  };
}

export async function fetchPurchaseOrders(token: string) {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }

  if (isV1Enabled()) {
    const rows = await v1Api.procurement.purchaseOrders(token);
    return rows.map(mapV1PurchaseOrder);
  }

  const response = await fetch(buildUrl("/api/procurement/purchase-orders"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<BackendPurchaseOrder[]>(response);
}

export async function createPurchaseOrder(
  token: string,
  payload: {
    vendor_id: string;
    warehouse_id: string;
    expected_date?: string;
    notes?: string;
    lines: Array<{ item_id: string; quantity: number; unit_cost: number }>;
  },
) {
  if (isDemoToken(token)) {
    throw new Error("Sign in with your email and password to create purchase orders.");
  }

  if (isV1Enabled()) {
    const row = await apiV1Fetch<Record<string, unknown>>("/procurement/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }, token);
    return mapV1PurchaseOrder(row);
  }

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

export async function updatePurchaseOrderStatus(token: string, internalId: string | number, status: BackendPurchaseOrder["status"]) {
  if (isDemoToken(token)) {
    throw new Error("Sign in with your email and password to update purchase order status.");
  }

  if (isV1Enabled() && status === "Approved") {
    await apiV1Fetch(`/procurement/purchase-orders/${internalId}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }, token);
    return { ok: true, id: String(internalId), status: "approved" };
  }

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

export async function receivePurchaseOrder(token: string, internalId: string | number, _received_by: string) {
  if (isDemoToken(token)) {
    throw new Error("Sign in with your email and password to receive purchase orders.");
  }

  if (isV1Enabled()) {
    const po = await apiV1Fetch<{ lines: Array<Record<string, unknown>>; warehouse_id?: string }>(
      `/procurement/purchase-orders/${internalId}`,
      {},
      token,
    );
    const lines = (po.lines || []).map((line) => ({
      po_line_id: line.id,
      item_id: line.item_id,
      quantity: Number(line.quantity) - Number(line.qty_received || 0),
      unit_cost: line.unit_cost,
    })).filter((l) => l.quantity > 0);

    const result = await apiV1Fetch<{ ok: boolean }>("/procurement/goods-receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        purchase_order_id: internalId,
        warehouse_id: po.warehouse_id,
        lines,
      }),
    }, token);
    return { ok: true, grn_number: "posted", po_number: String(internalId), received_items: lines.length, ...result };
  }

  const response = await fetch(buildUrl(`/api/procurement/purchase-orders/${internalId}/receive`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ received_by: _received_by }),
  });
  return handleResponse<{ ok: true; grn_number: string; po_number: string; received_items: number }>(response);
}

export type BackendEmployee = {
  id: string;
  name: string;
  department: string;
  role: string;
  salary: number;
  status: string;
};

export async function fetchHrEmployees(token: string) {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }

  if (isV1Enabled()) {
    const rows = await v1Api.hr.employees(token);
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.full_name || `${row.first_name || ""} ${row.last_name || ""}`.trim()),
      department: String(row.department_name || row.department || "—"),
      role: String(row.job_title || row.position || "—"),
      salary: Number(row.basic_salary || row.gross_salary || 0),
      status: String(row.status || "active").toLowerCase() === "active" ? "Active" : "Inactive",
    }));
  }
  throw new Error("HR employees endpoint requires API v1 configuration.");
}

export type ReportLibraryEntry = { code: string; name: string; category: string };

export async function fetchReportLibrary(token: string) {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }
  if (!isV1Enabled()) throw new Error("Report library requires API v1 configuration.");
  const rows = await v1Api.reports.library(token);
  return rows.map((row) => ({
    code: String(row.report_code || row.code),
    name: String(row.name || row.title),
    category: String(row.category || row.module || "General"),
  }));
}

export type BackendInvoice = {
  id: string;
  date: string;
  due: string;
  customer: string;
  kraPin: string;
  etr: string;
  subtotal: number;
  excise: number;
  vat: number;
  total: number;
  status: "Draft" | "Sent" | "Paid" | "Overdue" | "Cancelled";
};

function mapV1Invoice(row: Record<string, unknown>): BackendInvoice {
  const statusMap: Record<string, BackendInvoice["status"]> = {
    draft: "Draft",
    posted: "Sent",
    paid: "Paid",
    partial: "Sent",
    overdue: "Overdue",
    cancelled: "Cancelled",
  };
  const raw = String(row.status || "draft").toLowerCase();
  const tax = Number(row.tax_amount || 0);
  return {
    id: String(row.invoice_no),
    date: String(row.invoice_date || "").slice(0, 10),
    due: String(row.due_date || row.invoice_date || "").slice(0, 10),
    customer: String(row.customer_name || ""),
    kraPin: String(row.customer_tax_id || row.tax_id || ""),
    etr: String(row.etims_ref || "—"),
    subtotal: Number(row.subtotal || 0),
    excise: 0,
    vat: tax,
    total: Number(row.total_amount || 0),
    status: statusMap[raw] || "Draft",
  };
}

export async function fetchSalesInvoices(token: string) {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }

  if (isV1Enabled()) {
    const rows = await v1Api.sales.invoices(token);
    return rows.map(mapV1Invoice);
  }
  const response = await fetch(buildUrl("/api/sales/invoices"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<BackendInvoice[]>(response);
}

export async function createSalesInvoice(
  token: string,
  payload: {
    customer_id: string;
    invoice_date?: string;
    due_date?: string;
    lines: Array<{ item_id: string; quantity: number; unit_price: number }>;
  },
) {
  if (isDemoToken(token)) {
    throw new Error("Sign in with the API to create invoices.");
  }
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  if (!payload.lines.length) throw new Error("Add at least one line item");
  return v1Api.sales.createInvoice(token, payload);
}

export async function paySalesInvoice(
  token: string,
  invoiceId: string,
  payload: { amount: number; payment_date?: string; reference_no?: string; notes?: string },
) {
  if (isDemoToken(token)) {
    throw new Error("Sign in with the API to post invoice payments.");
  }
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  if (!payload.amount || payload.amount <= 0) throw new Error("Payment amount must be greater than zero");
  return v1Api.sales.payInvoice(token, invoiceId, payload);
}

function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadInvoicePdf(token: string, invoiceNo: string) {
  if (isDemoToken(token)) throw new Error("Sign in with the API to download invoice PDFs.");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  const blob = await v1Api.sales.downloadInvoicePdf(token, invoiceNo);
  saveBlob(`invoice-${invoiceNo}.pdf`, blob);
}

export async function downloadReceiptPdf(token: string, invoiceNo: string) {
  if (isDemoToken(token)) throw new Error("Sign in with the API to download receipt PDFs.");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  const blob = await v1Api.sales.downloadReceiptPdf(token, invoiceNo);
  saveBlob(`receipt-${invoiceNo}.pdf`, blob);
}

export async function verifyInvoiceDocument(token: string, invoiceNo: string, hash?: string) {
  if (isDemoToken(token)) throw new Error("Sign in with the API to verify invoice documents.");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.sales.verifyInvoice(token, invoiceNo, hash);
}

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

export async function fetchAuditLogs(token: string, q = "", limit = 100) {
  if (isDemoToken(token)) return [];

  if (isV1Enabled()) {
    const rows = await v1Api.audit.list(token, q, limit);
    return rows.map((row) => ({
      id: String(row.id),
      action: String(row.action),
      entity_type: (row.entity_type as string) || null,
      entity_id: row.entity_id != null ? String(row.entity_id) : null,
      details: (row.new_values || row.old_values || null) as Record<string, unknown> | null,
      created_at: String(row.created_at),
      user_name: (row.user_name as string) || null,
      user_email: (row.user_email as string) || null,
      user_role: null,
    }));
  }

  const response = await fetch(buildUrl(`/api/audit-logs?q=${encodeURIComponent(q)}&limit=${limit}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<AuditLogRow[]>(response);
}

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

export async function fetchAccountingSnapshot(token: string): Promise<AccountingSnapshot> {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }
  if (!isV1Enabled()) throw new Error("Accounting snapshot requires API v1 configuration.");

  const periods = await v1Api.finance.fiscalPeriods(token);
  const period = periods.find((p) => p.status === "open") || periods[0];
  if (!period?.id) return { journalRows: [], pnl: [] };

  const periodId = String(period.id);
  const [journals, pl] = await Promise.all([
    v1Api.finance.journals(token),
    v1Api.finance.profitLoss(token, periodId),
  ]);

  let journalRows: AccountingJournalRow[] = [];
  const latest = journals[0];
  if (latest?.id) {
    const detail = await v1Api.finance.journal(token, String(latest.id));
    journalRows = (detail.lines || []).map((line) => ({
      d: String(detail.entry_date || "").slice(0, 10),
      a: `${line.account_code} — ${line.account_name}`,
      desc: String(line.description || detail.description || detail.journal_no || ""),
      db: Number(line.debit || 0),
      cr: Number(line.credit || 0),
    }));
  }

  const income = (pl.lines || [])
    .filter((l) => l.account_type === "income")
    .reduce((s, l) => s + Number(l.amount || 0), 0);
  const expense = (pl.lines || [])
    .filter((l) => l.account_type === "expense")
    .reduce((s, l) => s + Math.abs(Number(l.amount || 0)), 0);
  const periodLabel = String(period.name || period.code || "Current");

  return {
    journalRows,
    pnl: [{ month: periodLabel, revenue: income, expenses: expense }],
  };
}
