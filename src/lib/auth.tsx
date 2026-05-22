import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "./api";
import { loginRequest } from "./api";
import { demoRoleAccounts } from "./rbac";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STORAGE_KEY = "ayawin-enterprise-erp-token";

function parseJwt(token: string): User | null {
  try {
    const CLIENT_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.DEV;
    if (token.startsWith("demo:") && CLIENT_DEMO_MODE) {
      const [, rawEmail, rawRole] = token.split(":");
      const email = rawEmail?.trim() || "admin@martin.co.ke";
      const role = rawRole || demoRoleAccounts[email.toLowerCase()] || "Admin";
      return {
        id: 0,
        username: email.split("@")[0],
        full_name: role === "Admin" ? "System Administrator" : `${role} Demo User`,
        email,
        role,
      };
    }

    const payload = token.split(".")[1];
    const decoded = decodeURIComponent(
      atob(payload)
        .split("")
        .map((c) => `%${("00" + c.charCodeAt(0).toString(16)).slice(-2)}`)
        .join(""),
    );
    const parsed = JSON.parse(decoded);

    return {
      id: parsed.id,
      username: parsed.username,
      full_name: parsed.full_name ?? null,
      email: parsed.email,
      role: parsed.role,
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
    const storedToken = localStorage.getItem(STORAGE_KEY);
    if (storedToken) {
      const parsed = parseJwt(storedToken);
      if (parsed) {
        setToken(storedToken);
        setUser(parsed);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    const { token: newToken, user: currentUser } = await loginRequest(email, password);
    localStorage.setItem(STORAGE_KEY, newToken);
    setToken(newToken);
    setUser(currentUser);
  };

  const logout = () => {
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
