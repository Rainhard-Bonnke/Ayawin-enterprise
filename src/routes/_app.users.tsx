import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ArrowUpDown, Trash2, Save } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchBar } from "@/components/SearchBar";
import { ListPagination } from "@/components/ListPagination";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { PermissionGate } from "@/components/PermissionGate";
import { useAuth } from "@/lib/auth";
import {
  createUser,
  inviteUserRequest,
  fetchPermissions,
  fetchRoles,
  fetchRolesWithPermissions,
  fetchUsers,
  saveRolePermissions,
  type BackendUser,
  updateUser,
} from "@/lib/api";
import { isV1Enabled } from "@/lib/api-v1";
import { trackEvent } from "@/lib/event-tracker";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/users")({
  component: UsersPage,
  head: () => ({ meta: [{ title: "Users & Roles - Ayawin Stock Solutions ERP" }] }),
});

const roleColor: Record<string, string> = {
  Admin: "",
  Manager: "",
  "Sales Rep": "",
  Warehouse: "",
  Accountant: "",
  Driver: "",
};

function UsersPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<BackendUser[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [saving, setSaving] = useState(false);
  const [inviteByEmail, setInviteByEmail] = useState(true);
  const pageSize = 5;

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    void fetchUsers(token)
      .then((data) => setRows(data))
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load users");
        setRows([]);
      })
      .finally(() => setLoading(false));
    void fetchRoles(token)
      .then((roles) => {
        setRoleOptions(roles);
        if (roles.length && !roles.some((r) => r.name === invite.role)) {
          setInvite((prev) => ({ ...prev, role: roles[0].name }));
        }
      })
      .catch(() => setRoleOptions([]));
  }, [token]);

  const filtered = useMemo(
    () =>
      rows
        .filter((u) => (role === "all" || u.role === role) && (u.full_name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()) || u.username.toLowerCase().includes(q.toLowerCase())))
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
    if (!token) return;
    const data = await fetchUsers(token);
    setRows(data);
  };

  const createInvite = async () => {
    if (!token || !invite.full_name || !invite.email) {
      toast.error("Name and email are required");
      return;
    }
    if (!inviteByEmail && (!invite.username || !invite.password)) {
      toast.error("Username and password are required for manual accounts");
      return;
    }
    setSaving(true);
    try {
      const role_id = roleOptions.find((r) => r.name === invite.role)?.id;
      if (inviteByEmail && isV1Enabled()) {
        const result = await inviteUserRequest(token, {
          email: invite.email,
          full_name: invite.full_name,
          username: invite.username || undefined,
          role_id,
          phone: invite.phone || undefined,
        });
        toast.success(result.message);
        if (result.dev_token) {
          toast.message(`Dev invite link token: ${result.dev_token}`, { duration: 15000 });
        }
      } else {
        const created = await createUser(token, { ...invite, role_id });
        void trackEvent({
          action: "user_created",
          entityType: "user",
          entityId: String(created.id),
          details: { username: created.username, email: created.email, role: created.role },
          scenario: "hr",
          context: invite,
        });
        toast.success(`User ${created.full_name} created`);
      }
      setInviteOpen(false);
      setInvite({ username: "", full_name: "", email: "", role: invite.role, phone: "", password: "" });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Users & Access Control"
        description="Role-based permissions across all modules, plus password reset, activity logs and 2FA."
        actions={
          <PermissionGate permission="users.create">
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
                  {inviteByEmail
                    ? "Sends an email with a secure link to set their password (expires in 24 hours)."
                    : "Create an account with a password you share securely."}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox
                  id="invite-email"
                  checked={inviteByEmail}
                  onCheckedChange={(v) => setInviteByEmail(v === true)}
                  disabled={!isV1Enabled()}
                />
                <Label htmlFor="invite-email" className="text-sm font-normal">
                  Email invite (recommended)
                </Label>
              </div>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <Field label="Username" value={invite.username} onChange={(v) => setInvite((prev) => ({ ...prev, username: v }))} />
                <Field label="Full name" value={invite.full_name} onChange={(v) => setInvite((prev) => ({ ...prev, full_name: v }))} />
                <Field label="Email" value={invite.email} onChange={(v) => setInvite((prev) => ({ ...prev, email: v }))} />
                <Field label="Phone" value={invite.phone} onChange={(v) => setInvite((prev) => ({ ...prev, phone: v }))} />
                {!inviteByEmail && (
                  <Field label="Password" value={invite.password} onChange={(v) => setInvite((prev) => ({ ...prev, password: v }))} type="password" />
                )}
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Role</Label>
                  <Select value={invite.role} onValueChange={(value) => setInvite((prev) => ({ ...prev, role: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(roleOptions.length ? roleOptions.map((r) => r.name) : Object.keys(roleColor)).map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button onClick={createInvite} disabled={saving}>
                  {saving ? "Creating…" : "Create user"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </PermissionGate>
        }
      />

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="roles">Roles & Permissions</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Users", v: String(rows.length) },
          { l: "Active", v: String(rows.filter((u) => u.status.toLowerCase() === "active").length) },
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

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchBar value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search user or email..." />
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {(roleOptions.length ? roleOptions.map((r) => r.name) : Object.keys(roleColor)).map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
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
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">Loading users...</TableCell>
                </TableRow>
              ) : paged.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.full_name}</TableCell>
                  <TableCell className="text-xs">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={roleColor[u.role] || ""}>{u.role}</Badge>
                  </TableCell>
                  <TableCell><StatusBadge status={u.status} /></TableCell>
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
                        await updateUser(token, u.id, { status: "inactive" });
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
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Deactivate
                      </Button>
                    </ConfirmActionDialog>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && paged.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No users match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <ListPagination page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} />
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="roles">
          <RolePermissionsPanel token={token} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type PermissionRow = { id: string; code: string; module: string; action: string; description?: string };
type RoleWithPerms = { id: string; name: string; permissions?: string[] };

function RolePermissionsPanel({ token }: { token: string | null }) {
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [roles, setRoles] = useState<RoleWithPerms[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [moduleFilter, setModuleFilter] = useState("all");

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([fetchPermissions(token), fetchRolesWithPermissions(token)])
      .then(([perms, roleRows]) => {
        setPermissions(perms);
        setRoles(roleRows);
        if (roleRows.length) {
          setSelectedRoleId(roleRows[0].id);
          setSelectedCodes(new Set(roleRows[0].permissions ?? []));
        }
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load roles");
        setPermissions([]);
        setRoles([]);
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    const role = roles.find((r) => r.id === selectedRoleId);
    setSelectedCodes(new Set(role?.permissions ?? []));
  }, [selectedRoleId, roles]);

  const modules = useMemo(
    () => [...new Set(permissions.map((p) => p.module))].sort(),
    [permissions],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionRow[]>();
    for (const p of permissions) {
      if (moduleFilter !== "all" && p.module !== moduleFilter) continue;
      const list = map.get(p.module) ?? [];
      list.push(p);
      map.set(p.module, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [permissions, moduleFilter]);

  const toggle = (code: string, checked: boolean) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  };

  const toggleModule = (module: string, checked: boolean) => {
    const codes = permissions.filter((p) => p.module === module).map((p) => p.code);
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      for (const code of codes) {
        if (checked) next.add(code);
        else next.delete(code);
      }
      return next;
    });
  };

  const save = async () => {
    if (!token || !selectedRoleId) return;
    setSaving(true);
    try {
      await saveRolePermissions(token, selectedRoleId, [...selectedCodes]);
      setRoles((prev) =>
        prev.map((r) => (r.id === selectedRoleId ? { ...r, permissions: [...selectedCodes] } : r)),
      );
      toast.success("Role permissions updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save permissions");
    } finally {
      setSaving(false);
    }
  };

  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] space-y-1.5">
            <Label>Role</Label>
            <Select value={selectedRoleId} onValueChange={setSelectedRoleId} disabled={loading || !roles.length}>
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px] space-y-1.5">
            <Label>Module</Label>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modules</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => void save()} disabled={saving || !selectedRoleId || loading}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : "Save permissions"}
          </Button>
          {selectedRole && (
            <Badge variant="outline" className="mb-0.5">
              {selectedCodes.size} of {permissions.length} granted
            </Badge>
          )}
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading permission matrix…</p>
        ) : !roles.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No roles found. Sign in with the live API to manage permissions.
          </p>
        ) : (
          <div className="space-y-6">
            {grouped.map(([module, perms]) => {
              const moduleCodes = perms.map((p) => p.code);
              const allOn = moduleCodes.every((c) => selectedCodes.has(c));
              const someOn = moduleCodes.some((c) => selectedCodes.has(c));
              return (
                <div key={module}>
                  <div className="mb-2 flex items-center gap-2">
                    <Checkbox
                      checked={allOn ? true : someOn ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleModule(module, v === true)}
                      id={`mod-${module}`}
                    />
                    <Label htmlFor={`mod-${module}`} className="text-sm font-semibold capitalize">
                      {module.replace(/_/g, " ")}
                    </Label>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12" />
                        <TableHead>Permission</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {perms.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedCodes.has(p.code)}
                              onCheckedChange={(v) => toggle(p.code, v === true)}
                              aria-label={p.code}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{p.code}</TableCell>
                          <TableCell>{p.action}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.description ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
