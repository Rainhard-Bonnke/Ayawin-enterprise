// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  restore: vi.fn(),
  login: vi.fn(),
}));

vi.mock("./api-v1", () => ({
  clearTokens: vi.fn(),
  onAccessTokenRefreshed: () => () => undefined,
  parseAccessToken: () => null,
  v1Login: api.login,
  v1Logout: vi.fn(),
  v1RestoreSession: api.restore,
  v1Me: vi.fn(),
}));

import { AuthProvider, useAuth } from "./auth";

function AuthProbe() {
  const { user, token, loading, login } = useAuth();
  return (
    <div>
      <button onClick={() => void login("operator@example.test", "password")}>Login</button>
      <output>{`${user?.id ?? "anonymous"}|${token ?? "no-token"}|${loading ? "loading" : "ready"}`}</output>
    </div>
  );
}

describe("AuthProvider session restoration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not let a late refresh failure erase a successful login", async () => {
    let rejectRestore!: (error: Error) => void;
    api.restore.mockImplementation(() => new Promise((_resolve, reject) => { rejectRestore = reject; }));
    api.login.mockResolvedValue({
      token: "access-token",
      user: { id: "user-1", email: "operator@example.test", username: "operator", full_name: null, role: "Operator" },
    });

    render(<AuthProvider><AuthProbe /></AuthProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Login" }));

    expect(await screen.findByText("user-1|access-token|ready")).toBeTruthy();
    await act(async () => rejectRestore(new Error("No refresh session")));
    expect(screen.getByText("user-1|access-token|ready")).toBeTruthy();
  });
});
