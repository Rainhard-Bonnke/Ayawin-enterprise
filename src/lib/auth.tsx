import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "./api";
import { loginRequest, logoutRequest } from "./api";
import {
  parseAccessToken,
  getStoredTokens,
  clearTokens,
  onAccessTokenRefreshed,
  v1RestoreSession,
  v1Me,
  isV1Enabled,
  isApiSessionToken,
} from "./api-v1";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STORAGE_KEY = "ayawin-stock-solution-erp-token";

function parseJwt(token: string): User | null {
  try {
    const v1User = parseAccessToken(token);
    if (v1User) return v1User;

    const payload = token.split(".")[1];
    const decoded = decodeURIComponent(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => `%${("00" + c.charCodeAt(0).toString(16)).slice(-2)}`)
        .join(""),
    );
    const parsed = JSON.parse(decoded);

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
      setToken(access);
      const parsed = parseJwt(access);
      if (parsed) setUser(parsed);
    });

    async function restoreSession() {
      if (isV1Enabled()) {
        clearTokens();
        try {
          const access = await v1RestoreSession();
          if (!access) throw new Error("No active session");
          const me = await v1Me(access);
          setToken(access);
          setUser(me);
        } catch {
          clearTokens();
          setToken(null);
          setUser(null);
        } finally {
          setLoading(false);
        }
        return;
      }

      const storedToken = getStoredTokens().access || localStorage.getItem(STORAGE_KEY);
      if (!storedToken) {
        setLoading(false);
        return;
      }

      if (isApiSessionToken(storedToken) && isV1Enabled()) {
        const parsed = parseJwt(storedToken);
        if (parsed) {
          const access = getStoredTokens().access || storedToken;
          setToken(access);
          setUser(parsed);
          setLoading(false);

          void v1Me(access)
            .then((me) => setUser(me))
            .catch(() => {
              clearTokens();
              localStorage.removeItem(STORAGE_KEY);
              setToken(null);
              setUser(null);
            });
          return;
        }

        try {
          const me = await v1Me(storedToken);
          const access = getStoredTokens().access || storedToken;
          setToken(access);
          setUser(me);
          setLoading(false);
          return;
        } catch {
          clearTokens();
          localStorage.removeItem(STORAGE_KEY);
          setLoading(false);
          return;
        }
      }

      const parsed = parseJwt(storedToken);
      if (parsed) {
        setToken(storedToken);
        setUser(parsed);
      } else {
        clearTokens();
        localStorage.removeItem(STORAGE_KEY);
      }
      setLoading(false);
    }

    void restoreSession();
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    const { token: newToken, user: currentUser } = await loginRequest(email, password);
    setToken(newToken);
    setUser(currentUser);
    return currentUser;
  };

  const logout = async () => {
    if (token) {
      try {
        await logoutRequest(token);
      } catch {
        /* ignore */
      }
    }
    clearTokens();
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  };

  const value = useMemo(
    () => ({ user, token, login, logout, loading }),
    [user, token, login, logout, loading],
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
