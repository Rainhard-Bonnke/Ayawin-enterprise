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
  fetchPermissions as v1FetchPermissions,
  updateRolePermissions as v1UpdateRolePermissions,
  createChartOfAccount as v1CreateChartOfAccount,
  importRows,
} from "./api-v1";
import { humanizeError } from "@/lib/humanizeError";

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
    const data = (await response.json()) as { error?: string; message?: string; code?: string };
    const raw = data.error || data.message || response.statusText || "Request failed";
    const withCode = data.code && !raw.includes(data.code) ? `${data.code}: ${raw}` : raw;
    throw new Error(humanizeError(new Error(withCode)));
  }

  const text = await response.text();
  throw new Error(humanizeError(new Error(text || response.statusText || "Request failed")));
}

export async function loginRequest(
  email: string,
  password: string,
  options?: { rememberMe?: boolean; mfaToken?: string },
) {
  if (isV1Enabled()) {
    return v1Login(email, password, {
      rememberMe: options?.rememberMe,
      mfaToken: options?.mfaToken,
    });
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
  const rows = await v1FetchRoles(token);
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function fetchRolesWithPermissions(token: string) {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  return v1FetchRoles(token);
}

export async function fetchPermissions(token: string) {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  return v1FetchPermissions(token);
}

export async function saveRolePermissions(token: string, roleId: string, permissionCodes: string[]) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to update roles.");
  if (!isV1Enabled()) throw new Error("Roles require API v1 configuration.");
  return v1UpdateRolePermissions(token, roleId, permissionCodes);
}

export async function fetchMasterVendors(token: string) {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  return masterList(token, "vendors");
}

export async function fetchMasterEmployees(token: string) {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  return masterList(token, "employees");
}

export async function createChartOfAccount(
  token: string,
  body: { account_code: string; account_name: string; account_type: string; is_postable?: boolean },
) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Chart of accounts requires API v1.");
  return v1CreateChartOfAccount(token, body);
}

export async function inviteUserRequest(
  token: string,
  payload: {
    email: string;
    full_name: string;
    username?: string;
    role_id?: string;
    phone?: string;
  },
) {
  if (!isV1Enabled()) throw new Error("User invites require API v1");
  const { inviteUser } = await import("./api-v1");
  return inviteUser(token, payload);
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
    is_active: row.is_active !== false,
    kra_pin: String(row.tax_id || row.kra_pin || ""),
    contact: (row.phone as string) || (row.contact_name as string) || null,
    email: (row.email as string) || null,
    address: (row.address_line1 as string) || null,
    location: (row.city as string) || null,
    type: (row.customer_type as string) || null,
    segment: (row.customer_type as string) || null,
    credit_limit: Number(row.credit_limit || 0),
    payment_terms: (row.payment_terms as string) || null,
    balance: 0,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export type BackendCustomer = {
  id: string | number;
  name: string;
  is_active?: boolean;
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
  updated_at?: string;
};

export async function fetchCustomers(token: string) {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }

  if (isV1Enabled()) {
    const [rows, balances] = await Promise.all([
      v1Api.master.customers(token),
      v1Api.crm.customerBalances(token).catch(() => ({} as Record<string, number>)),
    ]);
    return rows.map((row) => {
      const c = mapV1Customer(row);
      c.balance = balances[String(c.id)] ?? 0;
      return c;
    });
  }

  const response = await fetch(buildUrl("/api/customers"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<BackendCustomer[]>(response);
}

export async function fetchActiveCustomers(token: string) {
  if (isV1Enabled()) {
    const rows = await masterList(token, "customers", "", { is_active: true });
    return rows.map((row) => mapV1Customer(row));
  }
  const all = await fetchCustomers(token);
  return all.filter((c) => c.is_active !== false);
}

export async function searchMasterItems(token: string, query: string) {
  if (!isV1Enabled()) return fetchMasterItems(token);
  const rows = await masterList(token, "items", query, { is_active: true });
  return rows.map(mapV1Item);
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
    throw new Error("Sign in with your email and password to save customers (demo tokens are read-only).");
  }

  if (isV1Enabled()) {
    const code = `C-${Date.now().toString(36).toUpperCase()}`;
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
    is_active: boolean;
  }>,
  options?: { ifMatch?: string },
) {
  if (isDemoToken(token)) {
    const existing = seededCustomers().find((customer) => customer.id === id) ?? seededCustomers()[0];
    return { ...existing, ...payload };
  }

  if (isV1Enabled()) {
    const row = await masterUpdate(
      token,
      "customers",
      String(id),
      {
        name: payload.name,
        tax_id: payload.kra_pin,
        email: payload.email,
        phone: payload.contact,
        address_line1: payload.address,
        city: payload.location,
        customer_type: payload.segment || payload.type,
        credit_limit: payload.credit_limit,
        is_active: payload.is_active,
      },
      options?.ifMatch ? { ifMatch: options.ifMatch } : undefined,
    );
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
    balance: Number(row.ap_balance ?? 0),
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
  updated_at?: string;
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
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
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
  options?: { ifMatch?: string },
) {
  if (isDemoToken(token)) throw new Error("Use live API for items");
  const row = await masterUpdate(token, "items", id, payload, options?.ifMatch ? { ifMatch: options.ifMatch } : undefined);
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
  entityType: "customers" | "items" | "vendors" | "opening_stock" | "attendance",
  rows: Record<string, unknown>[],
  fileName?: string,
) {
  if (isDemoToken(token)) throw new Error("Use live API for imports");
  return importRows(token, entityType, rows, fileName);
}

export type IntegrationStatus = {
  etims: { enabled: boolean; configured: boolean; mode: string };
  mpesa: { enabled: boolean; configured: boolean; mode: string };
  email: { enabled: boolean; configured: boolean; mode: string };
  sms: { enabled: boolean; configured: boolean; mode: string };
};

export async function fetchIntegrationStatus(token: string): Promise<IntegrationStatus> {
  if (isDemoToken(token)) {
    return {
      etims: { enabled: false, configured: false, mode: "disabled" },
      mpesa: { enabled: false, configured: false, mode: "disabled" },
      email: { enabled: false, configured: false, mode: "disabled" },
      sms: { enabled: false, configured: false, mode: "disabled" },
    };
  }
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.platform.integrationStatus(token);
}

export async function importAttendanceRows(
  token: string,
  rows: Array<Record<string, unknown>>,
) {
  if (isDemoToken(token)) throw new Error("Use live API for attendance import");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.hr.importAttendance(token, rows);
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
  batch_count?: number;
  stock_value?: number;
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
      barcode: row.barcode ? String(row.barcode) : null,
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
      expiry_date: row.nearest_expiry ? String(row.nearest_expiry).slice(0, 10) : null,
      batch_count: Number(row.batch_count || 0),
      stock_value: Number(row.stock_value || 0),
    }));
  }

  const response = await fetch(buildUrl("/api/inventory/items"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<BackendInventoryItem[]>(response);
}

/** All active items for a warehouse, including zero on-hand (live API catalog). */
export async function fetchInventoryCatalog(token: string, warehouseId: string, q?: string) {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  const data = await v1Api.inventory.catalog(token, warehouseId, q);
  return data.items.map((row, index) => ({
    item_id: String(row.item_id ?? row.id),
    product_id: index + 1,
    name: String(row.item_name ?? row.name),
    sku: String(row.item_code),
    barcode: row.barcode ? String(row.barcode) : null,
    category: "",
    brand: null,
    abv: 0,
    pack_size: null,
    cost_price: Number(row.avg_unit_cost ?? row.standard_cost ?? 0),
    retail_price: Number(row.unit_price ?? row.standard_cost ?? 0),
    min_stock: Number(row.reorder_point ?? 0),
    warehouse_id: warehouseId,
    warehouse: "",
    stock: Number(row.quantity ?? 0),
    expiry_date: null,
    batch_count: 0,
    stock_value: Number(row.quantity ?? 0) * Number(row.avg_unit_cost ?? row.standard_cost ?? 0),
  })) satisfies BackendInventoryItem[];
}

export type PosCatalogItem = {
  item_id: string;
  item_code: string;
  item_name: string;
  barcode: string | null;
  quantity: number;
  unit_price: number;
  price_tier: string;
  standard_cost: number;
  reorder_point: number;
};

export async function fetchPosCatalog(token: string, warehouseId: string, q?: string) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to use POS.");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  const data = await v1Api.pos.catalog(token, warehouseId, q ? { q } : undefined);
  return {
    customer_id: data.customer_id,
    items: data.items.map((row) => ({
      item_id: String(row.item_id),
      item_code: String(row.item_code),
      item_name: String(row.item_name),
      barcode: row.barcode ? String(row.barcode) : null,
      quantity: Number(row.quantity ?? 0),
      unit_price: Number(row.unit_price ?? 0),
      price_tier: String(row.price_tier ?? "retail"),
      standard_cost: Number(row.standard_cost ?? 0),
      reorder_point: Number(row.reorder_point ?? 0),
    })) satisfies PosCatalogItem[],
  };
}

export async function previewPosTotals(
  token: string,
  body: {
    customer_id?: string;
    lines: Array<{ item_id: string; quantity: number; unit_price: number; discount_percent?: number }>;
  },
) {
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.pos.previewTotals(token, body);
}

export async function completePosSale(
  token: string,
  body: {
    warehouse_id: string;
    customer_id?: string;
    lines: Array<{ item_id: string; quantity: number; unit_price: number; discount_percent?: number }>;
    payment_method?: string;
    reference_no?: string;
    notes?: string;
  },
) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to complete POS sales.");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.pos.completeSale(token, body);
}

export async function lookupInventoryBarcode(token: string, barcode: string) {
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.inventory.lookup(token, barcode);
}

export async function fetchInventoryValuation(token: string, warehouseId?: string) {
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.inventory.valuation(token, warehouseId);
}

export async function fetchInventoryMovements(
  token: string,
  params?: { limit?: number; item_id?: string; warehouse_id?: string },
) {
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.inventory.movements(token, params);
}

export async function fetchInventoryReorderAlerts(token: string) {
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.inventory.reorderAlerts(token);
}

export async function fetchAdjustmentReasonCodes(token: string) {
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.inventory.reasonCodes(token);
}

export async function createStockIn(
  token: string,
  payload: {
    warehouse_id: string;
    item_id: string;
    quantity: number;
    unit_cost?: number;
    notes?: string;
    batch_no?: string;
    expiry_date?: string;
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

export type DashboardDatePreset = "7d" | "30d" | "90d" | "mtd" | "ytd" | "6m";

export type DashboardAlert = {
  type: string;
  severity: string;
  message: string;
  href?: string;
  item_id?: string;
  invoice_id?: string;
  invoice_no?: string;
  item_code?: string;
};

export type DashboardSummary = {
  range?: { from: string; to: string; preset?: string | null };
  kpis: {
    todays_sales: number;
    revenue_mtd: number;
    revenue_in_range?: number;
    pending_orders: number;
    outstanding_invoices: number;
    pipeline_forecast?: number;
    stock_value?: number;
    open_pos?: number;
  };
  monthlyRevenue: Array<{ month: string; revenue: number }>;
  topProducts: Array<{ name: string; units: number }>;
  salesByCategory: Array<{ name: string; value: number }>;
  alerts: DashboardAlert[];
  recentTransactions: Array<{ id: string; date: string; customer: string; rep: string; total: number; status: string }>;
  kpiDefinitions?: Array<Record<string, unknown>>;
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

export type SalesOrderTotalsPreview = {
  subtotal: number;
  exciseAmount: number;
  taxAmount: number;
  total: number;
};

export async function fetchSalesDiscountCap(token: string) {
  if (!isV1Enabled()) return { max_discount_percent: 5 };
  return v1Api.sales.discountCap(token);
}

export async function previewSalesOrderTotals(
  token: string,
  payload: {
    customer_id: string;
    lines: Array<{ item_id: string; quantity: number; unit_price: number; discount_percent?: number }>;
  },
): Promise<SalesOrderTotalsPreview> {
  if (!isV1Enabled()) throw new Error("API v1 required");
  const data = await v1Api.sales.previewTotals(token, payload);
  return {
    subtotal: Number(data.subtotal || 0),
    exciseAmount: Number(data.exciseAmount || 0),
    taxAmount: Number(data.taxAmount || 0),
    total: Number(data.total || 0),
  };
}

export async function resolveSalesUnitPrice(token: string, customerId: string, itemId: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.sales.resolvePricing(token, customerId, itemId);
}

export async function checkSalesAtp(
  token: string,
  warehouseId: string,
  lines: Array<{ item_id: string; quantity: number }>,
) {
  if (!isV1Enabled()) return { ok: true as const };
  return v1Api.sales.atpCheck(token, { warehouse_id: warehouseId, lines });
}

const salesStatusMap: Record<string, BackendSalesOrder["status"]> = {
  draft: "Draft",
  confirmed: "Confirmed",
  partial: "Partial",
  delivered: "Delivered",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

export async function createSalesOrder(
  token: string,
  payload: {
    customer_id: string;
    warehouse_id: string;
    order_date?: string;
    notes?: string;
    sales_rep_id?: string;
    lines: Array<{ item_id: string; quantity: number; unit_price: number; discount_percent?: number }>;
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

export type SalesListPage = { rows: BackendSalesOrder[]; total: number };

export async function fetchSalesOrders(
  token: string,
  opts?: { page?: number; limit?: number; q?: string; status?: string },
): Promise<SalesListPage> {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }

  if (isV1Enabled()) {
    const result = await v1Api.sales.orders(token, opts);
    const rows = (result.data ?? []).map((row) => {
      const raw = String(row.status || "draft").toLowerCase();
      return {
        id: String(row.order_no),
        internal_id: String(row.id),
        date: String(row.order_date || "").slice(0, 10),
        customer: String(row.customer_name || ""),
        rep: String(row.sales_rep_name || "—"),
        items: Number(row.line_count || 0),
        total: Number(row.total_amount || 0),
        status: salesStatusMap[raw] || "Draft",
      };
    });
    return { rows, total: result.pagination?.total ?? rows.length };
  }

  const response = await fetch(buildUrl("/api/sales/orders"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const legacy = await handleResponse<BackendSalesOrder[]>(response);
  return { rows: legacy, total: legacy.length };
}

export async function cancelSalesOrder(token: string, internalId: string, reason: string) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to cancel orders.");
  if (!isV1Enabled()) throw new Error("Order cancellation requires API v1");
  return v1Api.sales.cancelOrder(token, internalId, reason);
}

export type CustomerStatementTxn = {
  txn_date: string;
  type: string;
  ref: string;
  debit: number;
  credit: number;
  credit_applied?: number;
  balance_effect: number;
  running_balance?: number;
};

export type CustomerStatementResult = {
  customer: Record<string, unknown>;
  opening_balance: number;
  closing_balance: number;
  ar_balance: number;
  transactions: CustomerStatementTxn[];
};

export async function fetchCustomerStatement(
  token: string,
  customerId: string,
  opts?: { from?: string; to?: string },
): Promise<CustomerStatementResult> {
  if (isDemoToken(token)) throw new Error("Customer statements require API authentication.");
  if (!isV1Enabled()) throw new Error("Customer statements require API v1");
  return v1Api.crm.customerStatement(token, customerId, opts?.from, opts?.to);
}

export async function fetchArAging(token: string) {
  if (!isV1Enabled()) throw new Error("AR aging requires API v1");
  return v1Api.crm.arAging(token);
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

export async function fetchDashboardSummary(
  token: string,
  options?: { preset?: DashboardDatePreset },
) {
  if (isDemoToken(token)) throw new Error("Demo mode uses local dashboard data");

  if (isV1Enabled()) {
    const preset = options?.preset || "6m";
    const data = await v1Api.reports.dashboardSummary(token, preset);
    const kpis = (data.kpis || {}) as DashboardSummary["kpis"];
    return {
      range: data.range as DashboardSummary["range"],
      kpis: {
        todays_sales: Number(kpis.todays_sales || 0),
        revenue_mtd: Number(kpis.revenue_mtd || 0),
        revenue_in_range: Number(kpis.revenue_in_range || 0),
        pending_orders: Number(kpis.pending_orders || 0),
        outstanding_invoices: Number(kpis.outstanding_invoices || 0),
        pipeline_forecast: Number(kpis.pipeline_forecast || 0),
        stock_value: Number(kpis.stock_value || 0),
        open_pos: Number(kpis.open_pos || 0),
      },
      monthlyRevenue: Array.isArray(data.monthlyRevenue)
        ? (data.monthlyRevenue as DashboardSummary["monthlyRevenue"])
        : [],
      topProducts: Array.isArray(data.topProducts)
        ? (data.topProducts as DashboardSummary["topProducts"])
        : [],
      salesByCategory: Array.isArray(data.salesByCategory)
        ? (data.salesByCategory as DashboardSummary["salesByCategory"])
        : [],
      alerts: Array.isArray(data.alerts) ? (data.alerts as DashboardAlert[]) : [],
      recentTransactions: Array.isArray(data.recentTransactions)
        ? (data.recentTransactions as DashboardSummary["recentTransactions"])
        : [],
      kpiDefinitions: Array.isArray(data.kpiDefinitions)
        ? (data.kpiDefinitions as DashboardSummary["kpiDefinitions"])
        : [],
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
  status: "Draft" | "Approved" | "Sent" | "Received" | "Partial" | "Pending MD" | "Invoiced" | "Cancelled";
  requires_md_approval?: boolean;
};

function mapV1PurchaseOrder(row: Record<string, unknown>): BackendPurchaseOrder {
  const statusMap: Record<string, BackendPurchaseOrder["status"]> = {
    draft: "Draft",
    submitted: "Sent",
    pending_md_approval: "Pending MD",
    approved: "Approved",
    sent: "Sent",
    partial: "Partial",
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
    requires_md_approval: Boolean(row.requires_md_approval),
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

export async function receivePurchaseOrder(
  token: string,
  internalId: string | number,
  _received_by: string,
  options?: { lines?: Array<{ po_line_id: string; item_id: string; quantity: number; unit_cost?: number }>; landed_cost_total?: number },
) {
  if (isDemoToken(token)) {
    throw new Error("Sign in with your email and password to receive purchase orders.");
  }

  if (isV1Enabled()) {
    const po = await apiV1Fetch<{ lines: Array<Record<string, unknown>>; warehouse_id?: string }>(
      `/procurement/purchase-orders/${internalId}`,
      {},
      token,
    );
    const lines = (options?.lines?.length ? options.lines : (po.lines || []).map((line) => ({
      po_line_id: line.id,
      item_id: line.item_id,
      quantity: Number(line.quantity) - Number(line.qty_received || 0),
      unit_cost: line.unit_cost,
    }))).filter((l) => Number(l.quantity) > 0);

    const result = await apiV1Fetch<{ ok: boolean }>("/procurement/goods-receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        purchase_order_id: internalId,
        warehouse_id: po.warehouse_id,
        lines,
        landed_cost_total: options?.landed_cost_total,
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

export type BackendRequisition = {
  id: string;
  requisition_no: string;
  status: string;
  required_date: string;
  notes: string;
  created_at: string;
};

export type BackendGoodsReceipt = {
  id: string;
  grn_number: string;
  po_number: string;
  received_date: string;
  status: string;
  total_amount: number;
};

export async function fetchRequisitions(token: string): Promise<BackendRequisition[]> {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  const result = await v1Api.procurement.requisitions(token);
  return (result.data || []).map((row) => ({
    id: String(row.id),
    requisition_no: String(row.requisition_no || "—"),
    status: String(row.status || "draft"),
    required_date: String(row.required_date || "").slice(0, 10),
    notes: String(row.notes || ""),
    created_at: String(row.created_at || "").slice(0, 10),
  }));
}

export async function fetchGoodsReceipts(token: string): Promise<BackendGoodsReceipt[]> {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  const rows = await v1Api.procurement.goodsReceipts(token);
  return rows.map((row) => ({
    id: String(row.id),
    grn_number: String(row.grn_number || row.receipt_no || "—"),
    po_number: String(row.po_number || "—"),
    received_date: String(row.received_date || "").slice(0, 10),
    status: String(row.status || "draft"),
    total_amount: Number(row.total_amount || 0),
  }));
}

export async function postGoodsReceipt(token: string, grnId: string) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to post goods receipts.");
  if (!isV1Enabled()) throw new Error("Goods receipts require API v1.");
  return v1Api.procurement.postGoodsReceipt(token, grnId);
}

export async function createRequisition(
  token: string,
  body: {
    warehouse_id?: string;
    required_date?: string;
    notes?: string;
    lines: Array<{ item_id: string; quantity: number; estimated_unit_cost?: number }>;
  },
) {
  if (isDemoToken(token) || !isV1Enabled()) throw new Error("Requisitions require API v1.");
  return v1Api.procurement.createRequisition(token, body);
}

export async function submitRequisition(token: string, id: string) {
  if (isDemoToken(token) || !isV1Enabled()) throw new Error("Requisitions require API v1.");
  return v1Api.procurement.submitRequisition(token, id);
}

export async function approveRequisition(token: string, id: string) {
  if (isDemoToken(token) || !isV1Enabled()) throw new Error("Requisitions require API v1.");
  return v1Api.procurement.approveRequisition(token, id);
}

export type BackendVendorBill = {
  id: string;
  bill_no: string;
  vendor_name: string;
  po_number: string;
  grn_number: string;
  bill_date: string;
  due_date: string;
  status: string;
  match_status: string;
  match_notes: string;
  total_amount: number;
  amount_paid: number;
};

export async function fetchVendorBills(token: string): Promise<BackendVendorBill[]> {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  const rows = await v1Api.finance.vendorBills(token);
  return rows.map((row) => ({
    id: String(row.id),
    bill_no: String(row.bill_no || "—"),
    vendor_name: String(row.vendor_name || ""),
    po_number: String(row.po_number || "—"),
    grn_number: String(row.grn_number || "—"),
    bill_date: String(row.bill_date || "").slice(0, 10),
    due_date: String(row.due_date || "").slice(0, 10),
    status: String(row.status || "draft"),
    match_status: String(row.match_status || "pending"),
    match_notes: String(row.match_notes || ""),
    total_amount: Number(row.total_amount || 0),
    amount_paid: Number(row.amount_paid || 0),
  }));
}

export async function createVendorBillFromGrn(
  token: string,
  goodsReceiptId: string,
  body?: { vendor_ref?: string; bill_date?: string; due_date?: string },
) {
  if (isDemoToken(token) || !isV1Enabled()) throw new Error("Vendor bills require API v1.");
  return v1Api.finance.createVendorBillFromGrn(token, { goods_receipt_id: goodsReceiptId, ...body });
}

export async function postVendorBill(token: string, billId: string) {
  if (isDemoToken(token) || !isV1Enabled()) throw new Error("Vendor bills require API v1.");
  return v1Api.finance.postVendorBill(token, billId);
}

export async function payVendorBill(
  token: string,
  billId: string,
  body: { amount: number; payment_date?: string; reference_no?: string; payment_method?: string },
) {
  if (isDemoToken(token) || !isV1Enabled()) throw new Error("Vendor payments require API v1.");
  return v1Api.finance.payVendorBill(token, billId, body);
}

export async function submitInvoiceEtims(token: string, invoiceId: string) {
  if (isDemoToken(token) || !isV1Enabled()) throw new Error("eTIMS requires API v1.");
  return v1Api.platform.submitEtims(token, invoiceId);
}

export async function initiateMpesaPayment(
  token: string,
  body: { phone: string; amount: number; reference: string },
) {
  if (isDemoToken(token) || !isV1Enabled()) throw new Error("M-Pesa requires API v1.");
  return v1Api.platform.mpesaStkPush(token, body);
}

export type SalesOrderLine = {
  id: string;
  item_code: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  qty_delivered: number;
  qty_invoiced: number;
};

export type SalesOrderDetail = {
  id: string;
  order_no: string;
  customer_name: string;
  warehouse_name: string;
  order_date: string;
  status: string;
  total_amount: number;
  notes: string;
  lines: SalesOrderLine[];
};

export async function fetchSalesOrderDetail(token: string, internalId: string): Promise<SalesOrderDetail> {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Order detail requires API v1.");
  const row = await v1Api.sales.orderDetail(token, internalId);
  return {
    id: String(row.id),
    order_no: String(row.order_no || ""),
    customer_name: String(row.customer_name || ""),
    warehouse_name: String(row.warehouse_name || "—"),
    order_date: String(row.order_date || "").slice(0, 10),
    status: String(row.status || "draft"),
    total_amount: Number(row.total_amount || 0),
    notes: String(row.notes || ""),
    lines: (row.lines || []).map((line) => ({
      id: String(line.id),
      item_code: String(line.item_code || ""),
      item_name: String(line.item_name || ""),
      quantity: Number(line.quantity || 0),
      unit_price: Number(line.unit_price || 0),
      line_total: Number(line.line_total || 0),
      qty_delivered: Number(line.qty_delivered || 0),
      qty_invoiced: Number(line.qty_invoiced || 0),
    })),
  };
}

export type FinanceJournalHeader = {
  id: string;
  journal_no: string;
  entry_date: string;
  description: string;
  status: string;
  total_debit: number;
  total_credit: number;
};

export async function fetchFinanceJournals(token: string): Promise<FinanceJournalHeader[]> {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  const rows = await v1Api.finance.journals(token);
  return rows.map((row) => ({
    id: String(row.id),
    journal_no: String(row.journal_no || row.entry_no || "—"),
    entry_date: String(row.entry_date || "").slice(0, 10),
    description: String(row.description || ""),
    status: String(row.status || "draft"),
    total_debit: Number(row.total_debit || 0),
    total_credit: Number(row.total_credit || 0),
  }));
}

export type BackendEmployee = {
  id: string;
  name: string;
  department: string;
  role: string;
  salary: number;
  status: string;
  profileComplete?: boolean;
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
      profileComplete: row.profile_complete !== false,
      status:
        row.is_active === false || String(row.status || "").toLowerCase() === "inactive"
          ? "Inactive"
          : "Active",
    }));
  }
  throw new Error("HR employees endpoint requires API v1 configuration.");
}

export type DeliveryRow = {
  id: string;
  deliveryNo: string;
  orderNo: string;
  customer: string;
  warehouse: string;
  date: string;
  status: string;
  logisticsStatus?: string;
  deliveryZone?: string;
  driverName?: string;
  salesOrderId?: string;
  podSignature?: string;
  hasPodPhoto?: boolean;
};

function mapDeliveryStatus(row: Record<string, unknown>): string {
  const ls = String(row.logistics_status || "").toLowerCase();
  if (ls === "failed") return "Failed";
  if (ls === "delivered") return "Delivered";
  if (ls === "in_transit") return "In transit";
  if (ls === "scheduled") return "Pending";
  const s = String(row.status || "draft").toLowerCase();
  if (s === "posted") return "Delivered";
  if (s === "cancelled") return "Failed";
  if (s === "draft") return "Pending";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function fetchDeliveries(token: string): Promise<DeliveryRow[]> {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }
  if (!isV1Enabled()) throw new Error("Deliveries require API v1 configuration.");
  const rows = await v1Api.sales.deliveries(token);
  return rows.map((row) => ({
    id: String(row.id),
    deliveryNo: String(row.delivery_no || row.id),
    orderNo: String(row.order_no || "—"),
    customer: String(row.customer_name || "—"),
    warehouse: String(row.warehouse_name || "—"),
    date: String(row.delivery_date || row.created_at || "").slice(0, 10),
    status: mapDeliveryStatus(row),
    logisticsStatus: row.logistics_status ? String(row.logistics_status) : undefined,
    deliveryZone: row.delivery_zone ? String(row.delivery_zone) : undefined,
    driverName: row.driver_name ? String(row.driver_name) : undefined,
    salesOrderId: row.sales_order_id ? String(row.sales_order_id) : undefined,
    podSignature: row.pod_signature ? String(row.pod_signature) : undefined,
    hasPodPhoto: Boolean(row.pod_photo_url),
  }));
}

export async function fetchDeliveryDrivers(token: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.logistics.drivers(token);
}

export async function fetchDeliveryVehicles(token: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.logistics.vehicles(token);
}

export async function assignDeliveryDriver(
  token: string,
  deliveryId: string,
  body: { driver_id?: string; vehicle_id?: string },
) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.logistics.assignDriver(token, deliveryId, body);
}

export async function failDelivery(token: string, deliveryId: string, reason?: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.logistics.failDelivery(token, deliveryId, reason);
}

export async function fetchRoutePlan(token: string, deliveryDate?: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.logistics.optimizeRoutes(token, deliveryDate);
}

export async function fetchRedeliveryTasks(token: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.logistics.redeliveryTasks(token);
}

export async function scheduleRedeliveryTask(
  token: string,
  taskId: string,
  body: { driver_id?: string; vehicle_id?: string; delivery_date?: string },
) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.logistics.scheduleRedelivery(token, taskId, body);
}

export async function recordTripMileage(
  token: string,
  body: {
    vehicle_id: string;
    delivery_id?: string;
    driver_id?: string;
    distance_km?: number;
    odometer_start?: number;
    odometer_end?: number;
    route_zone?: string;
    notes?: string;
  },
) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.logistics.recordMileage(token, body);
}

export async function downloadDeliveryNotePdf(token: string, deliveryNo: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  const blob = await v1Api.logistics.downloadDeliveryPdf(token, deliveryNo);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `delivery-${deliveryNo}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function uploadDeliveryPod(
  token: string,
  deliveryId: string,
  payload: { pod_signature?: string; pod_photo_data?: string },
) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to upload POD.");
  if (!isV1Enabled()) throw new Error("Deliveries require API v1 configuration.");
  return v1Api.sales.uploadPod(token, deliveryId, payload);
}

export type PayrollRunRow = {
  id: string;
  runNo: string;
  payrollMonth: string;
  status: string;
  employeeCount: number;
};

export type PayslipRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  gross: number;
  paye: number;
  nssf: number;
  nhif: number;
  housingLevy: number;
  net: number;
};

export async function fetchPayrollRuns(token: string): Promise<PayrollRunRow[]> {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Payroll requires API v1 configuration.");
  const rows = await v1Api.hr.payrollRuns(token);
  return rows.map((row) => ({
    id: String(row.id),
    runNo: String(row.run_no || ""),
    payrollMonth: String(row.payroll_month || "").slice(0, 7),
    status: String(row.status || "draft"),
    employeeCount: Number(row.employee_count || 0),
  }));
}

export async function downloadPayslipPdf(token: string, runId: string, payslipId: string, employeeCode: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  const blob = await v1Api.hr.downloadPayslipPdf(token, runId, payslipId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `payslip-${employeeCode || payslipId}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function fetchMonthEndOpenPeriod(token: string) {
  return v1Api.finance.monthEndOpenPeriod(token);
}

export async function previewMonthEnd(token: string, periodId: string) {
  return v1Api.finance.monthEndPreview(token, periodId);
}

export async function closeMonthEnd(token: string, periodId: string, force = false) {
  return v1Api.finance.monthEndClose(token, periodId, force);
}

export async function fetchKenyaCoaStatus(token: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.finance.kenyaCoaStatus(token);
}

export async function fetchTrialBalanceReport(token: string, periodId: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.finance.trialBalance(token, periodId);
}

export async function fetchBalanceSheetReport(token: string, periodId: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.finance.balanceSheet(token, periodId);
}

export async function fetchVatReturnReport(token: string, from?: string, to?: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.finance.vatReturn(token, from, to);
}

export async function fetchExciseReturnReport(token: string, from?: string, to?: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.finance.exciseReturn(token, from, to);
}

export async function fetchMultiPeriodReport(token: string, fiscalYearId?: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.finance.multiPeriod(token, fiscalYearId);
}

export async function fetchPayrollPayslips(token: string, runId: string): Promise<PayslipRow[]> {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Payroll requires API v1 configuration.");
  const rows = await v1Api.hr.payslips(token, runId);
  return rows.map((row) => ({
    id: String(row.id),
    employeeId: String(row.employee_id),
    employeeName: `${row.first_name || ""} ${row.last_name || ""}`.trim() || String(row.employee_code || "—"),
    employeeCode: String(row.employee_code || ""),
    gross: Number(row.gross_pay || 0),
    paye: Number(row.paye || 0),
    nssf: Number(row.nssf || 0),
    nhif: Number(row.nhif || 0),
    housingLevy: Number(row.housing_levy || 0),
    net: Number(row.net_pay || 0),
  }));
}

export async function createPayrollRun(token: string, payrollMonth: string) {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Payroll requires API v1 configuration.");
  return v1Api.hr.createPayrollRun(token, payrollMonth);
}

export async function postPayrollRun(token: string, runId: string) {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Payroll requires API v1 configuration.");
  return v1Api.hr.postPayrollRun(token, runId);
}

export type LeaveApplicationRow = {
  id: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
};

export async function fetchLeaveCalendar(token: string, from?: string, to?: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.hr.leaveCalendar(token, from, to);
}

export async function fetchLeaveApplications(token: string): Promise<LeaveApplicationRow[]> {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Leave applications require API v1 configuration.");
  const rows = await v1Api.hr.leaveApplications(token);
  return rows.map((row) => ({
    id: String(row.id),
    employeeName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    leaveType: String(row.leave_type_name || "—"),
    startDate: String(row.start_date || "").slice(0, 10),
    endDate: String(row.end_date || "").slice(0, 10),
    days: Number(row.days_requested || 0),
    status: String(row.status || "pending").replace(/^./, (c) => c.toUpperCase()),
  }));
}

export type AttendanceRow = {
  id: string;
  employeeName: string;
  department: string;
  checkIn: string;
  checkOut: string;
  status: string;
  date: string;
};

export async function fetchAttendance(token: string, limit = 100): Promise<AttendanceRow[]> {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Attendance requires API v1 configuration.");
  const rows = await v1Api.hr.attendance(token, limit);
  return rows.map((row) => ({
    id: String(row.id),
    employeeName: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    department: String(row.department || "—"),
    checkIn: row.check_in ? String(row.check_in).slice(11, 16) : "—",
    checkOut: row.check_out ? String(row.check_out).slice(11, 16) : "—",
    status: String(row.status || "present").replace(/^./, (c) => c.toUpperCase()),
    date: String(row.attendance_date || "").slice(0, 10),
  }));
}

export type ReportLibraryEntry = { code: string; name: string; category: string };

export async function fetchReportLibrary(token: string) {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }
  if (!isV1Enabled()) throw new Error("Report library requires API v1 configuration.");
  const rows = await v1Api.reports.library(token);
  return rows.map((row) => ({
    code: String(row.code || row.report_code),
    name: String(row.name || row.title),
    category: String(row.module || row.category || "General"),
  }));
}

export type ReportRunOptions = {
  preset?: DashboardDatePreset;
  from_date?: string;
  to_date?: string;
  compare_prior?: boolean;
};

function reportQueryOpts(options?: ReportRunOptions) {
  return {
    preset: options?.preset,
    from_date: options?.from_date,
    to_date: options?.to_date,
    compare_prior: options?.compare_prior,
  };
}

export async function runReport(token: string, code: string, options?: ReportRunOptions) {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Reports require API v1 configuration.");
  return v1Api.reports.run(token, code, reportQueryOpts(options));
}

export async function downloadReportExport(
  token: string,
  code: string,
  format: "csv" | "xlsx" | "pdf",
  filename: string,
  options?: ReportRunOptions,
) {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Reports require API v1 configuration.");
  const blob = await v1Api.reports.runBlob(token, code, format, reportQueryOpts(options));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadReportCsv(token: string, code: string, filename: string, options?: ReportRunOptions) {
  return downloadReportExport(token, code, "csv", filename, options);
}

export async function fetchReportKpiReconcile(token: string, options?: ReportRunOptions) {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Reports require API v1 configuration.");
  const preset = options?.preset || "6m";
  return v1Api.reports.reconcileKpis(token, preset, options?.from_date, options?.to_date);
}

export type AgingBucketRow = { bucket: string; ar: number; ap: number };

export async function fetchAgingSummary(token: string): Promise<AgingBucketRow[]> {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Aging summary requires API v1 configuration.");
  const data = await v1Api.finance.agingSummary(token);
  return data.buckets || [];
}

export type CashFlowWeek = { label: string; value: number };

export async function fetchCashFlowForecast(token: string): Promise<CashFlowWeek[]> {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("Cash flow forecast requires API v1 configuration.");
  const data = await v1Api.finance.cashFlowForecast(token);
  return (data.weeks || []).map((w) => ({ label: String(w.label), value: Number(w.value || 0) }));
}

export type CrmLeadRow = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  status: string;
  source: string;
};

export type CrmOpportunityRow = {
  id: string;
  title: string;
  customerName: string;
  stage: string;
  amount: number;
  probability: number;
};

export async function fetchCrmLeads(token: string): Promise<CrmLeadRow[]> {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("CRM requires API v1 configuration.");
  const rows = await v1Api.crm.leads(token);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.contact_name || row.name || "—"),
    company: String(row.company_name || row.company || "—"),
    email: String(row.email || "—"),
    phone: String(row.phone || "—"),
    status: String(row.status || "new").replace(/^./, (c) => c.toUpperCase()),
    source: String(row.source || "—"),
  }));
}

export async function fetchCrmOpportunities(token: string): Promise<CrmOpportunityRow[]> {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("CRM requires API v1 configuration.");
  const rows = await v1Api.crm.opportunities(token);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title || row.name || "—"),
    customerName: String(row.customer_name || "—"),
    stage: String(row.stage || "prospect").replace(/^./, (c) => c.toUpperCase()),
    amount: Number(row.amount || 0),
    probability: Number(row.probability || 0),
  }));
}

export async function fetchCrmPipeline(token: string) {
  if (isDemoToken(token)) throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  if (!isV1Enabled()) throw new Error("CRM requires API v1 configuration.");
  return v1Api.crm.pipeline(token);
}

export type BackendInvoice = {
  id: string;
  internal_id?: string;
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
    internal_id: String(row.id || ""),
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

export type InvoiceListPage = { rows: BackendInvoice[]; total: number };

export async function fetchSalesAnalytics(token: string) {
  if (!isV1Enabled()) return null;
  return v1Api.sales.analytics(token);
}

export async function fetchSalesInvoices(
  token: string,
  opts?: { page?: number; limit?: number; q?: string; status?: string },
): Promise<InvoiceListPage> {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }

  if (isV1Enabled()) {
    const result = await v1Api.sales.invoices(token, opts);
    const rows = (result.data ?? []).map(mapV1Invoice);
    return { rows, total: result.pagination?.total ?? rows.length };
  }
  const response = await fetch(buildUrl("/api/sales/invoices"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const legacy = await handleResponse<BackendInvoice[]>(response);
  return { rows: legacy, total: legacy.length };
}

export async function createSalesInvoice(
  token: string,
  payload: {
    customer_id: string;
    invoice_date?: string;
    due_date?: string;
    invoice_type?: "tax" | "proforma";
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

export type BackendQuotation = {
  id: string;
  quote_no: string;
  customer_name: string;
  status: string;
  total_amount: number;
  valid_until: string | null;
};

export async function fetchQuotations(token: string): Promise<BackendQuotation[]> {
  if (!isV1Enabled()) throw new Error("API v1 required");
  const rows = await v1Api.sales.quotations(token);
  return rows.map((r) => ({
    id: String(r.id),
    quote_no: String(r.quote_no),
    customer_name: String(r.customer_name || ""),
    status: String(r.status || "draft"),
    total_amount: Number(r.total_amount || 0),
    valid_until: r.valid_until ? String(r.valid_until).slice(0, 10) : null,
  }));
}

export async function createQuotation(
  token: string,
  payload: {
    customer_id: string;
    valid_until?: string;
    lines: Array<{ item_id: string; quantity: number; unit_price: number; discount_percent?: number }>;
  },
) {
  return v1Api.sales.createQuotation(token, payload);
}

export async function convertQuotationToOrder(token: string, quotationId: string, warehouseId: string) {
  return v1Api.sales.convertQuotation(token, quotationId, warehouseId);
}

export async function fetchCreditNotes(token: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.sales.creditNotes(token);
}

export async function createCreditNote(
  token: string,
  payload: {
    customer_id: string;
    invoice_id?: string;
    reason: string;
    warehouse_id?: string;
    lines: Array<{ item_id: string; quantity: number; unit_price: number }>;
  },
) {
  return v1Api.sales.createCreditNote(token, payload);
}

export async function fetchStockAdjustments(token: string) {
  if (!isV1Enabled()) throw new Error("API v1 required");
  return v1Api.inventory.adjustments(token);
}

export async function createStockAdjustment(
  token: string,
  payload: {
    warehouse_id: string;
    reason: string;
    reason_code?: string;
    lines: Array<{ item_id: string; quantity_delta: number; unit_cost?: number }>;
  },
) {
  return v1Api.inventory.createAdjustment(token, payload);
}

export async function postStockAdjustment(token: string, adjustmentId: string, approverId: string) {
  return v1Api.inventory.postAdjustment(token, adjustmentId, approverId);
}

export async function fetchBankAccounts(token: string) {
  return v1Api.finance.bankAccounts(token);
}

export async function fetchBankReconUnmatched(token: string, bankAccountId: string) {
  return v1Api.finance.bankReconUnmatched(token, bankAccountId);
}

export async function importBankStatement(
  token: string,
  payload: {
    bank_account_id: string;
    lines: Array<{ txn_date?: string; description?: string; reference_no?: string; amount: number }>;
  },
) {
  return v1Api.finance.bankReconImport(token, payload);
}

export async function matchBankStatementLine(
  token: string,
  payload: { statement_line_id: string; receipt_id?: string },
) {
  return v1Api.finance.bankReconMatch(token, payload);
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

export async function emailInvoiceToCustomer(token: string, invoiceNo: string, toEmail?: string) {
  if (isDemoToken(token)) throw new Error("Sign in with the API to email invoices.");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  return v1Api.sales.emailInvoice(token, invoiceNo, toEmail);
}

export async function downloadReceiptPdf(token: string, invoiceNo: string) {
  if (isDemoToken(token)) throw new Error("Sign in with the API to download receipt PDFs.");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  const blob = await v1Api.sales.downloadReceiptPdf(token, invoiceNo);
  saveBlob(`receipt-${invoiceNo}.pdf`, blob);
}

export async function downloadPaymentReceiptPdf(token: string, receiptNo: string) {
  if (isDemoToken(token)) throw new Error("Sign in with the API to download payment receipts.");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  const blob = await v1Api.sales.downloadPaymentReceiptPdf(token, receiptNo);
  saveBlob(`payment-receipt-${receiptNo}.pdf`, blob);
}

export async function downloadGrnPdf(token: string, grnId: string, grnLabel?: string) {
  if (isDemoToken(token)) throw new Error("Sign in with the API to download GRN receipts.");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  const blob = await v1Api.procurement.downloadGrnPdf(token, grnId);
  saveBlob(`grn-${grnLabel || grnId}.pdf`, blob);
}

export async function downloadVendorPaymentPdf(token: string, paymentNo: string) {
  if (isDemoToken(token)) throw new Error("Sign in with the API to download vendor payment receipts.");
  if (!isV1Enabled()) throw new Error("API v1 is not configured");
  const blob = await v1Api.finance.downloadVendorPaymentPdf(token, paymentNo);
  saveBlob(`vendor-payment-${paymentNo}.pdf`, blob);
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
  aging: AgingBucketRow[];
  cashFlow: CashFlowWeek[];
};

export async function fetchAccountingSnapshot(token: string): Promise<AccountingSnapshot> {
  if (isDemoToken(token)) {
    throw new Error("Real-time mode requires API authentication. Sign in with your email and password.");
  }
  if (!isV1Enabled()) throw new Error("Accounting snapshot requires API v1 configuration.");

  const periods = await v1Api.finance.fiscalPeriods(token);
  const period = periods.find((p) => p.status === "open") || periods[0];
  if (!period?.id) return { journalRows: [], pnl: [], aging: [], cashFlow: [] };

  const periodId = String(period.id);
  const [journals, pl, aging, cashFlow] = await Promise.all([
    v1Api.finance.journals(token),
    v1Api.finance.profitLoss(token, periodId),
    fetchAgingSummary(token).catch(() => [] as AgingBucketRow[]),
    fetchCashFlowForecast(token).catch(() => [] as CashFlowWeek[]),
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
    aging,
    cashFlow,
  };
}

export type CompanyProfile = {
  id: string;
  name: string;
  legal_name: string;
  tax_registration_no: string;
  base_currency_code: string;
  fiscal_year_start_month: number;
  timezone: string;
};

export async function fetchCurrentCompany(token: string): Promise<CompanyProfile | null> {
  if (isDemoToken(token) || !isV1Enabled()) return null;
  const row = await v1Api.companies.current(token);
  return {
    id: String(row.id),
    name: String(row.name || ""),
    legal_name: String(row.legal_name || row.name || ""),
    tax_registration_no: String(row.tax_registration_no || ""),
    base_currency_code: String(row.base_currency_code || "KES"),
    fiscal_year_start_month: Number(row.fiscal_year_start_month || 1),
    timezone: String(row.timezone || "Africa/Nairobi"),
  };
}

export async function updateCurrentCompany(token: string, body: Partial<CompanyProfile>) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to update company settings.");
  if (!isV1Enabled()) throw new Error("Company settings require API v1 configuration.");
  return v1Api.companies.updateCurrent(token, body);
}

export async function fetchSystemSettings(token: string, category?: string) {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  return v1Api.settings.list(token, category);
}

export async function saveSystemSetting(token: string, category: string, key: string, value: unknown) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to save settings.");
  if (!isV1Enabled()) throw new Error("Settings require API v1 configuration.");
  return v1Api.settings.save(token, category, key, value);
}

export async function createCrmLead(
  token: string,
  body: { company_name: string; contact_name?: string; email?: string; phone?: string; source?: string; estimated_value?: number },
) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to create leads.");
  if (!isV1Enabled()) throw new Error("CRM requires API v1 configuration.");
  return v1Api.crm.createLead(token, body);
}

export async function createCrmOpportunity(
  token: string,
  body: { name: string; customer_id?: string; amount?: number; stage?: string; probability?: number },
) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to create opportunities.");
  if (!isV1Enabled()) throw new Error("CRM requires API v1 configuration.");
  return v1Api.crm.createOpportunity(token, body);
}

export async function createLeaveApplication(
  token: string,
  body: { employee_id: string; leave_type_id: string; start_date: string; end_date: string; days_requested?: number; reason?: string },
) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to apply for leave.");
  if (!isV1Enabled()) throw new Error("Leave applications require API v1 configuration.");
  return v1Api.hr.createLeaveApplication(token, body);
}

export async function approveLeaveApplication(token: string, id: string) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to approve leave.");
  if (!isV1Enabled()) throw new Error("Leave applications require API v1 configuration.");
  return v1Api.hr.approveLeaveApplication(token, id);
}

export async function fetchLeaveTypes(token: string) {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  return v1Api.hr.leaveTypes(token);
}

export type ChartOfAccountRow = { id: string; code: string; name: string; account_type: string };

export async function fetchChartOfAccounts(token: string): Promise<ChartOfAccountRow[]> {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  const rows = await v1Api.finance.chartOfAccounts(token);
  return rows.map((row) => ({
    id: String(row.id),
    code: String(row.account_code || row.code || ""),
    name: String(row.account_name || row.name || ""),
    account_type: String(row.account_type || ""),
  }));
}

export async function createFinanceJournal(
  token: string,
  body: {
    entry_date: string;
    description?: string;
    reference_no?: string;
    lines: Array<{ account_id: string; debit?: number; credit?: number; description?: string }>;
  },
) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to create journals.");
  if (!isV1Enabled()) throw new Error("Finance journals require API v1 configuration.");
  return v1Api.finance.createJournal(token, { journal_type: "general", ...body });
}

export async function postFinanceJournal(token: string, journalId: string) {
  if (isDemoToken(token)) throw new Error("Sign in with your email and password to post journals.");
  if (!isV1Enabled()) throw new Error("Finance journals require API v1 configuration.");
  return v1Api.finance.postJournal(token, journalId);
}

export type TaxRateRow = { id: string; name: string; rate: number; tax_type: string };

export async function fetchTaxRates(token: string): Promise<TaxRateRow[]> {
  if (isDemoToken(token) || !isV1Enabled()) return [];
  const rows = await v1Api.finance.taxRates(token);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name || row.tax_name || "—"),
    rate: Number(row.rate || row.tax_rate || 0),
    tax_type: String(row.tax_type || row.type || "—"),
  }));
}
