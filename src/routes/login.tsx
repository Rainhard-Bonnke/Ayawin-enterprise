import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { loginSchema, type LoginFormValues } from "@/lib/schemas/auth";

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
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const handleSignIn = async ({ username, password }: LoginFormValues) => {
    setError(null);

    try {
      const currentUser = await login(username, password);
      navigate({ to: currentUser.role === "POS Operator" ? "/pos" : "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    }
  };

  return (
    <main className="ayawin-login-page">
      <header className="ayawin-login-topbar">
        <a href="/" className="ayawin-wordmark" aria-label="Ayawin Stock Solution home">
          <img
            src="/ayawin-wordmark.svg"
            alt="Ayawin Stock Solutions"
            className="h-10 w-auto max-w-60 object-contain"
          />
        </a>
        <div className="ayawin-topbar-links">
          <span className="ayawin-version">v 1.25.045</span>
          <a href="mailto:ayawin.ke@gmail.com">
            <CircleHelp className="h-4 w-4" /> Support
          </a>
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
                  <span className="ayawin-module-arrow" aria-hidden="true">
                    ↗
                  </span>
                </div>
              ))}
            </div>
            <div className="ayawin-login-copyright">
              © Ayawin Stock Solution
              <br />
              All rights reserved.
            </div>
          </div>

          <aside className="ayawin-login-box">
            <img
              src="/ayawin-wordmark.svg"
              alt="Ayawin Stock Solutions"
              className="mb-3 h-12 w-auto max-w-60 object-contain"
            />
            <div className="ayawin-login-box-title">LOGIN</div>
            <img
              src="/ayawin-wordmark.svg"
              alt="Ayawin Stock Solutions"
              className="ayawin-company-emblem-logo"
            />
            <form className="ayawin-login-fields" onSubmit={handleSubmit(handleSignIn)}>
              <div className="ayawin-login-field">
                <Label htmlFor="username">Email or username</Label>
                <Input id="username" type="text" autoComplete="username" aria-invalid={Boolean(errors.username)} aria-describedby={errors.username ? "username-error" : undefined}
                  {...register("username")} placeholder="Email or username" />
                {errors.username && <p id="username-error" role="alert" className="ayawin-login-error">{errors.username.message}</p>}
              </div>
              <div className="ayawin-login-field">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? "password-error" : undefined}
                  {...register("password")}
                  placeholder="Password"
                />
                {errors.password && <p id="password-error" role="alert" className="ayawin-login-error">{errors.password.message}</p>}
              </div>
              <div className="ayawin-login-actions">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Signing in…" : "Sign In"}
                </Button>
                <a href="mailto:ayawin.ke@gmail.com?subject=Password%20reset%20request">
                  Forgot Password
                </a>
              </div>
              {error && (
                <p role="alert" className="ayawin-login-error">
                  {error}
                </p>
              )}
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
          <div className="ayawin-footer-column">
            <strong>OVERVIEW</strong>
            <a href="#why-ayawin">Why Ayawin</a>
            <a href="#who-uses-ayawin">Who Uses Ayawin</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="ayawin-footer-column">
            <strong>PRODUCT DEMOS</strong>
            <a href="mailto:ayawin.ke@gmail.com?subject=Ayawin%20demo%20request">
              Contact Us for Demo
            </a>
          </div>
          <div className="ayawin-footer-column">
            <strong>SUPPORT</strong>
            <a href="mailto:ayawin.ke@gmail.com">ayawin.ke@gmail.com</a>
          </div>
          <div className="ayawin-footer-column">
            <strong>SOCIAL</strong>
            <span>Follow Ayawin</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
