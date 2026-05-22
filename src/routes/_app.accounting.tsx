import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/SearchBar";
import { KES } from "@/lib/format";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPagination } from "@/components/ListPagination";
import { QuietNote } from "@/components/QuietNote";
import { cashFlowForecast } from "@/lib/smartSignals";
import { exportWorkbook } from "@/lib/excel";
import { useState } from "react";
import { Printer, FileDown, ArrowUpDown } from "lucide-react";

export const Route = createFileRoute("/_app/accounting")({
  component: Accounting,
  head: () => ({ meta: [{ title: "Accounting & Finance — Ayawin Enterprise ERP" }] }),
});

const pnl = [
  { month: "Jan", revenue: 9800000, expenses: 7100000 },
  { month: "Feb", revenue: 9100000, expenses: 6800000 },
  { month: "Mar", revenue: 10600000, expenses: 7600000 },
  { month: "Apr", revenue: 12300000, expenses: 8400000 },
  { month: "May", revenue: 13800000, expenses: 9200000 },
];

const aging = [
  { bucket: "Current (0–30)", ar: 2840000, ap: 4100000 },
  { bucket: "31–60 days", ar: 1280000, ap: 1200000 },
  { bucket: "61–90 days", ar: 540000, ap: 380000 },
  { bucket: "90+ days", ar: 287500, ap: 0 },
];

function Accounting() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const journalRows = [
    { d: "20/05/2026", a: "1100 — Cash at Bank", desc: "Payment received — Quickmart", db: 431984, cr: 0 },
    { d: "20/05/2026", a: "1200 — Accounts Receivable", desc: "Payment received — Quickmart", db: 0, cr: 431984 },
    { d: "19/05/2026", a: "1200 — Accounts Receivable", desc: "INV-2026-0531 Mombasa Distributors", db: 1350820, cr: 0 },
    { d: "19/05/2026", a: "4000 — Sales Revenue", desc: "INV-2026-0531", db: 0, cr: 980000 },
    { d: "19/05/2026", a: "2300 — Excise Duty Payable", desc: "INV-2026-0531", db: 0, cr: 184500 },
    { d: "19/05/2026", a: "2200 — VAT Output", desc: "INV-2026-0531", db: 0, cr: 186320 },
  ]
    .filter((j) => j.d.includes(q) || j.a.toLowerCase().includes(q.toLowerCase()) || j.desc.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sort === "account") return a.a.localeCompare(b.a);
      return b.d.localeCompare(a.d);
    });
  const totalPages = Math.max(1, Math.ceil(journalRows.length / pageSize));
  const paged = journalRows.slice((page - 1) * pageSize, page * pageSize);
  const forecast = cashFlowForecast();
  const exportAccounting = () => {
    exportWorkbook("ayawin-enterprise-accounting.xlsx", [
      {
        name: "Journal",
        rows: journalRows.map((j) => ({
          Date: j.d,
          Account: j.a,
          Description: j.desc,
          Debit: j.db,
          Credit: j.cr,
        })),
      },
      {
        name: "P&L",
        rows: pnl.map((row) => ({
          Month: row.month,
          Revenue: row.revenue,
          Expenses: row.expenses,
          Profit: row.revenue - row.expenses,
        })),
      },
      {
        name: "Aging",
        rows: aging.map((row) => ({
          Bucket: row.bucket,
          Receivable: row.ar,
          Payable: row.ap,
        })),
      },
      {
        name: "Cash Flow",
        rows: forecast.map((row) => ({
          Period: row.label,
          Value: row.value,
        })),
      },
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Accounting & Finance"
        description="General Ledger, AR/AP, VAT & Excise returns, P&L."
        actions={
          <>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button variant="outline" onClick={exportAccounting}>
              <FileDown className="mr-2 h-4 w-4" />
              Export XLSX
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Cash Balance", v: KES(8420000) },
          { l: "Accounts Receivable", v: KES(4947500) },
          { l: "Accounts Payable", v: KES(5680000) },
          { l: "VAT Payable (MTD)", v: KES(692400) },
        ].map((k) => (
          <Card key={k.l}><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{k.l}</div>
            <div className="mt-1 font-display text-2xl font-bold">{k.v}</div>
          </CardContent></Card>
        ))}
      </div>

      <QuietNote
        scenario="accounting"
        contextKey={`${q}-${sort}`}
        context={{ q, sort, journalRows, pnl, aging }}
        className="mb-4"
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="font-display">Next 30 Days Cash Flow</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {forecast.map((item) => (
            <div key={item.label} className="rounded-xl border border-border/70 bg-background/60 p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{item.label}</div>
              <div className="mt-1 font-display text-xl font-bold">{KES(item.value)}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Tabs defaultValue="pnl">
        <TabsList>
          <TabsTrigger value="pnl">P&L</TabsTrigger>
          <TabsTrigger value="aging">Aging</TabsTrigger>
          <TabsTrigger value="vat">VAT & Excise (KRA)</TabsTrigger>
          <TabsTrigger value="ledger">General Ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="pnl" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-display">Profit & Loss — Last 5 months</CardTitle></CardHeader>
            <CardContent className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnl}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `${v / 1000000}M`} />
                  <Tooltip formatter={(v: number) => KES(v)} />
                  <Bar dataKey="revenue" fill="var(--navy)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="expenses" fill="var(--gold)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aging" className="mt-4">
          <Card><CardContent className="p-4">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Receivable</TableHead>
                <TableHead className="text-right">Payable</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {aging.map((a) => (
                  <TableRow key={a.bucket}>
                    <TableCell className="font-medium">{a.bucket}</TableCell>
                    <TableCell className="text-right">{KES(a.ar)}</TableCell>
                    <TableCell className="text-right">{KES(a.ap)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="vat" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="font-display">VAT Return — May 2026</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Output VAT (Sales)" value={KES(2208000)} />
                <Row label="Input VAT (Purchases)" value={KES(1515600)} />
                <div className="my-2 border-t border-border" />
                <Row label="Net VAT Payable" value={KES(692400)} bold />
                <div className="mt-3 text-xs text-muted-foreground">Due to KRA by 20 June 2026</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="font-display">Excise Duty Return</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Beer (KES 121.85/L)" value={KES(412000)} />
                <Row label="Spirits (KES 356.28/L)" value={KES(298000)} />
                <Row label="Wine (KES 229.85/L)" value={KES(58000)} />
                <Row label="Soft Drinks (KES 10.68/L)" value={KES(38500)} />
                <div className="my-2 border-t border-border" />
                <Row label="Total Excise Duty" value={KES(806500)} bold />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <Card><CardContent className="p-4">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <SearchBar value={q} onChange={(value) => { setQ(value); setPage(1); }} placeholder="Search journal entries..." />
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-40">
                  <ArrowUpDown className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Sort by date</SelectItem>
                  <SelectItem value="account">Sort by account</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Account</TableHead><TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {paged.map((j, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{j.d}</TableCell>
                    <TableCell className="font-mono text-xs">{j.a}</TableCell>
                    <TableCell className="text-xs">{j.desc}</TableCell>
                    <TableCell className="text-right text-xs">{j.db ? KES(j.db) : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{j.cr ? KES(j.cr) : "—"}</TableCell>
                  </TableRow>
                ))}
                {paged.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      No journal entries match your filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <ListPagination page={page} totalPages={totalPages} totalItems={journalRows.length} pageSize={pageSize} onPageChange={setPage} />
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-display text-base font-bold" : ""}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
