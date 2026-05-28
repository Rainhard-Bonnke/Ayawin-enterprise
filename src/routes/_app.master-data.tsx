import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchBar } from "@/components/SearchBar";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { KES } from "@/lib/format";
import {
  createMasterItem,
  createWarehouse,
  deleteMasterItem,
  deleteWarehouse,
  fetchMasterItems,
  fetchWarehouses,
  importMasterData,
  updateMasterItem,
  updateWarehouse,
  type BackendMasterItem,
  type BackendWarehouse,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/master-data")({
  component: MasterDataPage,
  head: () => ({ meta: [{ title: "Master Data - Ayawin Enterprise ERP" }] }),
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
  const [tab, setTab] = useState("items");
  const [items, setItems] = useState<BackendMasterItem[]>([]);
  const [warehouses, setWarehouses] = useState<BackendWarehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<"customers" | "items">("items");
  const [importing, setImporting] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [itemRows, whRows] = await Promise.all([fetchMasterItems(token), fetchWarehouses(token)]);
      setItems(itemRows);
      setWarehouses(whRows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load master data");
      setItems([]);
      setWarehouses([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  useEffect(() => {
    if (token?.startsWith("demo:")) {
      toast.message("Sign in with the API (admin@martin.co.ke / demo) to load and save master data.");
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

      const invalid = rows.findIndex((r) => !r.name || (!("item_code" in r) ? !r.customer_code : !r.item_code));
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

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="items">Products / Items</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="import">Import CSV</TabsTrigger>
        </TabsList>

        <div className="max-w-md">
          <SearchBar value={q} onChange={setQ} placeholder="Search code or name..." />
        </div>

        <TabsContent value="items">
          <p className="mb-3 text-sm text-muted-foreground">
            Product master list (all SKUs). Inventory shows stock on hand only — new items appear there after a goods receipt.
          </p>
          <ItemsPanel
            loading={loading}
            rows={filteredItems}
            token={token}
            onSaved={load}
            onItemsChange={setItems}
          />
        </TabsContent>

        <TabsContent value="warehouses">
          <WarehousesPanel
            loading={loading}
            rows={filteredWarehouses}
            token={token}
            onSaved={load}
          />
        </TabsContent>

        <TabsContent value="import">
          <Card>
            <CardContent className="space-y-4 p-4">
              <p className="text-sm text-muted-foreground">
                Upload a CSV with a header row. Items: <code>item_code,name,standard_cost</code>. Customers:{" "}
                <code>customer_code,name,email,tax_id,credit_limit</code>.
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

function ItemsPanel({
  loading,
  rows,
  token,
  onSaved,
  onItemsChange,
}: {
  loading: boolean;
  rows: BackendMasterItem[];
  token: string | null;
  onSaved: () => Promise<void>;
  onItemsChange: (updater: BackendMasterItem[] | ((prev: BackendMasterItem[]) => BackendMasterItem[])) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BackendMasterItem | null>(null);
  const [form, setForm] = useState({ item_code: "", name: "", barcode: "", standard_cost: "0", reorder_point: "0" });
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditing(null);
    setForm({ item_code: "", name: "", barcode: "", standard_cost: "0", reorder_point: "0" });
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
    });
    setOpen(true);
  };

  const save = async () => {
    if (!token || !form.item_code || !form.name) return;
    setSaving(true);
    try {
      const body = {
        name: form.name,
        barcode: form.barcode || undefined,
        standard_cost: Number(form.standard_cost) || 0,
        reorder_point: Number(form.reorder_point) || 0,
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
          const exists = prev.some((row) => row.id === created.id || row.item_code === created.item_code);
          return exists ? prev.map((row) => (row.item_code === created.item_code ? created : row)) : [created, ...prev];
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
                <Field label="Item code (SKU)" value={form.item_code} disabled={!!editing} onChange={(v) => setForm((p) => ({ ...p, item_code: v }))} />
                <Field label="Name" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
                <Field label="Barcode" value={form.barcode} onChange={(v) => setForm((p) => ({ ...p, barcode: v }))} />
                <Field label="Standard cost" value={form.standard_cost} onChange={(v) => setForm((p) => ({ ...p, standard_cost: v }))} />
                <Field label="Reorder point" value={form.reorder_point} onChange={(v) => setForm((p) => ({ ...p, reorder_point: v }))} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
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
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.item_code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{KES(row.standard_cost)}</TableCell>
                  <TableCell>{row.reorder_point}</TableCell>
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
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No items yet.</TableCell>
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
  const [form, setForm] = useState({ code: "", name: "", address_line1: "", city: "", manager_name: "", phone: "" });
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
                <Field label="Code" value={form.code} disabled={!!editing} onChange={(v) => setForm((p) => ({ ...p, code: v }))} />
                <Field label="Name" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
                <Field label="Address" value={form.address_line1} onChange={(v) => setForm((p) => ({ ...p, address_line1: v }))} />
                <Field label="City" value={form.city} onChange={(v) => setForm((p) => ({ ...p, city: v }))} />
                <Field label="Manager" value={form.manager_name} onChange={(v) => setForm((p) => ({ ...p, manager_name: v }))} />
                <Field label="Phone" value={form.phone} onChange={(v) => setForm((p) => ({ ...p, phone: v }))} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
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
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell>
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
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No warehouses yet.</TableCell>
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
