import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Sign in - Ayawin Enterprise ERP" }] }),
});

function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const CLIENT_DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true" || import.meta.env.DEV;
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
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <BrandMark />
        <ThemeToggle />
      </header>

      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Ayawin Enterprise ERP</p>

            <form className="mt-6 space-y-4" onSubmit={handleSignIn}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="remember" />
                <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
                  Remember me
                </Label>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </form>

            {CLIENT_DEMO_MODE && (
              <p className="mt-4 text-xs text-muted-foreground">
                Dev sign-in: <strong>admin@martin.co.ke</strong> / <strong>demo</strong> (API when backend has{" "}
                <code className="text-[11px]">ENABLE_DEMO_MODE=true</code>, otherwise offline demo token).
                <br />
                Use the Vite app URL (e.g. port <strong>5173</strong>), not port 4000 — that is API-only.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
