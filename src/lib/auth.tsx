import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "./api-types";
import {
  clearTokens,
  onAccessTokenRefreshed,
  parseAccessToken,
  v1Login,
  v1Logout,
  v1RestoreSession,
  v1Me,
} from "./api-v1";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAccessTokenRefreshed((access) => {
      setToken(access);
      const refreshedUser = parseAccessToken(access);
      if (refreshedUser) setUser(refreshedUser);
    });

    async function restoreSession() {
      try {
        const access = await v1RestoreSession();
        if (!access) return;
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
    }

    void restoreSession();
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    const { token: newToken, user: currentUser } = await v1Login(email, password);
    setToken(newToken);
    setUser(currentUser);
    return currentUser;
  };

  const logout = async () => {
    try {
      await v1Logout();
    } catch {
      /* The local session is cleared even when the API is unavailable. */
    }
    clearTokens();
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
