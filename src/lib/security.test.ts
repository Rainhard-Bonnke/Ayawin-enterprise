import { describe, expect, it } from "vitest";
import { canAccessPath } from "./rbac";
import type { User } from "./api-types";
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

describe("permission based route access", () => {
  const user = (permissions: string[]) => ({ permissions }) as unknown as User;

  it("checks actual backend permission codes and denies unknown routes", () => {
    expect(canAccessPath(user(["fleet.view"]), "/bank-reconciliation")).toBe(false);
    expect(canAccessPath(user(["fleet.view"]), "/inventory-lots")).toBe(false);
    expect(canAccessPath(user(["sales.credit_note.approve"]), "/customer-credit-notes")).toBe(true);
    expect(canAccessPath(user(["sales.view"]), "/crm")).toBe(true);
    expect(canAccessPath(user(["fleet.view"]), "/crm")).toBe(false);
    expect(canAccessPath(user(["finance.view"]), "/bank-reconciliation")).toBe(true);
    expect(canAccessPath(user(["procurement.approve"]), "/inventory-lots")).toBe(true);
    expect(canAccessPath(user(["procurement.view"]), "/purchase-requisitions")).toBe(true);
    expect(canAccessPath(user(["fleet.approve"]), "/route-closures")).toBe(true);
    expect(canAccessPath(user(["users.edit"]), "/users")).toBe(true);
    expect(canAccessPath(user(["sales.view"]), "/unknown-screen")).toBe(false);
  });
});
