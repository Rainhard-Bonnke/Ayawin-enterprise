import { afterEach, describe, expect, it, vi } from "vitest";

describe("API idempotency headers", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("adds a stable-per-request key to POST and preserves an explicit key", async () => {
    const response = () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const fetchMock = vi.fn().mockImplementation(response);
    vi.stubGlobal("fetch", fetchMock);
    const { apiV1Fetch } = await import("./api-v1");

    await apiV1Fetch("/money", { method: "POST" });
    const generatedHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(generatedHeaders.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("include");

    await apiV1Fetch("/money", { method: "POST", headers: { "Idempotency-Key": "client-key" } });
    const explicitHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(explicitHeaders.get("Idempotency-Key")).toBe("client-key");
  });
});
