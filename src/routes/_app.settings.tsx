import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { normalizeMasterWarehouse, v1Api } from "@/lib/api-v1";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EMPTY_ARRAY, useList } from "@/lib/queryHooks";
import { queryKeys } from "@/lib/queryKeys";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchBar } from "@/components/SearchBar";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { toast } from "sonner";
import { trackEvent } from "@/lib/event-tracker";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings - Ayawin Stock Solution" }] }),
});

function SettingsPage() {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [tab, setTab] = useState(() => hash.replace(/^#/, "") || "company");
  const [warehouseQ, setWarehouseQ] = useState("");
  const [templateCode, setTemplateCode] = useState("invoice_overdue");
  const [templateChannel, setTemplateChannel] = useState("email");
  const [templateSubject, setTemplateSubject] = useState("Invoice follow-up");
  const [templateBody, setTemplateBody] = useState(
    "Hello {{customer_name}}, your invoice {{invoice_number}} is due.",
  );

  const settingsQuery = useList(
    queryKeys.settings.workspace(user?.id),
    async ({ signal }) => {
      const [warehouseData, etimsSettings, mpesaSettings, templateResult] = await Promise.all([
        v1Api.master.warehouses(token!, signal),
        v1Api.integrations.providerSettings(token!, "etims", "sandbox", signal).catch(() => null),
        v1Api.integrations.providerSettings(token!, "mpesa", "sandbox", signal).catch(() => null),
        v1Api.integrations.notificationTemplates(token!, signal).catch(() => ({ templates: [] })),
      ]);
      const warehouses = warehouseData.map((row) => {
        const warehouse = normalizeMasterWarehouse(row);
        return {
          id: warehouse.id,
          name: warehouse.name,
          location: warehouse.address,
          manager: warehouse.manager || "—",
        };
      });
      return {
        warehouses,
        etimsSettings: etimsSettings as Record<string, unknown> | null,
        mpesaSettings: mpesaSettings as Record<string, unknown> | null,
        templates: templateResult.templates || [],
      };
    },
    { enabled: Boolean(token) },
  );
  const warehouseRows = settingsQuery.data?.warehouses ?? [];
  const etimsSettings = settingsQuery.data?.etimsSettings ?? null;
  const mpesaSettings = settingsQuery.data?.mpesaSettings ?? null;
  const templates = settingsQuery.data?.templates ?? EMPTY_ARRAY;
  const maskedToken = useMemo(() => {
    const value = String(
      (mpesaSettings?.public_config as Record<string, unknown> | undefined)?.callbackBaseUrl || "",
    );
    if (!value) return "Not configured";
    return value.replace(/https?:\/\//, "").replace(/\b([A-Za-z0-9._%+-]+)@/, "***@");
  }, [mpesaSettings]);
  useEffect(() => {
    const first = templates[0];
    if (!first) return;
    setTemplateCode(String(first.template_code || "invoice_overdue"));
    setTemplateChannel(String(first.channel || "email"));
    setTemplateSubject(String(first.subject_template || ""));
    setTemplateBody(String(first.message_template || ""));
  }, [templates]);

  const filteredWarehouses = warehouseRows.filter((w) =>
    `${w.name} ${w.location} ${w.manager}`.toLowerCase().includes(warehouseQ.toLowerCase()),
  );

  useEffect(() => {
    const nextTab = hash.replace(/^#/, "");
    if (["company", "tax", "warehouses", "notifications", "security"].includes(nextTab))
      setTab(nextTab);
  }, [hash]);

  const handleEtimsInitialize = async () => {
    if (!token) return;
    try {
      const result = await v1Api.integrations.initializeEtims(token, { environment: "sandbox" });
      queryClient.setQueryData<{
        warehouses: Array<{ id: string; name: string; location: string; manager: string }>;
        etimsSettings: Record<string, unknown> | null;
        mpesaSettings: Record<string, unknown> | null;
        templates: Array<Record<string, unknown>>;
      }>(queryKeys.settings.workspace(user?.id), (previous) =>
        previous
          ? {
              ...previous,
              etimsSettings: { ...(previous.etimsSettings || {}), last_result: result },
            }
          : previous,
      );
      toast.success("eTIMS device initialised");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to initialise eTIMS");
    }
  };

  const handleEtimsTest = async () => {
    if (!token) return;
    try {
      const result = await v1Api.integrations.testEtimsConnection(token, {
        environment: "sandbox",
      });
      queryClient.setQueryData<{
        warehouses: Array<{ id: string; name: string; location: string; manager: string }>;
        etimsSettings: Record<string, unknown> | null;
        mpesaSettings: Record<string, unknown> | null;
        templates: Array<Record<string, unknown>>;
      }>(queryKeys.settings.workspace(user?.id), (previous) =>
        previous
          ? {
              ...previous,
              etimsSettings: { ...(previous.etimsSettings || {}), test_result: result },
            }
          : previous,
      );
      toast.success("eTIMS connection test passed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "eTIMS connection test failed");
    }
  };

  const handleRotateMpesaToken = async () => {
    if (!token) return;
    try {
      const result = await v1Api.integrations.rotateMpesaCallbackToken(token, {
        environment: "sandbox",
      });
      queryClient.setQueryData<{
        warehouses: Array<{ id: string; name: string; location: string; manager: string }>;
        etimsSettings: Record<string, unknown> | null;
        mpesaSettings: Record<string, unknown> | null;
        templates: Array<Record<string, unknown>>;
      }>(queryKeys.settings.workspace(user?.id), (previous) =>
        previous
          ? { ...previous, mpesaSettings: { ...(previous.mpesaSettings || {}), callback: result } }
          : previous,
      );
      toast.success("Callback token rotated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to rotate callback token");
    }
  };

  const handleTemplateSave = async () => {
    if (!token) return;
    try {
      await v1Api.integrations.saveNotificationTemplate(token, templateCode, {
        channel: templateChannel,
        subject: templateSubject,
        body: templateBody,
      });
      toast.success("Notification template saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save template");
    }
  };

  return (
    <div>
      <PageHeader
        title="System Settings"
        description="Company profile, taxes, module access, backups and notifications."
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          window.history.replaceState({}, "", `${window.location.pathname}#${value}`);
        }}
      >
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="tax">Tax & Excise</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Company Profile</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Company Name" value="Ayawin Stock Solution Ltd" />
                <Field label="Company PIN" value="P051999999Z" />
                <Field label="VAT Registration" value="0123456789" />
                <Field label="ETR / TIMS Serial" value="KRACU0010000123" />
                <Field label="Phone" value="+254 711 100 200" />
                <Field label="Email" value="info@ayawinenterprise.co.ke" />
                <Field
                  label="Physical Address"
                  value="Industrial Area, Nairobi"
                  className="sm:col-span-2"
                />
                <Field label="Financial Year Start" value="01/01/2026" />
                <Field label="Default Currency" value="KES" />
                <div className="sm:col-span-2">
                  <Button
                    onClick={() => {
                      void trackEvent({
                        action: "settings_company_saved",
                        entityType: "settings",
                        entityId: "company",
                        details: { company: "Ayawin Stock Solution Ltd", currency: "KES" },
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

            <Card>
              <CardHeader>
                <CardTitle>Integration Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <InfoRow label="eTIMS" value={String(etimsSettings?.provider_mode || "disabled")} />
                <InfoRow
                  label="M-Pesa"
                  value={String(mpesaSettings?.provider_mode || "disabled")}
                />
                <InfoRow label="Email" value="sandbox" />
                <InfoRow label="SMS" value="sandbox" />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="tax" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Tax & Excise Rates</CardTitle>
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
                <SearchBar
                  value={warehouseQ}
                  onChange={setWarehouseQ}
                  placeholder="Search warehouse or manager..."
                />
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
                      <TableCell
                        colSpan={3}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
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
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Notifications</CardTitle>
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

            <Card>
              <CardHeader>
                <CardTitle>Notification Templates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Template code</Label>
                    <Input value={templateCode} onChange={(e) => setTemplateCode(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Channel</Label>
                    <Input
                      value={templateChannel}
                      onChange={(e) => setTemplateChannel(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Email subject</Label>
                  <Input
                    value={templateSubject}
                    onChange={(e) => setTemplateSubject(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Template body</Label>
                  <textarea
                    className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={templateBody}
                    onChange={(e) => setTemplateBody(e.target.value)}
                  />
                </div>
                <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Variables supported:{" "}
                  {"{{customer_name}}, {{invoice_number}}, {{amount_due}}, {{company_name}}"}
                </div>
                <Button onClick={() => void handleTemplateSave()}>Save template</Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Security and Access</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Toggle label="Require 2FA for admins and accountants" defaultOn />
                <Toggle label="Log every destructive action" defaultOn />
                <Toggle label="Restrict modules by role" defaultOn />
                <Toggle label="Enable password rotation reminders" />
                <div className="sm:col-span-2 flex flex-wrap gap-2 pt-2">
                  <Button
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

            <Card>
              <CardHeader>
                <CardTitle>eTIMS & M-Pesa settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">eTIMS</span>
                    <span className="text-xs text-muted-foreground">
                      {String(etimsSettings?.provider_mode || "disabled")}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => void handleEtimsInitialize()}>
                      Initialise
                    </Button>
                    <Button variant="outline" onClick={() => void handleEtimsTest()}>
                      Test connection
                    </Button>
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">M-Pesa callback</span>
                    <span className="text-xs text-muted-foreground">
                      {String(mpesaSettings?.provider_mode || "disabled")}
                    </span>
                  </div>
                  <InfoRow label="Callback URL" value={maskedToken} />
                  <div className="mt-3 flex gap-2">
                    <Button variant="outline" onClick={() => void handleRotateMpesaToken()}>
                      Rotate token
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
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
