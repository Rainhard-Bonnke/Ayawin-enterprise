import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Wine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Sign in — Martin Enterprise ERP" }] }),
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("martin@martinerp.co.ke");
  const [password, setPassword] = useState("demo");

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-navy p-12 text-navy-foreground lg:flex">
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }} />
        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-gold text-gold-foreground">
            <Wine className="h-6 w-6" />
          </div>
          <div>
            <div className="font-display text-xl font-bold">Martin Enterprise</div>
            <div className="text-xs uppercase tracking-[0.2em] text-gold">ERP · Kenya</div>
          </div>
        </div>
        <div className="relative">
          <h2 className="font-display text-4xl font-bold leading-tight">
            Premium beverage operations,<br />
            <span className="text-gold">fully digitized.</span>
          </h2>
          <p className="mt-4 max-w-md text-sm text-navy-foreground/70">
            KRA-compliant invoicing, excise duty automation, multi-warehouse
            inventory, and real-time finance — built for Kenya's leading
            distributors.
          </p>
        </div>
        <div className="relative text-xs text-navy-foreground/50">
          © 2026 Martin Enterprise Ltd · Nairobi, Kenya
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-navy text-navy-foreground">
              <Wine className="h-5 w-5" />
            </div>
            <div className="font-display font-bold">Martin Enterprise ERP</div>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your account to continue.</p>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => { e.preventDefault(); navigate({ to: "/" }); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <a href="#" className="text-xs text-muted-foreground hover:text-navy">Forgot?</a>
              </div>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="remember" />
              <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
                Remember me for 30 days
              </Label>
            </div>
            <Button type="submit" className="w-full bg-navy text-navy-foreground hover:bg-navy/90">
              Sign in
            </Button>
          </form>

          <div className="mt-6 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Demo mode:</span> any credentials work.
          </div>
        </div>
      </div>
    </div>
  );
}
