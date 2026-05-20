import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, FileSpreadsheet, FileDown } from "lucide-react";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Reports & Analytics — Martin Enterprise ERP" }] }),
});

const groups = [
  { title: "Sales", items: ["Daily Sales", "Sales by Product", "Sales by Customer", "Sales by Rep", "Commission Report"] },
  { title: "Inventory", items: ["Stock on Hand", "Stock Movement", "Stock Valuation (FIFO)", "Expiring Stock", "Low Stock Alert"] },
  { title: "Finance", items: ["Profit & Loss", "Balance Sheet", "Cash Flow", "Trial Balance", "Bank Reconciliation"] },
  { title: "KRA Compliance", items: ["VAT Return (16%)", "Excise Duty Return", "Withholding Tax", "ETR Reconciliation"] },
  { title: "Operations", items: ["Delivery Performance", "Driver Performance", "Customer Aging", "Supplier Aging"] },
];

function ReportsPage() {
  return (
    <div>
      <PageHeader title="Reports & Analytics" description="Export all reports as PDF or Excel." />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <Card key={g.title}>
            <CardHeader><CardTitle className="font-display text-base">{g.title}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {g.items.map((r) => (
                <div key={r} className="flex items-center justify-between rounded-md border border-border p-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-navy" />
                    {r}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="PDF"><FileDown className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Excel"><FileSpreadsheet className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
