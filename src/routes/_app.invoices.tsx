import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { invoices } from "@/lib/mock-data";
import { KES, fmtDate, VAT_RATE } from "@/lib/format";
import { SearchBar } from "@/components/SearchBar";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Mail, Printer, FileDown } from "lucide-react";
import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_app/invoices")({
  component: InvoicesPage,
  head: () => ({ meta: [{ title: "Invoicing — Martin Enterprise ERP" }] }),
});

function InvoicesPage() {
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<typeof invoices[number] | null>(null);
  const filtered = invoices.filter((i) =>
    i.id.toLowerCase().includes(q.toLowerCase()) || i.customer.toLowerCase().includes(q.toLowerCase())
  );
  const totals = {
    sent: invoices.filter((i) => i.status === "Sent").reduce((s, i) => s + i.total, 0),
    paid: invoices.filter((i) => i.status === "Paid").reduce((s, i) => s + i.total, 0),
    overdue: invoices.filter((i) => i.status === "Overdue").reduce((s, i) => s + i.total, 0),
    excise: invoices.reduce((s, i) => s + i.excise, 0),
  };

  return (
    <div>
      <PageHeader
        title="Invoicing & Billing"
        description="KRA-compliant invoices with auto excise duty and 16% VAT."
        actions={
          <>
            <Button variant="outline"><FileDown className="mr-2 h-4 w-4" />Export</Button>
            <Button className="bg-navy text-navy-foreground hover:bg-navy/90"><Plus className="mr-2 h-4 w-4" />New Invoice</Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Sent / Awaiting", v: KES(totals.sent) },
          { l: "Paid (MTD)", v: KES(totals.paid) },
          { l: "Overdue", v: KES(totals.overdue), warn: true },
          { l: "Excise Duty (MTD)", v: KES(totals.excise) },
        ].map((k) => (
          <Card key={k.l}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
              <div className={`mt-1 font-display text-2xl font-bold ${k.warn ? "text-destructive" : ""}`}>{k.v}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center gap-3">
            <SearchBar value={q} onChange={setQ} placeholder="Invoice # or customer..." />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>ETR / TIMS</TableHead>
                <TableHead>Customer (KRA PIN)</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Excise</TableHead>
                <TableHead className="text-right">VAT 16%</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((i) => (
                <TableRow key={i.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setPreview(i)}>
                  <TableCell className="font-mono text-xs font-medium">{i.id}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{i.etr}</TableCell>
                  <TableCell>
                    <div className="font-medium">{i.customer}</div>
                    <div className="text-xs text-muted-foreground">{i.kraPin}</div>
                  </TableCell>
                  <TableCell>{fmtDate(i.date)}</TableCell>
                  <TableCell>{fmtDate(i.due)}</TableCell>
                  <TableCell className="text-right text-xs">{KES(i.excise)}</TableCell>
                  <TableCell className="text-right text-xs">{KES(i.vat)}</TableCell>
                  <TableCell className="text-right font-semibold">{KES(i.total)}</TableCell>
                  <TableCell><StatusBadge status={i.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display">Tax Invoice — {preview.id}</DialogTitle>
              </DialogHeader>
              <div className="rounded-md border border-border bg-white p-6 text-sm text-foreground">
                <div className="flex items-start justify-between border-b border-border pb-4">
                  <div>
                    <div className="font-display text-xl font-bold">Martin Enterprise Ltd</div>
                    <div className="text-xs text-muted-foreground">Industrial Area, Nairobi · +254 711 100 200</div>
                    <div className="text-xs text-muted-foreground">KRA PIN: P051999999Z · VAT Reg: 0123456789</div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-lg font-bold text-gold">TAX INVOICE</div>
                    <div className="font-mono text-xs">{preview.id}</div>
                    <div className="text-xs text-muted-foreground">ETR: {preview.etr}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-muted-foreground">Bill To</div>
                    <div className="font-semibold">{preview.customer}</div>
                    <div className="text-muted-foreground">KRA PIN: {preview.kraPin}</div>
                  </div>
                  <div className="text-right">
                    <div><span className="text-muted-foreground">Invoice Date:</span> {fmtDate(preview.date)}</div>
                    <div><span className="text-muted-foreground">Due Date:</span> {fmtDate(preview.due)}</div>
                  </div>
                </div>
                <table className="mt-4 w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-2">Description</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit Price</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/50"><td className="py-2">Tusker Lager 500ml (24-pack)</td><td className="text-right">40</td><td className="text-right">5,280</td><td className="text-right">211,200</td></tr>
                    <tr className="border-b border-border/50"><td className="py-2">Whitecap 500ml (24-pack)</td><td className="text-right">30</td><td className="text-right">5,160</td><td className="text-right">154,800</td></tr>
                    <tr className="border-b border-border/50"><td className="py-2">Johnnie Walker Red 750ml</td><td className="text-right">24</td><td className="text-right">2,350</td><td className="text-right">56,400</td></tr>
                  </tbody>
                </table>
                <div className="mt-4 ml-auto w-64 space-y-1 text-xs">
                  <div className="flex justify-between"><span>Subtotal</span><span>{KES(preview.subtotal)}</span></div>
                  <div className="flex justify-between"><span>Excise Duty (KRA)</span><span>{KES(preview.excise)}</span></div>
                  <div className="flex justify-between"><span>VAT ({(VAT_RATE * 100).toFixed(0)}%)</span><span>{KES(preview.vat)}</span></div>
                  <div className="mt-1 flex justify-between border-t border-border pt-2 font-display text-base font-bold"><span>Total</span><span>{KES(preview.total)}</span></div>
                </div>
                <div className="mt-6 border-t border-border pt-3 text-[10px] text-muted-foreground">
                  This is a system-generated KRA-compliant tax invoice. Excise duty calculated per the Excise Duty Act (Kenya).
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline"><Printer className="mr-2 h-4 w-4" />Print</Button>
                <Button variant="outline"><Mail className="mr-2 h-4 w-4" />Email to customer</Button>
                <Button className="bg-navy text-navy-foreground hover:bg-navy/90"><FileDown className="mr-2 h-4 w-4" />Download PDF</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
