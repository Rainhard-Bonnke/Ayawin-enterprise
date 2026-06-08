import { useEffect, useState } from "react";

const STORAGE_KEY = "ayawin-enterprise-erp-theme";

export type ThemeMode = "light" | "dark";

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", mode === "dark");
}

export function getInitialTheme(): ThemeMode {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  }
  return "dark";
}

export function applyInitialTheme() {
  const initial = getInitialTheme();
  applyTheme(initial);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, initial);
  }
  return initial;
}

export function useThemeMode() {
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    const initial = applyInitialTheme();
    setTheme(initial);
  }, []);

  const updateTheme = (next: ThemeMode) => {
    setTheme(next);
    applyTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const toggleTheme = () => updateTheme(theme === "dark" ? "light" : "dark");

  return { theme, setTheme: updateTheme, toggleTheme };
}
