import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import {
  BriefcaseBusiness,
  CircleHelp,
  DollarSign,
  ShoppingCart,
  Store,
  Truck,
  Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Login - Ayawin Stock Solution" }] }),
});

const modules = [
  { name: "SALES", icon: ShoppingCart },
  { name: "PURCHASES", icon: Truck },
  { name: "INVENTORY", icon: Store },
  { name: "FINANCE", icon: DollarSign },
  { name: "HUMAN RESOURCE", icon: Users },
  { name: "ASSETS", icon: BriefcaseBusiness },
];

function LoginPage() {
  const navigate = useNavigate();
  const { login, loginPos } = useAuth();
  const [mode, setMode] = useState<"licensed" | "pos">("licensed");
  const [username, setUsername] = useState("");
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
        await login(username, password);
        navigate({ to: "/" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="ayawin-login-page">
      <header className="ayawin-login-topbar">
        <a href="/" className="ayawin-wordmark" aria-label="Ayawin Stock Solution home">
          <span className="ayawin-wordmark-icon">A</span>
          <span>Ayawin Stock Solution</span>
        </a>
        <div className="ayawin-topbar-links">
          <span className="ayawin-version">v 1.25.045</span>
          <a href="mailto:support@netrixbiz.com"><CircleHelp className="h-4 w-4" /> Support</a>
        </div>
      </header>
      <div className="ayawin-login-rule" />

      <section className="ayawin-login-stage">
        <div className="ayawin-login-card">
          <div className="ayawin-module-area">
            <div className="ayawin-module-grid">
              {modules.map(({ name, icon: Icon }, index) => (
                <div className={`ayawin-module-tile ayawin-module-tile-${index + 1}`} key={name}>
                  <span>{name}</span>
                  <Icon className="ayawin-module-icon" strokeWidth={1.45} />
                  <span className="ayawin-module-arrow" aria-hidden="true">↗</span>
                </div>
              ))}
            </div>
            <div className="ayawin-login-copyright">© Ayawin Stock Solution<br />All rights reserved.</div>
          </div>

          <aside className="ayawin-login-box">
            <div className="ayawin-login-box-brand">AYAWIN STOCK SOLUTION</div>
            <div className="ayawin-login-box-title">LOGIN</div>
            <div className="ayawin-company-emblem" aria-hidden="true"><span>A</span></div>
            <form className="ayawin-login-fields" onSubmit={handleSignIn}>
              {mode === "licensed" && (
                <div className="ayawin-login-field">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    placeholder="username"
                  />
                </div>
              )}
              <div className="ayawin-login-field">
                <Label htmlFor="password">{mode === "pos" ? "POS Password" : "Password"}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  placeholder="Password"
                />
              </div>
              <div className="ayawin-login-actions">
                <Button type="submit" disabled={loading}>
                  {loading ? "Signing in…" : mode === "pos" ? "Open POS" : "Sign In"}
                </Button>
                {mode === "licensed" && <a href="/forgot-password">Forgot Password</a>}
                <button type="button" onClick={() => { setMode(mode === "pos" ? "licensed" : "pos"); setError(null); }}>
                  {mode === "pos" ? "ERP Login" : "POS"}
                </button>
              </div>
              {error && <p role="alert" className="ayawin-login-error">{error}</p>}
            </form>
          </aside>
        </div>
      </section>

      <div className="ayawin-footer-rule" />
      <footer className="ayawin-login-footer">
        <div className="ayawin-footer-inner">
          <div className="ayawin-footer-brand">
            <div>Ayawin Stock Solution</div>
            <p>Manage your stock and business from one place</p>
          </div>
          <div className="ayawin-footer-column"><strong>OVERVIEW</strong><a href="#why-ayawin">Why Ayawin</a><a href="#who-uses-ayawin">Who Uses Ayawin</a><a href="#pricing">Pricing</a></div>
          <div className="ayawin-footer-column"><strong>DEMOS</strong><a href="mailto:support@netrixbiz.com">Contact Us for Demo</a></div>
          <div className="ayawin-footer-column"><strong>SUPPORT</strong><a href="mailto:support@netrixbiz.com">support@netrixbiz.com</a></div>
          <div className="ayawin-footer-column"><strong>SOCIAL</strong><span>Follow Ayawin</span></div>
        </div>
      </footer>
    </main>
  );
}
