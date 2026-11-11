import { afterEach, describe, expect, it, vi } from "vitest";

describe("browser session token handling", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("keeps access tokens in memory and never accesses browser storage", async () => {
    const storage = new Proxy({}, {
      get() {
        throw new Error("browser storage must not be accessed for session tokens");
      },
    });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);

    const session = await import("./api-v1");
    session.storeTokens("access-token");
    expect(session.getStoredTokens()).toEqual({ access: "access-token", refresh: null });
    session.clearTokens();
    expect(session.getStoredTokens()).toEqual({ access: null, refresh: null });
  });
});
