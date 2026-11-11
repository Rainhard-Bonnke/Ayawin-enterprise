import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, ArrowUpDown, Trash2, ShieldCheck } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchBar } from "@/components/SearchBar";
import { ListPagination } from "@/components/ListPagination";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { normalizeApiUser, v1Api, type ApiUser } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";
import { trackEvent } from "@/lib/event-tracker";
import { describeNetworkScope, describeSessionDevice } from "@/lib/security";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/users")({
  component: UsersPage,
  head: () => ({ meta: [{ title: "Users & Roles - Ayawin Stock Solution" }] }),
});

const roleColor: Record<string, string> = {
  Admin: "",
  Manager: "",
  "Sales Rep": "",
  Warehouse: "",
  Accountant: "",
  Driver: "",
};
const EMPTY_USERS: ApiUser[] = [];

function UsersPage() {
  const { token, user } = useAuth();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({
    username: "",
    full_name: "",
    email: "",
    role: "Sales Rep",
    phone: "",
    password: "",
  });
  const [roleOptions, setRoleOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [roleRows, setRoleRows] = useState<Array<{ id: string; name: string; permissions: string[] }>>([]);
  const [permissionRows, setPermissionRows] = useState<Array<{ id: string; code: string; module: string; action: string }>>([]);
  const [roleDataLoading, setRoleDataLoading] = useState(true);
  const [roleDataError, setRoleDataError] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [draftPermissions, setDraftPermissions] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [savingRolePermissions, setSavingRolePermissions] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaEnabled, setMfaEnabled] = useState(Boolean(user?.mfa_enabled));
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [mfaOtp, setMfaOtp] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [mfaSaving, setMfaSaving] = useState(false);
  const [allowlistRows, setAllowlistRows] = useState<Array<{
    id: string;
    cidr: string;
    description?: string | null;
    role_name?: string | null;
    user_name?: string | null;
  }>>([]);
  const [allowlistForm, setAllowlistForm] = useState({ cidr: "", description: "", role_id: "" });
  const [allowlistSaving, setAllowlistSaving] = useState(false);
  const [sessionRows, setSessionRows] = useState<Array<{
    id: string;
    full_name: string;
    email: string;
    username: string;
    session_type?: string | null;
    device_info?: string | null;
    ip_address?: string | null;
    created_at?: string | null;
  }>>([]);
  const pageSize = 5;
  const usersQuery = useQuery({
    queryKey: [...queryKeys.users.list(), user?.id],
    queryFn: async ({ signal }) =>
      (await v1Api.users.list(token!, "", signal)).map(normalizeApiUser),
    enabled: Boolean(token),
  });
  const rows: ApiUser[] = usersQuery.data ?? EMPTY_USERS;
  const loading = usersQuery.isPending;

  const loadRoleData = useCallback(async () => {
    if (!token) return;
    setRoleDataLoading(true);
    setRoleDataError(null);
    try {
      const [roles, permissions] = await Promise.all([
        v1Api.roles.list(token),
        v1Api.roles.permissions(token),
      ]);
      setRoleRows(roles);
      setRoleOptions(roles.map(({ id, name }) => ({ id, name })));
      setPermissionRows(permissions);
      setSelectedRoleId((current) =>
        roles.length && (!current || !roles.some((role) => role.id === current))
          ? roles[0].id
          : current,
      );
      setInvite((current) =>
        roles.length && !roles.some((role) => role.name === current.role)
          ? { ...current, role: roles[0].name }
          : current,
      );
    } catch (error) {
      setRoleDataError(error instanceof Error ? error.message : "Unable to load roles and permissions.");
    } finally {
      setRoleDataLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadRoleData();
  }, [loadRoleData]);

  const loadSecurity = useCallback(async () => {
    if (!token) return;
    try {
      const [allowlist, sessions] = await Promise.all([
        v1Api.users.listIpWhitelist(token),
        v1Api.users.listSessions(token),
      ]);
      setAllowlistRows(allowlist);
      setSessionRows(sessions);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load security data");
    }
  }, [token]);

  useEffect(() => {
    void loadSecurity();
  }, [loadSecurity]);

  useEffect(() => {
    const activeRole = roleRows.find((role) => role.id === selectedRoleId);
    setDraftPermissions(new Set((activeRole?.permissions ?? []).map(String)));
  }, [selectedRoleId, roleRows]);

  useEffect(() => {
    if (roleOptions.length && !allowlistForm.role_id) {
      setAllowlistForm((prev) => ({ ...prev, role_id: roleOptions[0].id }));
    }
  }, [roleOptions, allowlistForm.role_id]);

  useEffect(() => {
    setMfaEnabled(Boolean(user?.mfa_enabled));
  }, [user?.mfa_enabled]);

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; code: string; action: string }>>();
    for (const permission of permissionRows) {
      const module = permission.module || "General";
      const moduleRows = groups.get(module) ?? [];
      moduleRows.push({ id: permission.id, code: permission.code, action: permission.action });
      groups.set(module, moduleRows.sort((a, b) => a.code.localeCompare(b.code)));
    }
    return Array.from(groups.entries()).map(([module, rows]) => ({ module, rows }));
  }, [permissionRows]);

  const saveRolePermissions = async () => {
    if (!token || !selectedRoleId) return;
    setSavingRolePermissions(true);
    try {
      await v1Api.roles.updatePermissions(token, selectedRoleId, Array.from(draftPermissions));
      await loadRoleData();
      toast.success("Role permissions updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update permissions");
    } finally {
      setSavingRolePermissions(false);
    }
  };

  const createRole = async () => {
    if (!token || !newRoleName.trim()) {
      toast.error("Role name is required");
      return;
    }
    setSaving(true);
    try {
      await v1Api.roles.create(token, {
        name: newRoleName.trim(),
        description: newRoleDescription.trim() || undefined,
      });
      const refreshedRoles = await v1Api.roles.list(token);
      setRoleRows(refreshedRoles);
      setRoleOptions(refreshedRoles.map(({ id, name }) => ({ id, name })));
      const created = refreshedRoles.find((role) => role.name === newRoleName.trim());
      if (created) setSelectedRoleId(created.id);
      setNewRoleName("");
      setNewRoleDescription("");
      setRoleDialogOpen(false);
      toast.success(`Role ${newRoleName.trim()} created`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create role");
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(
    () =>
      rows
        .filter(
          (u) =>
            (role === "all" || u.role === role) &&
            (u.full_name.toLowerCase().includes(q.toLowerCase()) ||
              u.email.toLowerCase().includes(q.toLowerCase()) ||
              u.username.toLowerCase().includes(q.toLowerCase())),
        )
        .sort((a, b) => {
          if (sort === "role") return a.role.localeCompare(b.role);
          if (sort === "status") return a.status.localeCompare(b.status);
          return a.full_name.localeCompare(b.full_name);
        }),
    [rows, role, q, sort],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const refresh = async () => {
    if (token) await usersQuery.refetch();
  };

  const createInvite = async () => {
    if (!token || !invite.username || !invite.full_name || !invite.email || !invite.password) {
      toast.error("Username, name, email, and password are required");
      return;
    }
    setSaving(true);
    try {
      const role_id = roleOptions.find((r) => r.name === invite.role)?.id;
      const created = await v1Api.users.create(token, { ...invite, role_id });
      void trackEvent({
        action: "user_created",
        entityType: "user",
        entityId: String(created.id),
        details: { username: created.username, email: created.email, role: created.role },
        scenario: "hr",
        context: invite,
      });
      toast.success(`User ${created.full_name} created`);
      setInviteOpen(false);
      setInvite({
        username: "",
        full_name: "",
        email: "",
        role: invite.role,
        phone: "",
        password: "",
      });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setSaving(false);
    }
  };

  const setupMfa = async () => {
    if (!token || !mfaPassword) {
      toast.error("Enter your current password to continue");
      return;
    }
    setMfaSaving(true);
    try {
      setMfaSetup(await v1Api.auth.setupMfa(token, mfaPassword));
      setMfaOtp("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start MFA setup");
    } finally {
      setMfaSaving(false);
    }
  };

  const verifyMfa = async () => {
    if (!token || !mfaOtp.trim()) return;
    setMfaSaving(true);
    try {
      const result = await v1Api.auth.verifyMfa(token, mfaOtp.trim());
      setRecoveryCodes(result.recovery_codes);
      setMfaEnabled(result.mfa_enabled);
      setMfaSetup(null);
      setMfaPassword("");
      setMfaOtp("");
      toast.success("Multi-factor authentication enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to verify MFA token");
    } finally {
      setMfaSaving(false);
    }
  };

  const createIpWhitelistRule = async () => {
    if (!token || !allowlistForm.cidr.trim()) {
      toast.error("A valid CIDR range is required");
      return;
    }
    setAllowlistSaving(true);
    try {
      await v1Api.users.createIpWhitelist(token, {
        cidr: allowlistForm.cidr.trim(),
        description: allowlistForm.description.trim() || undefined,
        role_id: allowlistForm.role_id || undefined,
      });
      setAllowlistForm((prev) => ({ ...prev, cidr: "", description: "" }));
      await loadSecurity();
      toast.success("IP allowlist rule created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create the allowlist rule");
    } finally {
      setAllowlistSaving(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    if (!token) return;
    try {
      await v1Api.users.revokeSession(token, sessionId);
      await loadSecurity();
      toast.success("Session revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to revoke session");
    }
  };

  return (
    <div>
      <PageHeader
        title="Users & Access Control"
        description="Role-based permissions across all modules, plus password reset, activity logs and 2FA."
        actions={
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Invite User
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Invite User</DialogTitle>
                <DialogDescription>
                  Create a new ERP account and assign a module role.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <Field
                  label="Username"
                  value={invite.username}
                  onChange={(v) => setInvite((prev) => ({ ...prev, username: v }))}
                />
                <Field
                  label="Full name"
                  value={invite.full_name}
                  onChange={(v) => setInvite((prev) => ({ ...prev, full_name: v }))}
                />
                <Field
                  label="Email"
                  value={invite.email}
                  onChange={(v) => setInvite((prev) => ({ ...prev, email: v }))}
                />
                <Field
                  label="Phone"
                  value={invite.phone}
                  onChange={(v) => setInvite((prev) => ({ ...prev, phone: v }))}
                />
                <Field
                  label="Password"
                  value={invite.password}
                  onChange={(v) => setInvite((prev) => ({ ...prev, password: v }))}
                  type="password"
                />
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Role</Label>
                  <Select
                    value={invite.role}
                    onValueChange={(value) => setInvite((prev) => ({ ...prev, role: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(roleOptions.length
                        ? roleOptions.map((r) => r.name)
                        : Object.keys(roleColor)
                      ).map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={createInvite} disabled={saving}>
                  {saving ? "Creating…" : "Create user"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Users", v: String(rows.length) },
          {
            l: "Active",
            v: String(rows.filter((u) => u.status.toLowerCase() === "active").length),
          },
          { l: "2FA Enabled", v: String(rows.filter((u) => u.two_factor_enabled).length) },
          { l: "Recent Logins", v: String(rows.filter((u) => u.last_login).length) },
        ].map((k) => (
          <Card key={k.l}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
              <div className="mt-1 text-2xl font-bold">{k.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Your multi-factor authentication</h2>
              <p className="text-sm text-muted-foreground">
                {mfaEnabled
                  ? "MFA is enabled for your account."
                  : "Add an authenticator app to protect your account."}
              </p>
            </div>
          </div>

          {!mfaEnabled && !mfaSetup && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Current password" value={mfaPassword} onChange={setMfaPassword} type="password" />
              <div className="flex items-end">
                <Button onClick={setupMfa} disabled={mfaSaving || !mfaPassword}>
                  {mfaSaving ? "Starting..." : "Set up MFA"}
                </Button>
              </div>
            </div>
          )}

          {mfaSetup && (
            <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Authenticator setup key</Label>
                <code className="block break-all rounded-md bg-muted p-3 text-sm">{mfaSetup.secret}</code>
                <p className="break-all text-xs text-muted-foreground">{mfaSetup.otpauth_url}</p>
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Field label="6-digit verification code" value={mfaOtp} onChange={setMfaOtp} inputMode="numeric" />
                <Button onClick={verifyMfa} disabled={mfaSaving || !mfaOtp.trim()}>
                  {mfaSaving ? "Verifying..." : "Verify and enable"}
                </Button>
                <Button variant="ghost" onClick={() => setMfaSetup(null)} disabled={mfaSaving}>
                  Cancel setup
                </Button>
              </div>
            </div>
          )}

          {recoveryCodes && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4" role="status">
              <div className="font-semibold">Save your recovery codes now</div>
              <p className="mb-3 text-sm text-muted-foreground">
                Each code can be used once. They will not be shown again after you dismiss this panel.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {recoveryCodes.map((code) => (
                  <code key={code} className="rounded bg-background px-2 py-1 text-center text-sm">
                    {code}
                  </code>
                ))}
              </div>
              <Button className="mt-3" variant="outline" onClick={() => setRecoveryCodes(null)}>
                Dismiss recovery codes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Access restriction rules</h2>
              <p className="text-sm text-muted-foreground">
                Restrict sign-ins to trusted networks before users can access the ERP.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)]">
            <Field
              label="CIDR range"
              value={allowlistForm.cidr}
              onChange={(value) => setAllowlistForm((prev) => ({ ...prev, cidr: value }))}
              placeholder="10.36.0.0/16"
            />
            <div className="space-y-1.5">
              <Label>Role scope</Label>
              <Select
                value={allowlistForm.role_id || roleOptions[0]?.id || ""}
                onValueChange={(value) => setAllowlistForm((prev) => ({ ...prev, role_id: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose role" />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={() => void createIpWhitelistRule()} disabled={allowlistSaving || !allowlistForm.cidr.trim()}>
                {allowlistSaving ? "Saving…" : "Add rule"}
              </Button>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {allowlistRows.length === 0 && (
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                No IP allowlist rules configured for this company.
              </div>
            )}
            {allowlistRows.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{describeNetworkScope(rule)}</div>
                  {rule.description && (
                    <div className="text-xs text-muted-foreground">{rule.description}</div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={async () => {
                    if (!token) return;
                    try {
                      await v1Api.users.deleteIpWhitelist(token, rule.id);
                      await loadSecurity();
                      toast.success("IP allowlist rule removed");
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Unable to remove rule");
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Active sessions</h2>
              <p className="text-sm text-muted-foreground">
                Review and revoke current device sessions for your team.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {sessionRows.length === 0 && (
              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                No active sessions for this company.
              </div>
            )}
            {sessionRows.map((session) => (
              <div key={session.id} className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium">{session.full_name || session.username}</div>
                  <div className="text-xs text-muted-foreground">{session.email}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {describeSessionDevice(session)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{session.session_type || "user"}</Badge>
                  <Button variant="outline" size="sm" onClick={() => void revokeSession(session.id)}>
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchBar
              value={q}
              onChange={(value) => {
                setQ(value);
                setPage(1);
              }}
              placeholder="Search user or email..."
            />
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {(roleOptions.length ? roleOptions.map((r) => r.name) : Object.keys(roleColor)).map(
                  (r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-40">
                <ArrowUpDown className="mr-2 h-4 w-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort by name</SelectItem>
                <SelectItem value="role">Sort by role</SelectItem>
                <SelectItem value="status">Sort by status</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-destructive">
                    {usersQuery.error instanceof Error ? usersQuery.error.message : "Failed to load users"}
                    <Button variant="ghost" size="sm" onClick={() => void usersQuery.refetch()}>Retry</Button>
                  </TableCell>
                </TableRow>
              ) : loading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Loading users...
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    <TableCell className="text-xs">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={roleColor[u.role] || ""}>
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={u.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.last_login ? new Date(u.last_login).toLocaleString("en-GB") : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <ConfirmActionDialog
                        title="Deactivate user?"
                        description="This will disable access for the selected user until their account is re-enabled."
                        confirmLabel="Deactivate"
                        onConfirm={async () => {
                          if (!token) return;
                          await v1Api.users.update(token, u.id, { status: "inactive" });
                          void trackEvent({
                            action: "user_deactivated",
                            entityType: "user",
                            entityId: String(u.id),
                            details: { name: u.full_name, email: u.email, role: u.role },
                            scenario: "hr",
                            context: { name: u.full_name, role: u.role },
                          });
                          toast.success(`User ${u.full_name} deactivated`);
                          await refresh();
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Deactivate
                        </Button>
                      </ConfirmActionDialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
              {!loading && !usersQuery.isError && paged.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No users match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <ListPagination
            page={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Roles & permissions</h2>
              <p className="text-sm text-muted-foreground">
                Review the live ERP permission matrix and update access for each role.
              </p>
            </div>
            <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">Create role</Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create new role</DialogTitle>
                  <DialogDescription>Define a role and assign permissions after creation.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label>Role name</Label>
                    <Input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Input value={newRoleDescription} onChange={(e) => setNewRoleDescription(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRoleDialogOpen(false)}>Cancel</Button>
                  <Button onClick={createRole} disabled={saving || !newRoleName.trim()}>
                    {saving ? "Creating…" : "Create role"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Roles
              </div>
              {roleDataLoading && (
                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  Loading roles...
                </div>
              )}
              {roleDataError && (
                <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
                  <p>{roleDataError}</p>
                  <Button variant="ghost" size="sm" onClick={() => void loadRoleData()}>
                    Retry
                  </Button>
                </div>
              )}
              {!roleDataLoading && !roleDataError && roleRows.length === 0 && (
                <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  No roles loaded.
                </div>
              )}
              {!roleDataError && roleRows.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedRoleId(role.id)}
                  className={[
                    "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    selectedRoleId === role.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background hover:bg-muted",
                  ].join(" ")}
                >
                  <span className="font-medium">{role.name}</span>
                  <span className="text-xs text-muted-foreground">{role.permissions?.length ?? 0}</span>
                </button>
              ))}
            </div>

            <div className="rounded-xl border p-3">
              {roleDataError ? (
                <div className="flex h-full min-h-56 items-center justify-center text-sm text-muted-foreground">
                  Role permissions are unavailable. Retry loading the roles list.
                </div>
              ) : roleDataLoading ? (
                <div className="flex h-full min-h-56 items-center justify-center text-sm text-muted-foreground">
                  Loading permission matrix...
                </div>
              ) : selectedRoleId ? (
                <>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Active role
                      </div>
                      <div className="text-lg font-semibold">
                        {roleRows.find((role) => role.id === selectedRoleId)?.name}
                      </div>
                    </div>
                    <Button onClick={saveRolePermissions} disabled={savingRolePermissions}>
                      {savingRolePermissions ? "Saving…" : "Save permissions"}
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {groupedPermissions.map(({ module, rows }) => (
                      <div key={module} className="rounded-lg border p-3">
                        <div className="mb-2 text-sm font-semibold text-foreground">{module}</div>
                        <div className="space-y-2">
                          {rows.map((permission) => {
                            const checked = draftPermissions.has(permission.code);
                            return (
                              <label key={permission.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-muted/50">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() =>
                                    setDraftPermissions((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(permission.code)) next.delete(permission.code);
                                      else next.add(permission.code);
                                      return next;
                                    })
                                  }
                                />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium capitalize">{permission.action}</div>
                                  <div className="text-xs text-muted-foreground">{permission.code}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-full min-h-56 items-center justify-center text-sm text-muted-foreground">
                  Select a role to manage permissions.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  inputMode,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
