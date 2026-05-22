import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { warehouses } from "@/lib/mock-data";
import { KES } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchBar } from "@/components/SearchBar";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { useState } from "react";
import { toast } from "sonner";
import { trackEvent } from "@/lib/event-tracker";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings - Ayawin Enterprise ERP" }] }),
});

function SettingsPage() {
  const [warehouseQ, setWarehouseQ] = useState("");
  const filteredWarehouses = warehouses.filter((w) =>
    `${w.name} ${w.location} ${w.manager}`.toLowerCase().includes(warehouseQ.toLowerCase()),
  );

  return (
    <div>
      <PageHeader title="System Settings" description="Company profile, taxes, module access, backups and notifications." />

      <Tabs defaultValue="company">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="tax">Tax & Excise</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Company Profile</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Company Name" value="Ayawin Enterprise ERP Ltd" />
              <Field label="Company PIN" value="P051999999Z" />
              <Field label="VAT Registration" value="0123456789" />
              <Field label="ETR / TIMS Serial" value="KRACU0010000123" />
              <Field label="Phone" value="+254 711 100 200" />
              <Field label="Email" value="info@ayawinenterprise.co.ke" />
              <Field label="Physical Address" value="Industrial Area, Nairobi" className="sm:col-span-2" />
              <Field label="Financial Year Start" value="01/01/2026" />
              <Field label="Default Currency" value="KES" />
              <div className="sm:col-span-2">
                <Button
                  className="bg-navy text-navy-foreground hover:bg-navy/90"
                  onClick={() => {
                    void trackEvent({
                      action: "settings_company_saved",
                      entityType: "settings",
                      entityId: "company",
                      details: { company: "Ayawin Enterprise ERP Ltd", currency: "KES" },
                      scenario: "reports",
                      context: { tab: "company" },
                    });
                    toast.success("Company profile saved");
                  }}
                >
                  Save changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Tax & Excise Rates</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Excise Rate</TableHead>
                    <TableHead>VAT</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ["Beer", "KES 121.85 / litre"],
                    ["Spirits", "KES 356.28 / litre"],
                    ["Wine", "KES 229.85 / litre"],
                    ["Soft Drinks", "KES 10.68 / litre"],
                    ["Juice", "KES 10.68 / litre"],
                    ["Water", "-"],
                  ].map(([c, r]) => (
                    <TableRow key={c}>
                      <TableCell className="font-medium">{c}</TableCell>
                      <TableCell>{r}</TableCell>
                      <TableCell>16%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="warehouses" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <SearchBar value={warehouseQ} onChange={setWarehouseQ} placeholder="Search warehouse or manager..." />
                <div className="ml-auto text-xs text-muted-foreground">
                  {filteredWarehouses.length} warehouses
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Manager</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWarehouses.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell>{w.location}</TableCell>
                      <TableCell>{w.manager}</TableCell>
                    </TableRow>
                  ))}
                  {filteredWarehouses.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-10 text-center text-sm text-muted-foreground">
                        No warehouses match your filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Toggle label="Email when invoice goes overdue" defaultOn />
              <Toggle label="Email daily sales summary at 18:00 EAT" defaultOn />
              <Toggle label="SMS driver on delivery assignment" defaultOn />
              <Toggle label="Alert when stock falls below minimum" defaultOn />
              <Toggle label="Alert 30 days before product expiry" defaultOn />
              <Toggle label="Weekly KRA filing reminder" />
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    void trackEvent({
                      action: "settings_notifications_saved",
                      entityType: "settings",
                      entityId: "notifications",
                      details: { warehouseQ, enabled: true },
                      scenario: "reports",
                      context: { tab: "notifications" },
                    });
                    toast.success("Notification settings saved");
                  }}
                >
                  Save notifications
                </Button>
                <ConfirmActionDialog
                  title="Restore backup?"
                  description="This will replace the current environment settings with the last saved backup."
                  confirmLabel="Restore"
                  onConfirm={() => {
                    void trackEvent({
                      action: "settings_backup_restore_queued",
                      entityType: "settings",
                      entityId: "backup",
                      details: { requested: true },
                      scenario: "reports",
                      context: { tab: "notifications" },
                    });
                    toast.success("Backup restore queued");
                  }}
                >
                  <Button variant="destructive">Restore backup</Button>
                </ConfirmActionDialog>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Security and Access</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Toggle label="Require 2FA for admins and accountants" defaultOn />
              <Toggle label="Log every destructive action" defaultOn />
              <Toggle label="Restrict modules by role" defaultOn />
              <Toggle label="Enable password rotation reminders" />
              <div className="sm:col-span-2 flex flex-wrap gap-2 pt-2">
                <Button
                  className="bg-navy text-navy-foreground hover:bg-navy/90"
                  onClick={() => {
                    void trackEvent({
                      action: "settings_security_saved",
                      entityType: "settings",
                      entityId: "security",
                      details: { twoFactor: true, moduleRestrictions: true },
                      scenario: "reports",
                      context: { tab: "security" },
                    });
                    toast.success("Security settings saved");
                  }}
                >
                  Save security settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <div className="mt-4 text-xs text-muted-foreground">
        Stock value tracked: {KES(warehouses.length * 12000000)} approx | Last backup: 20/05/2026 03:00 EAT
      </div>
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      <Input defaultValue={value} />
    </div>
  );
}

function Toggle({ label, defaultOn }: { label: string; defaultOn?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border p-3">
      <span className="text-sm">{label}</span>
      <Switch defaultChecked={defaultOn} />
    </div>
  );
}
