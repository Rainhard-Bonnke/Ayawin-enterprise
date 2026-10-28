import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchBar } from "@/components/SearchBar";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { KES } from "@/lib/format";
import {
  createMasterItem,
  createCustomer,
  createSupplier,
  deleteCustomer,
  createWarehouse,
  deleteMasterItem,
  deleteSupplier,
  deleteWarehouse,
  fetchCustomers,
  fetchMasterItems,
  fetchTaxGroups,
  fetchTaxRates,
  createTaxRateVersion,
  fetchWarehouses,
  fetchSuppliers,
  importMasterData,
  updateMasterItem,
  updateCustomer,
  updateSupplier,
  updateWarehouse,
  type BackendCustomer,
  type BackendMasterItem,
  type BackendTaxGroup,
  type BackendTaxRate,
  type BackendSupplier,
  type BackendWarehouse,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/master-data")({
  component: MasterDataPage,
  head: () => ({ meta: [{ title: "Master Data - Ayawin Stock Solution" }] }),
});

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function MasterDataPage() {
  const { token } = useAuth();
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [tab, setTab] = useState(() => hash.replace(/^#/, "") || "items");
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [taxGroups, setTaxGroups] = useState<BackendTaxGroup[]>([]);
  const [taxRates, setTaxRates] = useState<BackendTaxRate[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [customers, setCustomers] = useState<BackendCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<BackendSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<"customers" | "items">("items");
  const [importing, setImporting] = useState(false);

  const load = async (requestedTab = tab) => {
    if (!token) return;
    setLoading(true);
    try {
      if (requestedTab === "items") {
        const [itemRows, groupRows] = await Promise.all([
          fetchMasterItems(token, "", 2000), fetchTaxGroups(token),
        ]);
        setItems(itemRows);
        setTaxGroups(groupRows);
      }
      if (requestedTab === "tax") setTaxRates(await fetchTaxRates(token));
      if (requestedTab === "warehouses") setWarehouses(await fetchWarehouses(token));
      if (requestedTab === "customers") setCustomers(await fetchCustomers(token));
      if (requestedTab === "suppliers") setSuppliers(await fetchSuppliers(token));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load master data");
      setItems([]);
      setWarehouses([]);
      setCustomers([]);
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(tab);
  }, [token, tab]);

  useEffect(() => {
    const nextTab = hash.replace(/^#/, "");
    if (["items", "tax", "customers", "suppliers", "warehouses", "import"].includes(nextTab))
      setTab(nextTab);
  }, [hash]);

  useEffect(() => {
    if (token?.startsWith("demo:")) {
      toast.message(
        "Sign in with the API (admin@martin.co.ke / demo) to load and save master data.",
      );
    }
  }, [token]);

  const filteredItems = useMemo(() => {
    const needle = q.toLowerCase();
    return items.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        row.item_code.toLowerCase().includes(needle) ||
        (row.barcode || "").toLowerCase().includes(needle),
    );
  }, [items, q]);

  const filteredWarehouses = useMemo(() => {
    const needle = q.toLowerCase();
    return warehouses.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        (row.code || "").toLowerCase().includes(needle) ||
        (row.city || "").toLowerCase().includes(needle),
    );
  }, [warehouses, q]);

  const filteredCustomers = useMemo(() => {
    const needle = q.toLowerCase();
    return customers.filter((row) =>
      [row.name, row.kra_pin, row.email, row.location].some((value) =>
        (value || "").toLowerCase().includes(needle),
      ),
    );
  }, [customers, q]);

  const filteredSuppliers = useMemo(() => {
    const needle = q.toLowerCase();
    return suppliers.filter((row) =>
      [row.name, row.kra_pin, row.email, row.phone].some((value) =>
        (value || "").toLowerCase().includes(needle),
      ),
    );
  }, [suppliers, q]);

  const onImportFile = async (file: File) => {
    if (!token) return;
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      const rows =
        importType === "items"
          ? parsed.map((r) => ({
              item_code: r.item_code || r.sku || r.code,
              name: r.name,
              standard_cost: Number(r.standard_cost || r.cost || 0),
            }))
          : parsed.map((r) => ({
              customer_code: r.customer_code || r.code || r.kra_pin,
              name: r.name,
              email: r.email,
              tax_id: r.tax_id || r.kra_pin,
              credit_limit: Number(r.credit_limit || 0),
            }));

      const invalid = rows.findIndex(
        (r) => !r.name || (!("item_code" in r) ? !r.customer_code : !r.item_code),
      );
      if (invalid >= 0) {
        toast.error(`Row ${invalid + 2} is missing required fields`);
        return;
      }

      const result = await importMasterData(token, importType, rows, file.name);
      toast.success(`Imported ${result.success} of ${result.total} rows`);
      if (result.errors.length) {
        toast.warning(`${result.errors.length} rows failed — check server logs`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <PageHeader
        title="Master Data"
        description="Manage products, warehouses, and bulk imports against the live database."
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          window.history.replaceState({}, "", `${window.location.pathname}#${value}`);
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="items">Products / Items</TabsTrigger>
          <TabsTrigger value="tax">Tax settings</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="import">Import CSV</TabsTrigger>
        </TabsList>

        <div className="max-w-md">
          <SearchBar value={q} onChange={setQ} placeholder="Search code or name..." />
        </div>

        <TabsContent value="items">
          <p className="mb-3 text-sm text-muted-foreground">
            Product master list (all SKUs). Inventory shows stock on hand only — new items appear
            there after a goods receipt.
          </p>
          <ItemsPanel
            loading={loading}
            rows={filteredItems}
            taxGroups={taxGroups}
            token={token}
            onSaved={() => load("items")}
            onItemsChange={setItems}
          />
        </TabsContent>

        <TabsContent value="tax">
          <TaxSettingsPanel rates={taxRates} token={token} onSaved={() => load("tax")} />
        </TabsContent>

        <TabsContent value="warehouses">
          <WarehousesPanel
            loading={loading}
            rows={filteredWarehouses}
            token={token}
            onSaved={() => load("warehouses")}
          />
        </TabsContent>

        <TabsContent value="customers">
          <PartyPanel
            kind="customer"
            loading={loading}
            rows={filteredCustomers}
            token={token}
            onSaved={() => load("customers")}
          />
        </TabsContent>

        <TabsContent value="suppliers">
          <PartyPanel
            kind="supplier"
            loading={loading}
            rows={filteredSuppliers}
            token={token}
            onSaved={() => load("suppliers")}
          />
        </TabsContent>

        <TabsContent value="import">
          <Card>
            <CardContent className="space-y-4 p-4">
              <p className="text-sm text-muted-foreground">
                Upload a CSV with a header row. Items: <code>item_code,name,standard_cost</code>.
                Customers: <code>customer_code,name,email,tax_id,credit_limit</code>.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant={importType === "items" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setImportType("items")}
                >
                  Items
                </Button>
                <Button
                  variant={importType === "customers" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setImportType("customers")}
                >
                  Customers
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onImportFile(file);
                  }}
                />
                <Button disabled={importing || !token} onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  {importing ? "Importing…" : "Choose CSV file"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TaxSettingsPanel({ rates, token, onSaved }: {
  rates: BackendTaxRate[];
  token: string | null;
  onSaved: () => Promise<void>;
}) {
  const vatCodes = Array.from(new Set(rates.filter((rate) => rate.tax_type === "vat" && rate.basis === "percentage").map((rate) => rate.code)));
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(vatCodes.includes("VAT16") ? "VAT16" : vatCodes[0] || "");
  const [rate, setRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!code && vatCodes.length) setCode(vatCodes.includes("VAT16") ? "VAT16" : vatCodes[0]);
  }, [code, vatCodes]);

  useEffect(() => {
    const latest = rates.filter((row) => row.code === code).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    setRate(latest ? String(latest.rate) : "16");
  }, [code, rates]);

  const save = async () => {
    if (!token || !code || !effectiveFrom || !Number.isFinite(Number(rate)) || Number(rate) < 0 || Number(rate) > 100) {
      toast.error("Enter a VAT rate from 0 to 100 and its effective date.");
      return;
    }
    if (code === "VAT0" && Number(rate) !== 0) {
      toast.error("The zero-rate tax code must remain 0%. Use a standard VAT tax code for another rate.");
      return;
    }
    setSaving(true);
    try {
      await createTaxRateVersion(token, {
        code, name: `${code} ${Number(rate)}%`, rate: Number(rate), tax_type: "vat", basis: "percentage", effective_from: effectiveFrom,
      });
      toast.success(`${code} ${Number(rate)}% saved from ${effectiveFrom}; prior rate history was retained.`);
      setOpen(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save tax rate");
    } finally { setSaving(false); }
  };

  return <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-4 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">VAT rate history</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">Add a dated rate version instead of changing a rate already used on an invoice. Item Master assigns products to standard, zero-rated, or exempt treatment. Ask accounts to confirm classification and effective dates before saving.</p></div>
      <Button onClick={() => setOpen(true)} disabled={!vatCodes.length}>Add effective rate</Button>
    </div>
    <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Tax code</th><th className="px-3 py-3 text-right">Rate</th><th className="px-3 py-3">Effective period</th><th className="px-3 py-3">Used by tax groups</th></tr></thead><tbody>
      {rates.map((row) => <tr key={row.id} className="border-t"><td className="px-3 py-3"><div className="font-mono text-xs">{row.code}</div><div className="text-xs text-muted-foreground">{row.name}</div></td><td className="px-3 py-3 text-right tabular-nums">{Number(row.rate).toLocaleString()} {row.basis === "percentage" ? "%" : row.basis}</td><td className="px-3 py-3">{row.effective_from} – {row.effective_to || "No end date"}</td><td className="px-3 py-3">{row.tax_groups.join(", ") || "Not assigned"}</td></tr>)}
      {!rates.length && <tr><td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">No tax rates are configured. Apply the latest ERP database migration and reload.</td></tr>}
    </tbody></table></div>
    <p className="text-xs text-muted-foreground">This screen configures VAT only. Excise duty calculations, KRA eTIMS submission, and tax-return reconciliation are separate unfinished workflows.</p>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Add effective VAT rate</DialogTitle><DialogDescription>The previous rate will end the day before this date. Existing order and invoice lines keep their tax snapshots.</DialogDescription></DialogHeader><div className="space-y-3">
      <div className="space-y-1.5"><Label>Tax code</Label><Select value={code} onValueChange={setCode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{vatCodes.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Rate (%)</Label><Input type="number" min="0" max="100" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} /></div>
      <div className="space-y-1.5"><Label>Effective from</Label><Input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></div>
      <p className="text-xs text-muted-foreground">The selected code is configured as {code === "VAT0" ? "zero-rated" : "standard VAT"}.</p>
    </div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save rate version"}</Button></DialogFooter></DialogContent></Dialog>
  </CardContent></Card>;
}

function ItemsPanel({
  loading,
  rows,
  taxGroups,
  token,
  onSaved,
  onItemsChange,
}: {
  loading: boolean;
  rows: BackendMasterItem[];
  taxGroups: BackendTaxGroup[];
  token: string | null;
  onSaved: () => Promise<void>;
  onItemsChange: (
    updater: BackendMasterItem[] | ((prev: BackendMasterItem[]) => BackendMasterItem[]),
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BackendMasterItem | null>(null);
  const [form, setForm] = useState({
    item_code: "",
    name: "",
    barcode: "",
    standard_cost: "0",
    reorder_point: "0",
    tax_group_id: "",
    lot_tracking_enabled: false,
  });
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditing(null);
    setForm({ item_code: "", name: "", barcode: "", standard_cost: "0", reorder_point: "0", tax_group_id: taxGroups.find((group) => group.code === "STD-VAT")?.id || "", lot_tracking_enabled: false });
    setOpen(true);
  };

  const openEdit = (row: BackendMasterItem) => {
    setEditing(row);
    setForm({
      item_code: row.item_code,
      name: row.name,
      barcode: row.barcode || "",
      standard_cost: String(row.standard_cost),
      reorder_point: String(row.reorder_point),
      tax_group_id: row.tax_group_id || taxGroups.find((group) => group.code === "STD-VAT")?.id || "",
      lot_tracking_enabled: row.lot_tracking_enabled,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!token || !form.item_code || !form.name) return;
    if (!form.tax_group_id) {
      toast.error("Choose the sales tax treatment approved for this item.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: form.name,
        barcode: form.barcode || undefined,
        standard_cost: Number(form.standard_cost) || 0,
        reorder_point: Number(form.reorder_point) || 0,
        tax_group_id: form.tax_group_id,
        lot_tracking_enabled: form.lot_tracking_enabled,
      };
      if (editing) {
        const updated = await updateMasterItem(token, editing.id, body);
        toast.success("Item updated");
        await onSaved();
        onItemsChange((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      } else {
        const created = await createMasterItem(token, { item_code: form.item_code, ...body });
        toast.success("Item created");
        onItemsChange((prev) => {
          const exists = prev.some(
            (row) => row.id === created.id || row.item_code === created.item_code,
          );
          return exists
            ? prev.map((row) => (row.item_code === created.item_code ? created : row))
            : [created, ...prev];
        });
        await onSaved();
      }
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4 flex justify-end">
          <Button
            onClick={() => {
              openNew();
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add item
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit item" : "New item"}</DialogTitle>
                <DialogDescription>Stored in PostgreSQL via /api/v1/master/items</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <Field
                  label="Item code (SKU)"
                  value={form.item_code}
                  disabled={!!editing}
                  onChange={(v) => setForm((p) => ({ ...p, item_code: v }))}
                />
                <Field
                  label="Name"
                  value={form.name}
                  onChange={(v) => setForm((p) => ({ ...p, name: v }))}
                />
                <Field
                  label="Barcode"
                  value={form.barcode}
                  onChange={(v) => setForm((p) => ({ ...p, barcode: v }))}
                />
                <Field
                  label="Standard cost"
                  value={form.standard_cost}
                  onChange={(v) => setForm((p) => ({ ...p, standard_cost: v }))}
                />
                <Field
                  label="Reorder point"
                  value={form.reorder_point}
                  onChange={(v) => setForm((p) => ({ ...p, reorder_point: v }))}
                />
                <div className="space-y-1.5">
                  <Label>Sales tax treatment</Label>
                  <Select value={form.tax_group_id} onValueChange={(value) => setForm((p) => ({ ...p, tax_group_id: value }))}>
                    <SelectTrigger><SelectValue placeholder="Choose tax treatment" /></SelectTrigger>
                    <SelectContent>
                      {taxGroups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name} ({group.tax_treatment.replaceAll("_", " ")})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Use the product’s approved classification. Exempt and zero-rated supplies have different tax treatment. Excise-rated items need an excise workflow before sale.</p>
                </div>
                <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                  <input type="checkbox" className="mt-1" checked={form.lot_tracking_enabled} onChange={(event) => setForm((p) => ({ ...p, lot_tracking_enabled: event.target.checked }))} />
                  <span><span className="font-medium">Track batches and expiry (FEFO)</span><span className="mt-1 block text-xs text-muted-foreground">Enable only when current stock is zero or reconciled to lots. Tracked receipts require batch and expiry; deliveries and issues consume earliest unexpired lots first.</span></span>
                </label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Reorder</TableHead>
              <TableHead>Sales tax</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.item_code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{KES(row.standard_cost)}</TableCell>
                  <TableCell>{row.reorder_point}</TableCell>
                  <TableCell>{taxGroups.find((group) => group.id === row.tax_group_id)?.name || "Unassigned"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmActionDialog
                      title="Delete item?"
                      description="Soft-deletes the item. It will no longer appear in lists."
                      confirmLabel="Delete"
                      onConfirm={async () => {
                        if (!token) return;
                        await deleteMasterItem(token, row.id);
                        toast.success("Item deleted");
                        await onSaved();
                      }}
                    >
                      <Button variant="ghost" size="sm" className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </ConfirmActionDialog>
                  </TableCell>
                </TableRow>
              ))
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No items yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PartyPanel({
  kind,
  loading,
  rows,
  token,
  onSaved,
}: {
  kind: "customer" | "supplier";
  loading: boolean;
  rows: (BackendCustomer | BackendSupplier)[];
  token: string | null;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<(BackendCustomer | BackendSupplier) | null>(null);
  const [form, setForm] = useState({
    name: "",
    kra_pin: "",
    email: "",
    contact: "",
    location: "",
    credit_limit: "0",
  });
  const isCustomer = kind === "customer";

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", kra_pin: "", email: "", contact: "", location: "", credit_limit: "0" });
    setOpen(true);
  };

  const openEdit = (row: BackendCustomer | BackendSupplier) => {
    setEditing(row);
    setForm({
      name: row.name,
      kra_pin: row.kra_pin,
      email: row.email || "",
      contact: row.contact || ("phone" in row ? row.phone : "") || "",
      location: ("location" in row ? row.location : "") || "",
      credit_limit: String(row.credit_limit),
    });
    setOpen(true);
  };

  const save = async () => {
    if (!token || !form.name || !form.kra_pin) return;
    try {
      const payload = {
        name: form.name,
        kra_pin: form.kra_pin,
        email: form.email || undefined,
        contact: form.contact || undefined,
        credit_limit: Number(form.credit_limit) || 0,
        ...(isCustomer
          ? { location: form.location || undefined }
          : { phone: form.contact || undefined }),
      };
      if (editing) {
        if (isCustomer) await updateCustomer(token, editing.id, payload);
        else await updateSupplier(token, editing.id, payload);
        toast.success(`${isCustomer ? "Customer" : "Supplier"} updated`);
      } else {
        if (isCustomer) await createCustomer(token, payload);
        else await createSupplier(token, payload);
        toast.success(`${isCustomer ? "Customer" : "Supplier"} created`);
      }
      setOpen(false);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  const remove = async (row: BackendCustomer | BackendSupplier) => {
    if (!token) return;
    if (isCustomer) await deleteCustomer(token, row.id);
    else await deleteSupplier(token, row.id);
    toast.success(`${isCustomer ? "Customer" : "Supplier"} deleted`);
    await onSaved();
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4 flex justify-end">
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" />
            Add {isCustomer ? "customer" : "supplier"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Edit" : "New"} {isCustomer ? "customer" : "supplier"}
                </DialogTitle>
                <DialogDescription>Stored in the live ERP master data database.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2 sm:grid-cols-2">
                <Field
                  label="Legal name"
                  value={form.name}
                  onChange={(v) => setForm((p) => ({ ...p, name: v }))}
                />
                <Field
                  label="Tax ID / KRA PIN"
                  value={form.kra_pin}
                  disabled={!!editing}
                  onChange={(v) => setForm((p) => ({ ...p, kra_pin: v }))}
                />
                <Field
                  label="Email"
                  value={form.email}
                  onChange={(v) => setForm((p) => ({ ...p, email: v }))}
                />
                <Field
                  label={isCustomer ? "Contact" : "Phone"}
                  value={form.contact}
                  onChange={(v) => setForm((p) => ({ ...p, contact: v }))}
                />
                {isCustomer && (
                  <Field
                    label="City / location"
                    value={form.location}
                    onChange={(v) => setForm((p) => ({ ...p, location: v }))}
                  />
                )}
                <Field
                  label="Credit limit"
                  value={form.credit_limit}
                  onChange={(v) => setForm((p) => ({ ...p, credit_limit: v }))}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={save}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Tax ID</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Credit limit</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono text-xs">{row.kra_pin}</TableCell>
                  <TableCell>{row.email || row.contact || row.phone || "—"}</TableCell>
                  <TableCell>{KES(row.credit_limit)}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmActionDialog
                      title={`Delete ${isCustomer ? "customer" : "supplier"}?`}
                      description="This record will be removed from active master data."
                      confirmLabel="Delete"
                      onConfirm={() => remove(row)}
                    >
                      <Button variant="ghost" size="sm" className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </ConfirmActionDialog>
                  </TableCell>
                </TableRow>
              ))
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No {isCustomer ? "customers" : "suppliers"} found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function WarehousesPanel({
  loading,
  rows,
  token,
  onSaved,
}: {
  loading: boolean;
  rows: BackendWarehouse[];
  token: string | null;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BackendWarehouse | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    address_line1: "",
    city: "",
    manager_name: "",
    phone: "",
  });
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditing(null);
    setForm({ code: "", name: "", address_line1: "", city: "", manager_name: "", phone: "" });
    setOpen(true);
  };

  const openEdit = (row: BackendWarehouse) => {
    setEditing(row);
    setForm({
      code: row.code || "",
      name: row.name,
      address_line1: row.address,
      city: row.city || "",
      manager_name: row.manager || "",
      phone: row.phone || "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!token || !form.code || !form.name) return;
    setSaving(true);
    try {
      const body = {
        code: form.code,
        name: form.name,
        address_line1: form.address_line1 || undefined,
        city: form.city || undefined,
        manager_name: form.manager_name || undefined,
        phone: form.phone || undefined,
      };
      if (editing) {
        await updateWarehouse(token, String(editing.id), body);
        toast.success("Warehouse updated");
      } else {
        await createWarehouse(token, body);
        toast.success("Warehouse created");
      }
      setOpen(false);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4 flex justify-end">
          <Button
            onClick={() => {
              openNew();
              setOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add warehouse
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit warehouse" : "New warehouse"}</DialogTitle>
                <DialogDescription>Stored via /api/v1/master/warehouses</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2 sm:grid-cols-2">
                <Field
                  label="Code"
                  value={form.code}
                  disabled={!!editing}
                  onChange={(v) => setForm((p) => ({ ...p, code: v }))}
                />
                <Field
                  label="Name"
                  value={form.name}
                  onChange={(v) => setForm((p) => ({ ...p, name: v }))}
                />
                <Field
                  label="Address"
                  value={form.address_line1}
                  onChange={(v) => setForm((p) => ({ ...p, address_line1: v }))}
                />
                <Field
                  label="City"
                  value={form.city}
                  onChange={(v) => setForm((p) => ({ ...p, city: v }))}
                />
                <Field
                  label="Manager"
                  value={form.manager_name}
                  onChange={(v) => setForm((p) => ({ ...p, manager_name: v }))}
                />
                <Field
                  label="Phone"
                  value={form.phone}
                  onChange={(v) => setForm((p) => ({ ...p, phone: v }))}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.city || "—"}</TableCell>
                  <TableCell>{row.manager || "—"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmActionDialog
                      title="Delete warehouse?"
                      description="Soft-deletes the warehouse record."
                      confirmLabel="Delete"
                      onConfirm={async () => {
                        if (!token) return;
                        await deleteWarehouse(token, String(row.id));
                        toast.success("Warehouse deleted");
                        await onSaved();
                      }}
                    >
                      <Button variant="ghost" size="sm" className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </ConfirmActionDialog>
                  </TableCell>
                </TableRow>
              ))
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No warehouses yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
