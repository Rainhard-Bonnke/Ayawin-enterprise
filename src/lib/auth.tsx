import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  const sessionEpoch = useRef(0);

  useEffect(() => {
    const unsubscribe = onAccessTokenRefreshed((access) => {
      setToken(access);
      const refreshedUser = parseAccessToken(access);
      if (refreshedUser) setUser(refreshedUser);
    });

    async function restoreSession() {
      const epoch = sessionEpoch.current;
      try {
        const access = await v1RestoreSession();
        if (epoch !== sessionEpoch.current) return;
        if (!access) return;
        const me = await v1Me(access);
        if (epoch !== sessionEpoch.current) return;
        setToken(access);
        setUser(me);
      } catch {
        if (epoch === sessionEpoch.current) {
          clearTokens();
          setToken(null);
          setUser(null);
        }
      } finally {
        if (epoch === sessionEpoch.current) setLoading(false);
      }
    }

    void restoreSession();
    return unsubscribe;
  }, []);

  const login = async (email: string, password: string) => {
    const epoch = ++sessionEpoch.current;
    try {
      const { token: newToken, user: currentUser } = await v1Login(email, password);
      if (epoch === sessionEpoch.current) {
        setToken(newToken);
        setUser(currentUser);
        setLoading(false);
      }
      return currentUser;
    } catch (error) {
      if (epoch === sessionEpoch.current) setLoading(false);
      throw error;
    }
  };

  const logout = async () => {
    sessionEpoch.current += 1;
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
