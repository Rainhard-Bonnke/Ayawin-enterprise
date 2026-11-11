import { describe, expect, it } from "vitest";
import { canAccessPath } from "./rbac";
import { describeNetworkScope, describeSessionDevice } from "./security";

describe("security UI helpers", () => {
  it("formats rule labels with the CIDR and scope context", () => {
    expect(
      describeNetworkScope({
        cidr: "10.36.0.0/16",
        role_name: "Finance",
        description: "Head office Wi‑Fi",
      }),
    ).toBe("10.36.0.0/16 • Finance • Head office Wi‑Fi");
  });

  it("summarizes active session metadata in a readable string", () => {
    expect(
      describeSessionDevice({
        session_type: "user",
        device_info: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        ip_address: "192.168.1.8",
      }),
    ).toBe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) • 192.168.1.8");
  });
});

describe("route access matrix", () => {
  it("blocks unmapped routes and allows explicitly approved screens", () => {
    expect(canAccessPath({ role: "Driver" } as any, "/bank-reconciliation")).toBe(false);
    expect(canAccessPath({ role: "Driver" } as any, "/inventory-lots")).toBe(false);
    expect(canAccessPath({ role: "Manager" } as any, "/customer-credit-notes")).toBe(true);
    expect(canAccessPath({ role: "Accountant" } as any, "/bank-reconciliation")).toBe(true);
    expect(canAccessPath({ role: "Store Manager" } as any, "/inventory-lots")).toBe(true);
  });
});
