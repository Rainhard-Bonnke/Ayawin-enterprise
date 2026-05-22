import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ArrowUpDown, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchBar } from "@/components/SearchBar";
import { ListPagination } from "@/components/ListPagination";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { createUser, fetchUsers, type BackendUser, updateUser } from "@/lib/api";
import { trackEvent } from "@/lib/event-tracker";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/users")({
  component: UsersPage,
  head: () => ({ meta: [{ title: "Users & Roles - Ayawin Enterprise ERP" }] }),
});

const roleColor: Record<string, string> = {
  Admin: "bg-navy text-navy-foreground",
  Manager: "bg-gold text-gold-foreground",
  "Sales Rep": "bg-blue-500/15 text-blue-600 border-blue-500/30",
  Warehouse: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  Accountant: "bg-green-500/15 text-green-700 border-green-500/30",
  Driver: "bg-purple-500/15 text-purple-700 border-purple-500/30",
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
  const [invite, setInvite] = useState({ username: "", full_name: "", email: "", role: "Sales Rep", phone: "" });
  const pageSize = 5;

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    void fetchUsers(token)
      .then((data) => setRows(data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
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
    if (!token || !invite.username || !invite.full_name || !invite.email) return;
    const created = await createUser(token, invite);
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
    setInvite({ username: "", full_name: "", email: "", role: "Sales Rep", phone: "" });
    await refresh();
  };

  return (
    <div>
      <PageHeader
        title="Users & Access Control"
        description="Role-based permissions across all modules, plus password reset, activity logs and 2FA."
        actions={
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button className="bg-navy text-navy-foreground hover:bg-navy/90">
                <Plus className="mr-2 h-4 w-4" />
                Invite User
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle className="font-display">Invite User</DialogTitle>
                <DialogDescription>Create a new ERP account and assign a module role.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2 sm:grid-cols-2">
                <Field label="Username" value={invite.username} onChange={(v) => setInvite((prev) => ({ ...prev, username: v }))} />
                <Field label="Full name" value={invite.full_name} onChange={(v) => setInvite((prev) => ({ ...prev, full_name: v }))} />
                <Field label="Email" value={invite.email} onChange={(v) => setInvite((prev) => ({ ...prev, email: v }))} />
                <Field label="Phone" value={invite.phone} onChange={(v) => setInvite((prev) => ({ ...prev, phone: v }))} />
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Role</Label>
                  <Select value={invite.role} onValueChange={(value) => setInvite((prev) => ({ ...prev, role: value }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(roleColor).map((r) => (
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
                <Button className="bg-navy text-navy-foreground hover:bg-navy/90" onClick={createInvite}>
                  Create user
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Users", v: String(rows.length) },
          { l: "Active", v: String(rows.filter((u) => u.status.toLowerCase() === "active").length) },
          { l: "2FA Enabled", v: String(rows.filter((u) => u.two_factor_enabled).length) },
          { l: "Recent Logins", v: String(rows.filter((u) => u.last_login).length) },
        ].map((k) => (
          <Card key={k.l}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
              <div className="mt-1 font-display text-2xl font-bold">{k.v}</div>
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
                {Object.keys(roleColor).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
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
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
