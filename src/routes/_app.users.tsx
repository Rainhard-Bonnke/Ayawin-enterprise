import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { users } from "@/lib/mock-data";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_app/users")({
  component: UsersPage,
  head: () => ({ meta: [{ title: "Users & Roles — Martin Enterprise ERP" }] }),
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
  return (
    <div>
      <PageHeader
        title="Users & Access Control"
        description="Role-based permissions across all modules. 2FA available."
        actions={<Button className="bg-navy text-navy-foreground hover:bg-navy/90"><Plus className="mr-2 h-4 w-4" />Invite User</Button>}
      />

      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader><TableRow>
              <TableHead>User</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead>
              <TableHead>Status</TableHead><TableHead>Last Login</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-xs">{u.email}</TableCell>
                  <TableCell><Badge variant="outline" className={roleColor[u.role]}>{u.role}</Badge></TableCell>
                  <TableCell><StatusBadge status={u.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(u.lastLogin).toLocaleString("en-GB")}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm">Manage</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
