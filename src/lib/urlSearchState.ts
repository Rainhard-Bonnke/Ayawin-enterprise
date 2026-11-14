import { useCallback, useSyncExternalStore } from "react";

export function readUrlSearchParam(search: string, key: string, fallback: string) {
  return new URLSearchParams(search).get(key) ?? fallback;
}

export function writeUrlSearchParam(search: string, key: string, value: string, fallback: string) {
  const params = new URLSearchParams(search);
  if (value === fallback || value === "") params.delete(key);
  else params.set(key, value);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function useUrlSearchParam(key: string, fallback = "") {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === "undefined") return () => undefined;
    window.addEventListener("popstate", notify);
    return () => window.removeEventListener("popstate", notify);
  }, []);
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return fallback;
    return readUrlSearchParam(window.location.search, key, fallback);
  }, [fallback, key]);
  const value = useSyncExternalStore(subscribe, getSnapshot, () => fallback);
  const setValue = useCallback(
    (next: string) => {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      const nextSearch = writeUrlSearchParam(url.search, key, next, fallback);
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${nextSearch}${url.hash}`,
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    [fallback, key],
  );
  return [value, setValue] as const;
}
