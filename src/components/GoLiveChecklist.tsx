import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, ExternalLink, RefreshCw } from "lucide-react";
import { fetchGoLiveStatus, v1ChangePassword, type GoLiveStatus } from "@/lib/api-v1";
import { toast } from "sonner";

type Props = {
  token: string | null;
};

export function GoLiveChecklist({ token }: Props) {
  const [status, setStatus] = useState<GoLiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setStatus(await fetchGoLiveStatus(token));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load go-live status");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const changePassword = async () => {
    if (!token) return;
    if (newPw.length < 12) {
      toast.error("New password must be at least 12 characters");
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("Passwords do not match");
      return;
    }
    setSavingPw(true);
    try {
      await v1ChangePassword(token, { current_password: currentPw, new_password: newPw });
      toast.success("Password updated");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to change password");
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Go-live checklist</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {status && (
            <div className="flex items-center gap-2">
              <Badge variant={status.ready ? "default" : "secondary"}>
                {status.pass_count}/{status.total} complete
              </Badge>
              {status.ready && <span className="text-sm text-muted-foreground">Ready for production traffic</span>}
            </div>
          )}
          <ul className="space-y-2">
            {(status?.checklist ?? []).map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                {item.pass ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div>
                  <div className="font-medium">{item.label}</div>
                  {!item.pass && item.hint && (
                    <div className="text-muted-foreground">{item.hint}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Server-side checks reflect backend environment variables. See{" "}
            <code className="rounded bg-muted px-1">docs/OPERATOR-GO-LIVE.md</code> for CLI steps.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change your password</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:max-w-md">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <Input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label>New password (min 12 characters)</Label>
            <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" />
          </div>
          <Button onClick={() => void changePassword()} disabled={savingPw}>
            Update password
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PDF sign-off</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Download sample invoice, receipt, and payslip PDFs for client approval before go-live.</p>
          <Button variant="outline" size="sm" asChild>
            <a href="/PDF-SIGNOFF-CHECKLIST.md" target="_blank" rel="noreferrer">
              Open sign-off checklist
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
          <p className="text-xs">Generate PDFs from Invoices and HR after company KRA PIN is saved under Company settings.</p>
        </CardContent>
      </Card>
    </div>
  );
}
