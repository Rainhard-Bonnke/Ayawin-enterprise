import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "./api";
import { loginRequest, logoutRequest } from "./api";
import {
  parseAccessToken,
  getStoredTokens,
  clearTokens,
  onAccessTokenRefreshed,
  v1Me,
  isV1Enabled,
  isApiSessionToken,
  isAccessTokenExpired,
  refreshAccessToken,
} from "./api-v1";
import { broadcastLogout, subscribeLogout } from "./sessionSync";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  login: (
    email: string,
    password: string,
    options?: { rememberMe?: boolean; mfaToken?: string },
  ) => Promise<void>;
  logout: () => void;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STORAGE_KEY = "ayawin-enterprise-erp-token";

function parseJwt(token: string): User | null {
  try {
    if (token.startsWith("demo:")) return null;

    const v1User = parseAccessToken(token);
    if (v1User) return v1User;

    const payload = token.split(".")[1];
    const decoded = decodeURIComponent(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => `%${("00" + c.charCodeAt(0).toString(16)).slice(-2)}`)
        .join(""),
    );
    const parsed = JSON.parse(decoded) as { exp?: number; id?: string; sub?: string };

    if (parsed.exp && parsed.exp * 1000 < Date.now()) {
      return null;
    }

    return {
      id: parsed.id ?? parsed.sub,
      username: parsed.username ?? parsed.email?.split("@")[0],
      full_name: parsed.full_name ?? null,
      email: parsed.email,
      role: parsed.role_name || parsed.role,
      permissions: parsed.permissions,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAccessTokenRefreshed((access) => {
      localStorage.setItem(STORAGE_KEY, access);
      setToken(access);
      const parsed = parseJwt(access);
      if (parsed) setUser(parsed);
    });

    async function restoreSession() {
      const storedToken = getStoredTokens().access || localStorage.getItem(STORAGE_KEY);
      if (!storedToken) {
        setLoading(false);
        return;
      }

      if (storedToken.startsWith("demo:")) {
        clearTokens();
        localStorage.removeItem(STORAGE_KEY);
        setLoading(false);
        return;
      }

      let access = getStoredTokens().access || storedToken;

      if (isApiSessionToken(access) && isV1Enabled() && isAccessTokenExpired(access)) {
        const refreshed = await refreshAccessToken();
        if (refreshed) access = refreshed;
      }

      const parsed = parseJwt(access);

      if (parsed) {
        localStorage.setItem(STORAGE_KEY, access);
        setToken(access);
        setUser(parsed);
        setLoading(false);

        if (isApiSessionToken(access) && isV1Enabled()) {
          void v1Me(access)
            .then((me) => setUser(me))
            .catch(() => {
              clearTokens();
              localStorage.removeItem(STORAGE_KEY);
              setToken(null);
              setUser(null);
            });
        }
        return;
      }

      clearTokens();
      localStorage.removeItem(STORAGE_KEY);
      setLoading(false);
    }

    void restoreSession();

    const unsubLogout = subscribeLogout(() => {
      clearTokens();
      localStorage.removeItem(STORAGE_KEY);
      setToken(null);
      setUser(null);
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    });

    return () => {
      unsubscribe();
      unsubLogout();
    };
  }, []);

  const login = async (
    email: string,
    password: string,
    options?: { rememberMe?: boolean; mfaToken?: string },
  ) => {
    const { token: newToken, user: currentUser } = await loginRequest(email, password, {
      rememberMe: options?.rememberMe,
      mfaToken: options?.mfaToken,
    });
    localStorage.setItem(STORAGE_KEY, newToken);
    setToken(newToken);
    setUser(currentUser);
  };

  const logout = async () => {
    if (token) {
      try {
        await logoutRequest(token);
      } catch {
        /* ignore */
      }
    }
    broadcastLogout();
    clearTokens();
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  };

  const value = useMemo(
    () => ({ user, token, login, logout, loading }),
    [user, token, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
