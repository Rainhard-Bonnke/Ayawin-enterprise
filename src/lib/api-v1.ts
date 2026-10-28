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
  localStorage.setItem("ayawin-stock-solution-erp-token", access);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem("ayawin-stock-solution-erp-token");
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
  throw new Error((await response.text()) || response.statusText);
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
  if (token === null) return null;
  if (typeof token === "string" && token && !token.startsWith("demo:")) return token;

  if (typeof token === "undefined") {
    const stored = getStoredTokens().access;
    if (stored && !stored.startsWith("demo:")) return stored;
    return null;
  }

  const stored = getStoredTokens().access;
  if (stored && !stored.startsWith("demo:")) return stored;
  return null;
}

export async function apiV1Fetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  let access = resolveApiToken(token);

  if (access?.startsWith("demo:")) {
    throw new ApiAuthError(
      "Sign in with your email and password to use the live API (offline demo cannot call the server).",
    );
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

export async function apiV1FetchBlob(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<Blob> {
  let access = resolveApiToken(token);
  if (access?.startsWith("demo:")) {
    throw new ApiAuthError(
      "Sign in with your email and password to use the live API (offline demo cannot call the server).",
    );
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
    if (!payload.sub || !payload.email) return null;
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
  }>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email, password, mfa_token: mfaToken }),
    },
    null,
  );

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

export async function v1PosLogin(password: string) {
  const response = await fetch(buildUrl("/auth/pos-login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) await parseError(response);

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    user: ErpUser & { role_name?: string };
  };

  storeTokens(data.access_token, data.refresh_token);
  return {
    token: data.access_token,
    user: {
      id: data.user.id,
      username: data.user.username,
      full_name: data.user.full_name,
      email: data.user.email,
      role: data.user.role_name || "POS Operator",
      permissions: data.user.permissions,
    } satisfies ErpUser,
  };
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
    taxGroups: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/master/tax-groups?limit=200", {}, token)
        .then((result) => result.data),
    taxRates: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/master/tax-rates", {}, token)
        .then((result) => result.data),
    createTaxRateVersion: (token: string, body: {
      code: string; name: string; rate: number; tax_type: string; basis: string;
      effective_from: string; effective_to?: string;
    }) => apiV1Fetch<Record<string, unknown>>("/master/tax-rates", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }, token),
    customers: (token: string, q = "") =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>(
        `/master/customers?q=${encodeURIComponent(q)}&limit=200`,
        {},
        token,
      ).then((r) => r.data),
    vendors: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/master/vendors?limit=200", {}, token).then(
        (r) => r.data,
      ),
    items: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/master/items?limit=200", {}, token).then(
        (r) => r.data,
      ),
    warehouses: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>(
        "/master/warehouses?limit=200",
        {},
        token,
      ).then((r) => r.data),
  },
  users: {
    list: (token: string, q = "") =>
      apiV1Fetch<Record<string, unknown>[]>(`/users?q=${encodeURIComponent(q)}`, {}, token),
  },
  audit: {
    list: (token: string, q = "", limit = 100) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/audit?q=${encodeURIComponent(q)}&limit=${limit}`,
        {},
        token,
      ),
  },
  inventory: {
      stock: (token: string, limit = 50, warehouseId = "") =>
        apiV1Fetch<Record<string, unknown>[]>(`/inventory/stock?limit=${limit}${warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : ""}`, {}, token),
    transfers: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/inventory/transfers", {}, token),
    transferDetail: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(`/inventory/transfers/${id}`, {}, token),
    quarantine: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/inventory/quarantine", {}, token),
    quarantineSetup: (token: string) =>
      apiV1Fetch<{ vendors: Record<string, unknown>[]; accounts: Record<string, unknown>[] }>("/inventory/quarantine/setup", {}, token),
    dispositions: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/inventory/quarantine/dispositions", {}, token),
    createDisposition: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>("/inventory/quarantine/dispositions", { method: "POST", body: JSON.stringify(body) }, token),
    postDisposition: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/quarantine/dispositions/${id}/post`, { method: "POST" }, token),
    receiveTransfer: (token: string, id: string, body: { lines: Array<{ transfer_line_id: string; received_quantity: number; damaged_quantity: number; complete: boolean }>; notes?: string }) =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/transfers/${id}/receive`, { method: "POST", body: JSON.stringify(body) }, token),
    movements: (token: string, limit = 100) =>
      apiV1Fetch<Record<string, unknown>[]>(`/inventory/movements?limit=${limit}`, {}, token),
    reorderAlerts: (token: string, limit = 50) =>
      apiV1Fetch<Record<string, unknown>[]>(`/inventory/reorder-alerts?limit=${limit}`, {}, token),
    analysis: (token: string, days = 30, warehouseId = "") =>
      apiV1Fetch<{ days: number; rows: Record<string, unknown>[] }>(
        `/inventory/analysis?days=${days}${warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : ""}`,
        {}, token,
      ),
    materialRequisitions: (token: string, status = "") =>
      apiV1Fetch<Array<Record<string, unknown>>>(`/inventory/material-requisitions${status ? `?status=${encodeURIComponent(status)}` : ""}`, {}, token),
    materialRequisition: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/material-requisitions/${id}`, {}, token),
    createMaterialRequisition: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>("/inventory/material-requisitions", { method: "POST", body: JSON.stringify(body) }, token),
    submitMaterialRequisition: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/material-requisitions/${id}/submit`, { method: "POST" }, token),
    reviewMaterialRequisition: (token: string, id: string, decision: "approve" | "reject", note = "") =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/material-requisitions/${id}/review`, { method: "POST", body: JSON.stringify({ decision, note }) }, token),
    issueMaterialRequisition: (token: string, id: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/material-requisitions/${id}/issues`, { method: "POST", body: JSON.stringify(body) }, token),
    materialIssues: (token: string) =>
      apiV1Fetch<Array<Record<string, unknown>>>("/inventory/material-issues", {}, token),
    materialIssue: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/material-issues/${id}`, {}, token),
    materialReturns: (token: string) =>
      apiV1Fetch<Array<Record<string, unknown>>>("/inventory/material-returns", {}, token),
    createMaterialReturn: (token: string, issueId: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/material-issues/${issueId}/returns`, { method: "POST", body: JSON.stringify(body) }, token),
    adjustmentJournals: (token: string) =>
      apiV1Fetch<Array<Record<string, unknown>>>("/inventory/adjustment-journals", {}, token),
    createAdjustmentJournal: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>("/inventory/adjustment-journals", { method: "POST", body: JSON.stringify(body) }, token),
    postAdjustmentJournal: (token: string, id: string, note = "") =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/adjustment-journals/${id}/post`, { method: "POST", body: JSON.stringify({ note }) }, token),
    cancelAdjustmentJournal: (token: string, id: string, note = "") =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/adjustment-journals/${id}/cancel`, { method: "POST", body: JSON.stringify({ note }) }, token),
    fleetLocations: (token: string) =>
      apiV1Fetch<FleetLocation[]>("/inventory/fleet/locations", {}, token),
    fleetItems: (token: string) =>
      apiV1Fetch<Array<{ id: string; item_code: string; name: string }>>(
        "/inventory/fleet/items",
        {},
        token,
      ),
    fleetVehicleStock: (token: string) =>
      apiV1Fetch<DriverStockRow[]>("/inventory/fleet/vehicle-stock", {}, token),
    fleetDrivers: (token: string) =>
      apiV1Fetch<Array<{ id: string; full_name: string; email: string }>>(
        "/inventory/fleet/drivers",
        {},
        token,
      ),
    createVehicleLocation: (
      token: string,
      body: {
        code: string;
        name: string;
        vehicle_registration: string;
        assigned_driver_user_id: string;
      },
    ) =>
      apiV1Fetch<FleetLocation>(
        "/inventory/fleet/vehicles",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    stocktakes: (token: string) =>
      apiV1Fetch<FleetStocktake[]>("/inventory/fleet/stocktakes", {}, token),
    stocktake: (token: string, id: string) =>
      apiV1Fetch<FleetStocktakeDetail>(`/inventory/fleet/stocktakes/${id}`, {}, token),
    startStocktake: (token: string, warehouse_id: string, title: string) =>
      apiV1Fetch<FleetStocktake>(
        "/inventory/fleet/stocktakes",
        {
          method: "POST",
          body: JSON.stringify({ warehouse_id, title }),
        },
        token,
      ),
    submitStocktake: (
      token: string,
      id: string,
      counts: Array<{ line_id: string; counted_quantity: number; notes?: string }>,
    ) =>
      apiV1Fetch<FleetStocktake>(
        `/inventory/fleet/stocktakes/${id}/submit`,
        {
          method: "POST",
          body: JSON.stringify({ counts }),
        },
        token,
      ),
    reviewStocktake: (token: string, id: string, decision: "approve" | "reject", note?: string) =>
      apiV1Fetch<FleetStocktake>(
        `/inventory/fleet/stocktakes/${id}/review`,
        {
          method: "POST",
          body: JSON.stringify({ decision, note }),
        },
        token,
      ),
    intelligenceFindings: (token: string, status = "open") =>
      apiV1Fetch<InventoryFinding[]>(
        `/intelligence/inventory/findings?status=${status}&limit=100`,
        {},
        token,
      ),
    analyzeInventory: (token: string) =>
      apiV1Fetch<{ run: { id: string; summary: string | null }; findings: unknown[] }>(
        "/intelligence/inventory/analyze",
        { method: "POST" },
        token,
      ),
    reviewFinding: (
      token: string,
      findingId: string,
      status: "acknowledged" | "resolved" | "dismissed",
    ) =>
      apiV1Fetch<InventoryFinding>(
        `/intelligence/inventory/findings/${findingId}/review`,
        { method: "PATCH", body: JSON.stringify({ status }) },
        token,
      ),
    analyzeBusiness: (token: string, question = "") =>
      apiV1Fetch<{
        answer: string;
        observations: { title: string; detail: string; evidence: string[]; priority: "low" | "medium" | "high" }[];
        actions: string[];
        provider: string;
        model: string;
        mode: "rules" | "model";
        note?: string;
        snapshot: { asOf: string; currency: string; sections: { name: string; data: Record<string, number> }[] };
      }>(
        "/intelligence/assistant/analyze",
        { method: "POST", body: JSON.stringify({ question }) },
        token,
      ),
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
      apiV1Fetch<{ ok: boolean; reference_id: string }>(
        "/inventory/stock-in",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        token,
      ),
    adjust: (
      token: string,
      body: {
        warehouse_id: string;
        item_id: string;
        physical_quantity: number;
        unit_cost?: number;
        reason: string;
      },
    ) =>
      apiV1Fetch<{
        ok: boolean;
        reference_id: string;
        system_quantity: number;
        physical_quantity: number;
        delta: number;
      }>(
        "/inventory/adjustments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        token,
      ),
    dispatchTransfer: (
      token: string,
      body: {
        from_warehouse_id: string;
        to_warehouse_id: string;
        lines: Array<{ item_id: string; quantity: number }>;
        notes?: string;
      },
    ) =>
      apiV1Fetch<{ ok: boolean; transfer_no: string; id: string }>(
        "/inventory/transfers",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        token,
      ),
  },
  procurement: {
    purchaseOrders: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/procurement/purchase-orders", {}, token),
    goodsReceipts: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/procurement/goods-receipts", {}, token),
    supplierReturnCredits: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/procurement/supplier-return-credits", {}, token),
    supplierReturnCreditSetup: (token: string) =>
      apiV1Fetch<{ claims: Record<string, unknown>[]; bills: Record<string, unknown>[]; sourceLines: Record<string, unknown>[]; accounts: Record<string, unknown>[] }>("/procurement/supplier-return-credits/setup", {}, token),
    createSupplierReturnCredit: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>("/procurement/supplier-return-credits", { method: "POST", body: JSON.stringify(body) }, token),
    postSupplierReturnCredit: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/procurement/supplier-return-credits/${id}/post`, { method: "POST" }, token),
    cancelSupplierReturnCredit: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/procurement/supplier-return-credits/${id}/cancel`, { method: "POST" }, token),
  },
  sales: {
    customerCreditNoteSetup: (token: string) =>
      apiV1Fetch<{ invoices: Record<string, unknown>[]; notes: Record<string, unknown>[]; refundAccounts: Record<string, unknown>[] }>("/sales/customer-credit-notes/setup", {}, token),
    customerReturnOptions: (token: string, invoiceId: string) =>
      apiV1Fetch<{ invoice: Record<string, unknown>; lines: Record<string, unknown>[] }>(`/sales/invoices/${invoiceId}/return-options`, {}, token),
    createCustomerCreditNote: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>("/sales/customer-credit-notes", { method: "POST", body: JSON.stringify(body) }, token),
    postCustomerCreditNote: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/sales/customer-credit-notes/${id}/post`, { method: "POST" }, token),
    cancelCustomerCreditNote: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/sales/customer-credit-notes/${id}/cancel`, { method: "POST" }, token),
    taxPreview: (token: string, lines: Array<{ item_id: string; quantity: number; unit_price: number; tax_group_id?: string }>, taxDate?: string) =>
      apiV1Fetch<{ subtotal: number; tax_amount: number; total_amount: number; lines: Record<string, unknown>[] }>(
        "/sales/tax-preview",
        { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ lines, tax_date: taxDate }) },
        token,
      ),
    receivablesAging: (token: string) =>
      apiV1Fetch<{ as_of: string; totals: Record<string, number>; rows: Record<string, unknown>[] }>(
        "/sales/receivables/aging", {}, token,
      ),
    collectionActivities: (token: string, status = "open") =>
      apiV1Fetch<Record<string, unknown>[]>(`/sales/receivables/collection-activities?status=${encodeURIComponent(status)}`, {}, token),
    createCollectionActivity: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>("/sales/receivables/collection-activities", { method: "POST", body: JSON.stringify(body) }, token),
    completeCollectionActivity: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/sales/receivables/collection-activities/${id}/complete`, { method: "POST" }, token),
    orders: (token: string, limit = 25) =>
      apiV1Fetch<Record<string, unknown>[]>(`/sales/orders?limit=${limit}`, {}, token),
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
      apiV1Fetch<Record<string, unknown>>(
        "/sales/orders",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        token,
      ),
    orderDetail: (token: string, orderId: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(
        `/sales/orders/${orderId}`,
        {},
        token,
      ),
    cancelOrder: (token: string, orderId: string) =>
      apiV1Fetch<{ ok: boolean; order_id: string; status: string }>(
        `/sales/orders/${orderId}/cancel`, { method: "POST" }, token,
      ),
    createDelivery: (
      token: string,
      body: {
        sales_order_id: string;
        warehouse_id: string;
        delivery_date?: string;
        lines: Array<{
          so_line_id?: string;
          item_id: string;
          quantity: number;
          unit_cost?: number;
        }>;
      },
    ) =>
      apiV1Fetch<{ ok: boolean; delivery_id: string }>(
        "/sales/deliveries",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        token,
      ),
    invoices: (token: string, limit = 25) =>
      apiV1Fetch<Record<string, unknown>[]>(`/sales/invoices?limit=${limit}`, {}, token),
    postInvoice: (token: string, invoiceNo: string) =>
      apiV1Fetch<{ ok: boolean; invoice_id: string; invoice_no: string; journal_id: string | null }>(
        `/sales/invoices/${encodeURIComponent(invoiceNo)}/post`, { method: "POST" }, token,
      ),
    createInvoice: (
      token: string,
      body: {
        customer_id: string;
        invoice_date?: string;
        due_date?: string;
        sales_order_id?: string;
        delivery_note_id?: string;
        lines: Array<{
          item_id: string;
          quantity: number;
          unit_price: number;
          so_line_id?: string;
        }>;
      },
    ) =>
      apiV1Fetch<{ ok: boolean; invoice_id: string; invoice_no: string; journal_id?: string | null; gl_warning?: string | null }>(
        "/sales/invoices",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        token,
      ),
    payInvoice: (
      token: string,
      invoiceId: string,
      body: { amount: number; payment_date?: string; reference_no?: string; notes?: string },
    ) =>
      apiV1Fetch<{ ok: boolean; payment_no: string; status: string; amount_paid: number; gl_warning?: string | null }>(
        `/sales/invoices/${invoiceId}/pay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        token,
      ),
    downloadInvoicePdf: (token: string, invoiceNo: string) =>
      apiV1FetchBlob(`/sales/invoices/${encodeURIComponent(invoiceNo)}/pdf`, {}, token),
    downloadReceiptPdf: (token: string, invoiceNo: string) =>
      apiV1FetchBlob(`/sales/invoices/${encodeURIComponent(invoiceNo)}/receipt-pdf`, {}, token),
    verifyInvoice: (token: string, invoiceNo: string, hash?: string) =>
      apiV1Fetch<{
        invoice_no: string;
        status: string;
        verification_hash: string;
        valid?: boolean;
      }>(
        `/sales/invoices/${encodeURIComponent(invoiceNo)}/verify${hash ? `?hash=${encodeURIComponent(hash)}` : ""}`,
        {},
        token,
      ),
    analytics: (token: string) =>
      apiV1Fetch<Record<string, unknown>>("/sales/analytics/summary", {}, token),
  },
  hr: {
    employees: (token: string) => apiV1Fetch<Record<string, unknown>[]>("/hr/employees", {}, token),
    payrollRuns: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/payroll/runs", {}, token),
    payslips: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>[]>(`/payroll/runs/${runId}/payslips`, {}, token),
  },
  reports: {
    dashboard: (token: string, code: string) =>
      apiV1Fetch<{ widgets: Array<{ widget: string; value: number | null }> }>(
        `/reports/dashboards/${code}`,
        {},
        token,
      ),
    kpis: (token: string) => apiV1Fetch<Array<Record<string, unknown>>>("/reports/kpis", {}, token),
    library: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/reports/library", {}, token),
    run: (token: string, code: string) =>
      apiV1Fetch<{ rows: Record<string, unknown>[] }>(`/reports/run/${code}`, {}, token),
  },
  finance: {
    trialBalance: (token: string, periodId: string) =>
      apiV1Fetch<{ lines: Record<string, unknown>[] }>(
        `/finance/reports/trial-balance?fiscal_period_id=${periodId}`,
        {},
        token,
      ),
    profitLoss: (token: string, periodId: string) =>
      apiV1Fetch<{ lines: Record<string, unknown>[]; net_profit: number }>(
        `/finance/reports/profit-loss?fiscal_period_id=${periodId}`,
        {},
        token,
      ),
    fiscalPeriods: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/finance/fiscal-periods", {}, token),
    journals: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/finance/journals?limit=50", {}, token).then(
        (r) => r.data,
      ),
    journal: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(
        `/finance/journals/${id}`,
        {},
        token,
      ),
  },
};

export type FleetLocation = {
  id: string;
  code: string;
  name: string;
  location_type: "warehouse" | "vehicle";
  vehicle_registration?: string | null;
  assigned_driver_user_id?: string | null;
  driver_name?: string | null;
};

export type DriverStockRow = {
  warehouse_id: string;
  vehicle_name: string;
  vehicle_registration: string | null;
  item_id: string;
  item_code: string;
  item_name: string;
  uom_code: string | null;
  quantity: number;
};

export type FleetStocktake = {
  id: string;
  count_no: string;
  title: string;
  status: "counting" | "submitted" | "recount_required" | "posted" | "rejected";
  location_name?: string;
  location_code?: string;
  location_type?: "warehouse" | "vehicle";
  line_count?: number;
  variance_count?: number;
  review_note?: string | null;
  created_at: string;
};

export type FleetStocktakeDetail = FleetStocktake & {
  lines: Array<{
    id: string;
    item_id: string;
    item_code: string;
    item_name: string;
    uom_code?: string | null;
    expected_quantity: number | null;
    counted_quantity: number | null;
    variance: number | null;
    notes: string | null;
  }>;
};

export type InventoryFinding = {
  id: string;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  title: string;
  finding: string;
  recommendation: string;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  created_at: string;
};

export function isV1Enabled() {
  if (import.meta.env.VITE_USE_API_V1 === "false") return false;
  if (apiBase) return true;
  // Dev without VITE_API_BASE: Vite proxies /api → backend (same as create calls).
  return import.meta.env.DEV;
}

export type MasterEntity = "customers" | "vendors" | "items" | "warehouses";

export async function masterList(token: string, entity: MasterEntity, q = "", limit?: number) {
  const requestedLimit = limit ?? (entity === "items" ? 100 : 500);
  const path = `/master/${entity}?limit=${requestedLimit}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const result = await apiV1Fetch<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    path,
    {},
    token,
  );
  if (Array.isArray(result)) return result;
  return result.data ?? [];
}

export async function masterCreate(
  token: string,
  entity: MasterEntity,
  body: Record<string, unknown>,
) {
  return apiV1Fetch<Record<string, unknown>>(
    `/master/${entity}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function masterUpdate(
  token: string,
  entity: MasterEntity,
  id: string,
  body: Record<string, unknown>,
) {
  return apiV1Fetch<Record<string, unknown>>(
    `/master/${entity}/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function masterDelete(token: string, entity: MasterEntity, id: string) {
  await apiV1Fetch(
    `/master/${entity}/${id}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
    token,
  );
}

export async function fetchRoles(token: string) {
  return apiV1Fetch<Array<{ id: string; name: string }>>("/roles", {}, token);
}

export type FixedAsset = {
  id: string;
  asset_code: string;
  name: string;
  category: string;
  acquisition_date: string;
  acquisition_cost: number | string;
  residual_value: number | string;
  useful_life_months: number;
  location: string;
  serial_number: string;
  status: "active" | "disposed";
  notes: string;
};

export async function fetchFixedAssets(token: string) {
  return apiV1Fetch<FixedAsset[]>("/assets", {}, token);
}

export async function createFixedAsset(token: string, data: Omit<FixedAsset, "id" | "status">) {
  return apiV1Fetch<FixedAsset>("/assets", { method: "POST", body: JSON.stringify(data) }, token);
}

export async function setFixedAssetStatus(token: string, id: string, status: FixedAsset["status"]) {
  return apiV1Fetch<FixedAsset>(
    `/assets/${id}`,
    { method: "PATCH", body: JSON.stringify({ status }) },
    token,
  );
}

export async function deleteFixedAsset(token: string, id: string) {
  return apiV1Fetch<void>(`/assets/${id}`, { method: "DELETE" }, token);
}

export async function importRows(
  token: string,
  entityType: "customers" | "items" | "attendance",
  rows: Record<string, unknown>[],
  fileName?: string,
) {
  return apiV1Fetch<{
    job_id: string;
    total: number;
    success: number;
    errors: Array<{ row: number; error: string }>;
  }>(
    "/platform/import",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entity_type: entityType, rows, file_name: fileName }),
    },
    token,
  );
}
