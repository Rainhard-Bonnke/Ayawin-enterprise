import { broadcastLogout } from "./sessionSync";

const apiBase = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
const ACCESS_KEY = "ayawin-erp-access-token";
const REFRESH_KEY = "ayawin-erp-refresh-token";

function decodeJwtPayload(token: string): { exp?: number; type?: string } | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number; type?: string };
  } catch {
    return null;
  }
}

export function isAccessTokenExpired(token: string | null | undefined, skewMs = 30_000) {
  if (!token || token.startsWith("demo:")) return false;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 <= Date.now() + skewMs;
}

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

/** API origin: explicit VITE_API_BASE, or localhost:4000 in dev (TanStack Start does not reliably proxy /api). */
function resolveApiBase() {
  if (apiBase) return apiBase;
  if (import.meta.env.DEV) return "http://localhost:4000";
  return "";
}

function buildUrl(path: string) {
  const base = resolveApiBase();
  return base ? `${base}/api/v1${path}` : `/api/v1${path}`;
}

async function parseError(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as { error?: string };
    throw new Error(data.error || response.statusText);
  }
  throw new Error(await response.text() || response.statusText);
}

export async function refreshAccessToken(): Promise<string | null> {
  const { refresh } = getStoredTokens();
  if (!refresh) return null;
  let response: Response;
  try {
    response = await fetch(buildUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const data = (await response.json()) as { access_token: string; refresh_token?: string };
  storeTokens(data.access_token, data.refresh_token || refresh);
  notifyTokenRefreshed(data.access_token);
  return data.access_token;
}

function sessionExpired() {
  clearTokens();
  broadcastLogout();
  throw new ApiAuthError("Session expired. Please sign in again.");
}

export class ApiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiAuthError";
  }
}

export class MfaRequiredError extends Error {
  mfaRequired = true;
  constructor(message = "Enter your authenticator code") {
    super(message);
    this.name = "MfaRequiredError";
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

  if (access && isAccessTokenExpired(access)) {
    const refreshed = await refreshAccessToken();
    access = refreshed ?? access;
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
    sessionExpired();
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
  if (access && isAccessTokenExpired(access)) {
    const refreshed = await refreshAccessToken();
    access = refreshed ?? access;
  }
  let response = await request(access);
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) response = await request(refreshed);
  }
  if (response.status === 401) {
    sessionExpired();
  }
  if (!response.ok) await parseError(response);
  return response.blob();
}

export function parseAccessToken(token: string): ErpUser | null {
  try {
    if (token.startsWith("demo:")) return null;
    if (isAccessTokenExpired(token, 0)) return null;
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

export async function v1Login(
  email: string,
  password: string,
  options?: { mfaToken?: string; rememberMe?: boolean },
) {
  const url = buildUrl("/auth/login");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        mfa_token: options?.mfaToken,
        remember_me: Boolean(options?.rememberMe),
      }),
    });
  } catch {
    const base = resolveApiBase() || "http://localhost:4000";
    throw new Error(
      `Cannot reach the API at ${base}. Start the backend (npm run dev:all from project root), wait for "Backend ready", then try again.`,
    );
  }
  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    user?: ErpUser & { role_name?: string };
    error?: string;
    mfa_required?: boolean;
  };
  if (response.status === 401 && data.mfa_required) {
    throw new MfaRequiredError(data.error);
  }
  if (!response.ok) {
    const msg = data.error || response.statusText || "Sign in failed";
    if (response.status === 403 && /locked/i.test(msg)) {
      throw new Error("Account is temporarily locked after failed attempts. Wait 30 minutes or ask an admin to unlock.");
    }
    throw new Error(msg);
  }
  if (!data.access_token || !data.refresh_token || !data.user) {
    throw new Error("Invalid login response");
  }

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

export async function v1ChangePassword(
  token: string,
  body: { current_password: string; new_password: string },
) {
  return apiV1Fetch<{ ok: boolean; message?: string }>("/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, token);
}

export type GoLiveChecklistItem = {
  id: string;
  label: string;
  pass: boolean;
  hint: string;
};

export type GoLiveStatus = {
  ready: boolean;
  pass_count: number;
  total: number;
  checklist: GoLiveChecklistItem[];
};

export async function fetchGoLiveStatus(token: string) {
  return apiV1Fetch<GoLiveStatus>("/platform/go-live/status", {}, token);
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

export async function v1ForgotPassword(email: string) {
  return apiV1Fetch<{ ok: boolean; message: string; dev_token?: string }>(
    "/auth/forgot-password",
    { method: "POST", body: JSON.stringify({ email }) },
    null,
  );
}

export async function v1ResetPassword(token: string, password: string) {
  return apiV1Fetch<{ ok: boolean; message: string }>(
    "/auth/reset-password",
    { method: "POST", body: JSON.stringify({ token, password }) },
    null,
  );
}

export async function v1Logout() {
  const { refresh, access } = getStoredTokens();
  try {
    await apiV1Fetch("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refresh }),
    }, access);
  } finally {
    clearTokens();
  }
}

export async function v1MfaSetup(token: string) {
  return apiV1Fetch<{ secret: string; otpauth_url: string }>("/auth/mfa/setup", { method: "POST" }, token);
}

export async function v1MfaVerify(token: string, mfaToken: string) {
  return apiV1Fetch<{ ok: boolean; mfa_enabled: boolean }>(
    "/auth/mfa/verify",
    { method: "POST", body: JSON.stringify({ token: mfaToken }) },
    token,
  );
}

export async function inviteUser(
  token: string,
  body: {
    email: string;
    full_name: string;
    username?: string;
    role_id?: string;
    phone?: string;
    default_branch_id?: string;
  },
) {
  return apiV1Fetch<{ ok: boolean; message: string; dev_token?: string }>(
    "/users/invite",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
    token,
  );
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
    stock: (token: string, q?: string) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/inventory/stock${q ? `?q=${encodeURIComponent(q)}` : ""}`,
        {},
        token,
      ),
    catalog: (token: string, warehouseId: string, q?: string) => {
      const params = new URLSearchParams({ warehouse_id: warehouseId });
      if (q) params.set("q", q);
      return apiV1Fetch<{
        customer_id: string | null;
        items: Array<Record<string, unknown>>;
      }>(`/inventory/catalog?${params}`, {}, token);
    },
    lookup: (token: string, barcode: string) =>
      apiV1Fetch<Record<string, unknown>[]>(`/inventory/lookup?barcode=${encodeURIComponent(barcode)}`, {}, token),
    valuation: (token: string, warehouseId?: string) =>
      apiV1Fetch<{ by_warehouse: Record<string, unknown>[]; totals: Record<string, unknown> }>(
        `/inventory/valuation${warehouseId ? `?warehouse_id=${encodeURIComponent(warehouseId)}` : ""}`,
        {},
        token,
      ),
    movements: (token: string, params?: { limit?: number; item_id?: string; warehouse_id?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.item_id) qs.set("item_id", params.item_id);
      if (params?.warehouse_id) qs.set("warehouse_id", params.warehouse_id);
      const query = qs.toString();
      return apiV1Fetch<Record<string, unknown>[]>(`/inventory/movements${query ? `?${query}` : ""}`, {}, token);
    },
    reasonCodes: (token: string) =>
      apiV1Fetch<Array<{ code: string; label: string }>>("/inventory/adjustment-reason-codes", {}, token),
    fefoPick: (token: string, warehouseId: string, itemId: string, quantity: number) =>
      apiV1Fetch<{ quantity: number; picks: Array<{ batch_no: string | null; expiry_date: string | null; quantity: number }>; on_hand: number }>(
        `/inventory/fefo-pick?warehouse_id=${encodeURIComponent(warehouseId)}&item_id=${encodeURIComponent(itemId)}&quantity=${quantity}`,
        {},
        token,
      ),
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
    createAdjustment: (
      token: string,
      body: {
        warehouse_id: string;
        reason: string;
        reason_code?: string;
        lines: Array<{ item_id: string; quantity_delta: number; unit_cost?: number }>;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    postAdjustment: (token: string, adjustmentId: string, approverId: string) =>
      apiV1Fetch<{ ok: boolean }>(`/inventory/adjustments/${adjustmentId}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ approver_id: approverId }),
      }, token),
    adjustments: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/inventory/adjustments", {}, token),
  },
  procurement: {
    purchaseOrders: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/procurement/purchase-orders", {}, token),
    requisitions: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[]; pagination: { total: number } }>(
        "/procurement/requisitions?limit=50",
        {},
        token,
      ),
    createRequisition: (
      token: string,
      body: {
        warehouse_id?: string;
        required_date?: string;
        notes?: string;
        lines: Array<{ item_id: string; quantity: number; estimated_unit_cost?: number; warehouse_id?: string }>;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/procurement/requisitions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    submitRequisition: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/procurement/requisitions/${id}/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }, token),
    approveRequisition: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/procurement/requisitions/${id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }, token),
    goodsReceipts: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/procurement/goods-receipts", {}, token),
    approvePurchaseOrder: (token: string, poId: string) =>
      apiV1Fetch<Record<string, unknown>>(`/procurement/purchase-orders/${poId}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }, token),
    downloadGrnPdf: (token: string, grnId: string) =>
      apiV1FetchBlob(`/procurement/goods-receipts/${grnId}/pdf`, {}, token),
    postGoodsReceipt: (token: string, grnId: string) =>
      apiV1Fetch<Record<string, unknown>>(`/procurement/goods-receipts/${grnId}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ post_gl: true }),
      }, token),
  },
  sales: {
    orders: (
      token: string,
      query?: { page?: number; limit?: number; q?: string; status?: string },
    ) => {
      const params = new URLSearchParams({
        page: String(query?.page ?? 1),
        limit: String(query?.limit ?? 50),
      });
      if (query?.q) params.set("q", query.q);
      if (query?.status) params.set("status", query.status);
      return apiV1Fetch<{ data: Record<string, unknown>[]; pagination: { page: number; limit: number; total: number } }>(
        `/sales/orders?${params}`,
        {},
        token,
      );
    },
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
    invoices: (
      token: string,
      query?: { page?: number; limit?: number; q?: string; status?: string },
    ) => {
      const params = new URLSearchParams({
        page: String(query?.page ?? 1),
        limit: String(query?.limit ?? 50),
      });
      if (query?.q) params.set("q", query.q);
      if (query?.status) params.set("status", query.status);
      return apiV1Fetch<{ data: Record<string, unknown>[]; pagination: { page: number; limit: number; total: number } }>(
        `/sales/invoices?${params}`,
        {},
        token,
      );
    },
    createInvoice: (
      token: string,
      body: {
        customer_id: string;
        invoice_date?: string;
        due_date?: string;
        sales_order_id?: string;
        delivery_note_id?: string;
        invoice_type?: "tax" | "proforma";
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
    emailInvoice: (token: string, invoiceNo: string, toEmail?: string) =>
      apiV1Fetch<{ ok: boolean; to: string; invoice_no: string; pdf_bytes?: number }>(
        `/sales/invoices/${encodeURIComponent(invoiceNo)}/email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(toEmail ? { to_email: toEmail } : {}),
        },
        token,
      ),
    downloadReceiptPdf: (token: string, invoiceNo: string) =>
      apiV1FetchBlob(`/sales/invoices/${encodeURIComponent(invoiceNo)}/receipt-pdf`, {}, token),
    downloadPaymentReceiptPdf: (token: string, receiptNo: string) =>
      apiV1FetchBlob(`/sales/receipts/${encodeURIComponent(receiptNo)}/pdf`, {}, token),
    verifyInvoice: (token: string, invoiceNo: string, hash?: string) =>
      apiV1Fetch<{ invoice_no: string; status: string; verification_hash: string; valid?: boolean }>(
        `/sales/invoices/${encodeURIComponent(invoiceNo)}/verify${hash ? `?hash=${encodeURIComponent(hash)}` : ""}`,
        {},
        token,
      ),
    deliveries: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/sales/deliveries", {}, token),
    uploadPod: (
      token: string,
      deliveryId: string,
      body: { pod_signature?: string; pod_photo_data?: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>(`/sales/deliveries/${deliveryId}/pod`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    analytics: (token: string) => apiV1Fetch<Record<string, unknown>>("/sales/analytics/summary", {}, token),
    cancelOrder: (token: string, orderId: string, reason: string) =>
      apiV1Fetch<{ ok: boolean; stock_reversed?: boolean }>(`/sales/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      }, token),
    discountCap: (token: string) =>
      apiV1Fetch<{ max_discount_percent: number }>("/sales/discount-cap", {}, token),
    previewTotals: (
      token: string,
      body: {
        customer_id: string;
        lines: Array<{ item_id: string; quantity: number; unit_price: number; discount_percent?: number }>;
      },
    ) =>
      apiV1Fetch<{
        subtotal: number;
        exciseAmount: number;
        taxAmount: number;
        total: number;
        lines: Array<Record<string, unknown>>;
      }>("/sales/preview-totals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    resolvePricing: (token: string, customerId: string, itemId: string) =>
      apiV1Fetch<{ unit_price: number; price_tier: string; price_list_code: string | null }>(
        `/sales/pricing?customer_id=${encodeURIComponent(customerId)}&item_id=${encodeURIComponent(itemId)}`,
        {},
        token,
      ),
    atpCheck: (
      token: string,
      body: { warehouse_id: string; lines: Array<{ item_id: string; quantity: number }> },
    ) => apiV1Fetch<{ ok: boolean; shortages?: Array<Record<string, unknown>> }>("/sales/atp-check", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }, token),
    quotations: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/sales/quotations", {}, token),
    createQuotation: (
      token: string,
      body: {
        customer_id: string;
        lines: Array<{ item_id: string; quantity: number; unit_price: number; discount_percent?: number }>;
        valid_until?: string;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/sales/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    convertQuotation: (token: string, quotationId: string, warehouseId: string) =>
      apiV1Fetch<Record<string, unknown>>(`/sales/quotations/${quotationId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ warehouse_id: warehouseId }),
      }, token),
    creditNotes: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/sales/credit-notes", {}, token),
    createCreditNote: (
      token: string,
      body: {
        customer_id: string;
        invoice_id?: string;
        reason?: string;
        warehouse_id?: string;
        lines: Array<{ item_id: string; quantity: number; unit_price: number; warehouse_id?: string }>;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/sales/credit-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
  },
  pos: {
    catalog: (token: string, warehouseId: string, query?: { q?: string; customer_id?: string }) => {
      const params = new URLSearchParams({ warehouse_id: warehouseId });
      if (query?.q) params.set("q", query.q);
      if (query?.customer_id) params.set("customer_id", query.customer_id);
      return apiV1Fetch<{
        customer_id: string | null;
        items: Array<{
          item_id: string;
          item_code: string;
          item_name: string;
          barcode: string | null;
          quantity: number;
          unit_price: number;
          price_tier: string;
          standard_cost: number;
          reorder_point: number;
        }>;
      }>(`/pos/catalog?${params}`, {}, token);
    },
    previewTotals: (
      token: string,
      body: { customer_id?: string; lines: Array<{ item_id: string; quantity: number; unit_price: number; discount_percent?: number }> },
    ) =>
      apiV1Fetch<{
        subtotal: number;
        exciseAmount: number;
        taxAmount: number;
        total: number;
        lines: Array<Record<string, unknown>>;
      }>("/pos/preview-totals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    completeSale: (
      token: string,
      body: {
        warehouse_id: string;
        customer_id?: string;
        lines: Array<{ item_id: string; quantity: number; unit_price: number; discount_percent?: number }>;
        payment_method?: string;
        reference_no?: string;
        notes?: string;
      },
    ) =>
      apiV1Fetch<{
        ok: boolean;
        sales_order_id: string;
        order_no: string;
        invoice_id: string;
        invoice_no: string;
        total_amount: number;
        receipt_no: string | null;
      }>("/pos/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
  },
  logistics: {
    drivers: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/logistics/drivers", {}, token),
    vehicles: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/logistics/vehicles", {}, token),
    assignDriver: (
      token: string,
      deliveryId: string,
      body: { driver_id?: string; vehicle_id?: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>(`/logistics/deliveries/${deliveryId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    updateStatus: (
      token: string,
      deliveryId: string,
      body: { logistics_status: string; failure_reason?: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>(`/logistics/deliveries/${deliveryId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    failDelivery: (token: string, deliveryId: string, reason?: string) =>
      apiV1Fetch<Record<string, unknown>>(`/logistics/deliveries/${deliveryId}/fail`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      }, token),
    driverActive: (token: string, driverId: string) =>
      apiV1Fetch<Record<string, unknown>[]>(`/logistics/drivers/${driverId}/active`, {}, token),
    optimizeRoutes: (token: string, deliveryDate?: string) => {
      const q = deliveryDate ? `?delivery_date=${encodeURIComponent(deliveryDate)}` : "";
      return apiV1Fetch<{ routes: Array<Record<string, unknown>>; total_stops: number }>(
        `/logistics/routes/optimize${q}`,
        {},
        token,
      );
    },
    recordMileage: (
      token: string,
      body: {
        vehicle_id: string;
        delivery_id?: string;
        driver_id?: string;
        trip_date?: string;
        odometer_start?: number;
        odometer_end?: number;
        distance_km?: number;
        route_zone?: string;
        notes?: string;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/logistics/mileage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    redeliveryTasks: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/logistics/redelivery-tasks", {}, token),
    scheduleRedelivery: (
      token: string,
      taskId: string,
      body: { driver_id?: string; vehicle_id?: string; delivery_date?: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>(`/logistics/redelivery-tasks/${taskId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    downloadDeliveryPdf: (token: string, deliveryNo: string) =>
      apiV1FetchBlob(`/logistics/deliveries/pdf/${encodeURIComponent(deliveryNo)}`, {}, token),
  },
  hr: {
    employees: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/hr/employees", {}, token),
    attendance: (token: string, limit = 100) =>
      apiV1Fetch<Record<string, unknown>[]>(`/hr/attendance?limit=${limit}`, {}, token),
    importAttendance: (
      token: string,
      rows: Array<Record<string, unknown>>,
    ) =>
      apiV1Fetch<{ ok: boolean; imported: number }>("/hr/attendance/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows }),
      }, token),
    leaveTypes: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/hr/leave-types", {}, token),
    leaveApplications: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/hr/leave-applications", {}, token),
    createLeaveApplication: (
      token: string,
      body: {
        employee_id: string;
        leave_type_id: string;
        start_date: string;
        end_date: string;
        days_requested?: number;
        reason?: string;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/hr/leave-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    approveLeaveApplication: (token: string, id: string) =>
      apiV1Fetch<{ ok: boolean; balance_after?: number }>(`/hr/leave-applications/${id}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }, token),
    leaveCalendar: (token: string, from?: string, to?: string) => {
      const q = new URLSearchParams();
      if (from) q.set("from_date", from);
      if (to) q.set("to_date", to);
      const suffix = q.toString() ? `?${q}` : "";
      return apiV1Fetch<{
        days: Array<{
          date: string;
          available_count: number;
          on_leave_count: number;
          is_holiday: boolean;
          on_leave: Array<{ name: string; department: string }>;
        }>;
      }>(`/hr/leave-calendar${suffix}`, {}, token);
    },
    payrollRuns: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/payroll/runs", {}, token),
    createPayrollRun: (token: string, payrollMonth: string) =>
      apiV1Fetch<Record<string, unknown>>("/payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ payroll_month: payrollMonth }),
      }, token),
    payslips: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>[]>(`/payroll/runs/${runId}/payslips`, {}, token),
    postPayrollRun: (token: string, runId: string) =>
      apiV1Fetch<{ ok: boolean }>(`/payroll/runs/${runId}/post`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }, token),
    downloadPayslipPdf: (token: string, runId: string, payslipId: string) =>
      apiV1FetchBlob(`/payroll/runs/${runId}/payslips/${payslipId}/pdf`, {}, token),
    statutoryReport: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>>(`/payroll/runs/${runId}/statutory-report`, {}, token),
  },
  reports: {
    dashboard: (token: string, code: string) =>
      apiV1Fetch<{ widgets: Array<{ widget: string; value: number | null }> }>>(`/reports/dashboards/${code}`, {}, token),
    dashboardSummary: (token: string, preset = "6m") =>
      apiV1Fetch<Record<string, unknown>>(`/dashboard/summary?preset=${encodeURIComponent(preset)}`, {}, token),
    kpis: (token: string) => apiV1Fetch<Array<Record<string, unknown>>>("/reports/kpis", {}, token),
    library: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/reports/library", {}, token),
    run: (
      token: string,
      code: string,
      opts?: { format?: "json" | "csv"; from_date?: string; to_date?: string; preset?: string; compare_prior?: boolean },
    ) => {
      const q = new URLSearchParams();
      if (opts?.format === "csv") q.set("format", "csv");
      if (opts?.from_date) q.set("from_date", opts.from_date);
      if (opts?.to_date) q.set("to_date", opts.to_date);
      if (opts?.preset) q.set("preset", opts.preset);
      if (opts?.compare_prior) q.set("compare_prior", "true");
      const suffix = q.toString() ? `?${q}` : "";
      return apiV1Fetch<{ report?: string; rows: Record<string, unknown>[]; period?: Record<string, unknown>; all_matched?: boolean }>(
        `/reports/run/${encodeURIComponent(code)}${suffix}`,
        {},
        token,
      );
    },
    runBlob: (token: string, code: string, format: "csv" | "xlsx" | "pdf", opts?: { from_date?: string; to_date?: string; preset?: string; compare_prior?: boolean }) => {
      const q = new URLSearchParams({ format });
      if (opts?.from_date) q.set("from_date", opts.from_date);
      if (opts?.to_date) q.set("to_date", opts.to_date);
      if (opts?.preset) q.set("preset", opts.preset);
      if (opts?.compare_prior) q.set("compare_prior", "true");
      return apiV1FetchBlob(`/reports/run/${encodeURIComponent(code)}?${q}`, {}, token);
    },
    runCsv: (token: string, code: string, opts?: { from_date?: string; to_date?: string; preset?: string }) =>
      v1Api.reports.runBlob(token, code, "csv", opts),
    reconcileKpis: (token: string, preset = "6m", from?: string, to?: string) => {
      const q = new URLSearchParams({ preset });
      if (from) q.set("from_date", from);
      if (to) q.set("to_date", to);
      return apiV1Fetch<{ rows: Array<Record<string, unknown>>; all_matched: boolean }>(
        `/reports/reconcile-kpis?${q}`,
        {},
        token,
      );
    },
  },
  crm: {
    leads: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/crm/leads?limit=50", {}, token).then((r) => r.data),
    createLead: (
      token: string,
      body: {
        company_name: string;
        contact_name?: string;
        email?: string;
        phone?: string;
        source?: string;
        estimated_value?: number;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    opportunities: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/crm/opportunities", {}, token),
    createOpportunity: (
      token: string,
      body: {
        name: string;
        customer_id?: string;
        lead_id?: string;
        stage?: string;
        amount?: number;
        probability?: number;
        expected_close_date?: string;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/crm/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    pipeline: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/crm/pipeline", {}, token),
    customerStatement: (token: string, customerId: string, from?: string, to?: string) => {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const suffix = q.toString() ? `?${q}` : "";
      return apiV1Fetch<{
        customer: Record<string, unknown>;
        opening_balance: number;
        closing_balance: number;
        ar_balance: number;
        transactions: Array<{
          txn_date: string;
          type: string;
          ref: string;
          debit: number;
          credit: number;
          balance_effect: number;
          running_balance: number;
        }>;
      }>(`/crm/customers/${customerId}/statement${suffix}`, {}, token);
    },
    arAging: (token: string) =>
      apiV1Fetch<{
        rows: Array<Record<string, unknown>>;
        summary: Record<string, number>;
      }>("/crm/ar-aging", {}, token),
    customerBalances: (token: string) =>
      apiV1Fetch<Record<string, number>>("/crm/customer-balances", {}, token),
    creditPolicy: (token: string) => apiV1Fetch<{ mode: string }>("/crm/credit-policy", {}, token),
  },
  companies: {
    current: (token: string) => apiV1Fetch<Record<string, unknown>>("/companies/current", {}, token),
    updateCurrent: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>("/companies/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
  },
  settings: {
    list: (token: string, category?: string) =>
      apiV1Fetch<Record<string, unknown>[]>(
        category ? `/settings?category=${encodeURIComponent(category)}` : "/settings",
        {},
        token,
      ),
    save: (token: string, category: string, key: string, setting_value: unknown) =>
      apiV1Fetch<Record<string, unknown>>(`/settings/${category}/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ setting_value }),
      }, token),
  },
  finance: {
    trialBalance: (token: string, periodId: string) =>
      apiV1Fetch<{
        lines: Record<string, unknown>[];
        totals: { period_debit: number; period_credit: number; difference: number; balanced: boolean };
        posted_journals: { debit: number; credit: number; difference: number; balanced: boolean };
      }>(`/finance/reports/trial-balance?fiscal_period_id=${periodId}`, {}, token),
    balanceSheet: (token: string, periodId: string) =>
      apiV1Fetch<{
        lines: Record<string, unknown>[];
        totals: Record<string, number>;
        balanced: boolean;
      }>(`/finance/reports/balance-sheet?fiscal_period_id=${periodId}`, {}, token),
    profitLoss: (token: string, periodId: string) =>
      apiV1Fetch<{
        lines: Record<string, unknown>[];
        total_income: number;
        total_expense: number;
        net_profit: number;
      }>(`/finance/reports/profit-loss?fiscal_period_id=${periodId}`, {}, token),
    kenyaCoaStatus: (token: string) =>
      apiV1Fetch<{ ok: boolean; missing: Array<{ code: string; name: string }> }>("/finance/coa/kenya-status", {}, token),
    vatReturn: (token: string, from?: string, to?: string) => {
      const q = new URLSearchParams();
      if (from) q.set("from_date", from);
      if (to) q.set("to_date", to);
      const suffix = q.toString() ? `?${q}` : "";
      return apiV1Fetch<{
        invoice_vat_total: number;
        gl_vat_total: number;
        variance: number;
        matched: boolean;
        lines: Record<string, unknown>[];
      }>(`/finance/reports/vat-return${suffix}`, {}, token);
    },
    exciseReturn: (token: string, from?: string, to?: string) => {
      const q = new URLSearchParams();
      if (from) q.set("from_date", from);
      if (to) q.set("to_date", to);
      const suffix = q.toString() ? `?${q}` : "";
      return apiV1Fetch<{
        format: string;
        lines: Record<string, unknown>[];
        totals: Record<string, number>;
      }>(`/finance/reports/excise-return${suffix}`, {}, token);
    },
    multiPeriod: (token: string, fiscalYearId?: string) => {
      const q = fiscalYearId ? `?fiscal_year_id=${fiscalYearId}` : "";
      return apiV1Fetch<{ periods: Record<string, unknown>[] }>(`/finance/reports/multi-period${q}`, {}, token);
    },
    fiscalPeriods: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/finance/fiscal-periods", {}, token),
    journals: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/finance/journals?limit=50", {}, token).then((r) => r.data),
    journal: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(`/finance/journals/${id}`, {}, token),
    agingSummary: (token: string) =>
      apiV1Fetch<{ buckets: Array<{ bucket: string; ar: number; ap: number }> }>("/finance/reports/aging-summary", {}, token),
    cashFlowForecast: (token: string) =>
      apiV1Fetch<{ weeks: Array<{ label: string; value: number }> }>("/finance/reports/cash-flow-forecast", {}, token),
    createJournal: (
      token: string,
      body: {
        entry_date: string;
        journal_type?: string;
        reference_no?: string;
        description?: string;
        lines: Array<{ account_id: string; debit?: number; credit?: number; description?: string }>;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/finance/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    postJournal: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/finance/journals/${id}/post`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }, token),
    chartOfAccounts: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/master/chart-of-accounts", {}, token),
    taxRates: (token: string) =>
      apiV1Fetch<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>("/master/tax-rates?limit=100", {}, token).then(
        (r) => (Array.isArray(r) ? r : r.data ?? []),
      ),
    vendorBills: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/finance/vendor-bills", {}, token),
    vendorBill: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(`/finance/vendor-bills/${id}`, {}, token),
    createVendorBillFromGrn: (
      token: string,
      body: { goods_receipt_id: string; vendor_ref?: string; bill_date?: string; due_date?: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/finance/vendor-bills/from-grn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    postVendorBill: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/finance/vendor-bills/${id}/post`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }, token),
    payVendorBill: (
      token: string,
      id: string,
      body: { amount: number; payment_date?: string; reference_no?: string; payment_method?: string },
    ) =>
      apiV1Fetch<{ ok: boolean; payment_no: string; status: string; amount_paid: number }>(
        `/finance/vendor-bills/${id}/pay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        token,
      ),
    downloadVendorPaymentPdf: (token: string, paymentNo: string) =>
      apiV1FetchBlob(`/finance/vendor-payments/${encodeURIComponent(paymentNo)}/pdf`, {}, token),
    bankAccounts: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/finance/bank-accounts", {}, token),
    bankReconUnmatched: (token: string, bankAccountId: string) =>
      apiV1Fetch<{
        statement_lines: Record<string, unknown>[];
        open_receipts: Record<string, unknown>[];
        suggestions: Array<{ statement_line_id: string; receipt_id: string }>;
      }>(`/finance/bank-recon/unmatched?bank_account_id=${bankAccountId}`, {}, token),
    bankReconImport: (
      token: string,
      body: {
        bank_account_id: string;
        lines: Array<{ txn_date?: string; description?: string; reference_no?: string; amount: number }>;
      },
    ) =>
      apiV1Fetch<{ imported: number }>("/finance/bank-recon/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    bankReconMatch: (
      token: string,
      body: { statement_line_id: string; receipt_id?: string; journal_id?: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/finance/bank-recon/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
    monthEndOpenPeriod: (token: string) =>
      apiV1Fetch<Record<string, unknown> | null>("/finance/month-end/open-period", {}, token),
    monthEndPreview: (token: string, periodId: string) =>
      apiV1Fetch<{
        can_close: boolean;
        blockers: string[];
        trial_balance: { period_debit?: number; period_credit?: number; difference: number; balanced?: boolean };
        posted_journals?: { balanced?: boolean };
        period: Record<string, unknown>;
      }>(`/finance/month-end/${periodId}/preview`, {}, token),
    monthEndClose: (token: string, periodId: string, force = false) =>
      apiV1Fetch<Record<string, unknown>>(`/finance/month-end/${periodId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ force }),
      }, token),
  },
  platform: {
    goLiveStatus: (token: string) => fetchGoLiveStatus(token),
    integrationStatus: (token: string) =>
      apiV1Fetch<{
        etims: { enabled: boolean; configured: boolean; mode: string };
        mpesa: { enabled: boolean; configured: boolean; mode: string };
        email: { enabled: boolean; configured: boolean; mode: string };
        sms: { enabled: boolean; configured: boolean; mode: string };
      }>("/platform/integrations/status", {}, token),
    submitEtims: (token: string, invoiceId: string) =>
      apiV1Fetch<Record<string, unknown>>("/platform/integrations/etims/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoice_id: invoiceId }),
      }, token),
    mpesaStkPush: (
      token: string,
      body: { phone: string; amount: number; reference: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>("/platform/integrations/mpesa/stk-push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }, token),
  },
};

export function isV1Enabled() {
  if (import.meta.env.VITE_USE_API_V1 === "false") return false;
  if (resolveApiBase() || apiBase) return true;
  return import.meta.env.DEV;
}

export type MasterEntity = "customers" | "vendors" | "items" | "warehouses" | "employees";
export type MasterBulkEntity = MasterEntity | "chart-of-accounts";

export async function masterList(
  token: string,
  entity: MasterEntity,
  q = "",
  filters?: Record<string, string | boolean>,
) {
  const params = new URLSearchParams({ limit: "500" });
  if (q) params.set("q", q);
  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      params.set(key, String(val));
    }
  }
  const path = `/master/${entity}?${params.toString()}`;
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
  options?: { ifMatch?: string },
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (options?.ifMatch) headers["If-Match"] = options.ifMatch;
  return apiV1Fetch<Record<string, unknown>>(`/master/${entity}/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  }, token);
}

export async function masterDelete(token: string, entity: MasterEntity, id: string) {
  await apiV1Fetch(`/master/${entity}/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }, token);
}

export async function masterBulkDelete(token: string, entity: MasterBulkEntity, ids: string[]) {
  return apiV1Fetch<{ deleted: number; errors: Array<{ id: string; error: string }> }>(
    `/master/${entity}/bulk/delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ids }),
    },
    token,
  );
}

export async function masterBulkExport(token: string, entity: MasterBulkEntity, ids?: string[]) {
  return apiV1FetchBlob(
    `/master/${entity}/bulk/export`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(ids?.length ? { ids } : {}),
    },
    token,
  );
}

export async function masterBulkStatus(
  token: string,
  entity: MasterBulkEntity,
  ids: string[],
  is_active: boolean,
) {
  return apiV1Fetch<{ updated: number }>(`/master/${entity}/bulk/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids, is_active }),
  }, token);
}

export async function fetchRoles(token: string) {
  return apiV1Fetch<Array<{ id: string; name: string; permissions?: string[] }>>("/roles", {}, token);
}

export async function fetchPermissions(token: string) {
  return apiV1Fetch<Array<{ id: string; code: string; module: string; action: string; description?: string }>>(
    "/roles/permissions",
    {},
    token,
  );
}

export async function updateRolePermissions(token: string, roleId: string, permission_codes: string[]) {
  return apiV1Fetch<{ ok: boolean }>(`/roles/${roleId}/permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ permission_codes }),
  }, token);
}

export async function createChartOfAccount(
  token: string,
  body: { account_code: string; account_name: string; account_type: string; is_postable?: boolean },
) {
  return apiV1Fetch<Record<string, unknown>>("/master/chart-of-accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }, token);
}

export async function importRows(
  token: string,
  entityType: "customers" | "items" | "vendors" | "opening_stock" | "attendance",
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
