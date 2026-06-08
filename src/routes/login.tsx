import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BarChart3, Shield, Zap } from "lucide-react";
import { v1ForgotPassword, v1ResetPassword, isV1Enabled, MfaRequiredError } from "@/lib/api-v1";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    reset: typeof search.reset === "string" ? search.reset : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in - Ayawin Stock Solutions ERP" }] }),
});

function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { reset: resetToken } = Route.useSearch();
  const CLIENT_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
  const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
  const IS_HOSTED_API = Boolean(API_BASE && !API_BASE.includes("localhost"));
  const [email, setEmail] = useState(CLIENT_DEMO_MODE ? "admin@martin.co.ke" : "admin@martin.co.ke");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot" | "reset">(resetToken ? "reset" : "signin");
  const [newPassword, setNewPassword] = useState("");
  const [resetDone, setResetDone] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const [apiWaking, setApiWaking] = useState(false);

  useEffect(() => {
    if (!isV1Enabled()) {
      setApiReachable(null);
      return;
    }
    const base = API_BASE || (import.meta.env.DEV ? "http://localhost:4000" : "");
    if (!base) return;
    let cancelled = false;
    const probe = () => {
      const started = Date.now();
      if (IS_HOSTED_API) setApiWaking(true);
      fetch(`${base}/health`)
        .then((r) => {
          if (!cancelled) {
            setApiReachable(r.ok);
            if (IS_HOSTED_API && Date.now() - started > 4000) {
              setApiWaking(false);
            }
          }
        })
        .catch(() => {
          if (!cancelled) setApiReachable(false);
        })
        .finally(() => {
          if (!cancelled && IS_HOSTED_API) setApiWaking(false);
        });
    };
    probe();
    const interval = window.setInterval(probe, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [API_BASE, IS_HOSTED_API]);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password, { rememberMe, mfaToken: mfaRequired ? mfaCode : undefined });
      navigate({ to: "/" });
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setMfaRequired(true);
        setError("Enter the 6-digit code from your authenticator app.");
      } else {
        const msg = err instanceof Error ? err.message : "Sign in failed";
        if (msg === "Invalid credentials") {
          setError(
            IS_HOSTED_API
              ? "Invalid email or password. Demo login is disabled on the hosted API — use the password set in ADMIN_PASSWORD (or reset via Forgot password)."
              : "Invalid email or password.",
          );
        } else {
          setError(msg);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (!isV1Enabled()) throw new Error("Password reset requires the live API");
      const result = await v1ForgotPassword(email);
      toast.success(result.message);
      if (result.dev_token && CLIENT_DEMO_MODE) {
        toast.message(`Dev reset token: ${result.dev_token}`, { duration: 12000 });
      }
      setMode("signin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send reset link");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resetToken) return;
    setError(null);
    setLoading(true);
    try {
      if (!isV1Enabled()) throw new Error("Password reset requires the live API");
      await v1ResetPassword(resetToken, newPassword);
      setResetDone(true);
      toast.success("Password updated. Sign in with your new password.");
      setMode("signin");
      navigate({ to: "/login", search: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reset password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen bg-background">
      <div className="relative hidden w-[44%] flex-col justify-between login-mesh p-12 lg:flex">
        <BrandMark inverted />

        <div className="space-y-8">
          <div>
            <p className="font-mono-label text-sidebar-primary">Enterprise platform</p>
            <h2 className="mt-3 max-w-md text-4xl font-semibold leading-[1.1] tracking-tight text-sidebar-foreground">
              Stock, sales & finance in one place
            </h2>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-sidebar-foreground/55">
              Built for distributors — from purchase orders to KRA-ready invoicing and live analytics.
            </p>
          </div>
          <div className="grid gap-3">
            {[
              { icon: BarChart3, title: "Real-time KPIs", desc: "Revenue, AR and inventory from your database" },
              { icon: Shield, title: "Compliance ready", desc: "VAT, excise, payroll and audit trails" },
              { icon: Zap, title: "End-to-end flow", desc: "Order → deliver → invoice → collect" },
            ].map((item) => (
              <div
                key={item.title}
                className="flex gap-4 rounded-xl border border-white/6 bg-white/4 p-4 backdrop-blur-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/15 text-sidebar-primary">
                  <item.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-sidebar-foreground">{item.title}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-sidebar-foreground/50">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-sidebar-foreground/35">© {new Date().getFullYear()} Ayawin Stock Solutions</p>
      </div>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between px-6 py-5 lg:justify-end">
          <div className="lg:hidden">
            <BrandMark />
          </div>
          <ThemeToggle />
        </header>

        <div className="flex flex-1 items-center justify-center px-6 pb-12">
          <div className="surface-card w-full max-w-[420px] p-8 sm:p-10">
            <div className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight">
                {mode === "forgot" ? "Reset password" : mode === "reset" ? "Choose new password" : "Welcome back"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {mode === "forgot"
                  ? "We'll email a secure link if this account exists."
                  : mode === "reset"
                    ? "Enter a new password (minimum 8 characters)."
                    : "Sign in to your workspace"}
              </p>
            </div>

            {mode === "signin" && apiWaking && (
              <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
                Server is waking up (Render cold start can take 30–60 seconds on first visit)…
              </div>
            )}

            {mode === "signin" && apiReachable === false && (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {IS_HOSTED_API ? (
                  <>
                    Cannot reach the API at <strong>{API_BASE}</strong>. Check that the Render backend is deployed and
                    healthy at <code className="rounded bg-muted px-1 text-xs">/health</code>.
                  </>
                ) : (
                  <>
                    API is not running on port 4000. Run{" "}
                    <code className="rounded bg-muted px-1 text-xs">npm run dev:all</code>, wait for{" "}
                    <strong>Backend ready</strong>, then refresh.
                  </>
                )}
              </div>
            )}

            {mode === "signin" && (
              <form className="space-y-5" onSubmit={handleSignIn}>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.co.ke"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => {
                        setMode("forgot");
                        setError(null);
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
                {!mfaRequired && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="remember"
                      checked={rememberMe}
                      onCheckedChange={(v) => setRememberMe(v === true)}
                    />
                    <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
                      Remember me for 30 days
                    </Label>
                  </div>
                )}
                {mfaRequired && (
                  <div className="space-y-2">
                    <Label htmlFor="mfa-code">Authenticator code</Label>
                    <Input
                      id="mfa-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\s/g, ""))}
                      placeholder="000000"
                      maxLength={8}
                      required
                    />
                  </div>
                )}
                <Button type="submit" className="h-11 w-full text-[15px]" disabled={loading}>
                  {loading ? "Signing in…" : mfaRequired ? "Verify & sign in" : "Continue"}
                </Button>
                {error && (
                  <p className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </form>
            )}

            {mode === "forgot" && (
              <form className="space-y-5" onSubmit={handleForgot}>
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">Email</Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="h-11 w-full" disabled={loading}>
                  {loading ? "Sending…" : "Send reset link"}
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setMode("signin")}>
                  Back to sign in
                </Button>
                {error && (
                  <p className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </form>
            )}

            {mode === "reset" && (
              <form className="space-y-5" onSubmit={handleReset}>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </div>
                <Button type="submit" className="h-11 w-full" disabled={loading || resetDone}>
                  {loading ? "Updating…" : "Update password"}
                </Button>
                {error && (
                  <p className="rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </form>
            )}

            {CLIENT_DEMO_MODE && mode === "signin" && (
              <p className="mt-6 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <strong className="text-foreground">Live database mode:</strong> sign in with{" "}
                <strong className="text-foreground">admin@martin.co.ke</strong> /{" "}
                <strong className="text-foreground">demo</strong> (saves to PostgreSQL). Start backend with{" "}
                <code className="text-foreground">npm run dev:all</code>. Header badge must show{" "}
                <strong className="text-foreground">Live</strong> or <strong className="text-foreground">Polling</strong>
                — not &quot;Demo / API off&quot;. Clean slate: <code className="text-foreground">npm run dev:reset-db</code>{" "}
                (set <code className="text-foreground">CONFIRM_RESET_DEV=yes</code>).
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
