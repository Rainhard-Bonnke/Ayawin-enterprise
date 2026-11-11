const apiBase = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
const ACCESS_KEY = "ayawin-erp-access-token";
const REFRESH_KEY = "ayawin-erp-refresh-token";
const LEGACY_ACCESS_KEY = "ayawin-stock-solution-erp-token";
const CSRF_COOKIE = "ayawin_csrf_token";

let accessToken: string | null = null;
let csrfTokenInMemory: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export type ErpUser = {
  id: string;
  username: string;
  full_name: string | null;
  email: string;
  role: string;
  role_name?: string;
  permissions?: string[];
  mfa_enabled?: boolean;
};

export type MasterVendor = {
  id: string;
  name: string;
  tax_id: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  credit_limit: number | string | null;
};

export type ApiUser = {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  phone?: string | null;
  two_factor_enabled?: boolean;
  last_login?: string | null;
};

export type IpWhitelistRule = {
  id: string;
  cidr: string;
  description?: string | null;
  user_id?: string | null;
  role_id?: string | null;
  user_name?: string | null;
  role_name?: string | null;
  created_at?: string | null;
};

export type SessionToken = {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  username: string;
  session_type?: string | null;
  device_info?: string | null;
  ip_address?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
};

export function normalizeApiUser(row: Record<string, unknown>): ApiUser {
  const email = String(row.email || "");
  return {
    id: String(row.id ?? ""),
    username: String(row.username || email.split("@")[0] || "user"),
    full_name: String(row.full_name || ""),
    email,
    role: String(row.role_name || row.role || "User"),
    status: String(row.status || "active"),
    phone: (row.phone as string | null) ?? null,
    two_factor_enabled: Boolean(row.mfa_enabled),
    last_login: row.last_login_at ? String(row.last_login_at) : null,
  };
}

export function normalizeMasterItem(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    item_code: String(row.item_code ?? ""),
    name: String(row.name ?? ""),
    barcode: (row.barcode as string | null) ?? null,
    standard_cost: Number(row.standard_cost ?? 0),
    reorder_point: Number(row.reorder_point ?? 0),
    tax_group_id: (row.tax_group_id as string | null) ?? null,
    lot_tracking_enabled: row.lot_tracking_enabled === true,
    is_stock_item: row.is_stock_item !== false,
    is_active: row.is_active !== false,
    etims_item_classification_code: (row.etims_item_classification_code as string | null) ?? null,
    etims_item_code: (row.etims_item_code as string | null) ?? null,
    etims_item_type_code: (row.etims_item_type_code as string | null) ?? null,
    etims_origin_country_code: (row.etims_origin_country_code as string | null) ?? null,
    etims_packaging_unit_code: (row.etims_packaging_unit_code as string | null) ?? null,
    etims_package_quantity:
      row.etims_package_quantity == null ? null : Number(row.etims_package_quantity),
    etims_quantity_unit_code: (row.etims_quantity_unit_code as string | null) ?? null,
    etims_tax_type_code: (row.etims_tax_type_code as string | null) ?? null,
    etims_sync_status: String(row.etims_sync_status || "unmapped") as
      | "unmapped"
      | "pending"
      | "synced"
      | "failed",
  };
}

export function normalizeMasterWarehouse(row: Record<string, unknown>) {
  return {
    ...row,
    id: String(row.id ?? ""),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    address: String(row.address_line1 ?? row.address ?? ""),
    city: (row.city as string | null) ?? null,
    manager: (row.manager_name as string | null) ?? (row.manager as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    is_active: row.is_active !== false,
  };
}

export function normalizeMasterCustomer(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    kra_pin: String(row.tax_id || row.kra_pin || ""),
    contact: (row.contact_name as string | null) || (row.phone as string | null) || null,
    email: (row.email as string | null) || null,
    address: (row.address_line1 as string | null) || null,
    location: (row.city as string | null) || null,
    type: (row.customer_type as string | null) || null,
    segment: (row.customer_type as string | null) || null,
    credit_limit: Number(row.credit_limit || 0),
    payment_terms: (row.payment_terms as string | null) || null,
    balance: 0,
  };
}

export function getStoredTokens() {
  return {
    access: accessToken,
    refresh: null,
  };
}

export function storeTokens(access: string) {
  accessToken = access;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(LEGACY_ACCESS_KEY);
}

export function clearTokens() {
  accessToken = null;
  csrfTokenInMemory = null;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(LEGACY_ACCESS_KEY);
}

function readCsrfToken() {
  if (csrfTokenInMemory) return csrfTokenInMemory;
  if (typeof document === "undefined") return "";
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE}=`));
  if (!cookie) return "";
  try {
    csrfTokenInMemory = decodeURIComponent(cookie.slice(CSRF_COOKIE.length + 1));
    return csrfTokenInMemory;
  } catch {
    return "";
  }
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
  return Boolean(token);
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
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    let csrfToken = readCsrfToken();
    if (!csrfToken) {
      const bootstrap = await fetch(buildUrl("/auth/csrf"), { credentials: "include" });
      if (!bootstrap.ok) return null;
      const result = (await bootstrap.json()) as { csrf_token?: string };
      csrfToken = result.csrf_token || "";
      csrfTokenInMemory = csrfToken || null;
      if (!csrfToken) return null;
    }
    const response = await fetch(buildUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": csrfToken },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { access_token: string; csrf_token?: string };
    if (data.csrf_token) csrfTokenInMemory = data.csrf_token;
    storeTokens(data.access_token);
    notifyTokenRefreshed(data.access_token);
    return data.access_token;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
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
  if (typeof token === "string" && token) return token;

  if (typeof token === "undefined") {
    const stored = getStoredTokens().access;
    if (stored) return stored;
    return null;
  }

  const stored = getStoredTokens().access;
  if (stored) return stored;
  return null;
}

export async function apiV1Fetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  let access = resolveApiToken(token);

  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");

  const request = (bearer: string | null) => {
    const h = new Headers(headers);
    if (bearer) h.set("Authorization", `Bearer ${bearer}`);
    if (path === "/auth/logout") {
      const csrfToken = readCsrfToken();
      if (csrfToken) h.set("X-CSRF-Token", csrfToken);
    }
    return fetch(buildUrl(path), { ...init, credentials: init.credentials ?? "include", headers: h });
  };

  let response = await request(access);
  const isAuthEndpoint = path === "/auth/login" || path === "/auth/refresh";

  if (response.status === 401 && !isAuthEndpoint) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      access = refreshed;
      response = await request(refreshed);
    }
  }

  if (response.status === 401 && !isAuthEndpoint) {
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
  const access = resolveApiToken(token);
  const headers = new Headers(init.headers);
  const request = (bearer: string | null) => {
    const h = new Headers(headers);
    if (bearer) h.set("Authorization", `Bearer ${bearer}`);
    return fetch(buildUrl(path), { ...init, credentials: init.credentials ?? "include", headers: h });
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
    csrf_token?: string;
    user: ErpUser & { role_name?: string };
  }>(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email, password, mfa_token: mfaToken }),
    },
    null,
  );

  storeTokens(data.access_token);
  csrfTokenInMemory = data.csrf_token || null;
  const user: ErpUser = {
    id: data.user.id,
    username: data.user.username,
    full_name: data.user.full_name,
    email: data.user.email,
    role: data.user.role_name || data.user.role || "Admin",
    permissions: data.user.permissions,
    mfa_enabled: data.user.mfa_enabled,
  };
  return { token: data.access_token, user };
}

export function v1RestoreSession() {
  return refreshAccessToken();
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
    mfa_enabled: user.mfa_enabled,
  } satisfies ErpUser;
}

export async function v1Logout() {
  try {
    await apiV1Fetch("/auth/logout", { method: "POST" });
  } finally {
    clearTokens();
  }
}

export const v1Api = {
  auth: {
    setupMfa: (token: string, password: string, current_totp?: string) =>
      apiV1Fetch<{ secret: string; otpauth_url: string }>("/auth/mfa/setup", {
        method: "POST",
        body: JSON.stringify({ password, current_totp }),
      }, token),
    verifyMfa: (token: string, otp: string) =>
      apiV1Fetch<{ ok: boolean; mfa_enabled: boolean; recovery_codes: string[] }>(
        "/auth/mfa/verify",
        { method: "POST", body: JSON.stringify({ token: otp }) },
        token,
      ),
  },
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
    customers: (token: string, q = "", signal?: AbortSignal) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>(
        `/master/customers?q=${encodeURIComponent(q)}&limit=200`,
        { signal },
        token,
      ).then((r) => r.data),
    createCustomer: (
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
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        "/master/customers",
        {
          method: "POST",
          body: JSON.stringify({
            customer_code: payload.kra_pin || `C-${Date.now()}`,
            name: payload.name,
            tax_id: payload.kra_pin,
            email: payload.email,
            phone: payload.contact,
            address_line1: payload.address,
            city: payload.location,
            customer_type: payload.segment || payload.type,
            credit_limit: payload.credit_limit,
          }),
        },
        token,
      ).then(normalizeMasterCustomer),
    updateCustomer: (
      token: string,
      id: string | number,
      payload: Partial<{
        name: string;
        kra_pin: string;
        contact: string;
        email: string;
        credit_limit: number;
      }>,
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/master/customers/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: payload.name,
            tax_id: payload.kra_pin,
            email: payload.email,
            phone: payload.contact,
            credit_limit: payload.credit_limit,
          }),
        },
        token,
      ).then(normalizeMasterCustomer),
    deleteCustomer: (token: string, id: string | number) =>
      apiV1Fetch<void>(`/master/customers/${id}`, { method: "DELETE" }, token),
    vendors: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{ data: MasterVendor[] }>("/master/vendors?limit=200", { signal }, token).then(
        (r) => r.data,
      ),
    items: (token: string, limit = 200, signal?: AbortSignal, q = "") =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>(
        `/master/items?limit=${limit}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
        { signal },
        token,
      ).then(
        (r) => r.data,
      ),
    warehouses: (token: string) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>(
        "/master/warehouses?limit=200",
        {},
        token,
      ).then((r) => r.data),
    chartOfAccounts: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/master/chart-of-accounts", {}, token),
  },
  users: {
    list: (token: string, q = "", signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/users?q=${encodeURIComponent(q)}`,
        { signal },
        token,
      ),
    create: (
      token: string,
      payload: {
        username: string;
        full_name: string;
        email: string;
        role_id?: string;
        phone?: string;
        password: string;
        role: string;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        "/users",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ).then((row) => normalizeApiUser({ ...row, role_name: row.role_name || payload.role })),
    update: (
      token: string,
      id: string | number,
      payload: { status?: string; role_id?: string; full_name?: string; phone?: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/users/${id}`,
        { method: "PATCH", body: JSON.stringify(payload) },
        token,
      ).then(normalizeApiUser),
    listIpWhitelist: (token: string) =>
      apiV1Fetch<IpWhitelistRule[]>("/users/security/ip-whitelist", {}, token),
    createIpWhitelist: (
      token: string,
      payload: { cidr: string; description?: string; role_id?: string; user_id?: string },
    ) =>
      apiV1Fetch<IpWhitelistRule>(
        "/users/security/ip-whitelist",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    deleteIpWhitelist: (token: string, id: string) =>
      apiV1Fetch<void>(`/users/security/ip-whitelist/${id}`, { method: "DELETE" }, token),
    listSessions: (token: string) =>
      apiV1Fetch<SessionToken[]>("/users/security/sessions", {}, token),
    revokeSession: (token: string, id: string) =>
      apiV1Fetch<{ ok: true }>(`/users/security/sessions/${id}/revoke`, { method: "POST" }, token),
  },
  roles: {
    list: (token: string) =>
      apiV1Fetch<RoleDefinition[]>("/roles", {}, token).then((rows) =>
        rows.map((row) => ({
          ...row,
          permissions: Array.isArray(row.permissions) ? row.permissions.map(String) : [],
        })),
      ),
    permissions: (token: string) =>
      apiV1Fetch<RolePermission[]>("/roles/permissions", {}, token),
    create: (token: string, payload: { name: string; description?: string; permission_codes?: string[] }) =>
      apiV1Fetch<Record<string, unknown>>("/roles", {
        method: "POST",
        body: JSON.stringify(payload),
      }, token),
    updatePermissions: (token: string, roleId: string, permission_codes: string[]) =>
      apiV1Fetch<{ ok: boolean }>(`/roles/${roleId}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ permission_codes }),
      }, token),
  },
  audit: {
    list: (token: string, q = "", limit = 100, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/audit?q=${encodeURIComponent(q)}&limit=${limit}`,
        { signal },
        token,
      ),
  },
  inventory: {
    lots: (token: string, includeExpired = true) =>
      apiV1Fetch<BackendInventoryLotRecord[]>(
        `/inventory/lots?include_expired=${includeExpired}`,
        {},
        token,
      ),
    lotEvents: (token: string, lotId: string) =>
      apiV1Fetch<Array<{
        id: string;
        event_type: string;
        quantity: number;
        reason: string;
        created_at: string;
        created_by_name?: string;
      }>>(`/inventory/lots/${lotId}/events`, {}, token),
    reconcileOpeningLots: (
      token: string,
      body: {
        warehouse_id: string;
        item_id: string;
        notes: string;
        lines: Array<{ batch_no: string; expiry_date: string; quantity: number; unit_cost: number }>;
      },
    ) =>
      apiV1Fetch<{ id: string; stock_quantity: number; lot_count: number }>(
        "/inventory/lots/opening-reconciliation",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    setLotQuarantine: (
      token: string,
      lotId: string,
      action: "quarantine" | "release",
      quantity: number,
      reason: string,
    ) =>
      apiV1Fetch<{ event_type: string; quantity: number; available_quantity: number; quarantined_quantity: number }>(
        `/inventory/lots/${lotId}/${action}`,
        { method: "POST", body: JSON.stringify({ quantity, reason }) },
        token,
      ),
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
    movements: (token: string, limit = 100, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(`/inventory/movements?limit=${limit}`, { signal }, token),
    reorderAlerts: (token: string, limit = 50, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(`/inventory/reorder-alerts?limit=${limit}`, { signal }, token),
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
    purchaseOrder: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(
        `/procurement/purchase-orders/${id}`,
        {},
        token,
      ),
    approvePurchaseOrder: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/procurement/purchase-orders/${id}/approve`,
        { method: "POST" },
        token,
      ),
    goodsReceipts: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/procurement/goods-receipts", { signal }, token),
    goodsReceipt: (token: string, receiptId: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(
        `/procurement/goods-receipts/${receiptId}`,
        {},
        token,
      ),
    receivePurchaseOrder: async (token: string, purchaseOrderId: string) => {
      const purchaseOrder = await v1Api.procurement.purchaseOrder(token, purchaseOrderId);
      const lines = (purchaseOrder.lines || [])
        .map((line) => ({
          po_line_id: String(line.id),
          item_id: String(line.item_id),
          quantity: Number(line.quantity || 0) - Number(line.qty_received || 0),
          unit_cost: Number(line.unit_cost || 0),
        }))
        .filter((line) => line.quantity > 0);
      if (!lines.length) throw new Error("This purchase order has no outstanding quantities to receive.");
      return apiV1Fetch<Record<string, unknown>>(
        "/procurement/goods-receipts",
        {
          method: "POST",
          body: JSON.stringify({
            purchase_order_id: purchaseOrderId,
            warehouse_id: purchaseOrder.warehouse_id,
            lines,
          }),
        },
        token,
      );
    },
    supplierBills: (token: string) =>
      apiV1Fetch<SupplierBillRecord[]>("/procurement/supplier-bills", {}, token),
    createSupplierBill: (token: string, payload: Record<string, unknown>) =>
      apiV1Fetch<SupplierBillRecord>(
        "/procurement/supplier-bills",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    postSupplierBill: (token: string, billId: string) =>
      apiV1Fetch<{ bill: SupplierBillRecord; journal_id: string }>(
        `/procurement/supplier-bills/${billId}/post`,
        { method: "POST" },
        token,
      ),
    supplierPayments: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/procurement/supplier-payments", {}, token),
    createSupplierPayment: (token: string, payload: Record<string, unknown>) =>
      apiV1Fetch<{ id: string; payment_no: string; amount: number; status: string }>(
        "/procurement/supplier-payments",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    postSupplierPayment: (token: string, paymentId: string) =>
      apiV1Fetch<{ ok: boolean; journal_id: string }>(
        `/procurement/supplier-payments/${paymentId}/post`,
        { method: "POST" },
        token,
      ),
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
    deliveries: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<{
        id: string;
        delivery_no: string;
        order_no?: string;
        delivery_date?: string;
        status?: string;
        driver_name?: string | null;
        vehicle_no?: string | null;
        route?: string | null;
      }>>("/sales/deliveries", { signal }, token),
    routeDrivers: (token: string) =>
      apiV1Fetch<Array<{ id: string; full_name: string; email: string }>>(
        "/inventory/fleet/drivers",
        {},
        token,
      ),
    routeClosures: (token: string, filters: { status?: string; route_date?: string } = {}) => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.route_date) params.set("route_date", filters.route_date);
      const query = params.size ? `?${params.toString()}` : "";
      return apiV1Fetch<RouteClosureRecord[]>(`/sales/routes/closures${query}`, {}, token);
    },
    submitRouteClosure: (
      token: string,
      body: {
        route_code: string;
        route_date: string;
        driver_user_id: string;
        declared_collection: number;
        note?: string;
      },
    ) =>
      apiV1Fetch<RouteClosureRecord>(
        "/sales/routes/closures",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        token,
      ),
    reviewRouteClosure: (token: string, id: string, decision: "approve" | "reject", note = "") =>
      apiV1Fetch<RouteClosureRecord>(
        `/sales/routes/closures/${id}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ decision, note }),
        },
        token,
      ),
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
        required_date: string;
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
    confirmOrder: (token: string, orderId: string) =>
      apiV1Fetch<{
        ok: boolean;
        reason?: "atp_failed" | "credit_limit_exceeded";
        shortages?: Array<{ item_id: string; requested: number; available: number }>;
      }>(`/sales/orders/${orderId}/confirm`, { method: "POST" }, token),
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
    invoices: (token: string, limit = 25, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(`/sales/invoices?limit=${limit}`, { signal }, token),
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
    attendance: (token: string, from?: string, to?: string) => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return apiV1Fetch<Record<string, unknown>[]>(
        `/hr/attendance${params.size ? `?${params.toString()}` : ""}`,
        {},
        token,
      );
    },
    leaveApplications: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/leave-applications", { signal }, token),
    payrollRuns: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/payroll/runs", { signal }, token),
    createPayrollRun: (token: string, payrollMonth: string) =>
      apiV1Fetch<Record<string, unknown>>(
        "/payroll/runs",
        { method: "POST", body: JSON.stringify({ payroll_month: payrollMonth }) },
        token,
      ),
    approvePayrollRun: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>>(`/payroll/runs/${runId}/approve`, { method: "POST" }, token),
    lockPayrollRun: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>>(`/payroll/runs/${runId}/lock`, { method: "POST" }, token),
    postPayrollRun: (token: string, runId: string) =>
      apiV1Fetch<{ ok: boolean }>(`/payroll/runs/${runId}/post`, { method: "POST" }, token),
    releasePayrollRun: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>>(`/payroll/runs/${runId}/release`, { method: "POST" }, token),
    payrollPaymentFile: (token: string, runId: string) =>
      apiV1FetchBlob(`/payroll/runs/${runId}/payment-file.csv`, {}, token),
    payslips: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>[]>(`/payroll/runs/${runId}/payslips`, {}, token),
    statutoryReport: (token: string, runId: string) =>
      apiV1Fetch<Record<string, number>>(`/payroll/runs/${runId}/statutory-report`, {}, token),
    statutoryRemittances: (token: string, runId?: string) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/payroll/statutory-remittances${runId ? `?payroll_run_id=${encodeURIComponent(runId)}` : ""}`,
        {},
        token,
      ),
    postStatutoryPayment: (token: string, paymentId: string) =>
      apiV1Fetch<Record<string, unknown>>(`/payroll/statutory-remittance-payments/${paymentId}/post`, { method: "POST" }, token),
  },
  reports: {
    dashboardSummary: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{
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
        recentTransactions: Array<{
          id: string;
          date: string;
          customer: string;
          rep: string;
          total: number;
          status: string;
        }>;
      }>('/reports/dashboard/summary', { signal }, token),
    dashboard: (token: string, code: string) =>
      apiV1Fetch<{ widgets: Array<{ widget: string; value: number | null }> }>(
        `/reports/dashboards/${code}`,
        {},
        token,
      ),
    kpis: (token: string) => apiV1Fetch<Array<Record<string, unknown>>>('/reports/kpis', {}, token),
    library: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/reports/library", {}, token),
    run: (token: string, code: string) =>
      apiV1Fetch<{ rows: Record<string, unknown>[] }>(`/reports/run/${code}`, {}, token),
  },
  tax: {
    returns: (token: string) => apiV1Fetch<Array<Record<string, unknown>>>("/tax/returns", {}, token),
    prepareReturn: (token: string, periodId: string) =>
      apiV1Fetch<Record<string, unknown>>(
        "/tax/returns/prepare",
        { method: "POST", body: JSON.stringify({ period_id: periodId }) },
        token,
      ),
    approveReturn: (token: string, id: string, varianceExplanation?: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/tax/returns/${encodeURIComponent(id)}/approve`,
        { method: "POST", body: JSON.stringify({ variance_explanation: varianceExplanation || null }) },
        token,
      ),
    lockReturn: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/tax/returns/${encodeURIComponent(id)}/lock`,
        { method: "POST" },
        token,
      ),
    reopenReturn: (token: string, id: string, reason: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/tax/returns/${encodeURIComponent(id)}/reopen`,
        { method: "POST", body: JSON.stringify({ reason }) },
        token,
      ),
  },
  platform: {
    integrationExceptions: (token: string, limit = 100, signal?: AbortSignal) =>
      apiV1Fetch<{ exceptions: Array<{
        id: string;
        type: string;
        source_id: string;
        reference: string | null;
        status: string;
        attempt_count: number;
        age_seconds: number;
        last_error: string | null;
        manually_retryable: boolean;
      }> }>(`/platform/integrations/exceptions?limit=${limit}`, { signal }, token)
        .then((result) => result.exceptions || []),
    retryEtimsEvent: (token: string, id: string) =>
      apiV1Fetch<{ ok: boolean; event_id: string; status: string }>(
        `/platform/integrations/etims/events/${encodeURIComponent(id)}/retry`,
        { method: "POST", body: "{}" },
        token,
      ),
    retryEtimsInvoice: (token: string, id: string) =>
      apiV1Fetch<{ ok: boolean; invoice_id: string; status: string }>(
        `/platform/integrations/etims/invoices/${encodeURIComponent(id)}/retry`,
        { method: "POST", body: "{}" },
        token,
      ),
  },
  integrations: {
    providerSettings: (token: string, provider: string, environment?: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/platform/integrations/${provider}/settings${environment ? `?environment=${encodeURIComponent(environment)}` : ""}`,
        {},
        token,
      ),
    saveProviderSettings: (
      token: string,
      provider: string,
      payload: Record<string, unknown>,
    ) => apiV1Fetch<Record<string, unknown>>(
      `/platform/integrations/${provider}/settings`,
      { method: "PUT", body: JSON.stringify(payload) },
      token,
    ),
    initializeEtims: (token: string, body: Record<string, unknown> = {}) =>
      apiV1Fetch<Record<string, unknown>>("/platform/integrations/etims/initialize", {
        method: "POST",
        body: JSON.stringify(body),
      }, token),
    testEtimsConnection: (token: string, body: Record<string, unknown> = {}) =>
      apiV1Fetch<Record<string, unknown>>("/platform/integrations/etims/test-connection", {
        method: "POST",
        body: JSON.stringify(body),
      }, token),
    refreshEtimsReferenceData: (token: string, body: Record<string, unknown> = {}) =>
      apiV1Fetch<Record<string, unknown>>("/platform/integrations/etims/reference-data/refresh", {
        method: "POST",
        body: JSON.stringify(body),
      }, token),
    etimsReferenceStatus: (token: string) =>
      apiV1Fetch<{ lists: Record<string, unknown>[] }>("/platform/integrations/etims/reference-data/status", {}, token),
    rotateMpesaCallbackToken: (token: string, body: Record<string, unknown> = {}) =>
      apiV1Fetch<Record<string, unknown>>("/platform/integrations/mpesa/rotate-callback-token", {
        method: "POST",
        body: JSON.stringify(body),
      }, token),
    createMpesaStkRequest: (
      token: string,
      invoiceId: string,
      body: { phone: string; amount: number; idempotency_key: string },
    ) =>
      apiV1Fetch<MpesaPaymentRequest>(
        `/platform/integrations/mpesa/invoices/${invoiceId}/stk-push`,
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    mpesaPaymentRequest: (token: string, requestId: string) =>
      apiV1Fetch<MpesaPaymentRequest>(`/platform/integrations/mpesa/requests/${requestId}`, {}, token),
    notificationTemplates: (token: string) =>
      apiV1Fetch<{ templates: Array<Record<string, unknown>> }>("/platform/notifications/templates", {}, token),
    saveNotificationTemplate: (token: string, code: string, payload: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/platform/notifications/templates/${encodeURIComponent(code)}`,
        { method: "PUT", body: JSON.stringify(payload) },
        token,
      ),
    sendNotification: (
      token: string,
      body: { channel: "email" | "sms"; to: string; subject?: string; body: string; idempotency_key: string },
    ) =>
      apiV1Fetch<OutboundNotification>(
        "/platform/notifications/send",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    notification: (token: string, id: string) =>
      apiV1Fetch<OutboundNotification>(`/platform/notifications/${id}`, {}, token),
  },
  finance: {
    bankAccounts: (token: string) =>
      apiV1Fetch<BankAccountRecord[]>("/finance/bank-accounts", {}, token),
    bankReconciliations: (token: string) =>
      apiV1Fetch<BankReconciliationRecord[]>("/finance/bank-reconciliations", {}, token),
    createBankReconciliation: (
      token: string,
      payload: {
        bank_account_id: string;
        statement_reference: string;
        statement_start: string;
        statement_end: string;
        opening_balance: number;
        closing_balance: number;
        lines: Array<{
          transaction_date: string;
          reference?: string;
          description: string;
          debit: number;
          credit: number;
        }>;
      },
    ) =>
      apiV1Fetch<BankReconciliationRecord>(
        "/finance/bank-reconciliations",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    bankReconciliation: (token: string, id: string) =>
      apiV1Fetch<BankReconciliationRecord>(`/finance/bank-reconciliations/${id}`, {}, token),
    bankCandidates: (token: string, id: string) =>
      apiV1Fetch<BankLedgerCandidateRecord[]>(
        `/finance/bank-reconciliations/${id}/candidates`,
        {},
        token,
      ),
    matchBankStatementLine: (
      token: string,
      id: string,
      lineId: string,
      journalLineId: string,
    ) =>
      apiV1Fetch<{ ok: boolean }>(
        `/finance/bank-reconciliations/${id}/lines/${lineId}/match`,
        { method: "POST", body: JSON.stringify({ journal_line_id: journalLineId }) },
        token,
      ),
    completeBankReconciliation: (token: string, id: string) =>
      apiV1Fetch<BankReconciliationRecord>(
        `/finance/bank-reconciliations/${id}/complete`,
        { method: "POST" },
        token,
      ),
    createFiscalYear: (token: string, body: { year_label: string; start_date: string; end_date: string }) =>
      apiV1Fetch<Record<string, unknown> & { periods: Record<string, unknown>[] }>(
        "/finance/fiscal-years",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    fiscalPeriodCloseChecklist: (token: string, periodId: string) =>
      apiV1Fetch<FinancePeriodCloseChecklist>(
        `/finance/fiscal-periods/${periodId}/close-checklist`,
        {},
        token,
      ),
    closeFiscalPeriod: (token: string, periodId: string, reason: string) =>
      apiV1Fetch<{ period: Record<string, unknown>; checklist: FinancePeriodCloseChecklist }>(
        `/finance/fiscal-periods/${periodId}/close`,
        { method: "POST", body: JSON.stringify({ reason }) },
        token,
      ),
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
    balanceSheet: (token: string, periodId: string) =>
      apiV1Fetch<FinanceReportLine[]>(
        `/finance/reports/balance-sheet?fiscal_period_id=${encodeURIComponent(periodId)}`,
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

export type MpesaPaymentRequest = {
  id: string;
  invoice_id: string;
  invoice_no?: string;
  idempotency_key?: string;
  phone_number: string;
  amount: number | string;
  status: string;
  checkout_request_id?: string | null;
  provider_receipt_no?: string | null;
  receipt_id?: string | null;
  configured?: boolean;
  message?: string;
  attempt_count?: number;
  last_error?: string | null;
};

export type OutboundNotification = {
  id: string;
  channel: "email" | "sms";
  status: "pending" | "processing" | "sent" | "retry" | "failed";
  queued?: boolean;
  delivered?: boolean;
  configured?: boolean;
  message?: string;
  provider_message_id?: string | null;
  attempt_count?: number;
  last_error?: string | null;
};

export type FinancePeriodCloseChecklist = {
  period_id: string;
  period_name: string;
  start_date: string;
  end_date: string;
  status: string;
  ready_to_close: boolean;
  blockers: Array<{ code: string; label: string; count: number; amount?: number }>;
  checks: Array<{ code: string; label: string; count: number; amount?: number; blocked: boolean }>;
};

export type SupplierBillRecord = {
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

export type BankAccountRecord = {
  id: string;
  account_code: string;
  account_name: string;
  currency_code: string;
};

export type BankStatementLineRecord = {
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

export type BankLedgerCandidateRecord = {
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

export type BankReconciliationRecord = {
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
  lines?: BankStatementLineRecord[];
  outstanding_book_lines?: BankLedgerCandidateRecord[];
};

export type AccountingJournalRow = { d: string; a: string; desc: string; db: number; cr: number };
export type AccountingSnapshot = {
  journalRows: AccountingJournalRow[];
  pnl: Array<{ month: string; revenue: number; expenses: number }>;
};

export async function fetchFinanceWorkspaceV1(
  token: string,
  periodId?: string,
): Promise<FinanceWorkspace> {
  const rawPeriods = await v1Api.finance.fiscalPeriods(token);
  const periods: FinancePeriod[] = rawPeriods.map((row) => ({
    id: String(row.id),
    name: String(row.name || row.code || row.id),
    code: row.code ? String(row.code) : undefined,
    status: String(row.status || "open"),
    start_date: row.start_date ? String(row.start_date).slice(0, 10) : undefined,
    end_date: row.end_date ? String(row.end_date).slice(0, 10) : undefined,
  }));
  const today = new Date().toISOString().slice(0, 10);
  const current = periods.find((period) =>
    period.status === "open" && period.start_date && period.end_date &&
    period.start_date <= today && period.end_date >= today,
  );
  const selected = periodId || current?.id || periods.find((period) => period.status === "open")?.id || periods[0]?.id;
  if (!selected) {
    return {
      periods,
      trialBalance: { lines: [], totals: { period_debit: 0, period_credit: 0 } },
      balanceSheet: [],
      profitLoss: { lines: [], net_profit: 0 },
    };
  }
  const [trialBalance, balanceSheet, profitLoss] = await Promise.all([
    v1Api.finance.trialBalance(token, selected),
    v1Api.finance.balanceSheet(token, selected),
    v1Api.finance.profitLoss(token, selected),
  ]);
  return { periods, trialBalance, balanceSheet, profitLoss };
}

export async function fetchAccountingSnapshotV1(token: string): Promise<AccountingSnapshot> {
  const workspace = await fetchFinanceWorkspaceV1(token);
  const period = workspace.periods.find((row) => row.status === "open") || workspace.periods[0];
  if (!period) return { journalRows: [], pnl: [] };
  const journals = await v1Api.finance.journals(token);
  const latest = journals[0];
  const journal = latest?.id ? await v1Api.finance.journal(token, String(latest.id)) : null;
  const journalRows = (journal?.lines || []).map((line) => ({
    d: String(journal?.entry_date || "").slice(0, 10),
    a: `${String(line.account_code || "")} — ${String(line.account_name || "")}`,
    desc: String(line.description || journal?.description || journal?.journal_no || ""),
    db: Number(line.debit || 0),
    cr: Number(line.credit || 0),
  }));
  const income = workspace.profitLoss.lines
    .filter((line) => line.account_type === "income")
    .reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const expenses = workspace.profitLoss.lines
    .filter((line) => line.account_type === "expense")
    .reduce((sum, line) => sum + Math.abs(Number(line.amount || 0)), 0);
  return {
    journalRows,
    pnl: [{ month: period.name || period.code || "Current", revenue: income, expenses }],
  };
}

export type RouteClosureRecord = {
  id: string;
  route_code: string;
  route_date: string;
  driver_user_id: string;
  driver_name?: string | null;
  status: "submitted" | "approved" | "rejected";
  delivery_count: number;
  proof_pending_count: number;
  discrepancy_count: number;
  invoice_value: string | number;
  matched_collection: string | number;
  declared_collection: string | number;
  collection_variance: string | number;
  close_note?: string | null;
  review_note?: string | null;
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

export type BackendInventoryLotRecord = {
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

export type RolePermission = {
  id: string;
  code: string;
  module: string;
  action: string;
  description?: string | null;
};

export type RoleDefinition = {
  id: string;
  name: string;
  description?: string | null;
  permissions?: string[];
};

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
