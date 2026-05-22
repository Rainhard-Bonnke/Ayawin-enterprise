import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Sign in - Ayawin Enterprise ERP" }] }),
});

function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const CLIENT_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.DEV;
  const [email, setEmail] = useState(CLIENT_DEMO_MODE ? "admin@martin.co.ke" : "");
  const [password, setPassword] = useState(CLIENT_DEMO_MODE ? "demo" : "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password);
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-navy p-12 text-navy-foreground lg:flex">
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="absolute right-0 top-0 h-80 w-80 translate-x-1/3 -translate-y-1/3 rounded-full bg-gold/15 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-72 w-72 -translate-x-1/3 translate-y-1/3 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex items-center justify-between gap-3">
          <BrandMark />
          <ThemeToggle />
        </div>
        <div className="relative max-w-xl">
          <h2 className="font-display text-4xl font-bold leading-tight">
            Premium beverage operations,
            <br />
            <span className="text-gold">fully digitized.</span>
          </h2>
          <p className="mt-4 max-w-md text-sm text-navy-foreground/70">
            KRA-compliant invoicing, excise duty automation, multi-warehouse inventory,
            and real-time finance built for Kenya's beverage distributors.
          </p>
          <div className="mt-6 grid max-w-lg gap-3 sm:grid-cols-3">
            {[
              ["VAT", "16%"],
              ["Excise", "Auto-calculated"],
              ["Locale", "en-KE"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
                <div className="text-[10px] uppercase tracking-[0.22em] text-navy-foreground/55">{label}</div>
                <div className="mt-1 text-sm font-semibold text-white">{value}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-navy-foreground/50">
          (c) 2026 Ayawin Enterprise ERP | Nairobi, Kenya
        </div>
      </div>

      <div className="flex items-center justify-center p-4 sm:p-8 lg:p-12">
        <div className="erp-panel w-full max-w-md rounded-3xl p-6 sm:p-8">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <BrandMark compact />
          </div>
          <div className="mb-4 inline-flex rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
            Secure access
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in to Ayawin Enterprise ERP to manage sales, inventory, invoicing and KRA compliance.
          </p>

          <form className="mt-8 space-y-4" onSubmit={handleSignIn}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <a href="#" className="text-xs text-muted-foreground hover:text-navy">
                  Forgot?
                </a>
              </div>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="remember" />
              <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
                Remember me for 30 days
              </Label>
            </div>
            <Button type="submit" className="w-full bg-navy text-navy-foreground hover:bg-navy/90" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
            {error && <div className="text-sm text-destructive">{error}</div>}
          </form>

          <div className="mt-6 rounded-2xl border border-border/70 bg-muted/40 p-4 text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">Demo mode:</span> use any seeded account or{" "}
            {loading ? "your" : "admin@martin.co.ke / demo"}.
          </div>
        </div>
      </div>
    </div>
  );
}
