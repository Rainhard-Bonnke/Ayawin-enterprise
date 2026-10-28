import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/PageHeader";
import { v1Api } from "@/lib/api-v1";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { LoaderCircle, PackageCheck, Undo2 } from "lucide-react";

export const Route = createFileRoute("/_app/material-returns")({ component: MaterialReturnsPage, head: () => ({ meta: [{ title: "Material Returns - Ayawin Stock Solution" }] }) });
type Issue = { id: string; issue_no: string; issue_date: string; recipient_name: string; request_no: string; status?: string; quantity?: number };
type IssueLot = { batch_no: string | null; expiry_date: string | null; quantity: number; returnable_quantity: number };
type IssueDetail = Issue & { lines: { id: string; item_id: string; item_code: string; item_name: string; uom_code?: string; quantity: number; lot_tracking_enabled: boolean; returnable_quantity: number; issued_lots: IssueLot[] }[] };
type ReturnLine = { issue_line_id: string; item_id: string; batch_no: string | null; expiry_date: string | null; quantity: string; remaining: number; item_code: string; item_name: string; uom_code?: string; condition: "good" | "damaged"; notes: string };
const returnLineKey = (line: ReturnLine) => `${line.issue_line_id}:${line.batch_no || ""}:${line.expiry_date || ""}`;

function MaterialReturnsPage() {
  const { token } = useAuth();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [returns, setReturns] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<IssueDetail | null>(null);
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { const [issueRows, returnRows] = await Promise.all([v1Api.inventory.materialIssues(token), v1Api.inventory.materialReturns(token)]); setIssues(issueRows as Issue[]); setReturns(returnRows); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load material returns"); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  const beginReturn = async (issue: Issue) => {
    if (!token) return;
    try {
      const detail = await v1Api.inventory.materialIssue(token, issue.id) as unknown as IssueDetail;
      setSelected(detail); setReason("");
      setLines(detail.lines.flatMap((line) => {
        const lots = line.lot_tracking_enabled ? line.issued_lots : [{ batch_no: null, expiry_date: null, quantity: Number(line.quantity), returnable_quantity: Number(line.returnable_quantity) }];
        return lots.filter((lot) => Number(lot.returnable_quantity) > 0).map((lot) => ({
          issue_line_id: line.id, item_id: line.item_id, batch_no: lot.batch_no, expiry_date: lot.expiry_date,
          item_code: line.item_code, item_name: line.item_name, uom_code: line.uom_code,
          remaining: Number(lot.returnable_quantity), quantity: "", condition: "good" as const, notes: "",
        }));
      }));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load issue details"); }
  };
  const postReturn = async () => {
    if (!token || !selected) return;
    const returned = lines.filter((line) => Number(line.quantity) > 0);
    if (!reason.trim() || !returned.length || returned.some((line) => Number(line.quantity) > line.remaining)) { toast.error("Enter a return reason and quantities within the unreturned issue balance."); return; }
    setSaving(true);
    try {
      const result = await v1Api.inventory.createMaterialReturn(token, selected.id, { reason, lines: returned.map((line) => ({ issue_line_id: line.issue_line_id, item_id: line.item_id, batch_no: line.batch_no, expiry_date: line.expiry_date, quantity: Number(line.quantity), condition: line.condition, notes: line.notes })) });
      toast.success(`Return received · ${String(result.return_no)}`); setSelected(null); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to post material return"); }
    finally { setSaving(false); }
  };

  return <div className="space-y-5 pb-8">
    <PageHeader title="Material returns" description="Record unused or returned materials against the original issue. Good items return to usable stock; damaged quantities are received directly into quarantine." />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Issues with returnable stock" value={issues.length} /><Metric label="Returns recorded" value={returns.length} /><Metric label="Damaged return lines" value={returns.reduce((sum, row) => sum + Number(row.damaged_lines || 0), 0)} /></div>
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Posted material issues</h2><p className="text-sm text-muted-foreground">A return cannot exceed quantities previously issued less earlier returns.</p></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[800px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Issue</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Requisition</th><th className="px-3 py-3">Recipient</th><th className="px-3 py-3">Quantity issued</th><th className="px-3 py-3">Action</th></tr></thead><tbody>{issues.filter((issue) => issue.status === "posted").map((issue) => <tr key={issue.id} className="border-t"><td className="px-3 py-3 font-semibold">{issue.issue_no}</td><td className="px-3 py-3">{new Date(issue.issue_date).toLocaleDateString()}</td><td className="px-3 py-3">{issue.request_no}</td><td className="px-3 py-3">{issue.recipient_name}</td><td className="px-3 py-3">{Number((issue as unknown as Record<string, unknown>).quantity || 0).toLocaleString()}</td><td className="px-3 py-3"><Button size="sm" variant="outline" onClick={() => void beginReturn(issue)}><Undo2 className="mr-1.5 h-3.5 w-3.5" />Receive return</Button></td></tr>)}{!loading && !issues.length && <tr><td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">No posted material issues are available for return.</td></tr>}</tbody></table></div></CardContent></Card>
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Material return register</h2><p className="text-sm text-muted-foreground">Return entries preserve condition and source issue for audit and follow-up.</p></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[800px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Return</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Source issue</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3 text-right">Units</th><th className="px-3 py-3">Damaged lines</th><th className="px-3 py-3">Status</th></tr></thead><tbody>{returns.map((row) => <tr key={String(row.id)} className="border-t"><td className="px-3 py-3 font-semibold">{String(row.return_no)}</td><td className="px-3 py-3">{new Date(String(row.return_date)).toLocaleDateString()}</td><td className="px-3 py-3">{String(row.issue_no)} · {String(row.recipient_name)}</td><td className="px-3 py-3">{String(row.reason)}</td><td className="px-3 py-3 text-right tabular-nums">{Number(row.quantity).toLocaleString()}</td><td className="px-3 py-3"><Badge variant={Number(row.damaged_lines) ? "destructive" : "secondary"}>{Number(row.damaged_lines)}</Badge></td><td className="px-3 py-3"><Badge variant="secondary">{String(row.status)}</Badge></td></tr>)}{!loading && !returns.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No material returns recorded yet.</td></tr>}</tbody></table></div></CardContent></Card>
    <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Receive return from {selected?.issue_no}</DialogTitle><DialogDescription>Good items return to sellable stock. Damaged items are recorded back into physical stock but held in quarantine, where an authorized reviewer can release, write off, or return them to a supplier.</DialogDescription></DialogHeader><div className="space-y-2"><Label>Reason for return</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="Unused balance, wrong item, damage, etc." /></div><div className="space-y-2"><Label>Returned lines</Label>{lines.length ? lines.map((line) => <div key={returnLineKey(line)} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_100px_130px]"><div><div className="font-medium">{line.item_name}</div><div className="font-mono text-xs text-muted-foreground">{line.item_code}{line.batch_no ? ` · Batch ${line.batch_no} · Exp ${line.expiry_date}` : ""} · Returnable: {line.remaining} {line.uom_code || ""}</div></div><Input type="number" min="0" max={line.remaining} step="any" value={line.quantity} onChange={(event) => setLines((current) => current.map((candidate) => returnLineKey(candidate) === returnLineKey(line) ? { ...candidate, quantity: event.target.value } : candidate))} aria-label={`Return quantity for ${line.item_name}`} /><Select value={line.condition} onValueChange={(condition: "good" | "damaged") => setLines((current) => current.map((candidate) => returnLineKey(candidate) === returnLineKey(line) ? { ...candidate, condition } : candidate))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="good">Good · restock</SelectItem><SelectItem value="damaged">Damaged · quarantine</SelectItem></SelectContent></Select></div>) : <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"><PackageCheck className="mx-auto mb-2 h-6 w-6" />This issue has already been fully returned.</div>}</div><DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button disabled={saving || !lines.length} onClick={() => void postReturn()}>{saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}Post return</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
function Metric({ label, value }: { label: string; value: number }) { return <Card className="rounded-2xl border-border/70"><CardContent className="p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString()}</div></CardContent></Card>; }
