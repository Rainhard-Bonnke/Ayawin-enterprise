import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { BriefcaseBusiness, Plus, Search, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { createFixedAsset, deleteFixedAsset, fetchFixedAssets, setFixedAssetStatus, type FixedAsset } from "@/lib/api-v1";
import { KES, fmtDate } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/assets")({
  component: FixedAssetsPage,
  head: () => ({ meta: [{ title: "Assets - Ayawin Stock Solution" }] }),
});

const emptyForm = {
  asset_code: "",
  name: "",
  category: "General",
  acquisition_date: new Date().toISOString().slice(0, 10),
  acquisition_cost: "",
  residual_value: "0",
  useful_life_months: "60",
  location: "",
  serial_number: "",
  notes: "",
};

function monthlyDepreciation(asset: FixedAsset) {
  return Math.max(0, Number(asset.acquisition_cost) - Number(asset.residual_value)) /
    Math.max(1, Number(asset.useful_life_months));
}

function FixedAssetsPage() {
  const { token } = useAuth();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setAssets(await fetchFixedAssets(token));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to load assets");
      setAssets([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, [token]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((asset) =>
      [asset.asset_code, asset.name, asset.category, asset.location, asset.serial_number]
        .some((value) => value?.toLowerCase().includes(q)),
    );
  }, [assets, query]);

  const activeAssets = assets.filter((asset) => asset.status === "active");
  const grossValue = activeAssets.reduce((sum, asset) => sum + Number(asset.acquisition_cost), 0);
  const monthlyCharge = activeAssets.reduce((sum, asset) => sum + monthlyDepreciation(asset), 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    try {
      await createFixedAsset(token, {
        ...form,
        acquisition_cost: Number(form.acquisition_cost),
        residual_value: Number(form.residual_value),
        useful_life_months: Number(form.useful_life_months),
      });
      toast.success("Asset added to the register");
      setOpen(false);
      setForm(emptyForm);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save asset");
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (asset: FixedAsset) => {
    if (!token) return;
    try {
      await setFixedAssetStatus(token, asset.id, asset.status === "active" ? "disposed" : "active");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to update asset");
    }
  };

  const remove = async (asset: FixedAsset) => {
    if (!token || !window.confirm(`Remove ${asset.asset_code} from the register?`)) return;
    try {
      await deleteFixedAsset(token, asset.id);
      toast.success("Asset removed");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to remove asset");
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Assets"
        description="Keep a register of business assets, useful lives and depreciation."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Add asset</Button></DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Register an asset</DialogTitle>
                <DialogDescription>Record the acquisition details used by the asset register.</DialogDescription>
              </DialogHeader>
              <form id="asset-form" className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
                {([
                  ["asset_code", "Asset code", "e.g. AST-001"],
                  ["name", "Asset name", "e.g. Delivery vehicle"],
                  ["category", "Category", "e.g. Vehicles"],
                  ["location", "Location", "Branch or site"],
                  ["serial_number", "Serial number", "Optional"],
                  ["acquisition_date", "Acquisition date", ""],
                  ["acquisition_cost", "Acquisition cost (KES)", "0.00"],
                  ["residual_value", "Residual value (KES)", "0.00"],
                  ["useful_life_months", "Useful life (months)", "60"],
                ] as const).map(([field, label, placeholder]) => (
                  <div className="space-y-1.5" key={field}>
                    <Label htmlFor={`asset-${field}`}>{label}</Label>
                    <Input
                      id={`asset-${field}`}
                      type={field === "acquisition_date" ? "date" : field === "acquisition_cost" || field === "residual_value" || field === "useful_life_months" ? "number" : "text"}
                      min={field === "acquisition_cost" || field === "residual_value" ? "0" : field === "useful_life_months" ? "1" : undefined}
                      step={field === "acquisition_cost" || field === "residual_value" ? "0.01" : undefined}
                      required={field !== "location" && field !== "serial_number"}
                      placeholder={placeholder}
                      value={form[field]}
                      onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
                    />
                  </div>
                ))}
              </form>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" form="asset-form" disabled={saving}>{saving ? "Saving…" : "Save asset"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Registered assets", value: String(activeAssets.length), detail: `${assets.length - activeAssets.length} disposed` },
          { label: "Acquisition value", value: KES(grossValue), detail: "Active asset register" },
          { label: "Monthly depreciation", value: KES(monthlyCharge), detail: "Straight-line estimate" },
        ].map((item) => (
          <Card key={item.label}><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{item.label}</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{item.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 font-semibold"><BriefcaseBusiness className="h-4 w-4 text-primary" /> Asset register</div>
            <div className="relative w-full sm:max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets" className="pl-9" /></div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Asset</TableHead><TableHead>Category</TableHead><TableHead>Acquired</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Monthly depreciation</TableHead>
                <TableHead>Location</TableHead><TableHead>Status</TableHead><TableHead className="w-24">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loading ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">Loading asset register…</TableCell></TableRow>
                  : filtered.length ? filtered.map((asset) => (
                    <TableRow key={asset.id}>
                      <TableCell><div className="font-medium">{asset.name}</div><div className="text-xs text-muted-foreground">{asset.asset_code}{asset.serial_number ? ` · ${asset.serial_number}` : ""}</div></TableCell>
                      <TableCell>{asset.category}</TableCell><TableCell>{fmtDate(asset.acquisition_date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{KES(Number(asset.acquisition_cost))}</TableCell>
                      <TableCell className="text-right tabular-nums">{KES(monthlyDepreciation(asset))}</TableCell>
                      <TableCell>{asset.location || "—"}</TableCell>
                      <TableCell><Badge variant={asset.status === "active" ? "default" : "secondary"}>{asset.status}</Badge></TableCell>
                      <TableCell><div className="flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => void toggleStatus(asset)}>{asset.status === "active" ? "Dispose" : "Restore"}</Button><Button size="icon" variant="ghost" aria-label={`Remove ${asset.asset_code}`} onClick={() => void remove(asset)}><Trash2 className="h-4 w-4" /></Button></div></TableCell>
                    </TableRow>
                  ))
                  : <TableRow><TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">No assets in this register yet. Add your first asset to begin tracking cost and depreciation.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
