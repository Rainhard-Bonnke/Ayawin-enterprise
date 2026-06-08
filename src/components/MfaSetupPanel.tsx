import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { v1MfaSetup, v1MfaVerify } from "@/lib/api-v1";
import { toast } from "sonner";

export function MfaSetupPanel({ token }: { token: string | null }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);

  const startSetup = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await v1MfaSetup(token);
      setSecret(data.secret);
      setOtpauthUrl(data.otpauth_url);
      toast.message("Add this secret to Google Authenticator or scan the otpauth URL in a compatible app.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start 2FA setup");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!token || !code.trim()) return;
    setLoading(true);
    try {
      await v1MfaVerify(token, code.trim());
      setEnabled(true);
      setSecret(null);
      toast.success("Two-factor authentication is enabled for your account.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  if (enabled) {
    return <p className="text-sm text-muted-foreground">2FA is enabled on your account.</p>;
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <p className="text-sm text-muted-foreground">
        Protect your account with a time-based one-time password (TOTP). You will enter a code at each sign-in.
      </p>
      {!secret ? (
        <Button type="button" variant="outline" onClick={startSetup} disabled={loading || !token}>
          {loading ? "Preparing…" : "Set up authenticator app"}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Manual entry secret</Label>
            <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{secret}</code>
          </div>
          {otpauthUrl && (
            <p className="text-xs text-muted-foreground break-all">
              Setup URL: {otpauthUrl}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mfa-verify">Verification code</Label>
            <Input
              id="mfa-verify"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              inputMode="numeric"
            />
          </div>
          <Button type="button" onClick={confirm} disabled={loading}>
            {loading ? "Verifying…" : "Enable 2FA"}
          </Button>
        </div>
      )}
    </div>
  );
}
