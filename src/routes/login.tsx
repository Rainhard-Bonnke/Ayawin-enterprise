import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { KeyRound, ShoppingCart } from "lucide-react";
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
  const { login, loginPos } = useAuth();
  const [mode, setMode] = useState<"licensed" | "pos">("licensed");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "pos") {
        await loginPos(password);
        navigate({ to: "/pos" });
      } else {
        await login(email, password);
        navigate({ to: "/" });
      }
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
            <p className="mt-1 text-sm text-muted-foreground">Choose your workspace to continue</p>

            <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
              <Button type="button" variant={mode === "licensed" ? "default" : "ghost"} onClick={() => { setMode("licensed"); setError(null); }}>
                <KeyRound className="mr-2 h-4 w-4" /> ERP workspace
              </Button>
              <Button type="button" variant={mode === "pos" ? "default" : "ghost"} onClick={() => { setMode("pos"); setError(null); }}>
                <ShoppingCart className="mr-2 h-4 w-4" /> Point of sale
              </Button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSignIn}>
              {mode === "licensed" && <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>}
              <div className="space-y-1.5">
                <Label htmlFor="password">{mode === "pos" ? "POS password" : "Password"}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {mode === "licensed" && <div className="flex items-center gap-2">
                <Checkbox id="remember" />
                <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
                  Remember me
                </Label>
              </div>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Opening workspace…" : mode === "pos" ? "Open POS" : "Sign in"}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </form>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
