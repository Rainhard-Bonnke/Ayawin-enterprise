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

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — Martin Enterprise ERP" }] }),
});

function SettingsPage() {
  return (
    <div>
      <PageHeader title="System Settings" description="Company profile, tax configuration, warehouses and notifications." />

      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="tax">Tax & Excise</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">Company Profile</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Company Name" value="Martin Enterprise Ltd" />
              <Field label="KRA PIN" value="P051999999Z" />
              <Field label="VAT Registration" value="0123456789" />
              <Field label="ETR / TIMS Serial" value="KRACU0010000123" />
              <Field label="Phone" value="+254 711 100 200" />
              <Field label="Email" value="info@martinerp.co.ke" />
              <Field label="Physical Address" value="Industrial Area, Nairobi" className="sm:col-span-2" />
              <Field label="Financial Year Start" value="01/01/2026" />
              <Field label="Default Currency" value="KES" />
              <div className="sm:col-span-2"><Button className="bg-navy text-navy-foreground hover:bg-navy/90">Save changes</Button></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">Tax & Excise Rates</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Category</TableHead><TableHead>Excise Rate</TableHead><TableHead>VAT</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {[
                    ["Beer", "KES 121.85 / litre"],
                    ["Spirits", "KES 356.28 / litre"],
                    ["Wine", "KES 229.85 / litre"],
                    ["Soft Drinks", "KES 10.68 / litre"],
                    ["Juice", "KES 10.68 / litre"],
                    ["Water", "—"],
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
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Warehouse</TableHead><TableHead>Location</TableHead><TableHead>Manager</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {warehouses.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>{w.location}</TableCell>
                    <TableCell>{w.manager}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">Notifications</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Toggle label="Email when invoice goes overdue" defaultOn />
              <Toggle label="Email daily sales summary at 18:00 EAT" defaultOn />
              <Toggle label="SMS driver on delivery assignment" defaultOn />
              <Toggle label="Alert when stock falls below minimum" defaultOn />
              <Toggle label="Alert 30 days before product expiry" defaultOn />
              <Toggle label="Weekly KRA filing reminder" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <div className="mt-4 text-xs text-muted-foreground">Stock value tracked: {KES(warehouses.length * 12000000)} approx · Last backup: 20/05/2026 03:00 EAT</div>
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={"space-y-1.5 " + (className ?? "")}>
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
