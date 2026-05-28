const apiBase = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
const ACCESS_KEY = "ayawin-erp-access-token";
const REFRESH_KEY = "ayawin-erp-refresh-token";

export type ErpUser = {
  id: string;
  username: string;
  full_name: string | null;
  email: string;
  role: string;
  role_name?: string;
  permissions?: string[];
};

export function getStoredTokens() {
  return {
    access: localStorage.getItem(ACCESS_KEY),
    refresh: localStorage.getItem(REFRESH_KEY),
  };
}

export function storeTokens(access: string, refresh?: string) {
  localStorage.setItem(ACCESS_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  localStorage.setItem("ayawin-enterprise-erp-token", access);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem("ayawin-enterprise-erp-token");
}

const tokenRefreshListeners = new Set<(access: string) => void>();

export function onAccessTokenRefreshed(listener: (access: string) => void) {
  tokenRefreshListeners.add(listener);
  return () => {
    tokenRefreshListeners.delete(listener);
  };
}

function notifyTokenRefreshed(access: string) {
  tokenRefreshListeners.forEach((listener) => listener(access));
}

export function isApiSessionToken(token: string | null | undefined) {
  return Boolean(token && !token.startsWith("demo:"));
}

function buildUrl(path: string) {
  return `${apiBase}/api/v1${path}`;
}

async function parseError(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as { error?: string };
    throw new Error(data.error || response.statusText);
  }
  throw new Error(await response.text() || response.statusText);
}

async function refreshAccessToken(): Promise<string | null> {
  const { refresh } = getStoredTokens();
  if (!refresh) return null;
  const response = await fetch(buildUrl("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { access_token: string; refresh_token?: string };
  storeTokens(data.access_token, data.refresh_token || refresh);
  notifyTokenRefreshed(data.access_token);
  return data.access_token;
}

export class ApiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiAuthError";
  }
}

/** Prefer the latest access token from storage (e.g. after refresh) over a stale React state token. */
export function resolveApiToken(token?: string | null): string | null {
  const stored = getStoredTokens().access;
  if (stored && !stored.startsWith("demo:")) return stored;
  return token ?? null;
}

export async function apiV1Fetch<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  let access = resolveApiToken(token);

  if (access?.startsWith("demo:")) {
    throw new ApiAuthError("Sign in with your email and password to use the live API (offline demo cannot call the server).");
  }

  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");

  const request = (bearer: string | null) => {
    const h = new Headers(headers);
    if (bearer) h.set("Authorization", `Bearer ${bearer}`);
    return fetch(buildUrl(path), { ...init, headers: h });
  };

  let response = await request(access);

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      access = refreshed;
      response = await request(refreshed);
    }
  }

  if (response.status === 401) {
    clearTokens();
    throw new ApiAuthError("Session expired. Please sign in again.");
  }

  if (!response.ok) await parseError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiV1FetchBlob(path: string, init: RequestInit = {}, token?: string | null): Promise<Blob> {
  let access = resolveApiToken(token);
  if (access?.startsWith("demo:")) {
    throw new ApiAuthError("Sign in with your email and password to use the live API (offline demo cannot call the server).");
  }
  const headers = new Headers(init.headers);
  const request = (bearer: string | null) => {
    const h = new Headers(headers);
    if (bearer) h.set("Authorization", `Bearer ${bearer}`);
    return fetch(buildUrl(path), { ...init, headers: h });
  };
  let response = await request(access);
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) response = await request(refreshed);
  }
  if (response.status === 401) {
    clearTokens();
    throw new ApiAuthError("Session expired. Please sign in again.");
  }
  if (!response.ok) await parseError(response);
  return response.blob();
}

export function parseAccessToken(token: string): ErpUser | null {
  try {
    if (token.startsWith("demo:")) return null;
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
      sub?: string;
      email?: string;
      full_name?: string;
      name?: string;
      role_name?: string;
      role?: string;
      permissions?: string[];
      exp?: number;
    };
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return null;
    }
    return {
      id: payload.sub,
      username: payload.email?.split("@")[0] || "user",
      full_name: payload.full_name || payload.name || null,
      email: payload.email,
      role: payload.role_name || payload.role || "Admin",
      role_name: payload.role_name,
      permissions: payload.permissions || [],
    };
  } catch {
    return null;
  }
}

export async function v1Login(email: string, password: string, mfaToken?: string) {
  const data = await apiV1Fetch<{
    access_token: string;
    refresh_token: string;
    user: ErpUser & { role_name?: string };
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, mfa_token: mfaToken }),
  }, null);

  storeTokens(data.access_token, data.refresh_token);
  const user: ErpUser = {
    id: data.user.id,
    username: data.user.username,
    full_name: data.user.full_name,
    email: data.user.email,
    role: data.user.role_name || data.user.role || "Admin",
    permissions: data.user.permissions,
  };
  return { token: data.access_token, user };
}

export async function v1Me(token: string) {
  const user = await apiV1Fetch<ErpUser & { role_name?: string }>("/auth/me", {}, token);
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    email: user.email,
    role: user.role_name || user.role || "Admin",
    permissions: user.permissions,
  } satisfies ErpUser;
}

export async function v1Logout() {
  const { refresh } = getStoredTokens();
  try {
    await apiV1Fetch("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refresh }),
    });
  } finally {
    clearTokens();
  }
}

export const v1Api = {
  master: {
    customers: (token: string, q = "") =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>(`/master/customers?q=${encodeURIComponent(q)}&limit=200`, {}, token)
        .then((r) => r.data),
    vendors: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/master/vendors?limit=200", {}, token).then((r) => r.data),
    items: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/master/items?limit=200", {}, token).then((r) => r.data),
    warehouses: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/master/warehouses?limit=200", {}, token).then((r) => r.data),
  },
  users: {
    list: (token: string, q = "") =>
      apiV1Fetch<Record<string, unknown>[]>(`/users?q=${encodeURIComponent(q)}`, {}, token),
  },
  audit: {
    list: (token: string, q = "", limit = 100) =>
      apiV1Fetch<Record<string, unknown>[]>(`/audit?q=${encodeURIComponent(q)}&limit=${limit}`, {}, token),
  },
  inventory: {
    stock: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/inventory/stock", {}, token),
    reorderAlerts: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/inventory/reorder-alerts", {}, token),
    stockIn: (
      token: string,
      body: {
        warehouse_id: string;
        item_id: string;
        quantity: number;
        unit_cost?: number;
        notes?: string;
        batch_no?: string;
        expiry_date?: string;
      },
    ) =>
      apiV1Fetch<{ ok: boolean; reference_id: string }>("/inventory/stock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    transfer: (
      token: string,
      body: {
        from_warehouse_id: string;
        to_warehouse_id: string;
        lines: Array<{ item_id: string; quantity: number }>;
        notes?: string;
      },
    ) =>
      apiV1Fetch<{ ok: boolean; transfer_no: string; id: string }>("/inventory/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
  },
  procurement: {
    purchaseOrders: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/procurement/purchase-orders", {}, token),
    goodsReceipts: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/procurement/goods-receipts", {}, token),
  },
  sales: {
    orders: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/sales/orders", {}, token),
    createOrder: (
      token: string,
      body: {
        customer_id: string;
        warehouse_id: string;
        order_date?: string;
        notes?: string;
        lines: Array<{ item_id: string; quantity: number; unit_price: number }>;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/sales/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    orderDetail: (token: string, orderId: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(`/sales/orders/${orderId}`, {}, token),
    createDelivery: (
      token: string,
      body: {
        sales_order_id: string;
        warehouse_id: string;
        delivery_date?: string;
        lines: Array<{ so_line_id?: string; item_id: string; quantity: number; unit_cost?: number }>;
      },
    ) =>
      apiV1Fetch<{ ok: boolean; delivery_id: string }>("/sales/deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    invoices: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/sales/invoices", {}, token),
    createInvoice: (
      token: string,
      body: {
        customer_id: string;
        invoice_date?: string;
        due_date?: string;
        sales_order_id?: string;
        delivery_note_id?: string;
        lines: Array<{ item_id: string; quantity: number; unit_price: number; so_line_id?: string }>;
      },
    ) =>
      apiV1Fetch<{ ok: boolean; invoice_id: string; gl_warning?: string | null }>("/sales/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    payInvoice: (
      token: string,
      invoiceId: string,
      body: { amount: number; payment_date?: string; reference_no?: string; notes?: string },
    ) =>
      apiV1Fetch<{ ok: boolean; payment_no: string; status: string; amount_paid: number }>(`/sales/invoices/${invoiceId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    downloadInvoicePdf: (token: string, invoiceNo: string) =>
      apiV1FetchBlob(`/sales/invoices/${encodeURIComponent(invoiceNo)}/pdf`, {}, token),
    downloadReceiptPdf: (token: string, invoiceNo: string) =>
      apiV1FetchBlob(`/sales/invoices/${encodeURIComponent(invoiceNo)}/receipt-pdf`, {}, token),
    verifyInvoice: (token: string, invoiceNo: string, hash?: string) =>
      apiV1Fetch<{ invoice_no: string; status: string; verification_hash: string; valid?: boolean }>(
        `/sales/invoices/${encodeURIComponent(invoiceNo)}/verify${hash ? `?hash=${encodeURIComponent(hash)}` : ""}`,
        {},
        token,
      ),
    analytics: (token: string) => apiV1Fetch<Record<string, unknown>>("/sales/analytics/summary", {}, token),
  },
  hr: {
    employees: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/hr/employees", {}, token),
    payrollRuns: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/payroll/runs", {}, token),
    payslips: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>[]>(`/payroll/runs/${runId}/payslips`, {}, token),
  },
  reports: {
    dashboard: (token: string, code: string) =>
      apiV1Fetch<{ widgets: Array<{ widget: string; value: number | null }> }>>(`/reports/dashboards/${code}`, {}, token),
    kpis: (token: string) => apiV1Fetch<Array<Record<string, unknown>>>("/reports/kpis", {}, token),
    library: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/reports/library", {}, token),
    run: (token: string, code: string) =>
      apiV1Fetch<{ rows: Record<string, unknown>[] }>(`/reports/run/${code}`, {}, token),
  },
  finance: {
    trialBalance: (token: string, periodId: string) =>
      apiV1Fetch<{ lines: Record<string, unknown>[] }>(`/finance/reports/trial-balance?fiscal_period_id=${periodId}`, {}, token),
    profitLoss: (token: string, periodId: string) =>
      apiV1Fetch<{ lines: Record<string, unknown>[]; net_profit: number }>(
        `/finance/reports/profit-loss?fiscal_period_id=${periodId}`,
        {},
        token,
      ),
    fiscalPeriods: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/finance/fiscal-periods", {}, token),
    journals: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/finance/journals?limit=50", {}, token).then((r) => r.data),
    journal: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(`/finance/journals/${id}`, {}, token),
  },
};

export function isV1Enabled() {
  if (import.meta.env.VITE_USE_API_V1 === "false") return false;
  if (apiBase) return true;
  // Dev without VITE_API_BASE: Vite proxies /api → backend (same as create calls).
  return import.meta.env.DEV;
}

export type MasterEntity = "customers" | "vendors" | "items" | "warehouses";

export async function masterList(token: string, entity: MasterEntity, q = "") {
  const path = `/master/${entity}?limit=500${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const result = await apiV1Fetch<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    path,
    {},
    token,
  );
  if (Array.isArray(result)) return result;
  return result.data ?? [];
}

export async function masterCreate(token: string, entity: MasterEntity, body: Record<string, unknown>) {
  return apiV1Fetch<Record<string, unknown>>(`/master/${entity}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }, token);
}

export async function masterUpdate(
  token: string,
  entity: MasterEntity,
  id: string,
  body: Record<string, unknown>,
) {
  return apiV1Fetch<Record<string, unknown>>(`/master/${entity}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }, token);
}

export async function masterDelete(token: string, entity: MasterEntity, id: string) {
  await apiV1Fetch(`/master/${entity}/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }, token);
}

export async function fetchRoles(token: string) {
  return apiV1Fetch<Array<{ id: string; name: string }>>("/roles", {}, token);
}

export async function importRows(
  token: string,
  entityType: "customers" | "items" | "attendance",
  rows: Record<string, unknown>[],
  fileName?: string,
) {
  return apiV1Fetch<{ job_id: string; total: number; success: number; errors: Array<{ row: number; error: string }> }>(
    "/platform/import",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entity_type: entityType, rows, file_name: fileName }),
    },
    token,
  );
}
