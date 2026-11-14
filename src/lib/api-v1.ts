const configuredApiBase = import.meta.env.VITE_API_BASE?.trim();
if (import.meta.env.PROD && !configuredApiBase) {
  throw new Error("VITE_API_BASE must be configured for production.");
}
const apiBase = configuredApiBase ? configuredApiBase.replace(/\/+$/, "") : "";
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
  tax_residency?: "resident" | "non_resident" | null;
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
      "unmapped" | "pending" | "synced" | "failed",
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
}

export function clearTokens() {
  accessToken = null;
  csrfTokenInMemory = null;
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

function buildUrl(path: string) {
  return `${apiBase}/api/v1${path}`;
}

function addIdempotencyKey(method: string | undefined, headers: Headers) {
  if (method?.toUpperCase() === "POST" && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", globalThis.crypto.randomUUID());
  }
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
  addIdempotencyKey(init.method, headers);

  const request = (bearer: string | null) => {
    const h = new Headers(headers);
    if (bearer) h.set("Authorization", `Bearer ${bearer}`);
    if (path === "/auth/logout") {
      const csrfToken = readCsrfToken();
      if (csrfToken) h.set("X-CSRF-Token", csrfToken);
    }
    return fetch(buildUrl(path), {
      ...init,
      credentials: init.credentials ?? "include",
      headers: h,
    });
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
  addIdempotencyKey(init.method, headers);
  const request = (bearer: string | null) => {
    const h = new Headers(headers);
    if (bearer) h.set("Authorization", `Bearer ${bearer}`);
    return fetch(buildUrl(path), {
      ...init,
      credentials: init.credentials ?? "include",
      headers: h,
    });
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

export type WithholdingCategoryRecord = {
  id: string;
  code: string;
  name: string;
  residency: "resident" | "non_resident";
  rate: number;
  taxable_basis: "net_before_vat" | "gross_including_vat";
  effective_from: string;
  effective_to: string | null;
  remittance_working_days: number;
  status: "draft" | "approved" | "disabled";
  liability_account_code: string;
  approved_by?: string | null;
};

export type WithholdingObligationRecord = {
  id: string;
  bill_id: string;
  payment_id: string;
  taxable_base: number;
  rate: number;
  amount: number;
  due_date: string;
  status: "outstanding" | "remitted";
  certificate_no: string | null;
  vendor_code: string;
  vendor_name: string;
  category_code: string;
  category_name: string;
};

export type FxRevaluationRunRecord = {
  id: string;
  fiscal_period_id: string;
  period_name: string;
  currency_code: string;
  closing_rate: number;
  total_gain: number;
  total_loss: number;
  journal_id: string | null;
  reversal_journal_id: string | null;
  status: string;
  account_count: number;
};

export const v1Api = {
  auth: {
    setupMfa: (token: string, password: string, current_totp?: string) =>
      apiV1Fetch<{ secret: string; otpauth_url: string }>(
        "/auth/mfa/setup",
        {
          method: "POST",
          body: JSON.stringify({ password, current_totp }),
        },
        token,
      ),
    verifyMfa: (token: string, otp: string) =>
      apiV1Fetch<{ ok: boolean; mfa_enabled: boolean; recovery_codes: string[] }>(
        "/auth/mfa/verify",
        { method: "POST", body: JSON.stringify({ token: otp }) },
        token,
      ),
  },
  master: {
    taxGroups: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>(
        "/master/tax-groups?limit=200",
        { signal },
        token,
      ).then((result) => result.data),
    taxRates: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>("/master/tax-rates", { signal }, token).then(
        (result) => result.data,
      ),
    createTaxRateVersion: (
      token: string,
      body: {
        code: string;
        name: string;
        rate: number;
        tax_type: string;
        basis: string;
        effective_from: string;
        effective_to?: string;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        "/master/tax-rates",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        },
        token,
      ),
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
    updateItem: (token: string, id: string, payload: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/master/items/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
        token,
      ),
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
      ).then((r) => r.data),
    warehouses: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>(
        "/master/warehouses?limit=200",
        { signal },
        token,
      ).then((r) => r.data),
    chartOfAccounts: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/master/chart-of-accounts", { signal }, token),
  },
  users: {
    list: (token: string, q = "", signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(`/users?q=${encodeURIComponent(q)}`, { signal }, token),
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
    listIpWhitelist: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<IpWhitelistRule[]>("/users/security/ip-whitelist", { signal }, token),
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
    listSessions: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<SessionToken[]>("/users/security/sessions", { signal }, token),
    revokeSession: (token: string, id: string) =>
      apiV1Fetch<{ ok: true }>(`/users/security/sessions/${id}/revoke`, { method: "POST" }, token),
  },
  roles: {
    list: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<RoleDefinition[]>("/roles", { signal }, token).then((rows) =>
        rows.map((row) => ({
          ...row,
          permissions: Array.isArray(row.permissions) ? row.permissions.map(String) : [],
        })),
      ),
    permissions: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<RolePermission[]>("/roles/permissions", { signal }, token),
    create: (
      token: string,
      payload: { name: string; description?: string; permission_codes?: string[] },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        "/roles",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token,
      ),
    updatePermissions: (token: string, roleId: string, permission_codes: string[]) =>
      apiV1Fetch<{ ok: boolean }>(
        `/roles/${roleId}/permissions`,
        {
          method: "PUT",
          body: JSON.stringify({ permission_codes }),
        },
        token,
      ),
  },
  audit: {
    list: (token: string, q = "", limit = 100, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/audit?q=${encodeURIComponent(q)}&limit=${limit}`,
        { signal },
        token,
      ),
    entityHistory: (token: string, entityType: string, entityId: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/audit/history/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
        { signal },
        token,
      ),
    hashChain: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/audit/hash-chain", { signal }, token),
    hashChainBlob: (token: string) => apiV1FetchBlob("/audit/hash-chain.csv", {}, token),
  },
  inventory: {
    lots: (token: string, includeExpired = true, signal?: AbortSignal) =>
      apiV1Fetch<BackendInventoryLotRecord[]>(
        `/inventory/lots?include_expired=${includeExpired}`,
        { signal },
        token,
      ),
    lotEvents: (token: string, lotId: string) =>
      apiV1Fetch<
        Array<{
          id: string;
          event_type: string;
          quantity: number;
          reason: string;
          created_at: string;
          created_by_name?: string;
        }>
      >(`/inventory/lots/${lotId}/events`, {}, token),
    reconcileOpeningLots: (
      token: string,
      body: {
        warehouse_id: string;
        item_id: string;
        notes: string;
        lines: Array<{
          batch_no: string;
          expiry_date: string;
          quantity: number;
          unit_cost: number;
        }>;
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
      apiV1Fetch<{
        event_type: string;
        quantity: number;
        available_quantity: number;
        quarantined_quantity: number;
      }>(
        `/inventory/lots/${lotId}/${action}`,
        { method: "POST", body: JSON.stringify({ quantity, reason }) },
        token,
      ),
    stock: (token: string, limit = 50, warehouseId = "", signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/inventory/stock?limit=${limit}${warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : ""}`,
        { signal },
        token,
      ),
    transfers: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/inventory/transfers", { signal }, token),
    transferDetail: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(
        `/inventory/transfers/${id}`,
        {},
        token,
      ),
    quarantine: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/inventory/quarantine", { signal }, token),
    quarantineSetup: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{ vendors: Record<string, unknown>[]; accounts: Record<string, unknown>[] }>(
        "/inventory/quarantine/setup",
        { signal },
        token,
      ),
    dispositions: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        "/inventory/quarantine/dispositions",
        { signal },
        token,
      ),
    createDisposition: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/inventory/quarantine/dispositions",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    postDisposition: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/inventory/quarantine/dispositions/${id}/post`,
        { method: "POST" },
        token,
      ),
    receiveTransfer: (
      token: string,
      id: string,
      body: {
        lines: Array<{
          transfer_line_id: string;
          received_quantity: number;
          damaged_quantity: number;
          complete: boolean;
        }>;
        notes?: string;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/inventory/transfers/${id}/receive`,
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    movements: (token: string, limit = 100, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/inventory/movements?limit=${limit}`,
        { signal },
        token,
      ),
    reorderAlerts: (token: string, limit = 50, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/inventory/reorder-alerts?limit=${limit}`,
        { signal },
        token,
      ),
    reorderSuggestions: (token: string, limit = 200, signal?: AbortSignal) =>
      apiV1Fetch<Array<Record<string, unknown>>>(
        `/inventory/reorder-suggestions?limit=${limit}`,
        { signal },
        token,
      ),
    valuationReconciliation: (token: string, asOfDate: string, signal?: AbortSignal) =>
      apiV1Fetch<{
        as_of: string;
        inventory_account: string;
        stock_value: number;
        gl_value: number;
        variance: number;
        items: Array<{
          item_id: string;
          item_code: string;
          item_name: string;
          on_hand_value: number;
          in_transit_value: number;
          stock_value: number;
        }>;
        unposted_movement_types: Array<{ reference_type: string; reason: string }>;
      }>(
        `/inventory/valuation-reconciliation?as_of=${encodeURIComponent(asOfDate)}`,
        { signal },
        token,
      ),
    analysis: (token: string, days = 30, warehouseId = "", signal?: AbortSignal) =>
      apiV1Fetch<{ days: number; rows: Record<string, unknown>[] }>(
        `/inventory/analysis?days=${days}${warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : ""}`,
        { signal },
        token,
      ),
    materialRequisitions: (token: string, status = "", signal?: AbortSignal) =>
      apiV1Fetch<Array<Record<string, unknown>>>(
        `/inventory/material-requisitions${status ? `?status=${encodeURIComponent(status)}` : ""}`,
        { signal },
        token,
      ),
    materialRequisition: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/material-requisitions/${id}`, {}, token),
    createMaterialRequisition: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/inventory/material-requisitions",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    submitMaterialRequisition: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/inventory/material-requisitions/${id}/submit`,
        { method: "POST" },
        token,
      ),
    reviewMaterialRequisition: (
      token: string,
      id: string,
      decision: "approve" | "reject",
      note = "",
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/inventory/material-requisitions/${id}/review`,
        { method: "POST", body: JSON.stringify({ decision, note }) },
        token,
      ),
    issueMaterialRequisition: (token: string, id: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/inventory/material-requisitions/${id}/issues`,
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    materialIssues: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<Record<string, unknown>>>("/inventory/material-issues", { signal }, token),
    materialIssue: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(`/inventory/material-issues/${id}`, {}, token),
    materialReturns: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<Record<string, unknown>>>("/inventory/material-returns", { signal }, token),
    createMaterialReturn: (token: string, issueId: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/inventory/material-issues/${issueId}/returns`,
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    adjustmentJournals: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<Record<string, unknown>>>(
        "/inventory/adjustment-journals",
        { signal },
        token,
      ),
    createAdjustmentJournal: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/inventory/adjustment-journals",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    postAdjustmentJournal: (token: string, id: string, note = "") =>
      apiV1Fetch<Record<string, unknown>>(
        `/inventory/adjustment-journals/${id}/post`,
        { method: "POST", body: JSON.stringify({ note }) },
        token,
      ),
    cancelAdjustmentJournal: (token: string, id: string, note = "") =>
      apiV1Fetch<Record<string, unknown>>(
        `/inventory/adjustment-journals/${id}/cancel`,
        { method: "POST", body: JSON.stringify({ note }) },
        token,
      ),
    fleetLocations: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<FleetLocation[]>("/inventory/fleet/locations", { signal }, token),
    fleetItems: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<{ id: string; item_code: string; name: string }>>(
        "/inventory/fleet/items",
        { signal },
        token,
      ),
    fleetVehicleStock: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<DriverStockRow[]>("/inventory/fleet/vehicle-stock", { signal }, token),
    fleetDrivers: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<{ id: string; full_name: string; email: string }>>(
        "/inventory/fleet/drivers",
        { signal },
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
    stocktakes: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<FleetStocktake[]>("/inventory/fleet/stocktakes", { signal }, token),
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
    reopenStocktakeForRecount: (token: string, id: string) =>
      apiV1Fetch<FleetStocktake>(
        `/inventory/fleet/stocktakes/${id}/recount`,
        { method: "POST" },
        token,
      ),
    intelligenceFindings: (token: string, status = "open", signal?: AbortSignal) =>
      apiV1Fetch<InventoryFinding[]>(
        `/intelligence/inventory/findings?status=${status}&limit=100`,
        { signal },
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
        observations: {
          title: string;
          detail: string;
          evidence: string[];
          priority: "low" | "medium" | "high";
        }[];
        actions: string[];
        provider: string;
        model: string;
        mode: "rules" | "model";
        note?: string;
        snapshot: {
          asOf: string;
          currency: string;
          sections: { name: string; data: Record<string, number> }[];
        };
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
    purchaseRequisitions: (token: string) =>
      apiV1Fetch<Record<string, unknown>[]>("/procurement/purchase-requisitions", {}, token),
    purchaseRequisition: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(
        `/procurement/purchase-requisitions/${id}`,
        {},
        token,
      ),
    createPurchaseRequisition: (token: string, payload: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/procurement/purchase-requisitions",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    approvePurchaseRequisition: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/procurement/purchase-requisitions/${id}/approve`,
        { method: "POST" },
        token,
      ),
    purchaseOrders: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/procurement/purchase-orders", { signal }, token),
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
    receivePurchaseOrder: async (
      token: string,
      purchaseOrderId: string,
      input: {
        lines: Array<{
          po_line_id: string;
          item_id: string;
          quantity: number;
          unit_cost: number;
          batch_no?: string;
          expiry_date?: string;
        }>;
        received_date?: string;
        notes?: string;
      },
    ) => {
      const purchaseOrder = await v1Api.procurement.purchaseOrder(token, purchaseOrderId);
      if (!input.lines.length)
        throw new Error("Enter a positive quantity for at least one receipt line.");
      return apiV1Fetch<Record<string, unknown>>(
        "/procurement/goods-receipts",
        {
          method: "POST",
          body: JSON.stringify({
            purchase_order_id: purchaseOrderId,
            warehouse_id: purchaseOrder.warehouse_id,
            lines: input.lines,
            received_date: input.received_date,
            notes: input.notes,
          }),
        },
        token,
      );
    },
    supplierBills: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<SupplierBillRecord[]>("/procurement/supplier-bills", { signal }, token),
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
    supplierPayments: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/procurement/supplier-payments", { signal }, token),
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
    supplierReturnCredits: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        "/procurement/supplier-return-credits",
        { signal },
        token,
      ),
    supplierReturnCreditSetup: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{
        claims: Record<string, unknown>[];
        bills: Record<string, unknown>[];
        sourceLines: Record<string, unknown>[];
        accounts: Record<string, unknown>[];
      }>("/procurement/supplier-return-credits/setup", { signal }, token),
    createSupplierReturnCredit: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/procurement/supplier-return-credits",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    postSupplierReturnCredit: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/procurement/supplier-return-credits/${id}/post`,
        { method: "POST" },
        token,
      ),
    cancelSupplierReturnCredit: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/procurement/supplier-return-credits/${id}/cancel`,
        { method: "POST" },
        token,
      ),
  },
  crm: {
    leads: (token: string, filters: { q?: string; status?: string } = {}, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.status) params.set("status", filters.status);
      return apiV1Fetch<{ data: Record<string, unknown>[]; pagination?: Record<string, number> }>(
        `/crm/leads${params.size ? `?${params}` : ""}`,
        { signal },
        token,
      );
    },
    createLead: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/crm/leads",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    updateLead: (token: string, id: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/crm/leads/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(body) },
        token,
      ),
    archiveLead: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/crm/leads/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        token,
      ),
    convertLead: (token: string, id: string, body: Record<string, unknown> = {}) =>
      apiV1Fetch<Record<string, unknown>>(
        `/crm/leads/${encodeURIComponent(id)}/convert`,
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    opportunities: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/crm/opportunities", { signal }, token),
    createOpportunity: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/crm/opportunities",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    updateOpportunity: (token: string, id: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/crm/opportunities/${encodeURIComponent(id)}`,
        { method: "PUT", body: JSON.stringify(body) },
        token,
      ),
    archiveOpportunity: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/crm/opportunities/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        token,
      ),
    activities: (
      token: string,
      filters: { lead_id?: string; opportunity_id?: string; customer_id?: string } = {},
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      return apiV1Fetch<Record<string, unknown>[]>(
        `/crm/activities${params.size ? `?${params}` : ""}`,
        { signal },
        token,
      );
    },
    createActivity: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/crm/activities",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    quotes: (
      token: string,
      filters: { q?: string; status?: string } = {},
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      if (filters.status) params.set("status", filters.status);
      return apiV1Fetch<{ data: Record<string, unknown>[]; pagination?: Record<string, number> }>(
        `/crm/quotes${params.size ? `?${params}` : ""}`,
        { signal },
        token,
      );
    },
    createQuote: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/crm/quotes",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    updateQuote: (token: string, id: string, action: "send" | "accept" | "reject") =>
      apiV1Fetch<Record<string, unknown>>(
        `/crm/quotes/${encodeURIComponent(id)}/${action}`,
        { method: "POST" },
        token,
      ),
    convertQuote: (
      token: string,
      id: string,
      body: { warehouse_id: string; required_date: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/crm/quotes/${encodeURIComponent(id)}/convert-order`,
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    saveSalesTarget: (
      token: string,
      body: {
        sales_rep_id: string;
        period_start: string;
        period_end: string;
        target_amount: number;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        "/crm/sales-targets",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    createCommissionPlan: (
      token: string,
      body: {
        code: string;
        name: string;
        rate_percent: number;
        effective_from: string;
        effective_to?: string;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        "/crm/commission-plans",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    salesRepresentatives: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<{ id: string; username: string; full_name: string | null; email: string }>>(
        "/crm/sales-representatives",
        { signal },
        token,
      ),
  },
  sales: {
    deliveries: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<
        Array<{
          id: string;
          delivery_no: string;
          order_no?: string;
          delivery_date?: string;
          status?: string;
          driver_name?: string | null;
          vehicle_no?: string | null;
          route?: string | null;
        }>
      >("/sales/deliveries", { signal }, token),
    deliveryProof: (token: string, deliveryId: string) =>
      apiV1Fetch<{
        id: string;
        delivery_no: string;
        order_no: string;
        customer_name: string;
        status: string;
        route_code?: string | null;
        proof_status: string;
        customer_confirmed: boolean;
        proof_note?: string | null;
        lines: Array<{
          delivery_line_id: string;
          item_id: string;
          item_name: string;
          quantity: number;
          delivered_quantity: number;
          short_quantity: number;
          damaged_quantity: number;
          customer_accepted_quantity: number;
        }>;
        attachments: Array<{
          id: string;
          file_name: string;
          content_type: string;
          byte_size: number;
          sha256: string;
          created_at: string;
        }>;
      }>(`/sales/deliveries/${deliveryId}/proof`, {}, token),
    recordDeliveryProof: (token: string, deliveryId: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/sales/deliveries/${deliveryId}/proof`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      ),
    uploadDeliveryProofAttachment: (token: string, deliveryId: string, file: File) =>
      apiV1Fetch<Record<string, unknown>>(
        `/sales/deliveries/${deliveryId}/proof/attachments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Content-Type": file.type,
            "X-File-Name": encodeURIComponent(file.name),
          },
          body: file,
        },
        token,
      ),
    downloadDeliveryProofAttachment: (token: string, deliveryId: string, attachmentId: string) =>
      apiV1FetchBlob(
        `/sales/deliveries/${deliveryId}/proof/attachments/${attachmentId}`,
        {},
        token,
      ),
    routeDrivers: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<{ id: string; full_name: string; email: string }>>(
        "/inventory/fleet/drivers",
        { signal },
        token,
      ),
    routeClosures: (
      token: string,
      filters: { status?: string; route_date?: string } = {},
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.route_date) params.set("route_date", filters.route_date);
      const query = params.size ? `?${params.toString()}` : "";
      return apiV1Fetch<RouteClosureRecord[]>(`/sales/routes/closures${query}`, { signal }, token);
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
    customerCreditNoteSetup: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{
        invoices: Record<string, unknown>[];
        notes: Record<string, unknown>[];
        refundAccounts: Record<string, unknown>[];
      }>("/sales/customer-credit-notes/setup", { signal }, token),
    customerReturnOptions: (token: string, invoiceId: string) =>
      apiV1Fetch<{ invoice: Record<string, unknown>; lines: Record<string, unknown>[] }>(
        `/sales/invoices/${invoiceId}/return-options`,
        {},
        token,
      ),
    createCustomerCreditNote: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/sales/customer-credit-notes",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    postCustomerCreditNote: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/sales/customer-credit-notes/${id}/post`,
        { method: "POST" },
        token,
      ),
    cancelCustomerCreditNote: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/sales/customer-credit-notes/${id}/cancel`,
        { method: "POST" },
        token,
      ),
    taxPreview: (
      token: string,
      lines: Array<{
        item_id: string;
        quantity: number;
        unit_price: number;
        tax_group_id?: string;
      }>,
      taxDate?: string,
      signal?: AbortSignal,
    ) =>
      apiV1Fetch<{
        subtotal: number;
        tax_amount: number;
        total_amount: number;
        lines: Record<string, unknown>[];
      }>(
        "/sales/tax-preview",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lines, tax_date: taxDate }),
          signal,
        },
        token,
      ),
    receivablesAging: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{
        as_of: string;
        totals: Record<string, number>;
        rows: Record<string, unknown>[];
      }>("/sales/receivables/aging", { signal }, token),
    collectionActivities: (token: string, status = "open", signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/sales/receivables/collection-activities?status=${encodeURIComponent(status)}`,
        { signal },
        token,
      ),
    createCollectionActivity: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/sales/receivables/collection-activities",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    completeCollectionActivity: (token: string, id: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/sales/receivables/collection-activities/${id}/complete`,
        { method: "POST" },
        token,
      ),
    queueDunningReminders: (token: string, asOfDate?: string) =>
      apiV1Fetch<{
        as_of: string;
        eligible_count: number;
        queued_count: number;
        skipped_count: number;
        failed_count: number;
        reminders: Record<string, unknown>[];
      }>(
        "/sales/receivables/dunning/reminders",
        { method: "POST", body: JSON.stringify({ as_of: asOfDate }) },
        token,
      ),
    createPickList: (token: string, orderId: string) =>
      apiV1Fetch<
        Record<string, unknown> & {
          id: string;
          pick_no: string;
          status: string;
          lines: Record<string, unknown>[];
        }
      >(`/sales/orders/${encodeURIComponent(orderId)}/pick-list`, { method: "POST" }, token),
    confirmPickList: (
      token: string,
      pickListId: string,
      lines: Array<{ pick_list_line_id: string; quantity_picked: number }>,
    ) =>
      apiV1Fetch<
        Record<string, unknown> & {
          id: string;
          pick_no: string;
          status: string;
          lines: Record<string, unknown>[];
        }
      >(
        `/sales/pick-lists/${encodeURIComponent(pickListId)}/confirm`,
        { method: "POST", body: JSON.stringify({ lines }) },
        token,
      ),
    orders: (token: string, limit = 25, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(`/sales/orders?limit=${limit}`, { signal }, token),
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
        `/sales/orders/${orderId}/cancel`,
        { method: "POST" },
        token,
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
        pick_list_id?: string;
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
      apiV1Fetch<{
        ok: boolean;
        invoice_id: string;
        invoice_no: string;
        journal_id: string | null;
      }>(`/sales/invoices/${encodeURIComponent(invoiceNo)}/post`, { method: "POST" }, token),
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
      apiV1Fetch<{
        ok: boolean;
        invoice_id: string;
        invoice_no: string;
        journal_id?: string | null;
        gl_warning?: string | null;
      }>(
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
      apiV1Fetch<{
        ok: boolean;
        payment_no: string;
        status: string;
        amount_paid: number;
        gl_warning?: string | null;
      }>(
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
    analytics: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>>("/sales/analytics/summary", { signal }, token),
  },
  hr: {
    employees: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/employees", { signal }, token),
    branches: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/branches", { signal }, token),
    selfProfile: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>>("/hr/me", { signal }, token),
    selfAttendance: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/me/attendance", { signal }, token),
    selfLeaveTypes: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/me/leave-types", { signal }, token),
    selfLeaveApplications: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/me/leave-applications", { signal }, token),
    selfLeaveBalances: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/me/leave-balances", { signal }, token),
    selfClaims: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/me/claims", { signal }, token),
    submitSelfClaim: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/hr/me/claims",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    selfProfileChangeRequests: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/me/profile-change-requests", { signal }, token),
    submitSelfProfileChangeRequest: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/hr/me/profile-change-requests",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    encashSelfLeaveBalance: (token: string, leaveTypeId: string, days: number) =>
      apiV1Fetch<Record<string, unknown>>(
        "/hr/me/leave-balances/encash",
        {
          method: "POST",
          body: JSON.stringify({ leave_type_id: leaveTypeId, days }),
        },
        token,
      ),
    requestSelfLeave: (
      token: string,
      body: {
        leave_type_id: string;
        start_date: string;
        end_date: string;
        days_requested: number;
        reason: string;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        "/hr/me/leave-applications",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      ),
    selfPayslips: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/me/payslips", { signal }, token),
    employeeOnboarding: (token: string, employeeId: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>>(`/hr/employees/${employeeId}/onboarding`, { signal }, token),
    updateEmployeeOnboarding: (
      token: string,
      employeeId: string,
      body: Record<string, unknown>,
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/hr/employees/${employeeId}/onboarding`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
        token,
      ),
    employeeDocuments: (token: string, employeeId: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(`/hr/employees/${employeeId}/documents`, { signal }, token),
    createEmployeeDocument: (
      token: string,
      employeeId: string,
      body: Record<string, unknown>,
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/hr/employees/${employeeId}/documents`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      ),
    linkEmployeeAccount: (token: string, employeeId: string, email: string) =>
      apiV1Fetch<{ ok: boolean }>(
        `/hr/employees/${employeeId}/link-user`,
        {
          method: "POST",
          body: JSON.stringify({ email }),
        },
        token,
      ),
    lifecycleEvents: (token: string, employeeId: string) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/hr/employees/${employeeId}/lifecycle-events`,
        {},
        token,
      ),
    requestLifecycleEvent: (token: string, employeeId: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/hr/employees/${employeeId}/lifecycle-events`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      ),
    decideLifecycleEvent: (
      token: string,
      eventId: string,
      decision: "approved" | "rejected",
      decisionNote: string,
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/hr/employee-lifecycle-events/${eventId}/decision`,
        {
          method: "POST",
          body: JSON.stringify({ decision, decision_note: decisionNote }),
        },
        token,
      ),
    applyLifecycleEvent: (token: string, eventId: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/hr/employee-lifecycle-events/${eventId}/apply`,
        {
          method: "POST",
        },
        token,
      ),
    attendance: (token: string, from?: string, to?: string, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      return apiV1Fetch<Record<string, unknown>[]>(
        `/hr/attendance${params.size ? `?${params.toString()}` : ""}`,
        { signal },
        token,
      );
    },
    recruitmentRequisitions: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/recruitment/requisitions", { signal }, token),
    recruitmentVacancies: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/recruitment/vacancies", { signal }, token),
    recruitmentCandidates: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/recruitment/candidates", { signal }, token),
    convertCandidate: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/hr/recruitment/convert-candidate",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      ),
    leaveApplications: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/leave-applications", { signal }, token),
    claims: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/claims", { signal }, token),
    createClaim: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/hr/claims",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    decideClaim: (token: string, id: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/hr/claims/${id}/decision`,
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    profileChangeRequests: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/profile-change-requests", { signal }, token),
    createProfileChangeRequest: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/hr/profile-change-requests",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    decideProfileChangeRequest: (token: string, id: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/hr/profile-change-requests/${id}/decision`,
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    leaveTypes: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/leave-types", { signal }, token),
    payrollLeaveRules: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/payroll/leave-rules", { signal }, token),
    savePayrollLeaveRule: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/hr/payroll/leave-rules",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    setPayrollLeaveRuleActive: (token: string, id: string, isActive: boolean) =>
      apiV1Fetch<Record<string, unknown>>(
        `/hr/payroll/leave-rules/${id}/status`,
        { method: "PATCH", body: JSON.stringify({ is_active: isActive }) },
        token,
      ),
    futureEvents: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/future-events", { signal }, token),
    createFutureEvent: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/hr/future-events",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    decideFutureEvent: (token: string, id: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/hr/future-events/${id}/decision`,
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    retentionPolicies: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/hr/retention-policies", { signal }, token),
    saveRetentionPolicy: (token: string, body: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        "/hr/retention-policies",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    setRetentionPolicyStatus: (token: string, id: string, status: "active" | "inactive") =>
      apiV1Fetch<Record<string, unknown>>(
        `/hr/retention-policies/${id}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
        token,
      ),
    payrollRuns: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/payroll/runs", { signal }, token),
    createPayrollRun: (token: string, payrollMonth: string) =>
      apiV1Fetch<Record<string, unknown>>(
        "/payroll/runs",
        { method: "POST", body: JSON.stringify({ payroll_month: payrollMonth }) },
        token,
      ),
    approvePayrollRun: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/payroll/runs/${runId}/approve`,
        { method: "POST" },
        token,
      ),
    lockPayrollRun: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>>(`/payroll/runs/${runId}/lock`, { method: "POST" }, token),
    postPayrollRun: (token: string, runId: string) =>
      apiV1Fetch<{ ok: boolean }>(`/payroll/runs/${runId}/post`, { method: "POST" }, token),
    releasePayrollRun: (token: string, runId: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/payroll/runs/${runId}/release`,
        { method: "POST" },
        token,
      ),
    payrollPaymentFile: (token: string, runId: string) =>
      apiV1FetchBlob(`/payroll/runs/${runId}/payment-file.csv`, {}, token),
    payslips: (token: string, runId: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(`/payroll/runs/${runId}/payslips`, { signal }, token),
    statutoryReport: (token: string, runId: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, number>>(
        `/payroll/runs/${runId}/statutory-report`,
        { signal },
        token,
      ),
    statutoryRemittances: (token: string, runId?: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>(
        `/payroll/statutory-remittances${runId ? `?payroll_run_id=${encodeURIComponent(runId)}` : ""}`,
        { signal },
        token,
      ),
    postStatutoryPayment: (token: string, paymentId: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/payroll/statutory-remittance-payments/${paymentId}/post`,
        { method: "POST" },
        token,
      ),
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
      }>("/reports/dashboard/summary", { signal }, token),
    dashboard: (token: string, code: string) =>
      apiV1Fetch<{ widgets: Array<{ widget: string; value: number | null }> }>(
        `/reports/dashboards/${code}`,
        {},
        token,
      ),
    kpis: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<Record<string, unknown>>>("/reports/kpis", { signal }, token),
    library: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/reports/library", { signal }, token),
    run: (token: string, code: string, signal?: AbortSignal) =>
      apiV1Fetch<{ rows: Record<string, unknown>[] }>(`/reports/run/${code}`, { signal }, token),
    salesPerformance: (
      token: string,
      filters: { period_start: string; period_end: string; sales_rep_id?: string },
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams({
        period_start: filters.period_start,
        period_end: filters.period_end,
      });
      if (filters.sales_rep_id) params.set("sales_rep_id", filters.sales_rep_id);
      return apiV1Fetch<{
        period_start: string;
        period_end: string;
        rows: Record<string, unknown>[];
      }>(`/reports/sales-performance?${params}`, { signal }, token);
    },
  },
  tax: {
    summary: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{
        summary: Array<{ label: string; value: number; tone: string }>;
        obligations: Array<{ type: string; amount: number; status: string; period: string }>;
        deadlines: Array<{ name: string; due: string; status: string }>;
        followUps: Array<{ label: string; value: number; detail: string }>;
        status: string;
      }>("/tax/summary", { signal }, token),
    withholdingCategories: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<WithholdingCategoryRecord[]>("/tax/withholding/categories", { signal }, token),
    createWithholdingCategory: (
      token: string,
      payload: {
        code: string;
        name: string;
        residency: "resident" | "non_resident";
        rate: number;
        taxable_basis: "net_before_vat" | "gross_including_vat";
        effective_from: string;
        effective_to?: string | null;
        remittance_working_days: number;
        liability_account_id: string;
      },
    ) =>
      apiV1Fetch<WithholdingCategoryRecord>(
        "/tax/withholding/categories",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    approveWithholdingCategory: (token: string, id: string) =>
      apiV1Fetch<WithholdingCategoryRecord>(
        `/tax/withholding/categories/${encodeURIComponent(id)}/approve`,
        { method: "POST", body: "{}" },
        token,
      ),
    withholdingObligations: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<WithholdingObligationRecord[]>("/tax/withholding/obligations", { signal }, token),
    remitWithholding: (
      token: string,
      payload: {
        obligation_ids: string[];
        remittance_date: string;
        payment_reference: string;
        bank_account_id: string;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        "/tax/withholding/remittances",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    updateVendorResidency: (
      token: string,
      vendorId: string,
      payload: { tax_residency: "resident" | "non_resident"; evidence_reference: string },
    ) =>
      apiV1Fetch<MasterVendor>(
        `/tax/withholding/vendors/${encodeURIComponent(vendorId)}/residency`,
        { method: "PATCH", body: JSON.stringify(payload) },
        token,
      ),
    returns: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<Record<string, unknown>>>("/tax/returns", { signal }, token),
    prepareReturn: (token: string, periodId: string) =>
      apiV1Fetch<Record<string, unknown>>(
        "/tax/returns/prepare",
        { method: "POST", body: JSON.stringify({ period_id: periodId }) },
        token,
      ),
    approveReturn: (token: string, id: string, varianceExplanation?: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/tax/returns/${encodeURIComponent(id)}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ variance_explanation: varianceExplanation || null }),
        },
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
  expenses: {
    summary: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{
        summary: Array<{ label: string; value: number | string; tone: string }>;
        claims: Array<{
          id: string;
          employee: string;
          category: string;
          amount: number;
          status: string;
          date: string;
          attachment_count: number;
          approval_journal_id: string | null;
          payment_journal_id: string | null;
          decision_note: string | null;
          requested_by: string;
          reviewed_by: string | null;
        }>;
        budgets: Array<{ category: string; allocated: number; used: number; remaining: number }>;
        status: string;
      }>("/expenses/summary", { signal }, token),
    claims: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<
        Array<{ employee: string; category: string; amount: number; status: string; date: string }>
      >("/expenses/claims", { signal }, token),
    budgets: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Array<{ category: string; allocated: number; used: number; remaining: number }>>(
        "/expenses/budgets",
        { signal },
        token,
      ),
    categories: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<
        Array<{
          id: string;
          code: string;
          name: string;
          receipt_required: boolean;
          per_claim_limit: number | null;
        }>
      >("/expenses/categories", { signal }, token),
    createClaim: (
      token: string,
      payload: {
        claim_date: string;
        description: string;
        currency_code: string;
        lines: Array<{
          category_id: string;
          description: string;
          amount: number;
          cost_centre?: string;
        }>;
      },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        "/expenses/claims",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    uploadReceipt: (
      token: string,
      claimId: string,
      payload: { file: Blob; file_name: string; content_type: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/expenses/claims/${encodeURIComponent(claimId)}/attachments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent(payload.file_name),
            "X-Receipt-Content-Type": payload.content_type,
          },
          body: payload.file,
        },
        token,
      ),
    decideClaim: (token: string, claimId: string, action: "approve" | "reject", note?: string) =>
      apiV1Fetch<Record<string, unknown>>(
        `/expenses/claims/${encodeURIComponent(claimId)}/decision`,
        { method: "POST", body: JSON.stringify({ action, note }) },
        token,
      ),
    reimburseClaim: (
      token: string,
      claimId: string,
      payload: { payment_date: string; payment_reference: string; bank_account_id: string },
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/expenses/claims/${encodeURIComponent(claimId)}/payments`,
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
  },
  platform: {
    integrationExceptions: (token: string, limit = 100, signal?: AbortSignal) =>
      apiV1Fetch<{
        exceptions: Array<{
          id: string;
          type: string;
          source_id: string;
          reference: string | null;
          status: string;
          attempt_count: number;
          age_seconds: number;
          last_error: string | null;
          manually_retryable: boolean;
        }>;
      }>(`/platform/integrations/exceptions?limit=${limit}`, { signal }, token).then(
        (result) => result.exceptions || [],
      ),
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
    providerSettings: (
      token: string,
      provider: string,
      environment?: string,
      signal?: AbortSignal,
    ) =>
      apiV1Fetch<Record<string, unknown>>(
        `/platform/integrations/${provider}/settings${environment ? `?environment=${encodeURIComponent(environment)}` : ""}`,
        { signal },
        token,
      ),
    saveProviderSettings: (token: string, provider: string, payload: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/platform/integrations/${provider}/settings`,
        { method: "PUT", body: JSON.stringify(payload) },
        token,
      ),
    initializeEtims: (token: string, body: Record<string, unknown> = {}) =>
      apiV1Fetch<Record<string, unknown>>(
        "/platform/integrations/etims/initialize",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      ),
    testEtimsConnection: (token: string, body: Record<string, unknown> = {}) =>
      apiV1Fetch<Record<string, unknown>>(
        "/platform/integrations/etims/test-connection",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      ),
    refreshEtimsReferenceData: (token: string, body: Record<string, unknown> = {}) =>
      apiV1Fetch<Record<string, unknown>>(
        "/platform/integrations/etims/reference-data/refresh",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      ),
    etimsReferenceStatus: (token: string) =>
      apiV1Fetch<{ lists: Record<string, unknown>[] }>(
        "/platform/integrations/etims/reference-data/status",
        {},
        token,
      ),
    rotateMpesaCallbackToken: (token: string, body: Record<string, unknown> = {}) =>
      apiV1Fetch<Record<string, unknown>>(
        "/platform/integrations/mpesa/rotate-callback-token",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      ),
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
      apiV1Fetch<MpesaPaymentRequest>(
        `/platform/integrations/mpesa/requests/${requestId}`,
        {},
        token,
      ),
    notificationTemplates: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{ templates: Array<Record<string, unknown>> }>(
        "/platform/notifications/templates",
        { signal },
        token,
      ),
    saveNotificationTemplate: (token: string, code: string, payload: Record<string, unknown>) =>
      apiV1Fetch<Record<string, unknown>>(
        `/platform/notifications/templates/${encodeURIComponent(code)}`,
        { method: "PUT", body: JSON.stringify(payload) },
        token,
      ),
    sendNotification: (
      token: string,
      body: {
        channel: "email" | "sms";
        to: string;
        subject?: string;
        body: string;
        idempotency_key: string;
      },
    ) =>
      apiV1Fetch<OutboundNotification>(
        "/platform/notifications/send",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    notification: (token: string, id: string) =>
      apiV1Fetch<OutboundNotification>(`/platform/notifications/${id}`, {}, token),
  },
  currencies: {
    list: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<CurrencyRecord[]>("/currencies", { signal }, token),
    exchangeRates: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<ExchangeRateRecord[]>("/currencies/exchange-rates", { signal }, token),
    createExchangeRate: (
      token: string,
      payload: {
        from_currency_code: string;
        to_currency_code: string;
        rate: number;
        effective_date: string;
        source: string;
      },
    ) =>
      apiV1Fetch<ExchangeRateRecord>(
        "/currencies/exchange-rates",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    approveExchangeRate: (token: string, id: string) =>
      apiV1Fetch<ExchangeRateRecord>(
        `/currencies/exchange-rates/${id}/approve`,
        { method: "POST" },
        token,
      ),
    rejectExchangeRate: (token: string, id: string, reason?: string) =>
      apiV1Fetch<ExchangeRateRecord>(
        `/currencies/exchange-rates/${id}/reject`,
        { method: "POST", body: JSON.stringify({ reason: reason || "Rejected by finance" }) },
        token,
      ),
    fxPolicies: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<FxPolicyRecord[]>("/currencies/fx-accounting-policies", { signal }, token),
    createFxPolicy: (
      token: string,
      payload: {
        currency_code: string;
        rate_direction: string;
        rate_source: string;
        effective_date_policy: string;
        rounding_method: string;
        realized_gain_account_id: string;
        realized_loss_account_id: string;
        unrealized_gain_account_id: string;
        unrealized_loss_account_id: string;
        monetary_account_ids: string[];
        reversal_policy: string;
      },
    ) =>
      apiV1Fetch<FxPolicyRecord>(
        "/currencies/fx-accounting-policies",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    approveFxPolicy: (token: string, id: string) =>
      apiV1Fetch<FxPolicyRecord>(
        `/currencies/fx-accounting-policies/${id}/approve`,
        { method: "POST" },
        token,
      ),
    rejectFxPolicy: (token: string, id: string, reason?: string) =>
      apiV1Fetch<FxPolicyRecord>(
        `/currencies/fx-accounting-policies/${id}/reject`,
        { method: "POST", body: JSON.stringify({ reason: reason || "Rejected by finance" }) },
        token,
      ),
    fxRevaluations: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<FxRevaluationRunRecord[]>("/currencies/fx-revaluations", { signal }, token),
    postFxRevaluation: (token: string, payload: { period_id: string; currency_code: string }) =>
      apiV1Fetch<{ run: FxRevaluationRunRecord; lines: Array<Record<string, unknown>> }>(
        "/currencies/fx-revaluations",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
  },
  finance: {
    bankAccounts: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<BankAccountRecord[]>("/finance/bank-accounts", { signal }, token),
    createBankAccount: (
      token: string,
      payload: {
        account_code: string;
        account_name: string;
        currency_code?: string;
        is_active?: boolean;
        is_postable?: boolean;
      },
    ) =>
      apiV1Fetch<BankAccountRecord>(
        "/finance/bank-accounts",
        { method: "POST", body: JSON.stringify(payload) },
        token,
      ),
    cashBook: (
      token: string,
      filters: { start_date: string; end_date: string; account_id?: string; limit?: number },
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams({
        start_date: filters.start_date,
        end_date: filters.end_date,
        limit: String(filters.limit ?? 1000),
      });
      if (filters.account_id) params.set("account_id", filters.account_id);
      return apiV1Fetch<CashBookResponse>(`/finance/cash-book?${params}`, { signal }, token);
    },
    budgetForecast: (
      token: string,
      filters: { period_start?: string; period_end?: string; limit?: number } = {},
      signal?: AbortSignal,
    ) => {
      const params = new URLSearchParams({
        period_start: filters.period_start || "2026-01-01",
        period_end: filters.period_end || "2026-12-31",
        limit: String(filters.limit ?? 4),
      });
      return apiV1Fetch<BudgetForecastResponse>(
        `/finance/budget-forecast?${params}`,
        { signal },
        token,
      );
    },
    bankReconciliations: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<BankReconciliationRecord[]>("/finance/bank-reconciliations", { signal }, token),
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
    bankReconciliation: (token: string, id: string, signal?: AbortSignal) =>
      apiV1Fetch<BankReconciliationRecord>(
        `/finance/bank-reconciliations/${id}`,
        { signal },
        token,
      ),
    bankCandidates: (token: string, id: string, signal?: AbortSignal) =>
      apiV1Fetch<BankLedgerCandidateRecord[]>(
        `/finance/bank-reconciliations/${id}/candidates`,
        { signal },
        token,
      ),
    matchBankStatementLine: (token: string, id: string, lineId: string, journalLineId: string) =>
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
    createFiscalYear: (
      token: string,
      body: { year_label: string; start_date: string; end_date: string },
    ) =>
      apiV1Fetch<Record<string, unknown> & { periods: Record<string, unknown>[] }>(
        "/finance/fiscal-years",
        { method: "POST", body: JSON.stringify(body) },
        token,
      ),
    fiscalPeriodCloseChecklist: (token: string, periodId: string, signal?: AbortSignal) =>
      apiV1Fetch<FinancePeriodCloseChecklist>(
        `/finance/fiscal-periods/${periodId}/close-checklist`,
        { signal },
        token,
      ),
    closeFiscalPeriod: (token: string, periodId: string, reason: string) =>
      apiV1Fetch<{ period: Record<string, unknown>; checklist: FinancePeriodCloseChecklist }>(
        `/finance/fiscal-periods/${periodId}/close`,
        { method: "POST", body: JSON.stringify({ reason }) },
        token,
      ),
    trialBalance: (token: string, periodId: string, signal?: AbortSignal) =>
      apiV1Fetch<{
        lines: FinanceReportLine[];
        totals: { period_debit: number; period_credit: number };
      }>(`/finance/reports/trial-balance?fiscal_period_id=${periodId}`, { signal }, token),
    profitLoss: (token: string, periodId: string, signal?: AbortSignal) =>
      apiV1Fetch<{ lines: FinanceReportLine[]; net_profit: number }>(
        `/finance/reports/profit-loss?fiscal_period_id=${periodId}`,
        { signal },
        token,
      ),
    balanceSheet: (token: string, periodId: string, signal?: AbortSignal) =>
      apiV1Fetch<FinanceReportLine[]>(
        `/finance/reports/balance-sheet?fiscal_period_id=${encodeURIComponent(periodId)}`,
        { signal },
        token,
      ),
    cashFlow: (token: string, periodId: string, signal?: AbortSignal) =>
      apiV1Fetch<{
        operating: number;
        investing: number;
        financing: number;
        net_movement: number;
        opening_cash: number;
        closing_cash: number;
        reconciliation_variance: number;
        lines: Array<{ activity: string; amount: number }>;
      }>(
        `/finance/reports/cash-flow?fiscal_period_id=${encodeURIComponent(periodId)}`,
        { signal },
        token,
      ),
    fiscalPeriods: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown>[]>("/finance/fiscal-periods", { signal }, token),
    journals: (token: string, signal?: AbortSignal) =>
      apiV1Fetch<{ data: Record<string, unknown>[] }>(
        "/finance/journals?limit=50",
        { signal },
        token,
      ).then((r) => r.data),
    journal: (token: string, id: string, signal?: AbortSignal) =>
      apiV1Fetch<Record<string, unknown> & { lines: Record<string, unknown>[] }>(
        `/finance/journals/${id}`,
        { signal },
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

export type CurrencyRecord = {
  id?: string | number;
  code: string;
  name?: string | null;
  symbol?: string | null;
  numeric_code?: string | number | null;
  is_active?: boolean;
  is_base?: boolean;
};

export type ExchangeRateRecord = {
  id: string;
  company_id?: string;
  from_currency_code: string;
  to_currency_code: string;
  rate: number;
  effective_date: string;
  source?: string | null;
  status?: string;
  approved_by?: string | null;
  approved_at?: string | null;
  rejected_reason?: string | null;
  created_at?: string | null;
};

export type FxPolicyRecord = {
  id: string;
  currency_code: string;
  rate_direction: string;
  rate_source?: string | null;
  effective_date_policy?: string | null;
  rounding_method?: string | null;
  reversal_policy?: string | null;
  status?: string;
  realized_gain_account_code?: string | null;
  realized_loss_account_code?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at?: string | null;
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
  cashFlow: {
    operating: number;
    investing: number;
    financing: number;
    net_movement: number;
    opening_cash: number;
    closing_cash: number;
    reconciliation_variance: number;
    lines: Array<{ activity: string; amount: number }>;
  };
};

export type BankAccountRecord = {
  id: string;
  account_code: string;
  account_name: string;
  currency_code: string;
};

export type BudgetForecastLine = {
  department: string;
  budget: number;
  actual: number;
  forecast: number;
  variance: number;
  status: "Ahead" | "On track" | "Watch";
};

export type BudgetForecastResponse = {
  metrics: {
    total_budget: number;
    total_actual: number;
    total_forecast: number;
    variance: number;
  };
  lines: BudgetForecastLine[];
  assumptions: Array<{ label: string; value: string }>;
  filters: { periodStart: string; periodEnd: string; limit: number };
};

export type CashBookResponse = {
  accounts: Array<BankAccountRecord & { opening_balance: number | string }>;
  lines: Array<{
    account_id: string;
    account_code: string;
    account_name: string;
    currency_code: string;
    journal_id: string;
    journal_no: string;
    entry_date: string;
    reference_no: string | null;
    description: string;
    line_no: number;
    debit: number | string;
    credit: number | string;
    opening_balance: number | string;
    running_balance: number | string;
  }>;
  filters: { accountId: string | null; startDate: string; endDate: string; limit: number };
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
  signal?: AbortSignal,
): Promise<FinanceWorkspace> {
  const rawPeriods = await v1Api.finance.fiscalPeriods(token, signal);
  const periods: FinancePeriod[] = rawPeriods.map((row) => ({
    id: String(row.id),
    name: String(row.name || row.code || row.id),
    code: row.code ? String(row.code) : undefined,
    status: String(row.status || "open"),
    start_date: row.start_date ? String(row.start_date).slice(0, 10) : undefined,
    end_date: row.end_date ? String(row.end_date).slice(0, 10) : undefined,
  }));
  const today = new Date().toISOString().slice(0, 10);
  const current = periods.find(
    (period) =>
      period.status === "open" &&
      period.start_date &&
      period.end_date &&
      period.start_date <= today &&
      period.end_date >= today,
  );
  const selected =
    periodId ||
    current?.id ||
    periods.find((period) => period.status === "open")?.id ||
    periods[0]?.id;
  if (!selected) {
    return {
      periods,
      trialBalance: { lines: [], totals: { period_debit: 0, period_credit: 0 } },
      balanceSheet: [],
      profitLoss: { lines: [], net_profit: 0 },
      cashFlow: {
        operating: 0,
        investing: 0,
        financing: 0,
        net_movement: 0,
        opening_cash: 0,
        closing_cash: 0,
        reconciliation_variance: 0,
        lines: [],
      },
    };
  }
  const [trialBalance, balanceSheet, profitLoss, cashFlow] = await Promise.all([
    v1Api.finance.trialBalance(token, selected, signal),
    v1Api.finance.balanceSheet(token, selected, signal),
    v1Api.finance.profitLoss(token, selected, signal),
    v1Api.finance.cashFlow(token, selected, signal),
  ]);
  return { periods, trialBalance, balanceSheet, profitLoss, cashFlow };
}

export async function fetchAccountingSnapshotV1(
  token: string,
  signal?: AbortSignal,
): Promise<AccountingSnapshot> {
  const workspace = await fetchFinanceWorkspaceV1(token, undefined, signal);
  const period = workspace.periods.find((row) => row.status === "open") || workspace.periods[0];
  if (!period) return { journalRows: [], pnl: [] };
  const journals = await v1Api.finance.journals(token, signal);
  const latest = journals[0];
  const journal = latest?.id ? await v1Api.finance.journal(token, String(latest.id), signal) : null;
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

export type MasterEntity = "customers" | "vendors" | "items" | "warehouses";

export async function masterList(
  token: string,
  entity: MasterEntity,
  q = "",
  limit?: number,
  signal?: AbortSignal,
) {
  const requestedLimit = limit ?? (entity === "items" ? 100 : 500);
  const path = `/master/${entity}?limit=${requestedLimit}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const result = await apiV1Fetch<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    path,
    { signal },
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

export type FixedAssetDepreciationRow = FixedAsset & {
  monthly_depreciation: number;
};

export type FixedAssetDepreciationSummary = {
  asOfDate: string;
  activeAssets: number;
  totalMonthlyDepreciation: number;
  rows: FixedAssetDepreciationRow[];
};

export type FixedAssetDisposalInput = {
  disposal_date: string;
  disposal_value: number;
  disposal_type: "sale" | "scrap" | "write_off" | "transfer";
  reason?: string;
};

export type FixedAssetDisposalResult = {
  asset: FixedAsset;
  impact: {
    type: string;
    disposal_value: number;
    net_book_value: number;
    gain_or_loss: number;
    months_held: number;
    monthly_depreciation: number;
  };
  note: string;
};

export async function fetchFixedAssets(token: string, signal?: AbortSignal) {
  return apiV1Fetch<FixedAsset[]>("/assets", { signal }, token);
}

export async function fetchFixedAssetDepreciation(
  token: string,
  asOfDate?: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (asOfDate) params.set("as_of_date", asOfDate);
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiV1Fetch<FixedAssetDepreciationSummary>(
    `/assets/depreciation${query}`,
    { signal },
    token,
  );
}

export async function fetchFixedAssetDepreciationRuns(token: string, signal?: AbortSignal) {
  return apiV1Fetch<
    Array<{
      id: string;
      period_start: string;
      period_end: string;
      status: string;
      total_depreciation: number;
      journal_id: string | null;
      notes: string | null;
      created_at: string;
      posted_at: string | null;
    }>
  >("/assets/depreciation-runs", { signal }, token);
}

export async function createFixedAssetDepreciationRun(
  token: string,
  payload: { period_start: string; period_end: string },
) {
  return apiV1Fetch<{
    run: Record<string, unknown>;
    summary: {
      period_start: string;
      period_end: string;
      line_count: number;
      total_depreciation: number;
      lines: Array<Record<string, unknown>>;
    };
  }>(
    "/assets/depreciation-runs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    },
    token,
  );
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

export async function disposeFixedAsset(token: string, id: string, input: FixedAssetDisposalInput) {
  return apiV1Fetch<FixedAssetDisposalResult>(
    `/assets/${id}/dispose`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    },
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
