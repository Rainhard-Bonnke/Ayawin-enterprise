import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import {
  fetchCurrentCompany,
  fetchSystemSettings,
  fetchTaxRates,
  fetchWarehouses,
  saveSystemSetting,
  updateCurrentCompany,
  type BackendWarehouse,
  type CompanyProfile,
  type TaxRateRow,
} from "@/lib/api";
import { useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchBar } from "@/components/SearchBar";
import { toast } from "sonner";
import { GoLiveChecklist } from "@/components/GoLiveChecklist";
import { MfaSetupPanel } from "@/components/MfaSetupPanel";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings - Ayawin Stock Solutions ERP" }] }),
});

function SettingsPage() {
  const { token } = useAuth();
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [companySaving, setCompanySaving] = useState(false);
  const [taxRates, setTaxRates] = useState<TaxRateRow[]>([]);
  const [warehouseRows, setWarehouseRows] = useState<Array<{ id: string; name: string; location: string; manager: string }>>([]);
  const [warehouseQ, setWarehouseQ] = useState("");
  const [notifyToggles, setNotifyToggles] = useState({
    overdue_invoice: true,
    daily_sales: true,
    stock_alert: true,
    kra_reminder: false,
  });
  const [securityToggles, setSecurityToggles] = useState({
    require_2fa: false,
    audit_destructive: true,
    module_restrictions: true,
  });

  useEffect(() => {
    if (!token) return;
    void fetchCurrentCompany(token)
      .then((c) => c && setCompany(c))
      .catch(() => toast.error("Unable to load company profile"));
    void fetchTaxRates(token).then(setTaxRates).catch(() => setTaxRates([]));
    void fetchWarehouses(token)
      .then((rows: BackendWarehouse[]) =>
        setWarehouseRows(
          rows.map((w) => ({
            id: String(w.id),
            name: w.name,
            location: w.address,
            manager: w.manager || "—",
          })),
        ),
      )
      .catch(() => undefined);
    void fetchSystemSettings(token, "notifications")
      .then((rows) => {
        const map: Record<string, boolean> = {};
        for (const row of rows) {
          const key = String(row.setting_key || "");
          map[key] = Boolean((row.setting_value as { enabled?: boolean })?.enabled ?? row.setting_value);
        }
        setNotifyToggles((prev) => ({ ...prev, ...map }));
      })
      .catch(() => undefined);
    void fetchSystemSettings(token, "security")
      .then((rows) => {
        const map: Record<string, boolean> = {};
        for (const row of rows) {
          const key = String(row.setting_key || "");
          map[key] = Boolean((row.setting_value as { enabled?: boolean })?.enabled ?? row.setting_value);
        }
        setSecurityToggles((prev) => ({ ...prev, ...map }));
      })
      .catch(() => undefined);
  }, [token]);

  const filteredWarehouses = warehouseRows.filter((w) =>
    `${w.name} ${w.location} ${w.manager}`.toLowerCase().includes(warehouseQ.toLowerCase()),
  );

  const saveCompany = async () => {
    if (!token || !company) return;
    setCompanySaving(true);
    try {
      await updateCurrentCompany(token, {
        name: company.name,
        legal_name: company.legal_name,
        tax_registration_no: company.tax_registration_no,
        base_currency_code: company.base_currency_code,
        timezone: company.timezone,
      });
      toast.success("Company profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save company");
    } finally {
      setCompanySaving(false);
    }
  };

  const saveNotifications = async () => {
    if (!token) return;
    try {
      await Promise.all(
        Object.entries(notifyToggles).map(([key, enabled]) =>
          saveSystemSetting(token, "notifications", key, { enabled }),
        ),
      );
      toast.success("Notification settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save notifications");
    }
  };

  const saveSecurity = async () => {
    if (!token) return;
    try {
      await Promise.all(
        Object.entries(securityToggles).map(([key, enabled]) =>
          saveSystemSetting(token, "security", key, { enabled }),
        ),
      );
      toast.success("Security settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save security settings");
    }
  };

  return (
    <div>
      <PageHeader title="System Settings" description="Company profile, taxes, warehouses, notifications and security." />

      <Tabs defaultValue="company">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="tax">Tax Rates</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="go-live">Go-live</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Company Profile</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {company ? (
                <>
                  <EditableField label="Company Name" value={company.name} onChange={(v) => setCompany({ ...company, name: v })} />
                  <EditableField label="Legal Name" value={company.legal_name} onChange={(v) => setCompany({ ...company, legal_name: v })} />
                  <EditableField label="Tax / VAT Registration" value={company.tax_registration_no} onChange={(v) => setCompany({ ...company, tax_registration_no: v })} />
                  <EditableField label="Default Currency" value={company.base_currency_code} onChange={(v) => setCompany({ ...company, base_currency_code: v })} />
                  <EditableField label="Timezone" value={company.timezone} className="sm:col-span-2" onChange={(v) => setCompany({ ...company, timezone: v })} />
                  <div className="sm:col-span-2">
                    <Button onClick={() => void saveCompany()} disabled={companySaving}>
                      {companySaving ? "Saving…" : "Save changes"}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground sm:col-span-2">Loading company profile…</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Tax Rates (from master data)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxRates.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.tax_type}</TableCell>
                      <TableCell className="text-right">{row.rate}%</TableCell>
                    </TableRow>
                  ))}
                  {taxRates.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                        No tax rates configured. Add them under Master Data.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="warehouses" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <SearchBar value={warehouseQ} onChange={setWarehouseQ} placeholder="Search warehouse…" />
                <div className="ml-auto text-xs text-muted-foreground">{filteredWarehouses.length} warehouses</div>
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
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Toggle label="Email when invoice goes overdue" checked={notifyToggles.overdue_invoice} onChange={(v) => setNotifyToggles((p) => ({ ...p, overdue_invoice: v }))} />
              <Toggle label="Email daily sales summary at 18:00 EAT" checked={notifyToggles.daily_sales} onChange={(v) => setNotifyToggles((p) => ({ ...p, daily_sales: v }))} />
              <Toggle label="Alert when stock falls below minimum" checked={notifyToggles.stock_alert} onChange={(v) => setNotifyToggles((p) => ({ ...p, stock_alert: v }))} />
              <Toggle label="Weekly KRA filing reminder" checked={notifyToggles.kra_reminder} onChange={(v) => setNotifyToggles((p) => ({ ...p, kra_reminder: v }))} />
              <Button onClick={() => void saveNotifications()}>Save notifications</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Security and Access</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <MfaSetupPanel token={token} />
              </div>
              <Toggle label="Require 2FA for admins and accountants" checked={securityToggles.require_2fa} onChange={(v) => setSecurityToggles((p) => ({ ...p, require_2fa: v }))} />
              <Toggle label="Log every destructive action" checked={securityToggles.audit_destructive} onChange={(v) => setSecurityToggles((p) => ({ ...p, audit_destructive: v }))} />
              <Toggle label="Restrict modules by role" checked={securityToggles.module_restrictions} onChange={(v) => setSecurityToggles((p) => ({ ...p, module_restrictions: v }))} />
              <div className="sm:col-span-2">
                <Button onClick={() => void saveSecurity()}>Save security settings</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="go-live" className="mt-4">
          <GoLiveChecklist token={token} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border p-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
