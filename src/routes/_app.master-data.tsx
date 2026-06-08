import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { MasterBulkActionsBar, useMasterRowSelection } from "@/components/MasterBulkActionsBar";
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
  createChartOfAccount,
  deleteMasterItem,
  deleteWarehouse,
  fetchChartOfAccounts,
  fetchMasterEmployees,
  fetchMasterItems,
  fetchMasterVendors,
  fetchWarehouses,
  importMasterData,
  updateMasterItem,
  updateWarehouse,
  type BackendMasterItem,
  type BackendWarehouse,
  type ChartOfAccountRow,
} from "@/lib/api";
import { masterCreate, masterDelete, masterUpdate, type MasterEntity } from "@/lib/api-v1";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/master-data")({
  component: MasterDataPage,
  head: () => ({ meta: [{ title: "Master Data - Ayawin Stock Solutions ERP" }] }),
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
  const [vendors, setVendors] = useState<Record<string, unknown>[]>([]);
  const [employees, setEmployees] = useState<Record<string, unknown>[]>([]);
  const [coa, setCoa] = useState<ChartOfAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<"customers" | "items" | "vendors" | "opening_stock">("items");
  const [importing, setImporting] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [itemRows, whRows, vendorRows, empRows, coaRows] = await Promise.all([
        fetchMasterItems(token),
        fetchWarehouses(token),
        fetchMasterVendors(token),
        fetchMasterEmployees(token),
        fetchChartOfAccounts(token),
      ]);
      setItems(itemRows);
      setWarehouses(whRows);
      setVendors(vendorRows);
      setEmployees(empRows);
      setCoa(coaRows);
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
      let rows: Record<string, unknown>[] = [];
      if (importType === "items") {
        rows = parsed.map((r) => ({
          item_code: r.item_code || r.sku || r.code,
          name: r.name,
          standard_cost: Number(r.standard_cost || r.cost || 0),
        }));
      } else if (importType === "vendors") {
        rows = parsed.map((r) => ({
          vendor_code: r.vendor_code || r.code,
          name: r.name,
          email: r.email,
          tax_id: r.tax_id || r.kra_pin,
          credit_limit: Number(r.credit_limit || 0),
        }));
      } else if (importType === "opening_stock") {
        rows = parsed.map((r) => ({
          warehouse_code: r.warehouse_code || r.warehouse,
          item_code: r.item_code || r.sku,
          quantity: Number(r.quantity || 0),
          unit_cost: Number(r.unit_cost || r.cost || 0),
        }));
      } else {
        rows = parsed.map((r) => ({
          customer_code: r.customer_code || r.code || r.kra_pin,
          name: r.name,
          email: r.email,
          tax_id: r.tax_id || r.kra_pin,
          credit_limit: Number(r.credit_limit || 0),
        }));
      }

      const invalid = rows.findIndex((r) => {
        if (importType === "opening_stock") {
          return !r.warehouse_code || !r.item_code || !Number(r.quantity);
        }
        if (importType === "vendors") return !r.name || !r.vendor_code;
        if (importType === "items") return !r.name || !r.item_code;
        return !r.name || !r.customer_code;
      });
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
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="items">Products / Items</TabsTrigger>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="coa">Chart of Accounts</TabsTrigger>
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

        <TabsContent value="vendors">
          <SimpleMasterTable
            loading={loading}
            rows={vendors}
            q={q}
            columns={[
              { key: "vendor_code", label: "Code" },
              { key: "name", label: "Name" },
              { key: "email", label: "Email" },
              { key: "tax_id", label: "Tax ID" },
            ]}
            entity="vendors"
            codeField="vendor_code"
            token={token}
            onSaved={load}
          />
        </TabsContent>

        <TabsContent value="employees">
          <SimpleMasterTable
            loading={loading}
            rows={employees}
            q={q}
            columns={[
              { key: "employee_code", label: "Code" },
              { key: "first_name", label: "First" },
              { key: "last_name", label: "Last" },
              { key: "department", label: "Department" },
              { key: "job_title", label: "Title" },
            ]}
            entity="employees"
            codeField="employee_code"
            token={token}
            onSaved={load}
            createFields={[
              { key: "employee_code", label: "Employee code" },
              { key: "first_name", label: "First name" },
              { key: "last_name", label: "Last name" },
              { key: "email", label: "Email" },
              { key: "department", label: "Department" },
              { key: "job_title", label: "Job title" },
            ]}
          />
        </TabsContent>

        <TabsContent value="coa">
          <CoaPanel loading={loading} rows={coa.filter((r) => `${r.code} ${r.name}`.toLowerCase().includes(q.toLowerCase()))} token={token} onSaved={load} />
        </TabsContent>

        <TabsContent value="import">
          <Card>
            <CardContent className="space-y-4 p-4">
              <p className="text-sm text-muted-foreground">
                Upload a CSV with a header row. Opening stock: <code>warehouse_code,item_code,quantity,unit_cost</code>.
                Items: <code>item_code,name,standard_cost</code>. Customers / vendors use their code columns.
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
                <Button
                  variant={importType === "vendors" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setImportType("vendors")}
                >
                  Vendors
                </Button>
                <Button
                  variant={importType === "opening_stock" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setImportType("opening_stock")}
                >
                  Opening stock
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
  const selection = useMasterRowSelection(rows);

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
        const updated = await updateMasterItem(
          token,
          editing.id,
          body,
          editing.updated_at ? { ifMatch: editing.updated_at } : undefined,
        );
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
        <MasterBulkActionsBar
          token={token}
          entity="items"
          selectedIds={selection.selectedIds}
          onComplete={onSaved}
          onClearSelection={selection.clear}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selection.allSelected}
                  onCheckedChange={() => selection.toggleAll()}
                  aria-label="Select all items"
                />
              </TableHead>
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
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Checkbox
                      checked={selection.isSelected(row.id)}
                      onCheckedChange={() => selection.toggle(row.id)}
                      aria-label={`Select ${row.item_code}`}
                    />
                  </TableCell>
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
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No items yet.</TableCell>
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
  const selection = useMasterRowSelection(rows.map((row) => ({ id: String(row.id) })));

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
        <MasterBulkActionsBar
          token={token}
          entity="warehouses"
          selectedIds={selection.selectedIds}
          onComplete={onSaved}
          onClearSelection={selection.clear}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selection.allSelected}
                  onCheckedChange={() => selection.toggleAll()}
                  aria-label="Select all warehouses"
                />
              </TableHead>
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
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Checkbox
                      checked={selection.isSelected(String(row.id))}
                      onCheckedChange={() => selection.toggle(String(row.id))}
                      aria-label={`Select ${row.code}`}
                    />
                  </TableCell>
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
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No warehouses yet.</TableCell>
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

function SimpleMasterTable({
  loading,
  rows,
  q,
  columns,
  entity,
  codeField,
  token,
  onSaved,
  createFields,
}: {
  loading: boolean;
  rows: Record<string, unknown>[];
  q: string;
  columns: Array<{ key: string; label: string }>;
  entity: Extract<MasterEntity, "vendors" | "employees">;
  codeField: string;
  token: string | null;
  onSaved: () => Promise<void>;
  createFields?: Array<{ key: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVersion, setEditVersion] = useState<string | undefined>();
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const filtered = rows.filter((row) =>
    columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(q.toLowerCase())),
  );
  const selectable = filtered.map((row) => ({ id: String(row.id) }));
  const selection = useMasterRowSelection(selectable);

  const fields =
    createFields ??
    (entity === "vendors"
      ? [
          { key: "vendor_code", label: "Vendor code" },
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "tax_id", label: "Tax ID" },
        ]
      : []);

  const save = async () => {
    if (!token || !form[codeField]) return;
    if (entity === "vendors" && !form.name) return;
    if (entity === "employees" && (!form.first_name || !form.last_name)) return;
    setSaving(true);
    try {
      if (editingId) {
        await masterUpdate(token, entity, editingId, form, editVersion ? { ifMatch: editVersion } : undefined);
        toast.success("Record updated");
      } else {
        await masterCreate(token, entity, form);
        toast.success("Record created");
      }
      setOpen(false);
      setEditingId(null);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({});
    setOpen(true);
  };

  const openEdit = (row: Record<string, unknown>) => {
    setEditingId(String(row.id));
    setEditVersion(row.updated_at ? String(row.updated_at) : undefined);
    const next: Record<string, string> = {};
    for (const f of fields) next[f.key] = String(row[f.key] ?? "");
    setForm(next);
    setOpen(true);
  };

  const remove = async (row: Record<string, unknown>) => {
    if (!token) return;
    try {
      await masterDelete(token, entity, String(row.id));
      toast.success("Record deleted");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4 flex justify-end">
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Add {entity === "vendors" ? "vendor" : "employee"}
          </Button>
        </div>
        <MasterBulkActionsBar
          token={token}
          entity={entity}
          selectedIds={selection.selectedIds}
          onComplete={onSaved}
          onClearSelection={selection.clear}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selection.allSelected}
                  onCheckedChange={() => selection.toggleAll()}
                  aria-label="Select all"
                />
              </TableHead>
              {columns.map((c) => (
                <TableHead key={c.key}>{c.label}</TableHead>
              ))}
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={columns.length + 2} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : filtered.map((row) => (
              <TableRow key={String(row.id)}>
                <TableCell>
                  <Checkbox
                    checked={selection.isSelected(String(row.id))}
                    onCheckedChange={() => selection.toggle(String(row.id))}
                    aria-label="Select row"
                  />
                </TableCell>
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.key.includes("code") ? "font-mono text-xs" : ""}>
                    {String(row[c.key] ?? "—")}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)} aria-label="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <ConfirmActionDialog
                      title="Delete record?"
                      description="This soft-deletes the master record."
                      confirmLabel="Delete"
                      onConfirm={() => remove(row)}
                    >
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </ConfirmActionDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!loading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={columns.length + 2} className="py-8 text-center text-sm text-muted-foreground">No records.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditingId(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId ? "Edit record" : "New record"}</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              {fields.map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  value={form[f.key] ?? ""}
                  disabled={Boolean(editingId && f.key === codeField)}
                  onChange={(v) => setForm((p) => ({ ...p, [f.key]: v }))}
                />
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editingId ? "Update" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function CoaPanel({
  loading,
  rows,
  token,
  onSaved,
}: {
  loading: boolean;
  rows: ChartOfAccountRow[];
  token: string | null;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ account_code: "", account_name: "", account_type: "asset" });
  const [saving, setSaving] = useState(false);
  const selection = useMasterRowSelection(rows);

  const save = async () => {
    if (!token || !form.account_code || !form.account_name) return;
    setSaving(true);
    try {
      await createChartOfAccount(token, form);
      toast.success("Account created");
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
          <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Add account</Button>
        </div>
        <MasterBulkActionsBar
          token={token}
          entity="chart-of-accounts"
          selectedIds={selection.selectedIds}
          onComplete={onSaved}
          onClearSelection={selection.clear}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selection.allSelected}
                  onCheckedChange={() => selection.toggleAll()}
                  aria-label="Select all accounts"
                />
              </TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">No accounts yet.</TableCell></TableRow>
            ) : rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Checkbox
                    checked={selection.isSelected(row.id)}
                    onCheckedChange={() => selection.toggle(row.id)}
                    aria-label={`Select ${row.code}`}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{row.account_type}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>New GL account</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <Field label="Account code" value={form.account_code} onChange={(v) => setForm((p) => ({ ...p, account_code: v }))} />
              <Field label="Account name" value={form.account_name} onChange={(v) => setForm((p) => ({ ...p, account_name: v }))} />
              <Field label="Type (asset/liability/income/expense)" value={form.account_type} onChange={(v) => setForm((p) => ({ ...p, account_type: v }))} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
