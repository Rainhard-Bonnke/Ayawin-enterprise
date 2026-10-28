import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, CircleCheck, LoaderCircle, PackageOpen } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { v1Api } from "@/lib/api-v1";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/material-issues")({ component: MaterialIssuesPage, head: () => ({ meta: [{ title: "Material Issues - Ayawin Stock Solution" }] }) });
type ReqLine = { id: string; item_id: string; item_code: string; item_name: string; uom_code?: string; approved_quantity: number; issued_quantity: number };
type Requisition = { id: string; request_no: string; status: string; requesting_department: string; warehouse_name: string; required_date?: string; lines: ReqLine[] };
type IssueLine = { item_id: string; quantity: string; remaining: number; item_code: string; item_name: string; uom_code?: string };

function MaterialIssuesPage() {
  const { token } = useAuth();
  const [requests, setRequests] = useState<Record<string, unknown>[]>([]);
  const [issues, setIssues] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<Requisition | null>(null);
  const [lines, setLines] = useState<IssueLine[]>([]);
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [allRequests, allIssues] = await Promise.all([v1Api.inventory.materialRequisitions(token), v1Api.inventory.materialIssues(token)]);
      setRequests(allRequests); setIssues(allIssues);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load material issues"); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const openIssue = async (row: Record<string, unknown>) => {
    if (!token) return;
    try {
      const detail = await v1Api.inventory.materialRequisition(token, String(row.id)) as unknown as Requisition;
      setSelected(detail);
      setRecipient(detail.requesting_department || "");
      setNotes("");
      setLines(detail.lines.filter((line) => line.approved_quantity > line.issued_quantity).map((line) => ({ item_id: line.item_id, item_code: line.item_code, item_name: line.item_name, uom_code: line.uom_code, remaining: Number(line.approved_quantity) - Number(line.issued_quantity), quantity: String(Number(line.approved_quantity) - Number(line.issued_quantity)) })));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load request lines"); }
  };
  const postIssue = async () => {
    if (!token || !selected) return;
    const issueLines = lines.filter((line) => Number(line.quantity) > 0);
    if (!recipient.trim() || !issueLines.length || issueLines.some((line) => Number(line.quantity) > line.remaining)) { toast.error("Enter a recipient and valid quantities within the approved balance."); return; }
    setSaving(true);
    try {
      const issue = await v1Api.inventory.issueMaterialRequisition(token, selected.id, { recipient, notes, lines: issueLines.map((line) => ({ item_id: line.item_id, quantity: Number(line.quantity) })) });
      toast.success(`Stock issued · ${String(issue.issue_no)}`); setSelected(null); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to post material issue"); }
    finally { setSaving(false); }
  };
  const eligible = requests.filter((row) => ["approved", "partially_issued"].includes(String(row.status)));

  return <div className="space-y-5 pb-8">
    <PageHeader title="Material issues" description="Issue approved internal requisitions from their approved stock location. Every issue reduces available stock and writes to the inventory ledger." />
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Requests ready to issue" value={eligible.length} /><Metric label="Issues posted" value={issues.length} /><Metric label="Units issued" value={issues.reduce((sum, row) => sum + Number(row.quantity || 0), 0)} /></div>
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Approved requests</h2><p className="text-sm text-muted-foreground">Only approved quantities can be issued. Partial issues remain open for the balance.</p></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[850px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Request</th><th className="px-3 py-3">Department</th><th className="px-3 py-3">From warehouse</th><th className="px-3 py-3 text-right">Requested units</th><th className="px-3 py-3 text-right">Already issued</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Action</th></tr></thead><tbody>{eligible.map((row) => <tr key={String(row.id)} className="border-t"><td className="px-3 py-3 font-semibold">{String(row.request_no)}</td><td className="px-3 py-3">{String(row.requesting_department || "—")}</td><td className="px-3 py-3">{String(row.warehouse_name)}</td><td className="px-3 py-3 text-right tabular-nums">{Number(row.requested_units).toLocaleString()}</td><td className="px-3 py-3 text-right tabular-nums">{Number(row.issued_units).toLocaleString()}</td><td className="px-3 py-3"><Badge variant="secondary">{String(row.status).replaceAll("_", " ")}</Badge></td><td className="px-3 py-3"><Button size="sm" onClick={() => void openIssue(row)}><ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" /> Prepare issue</Button></td></tr>)}{!loading && !eligible.length && <tr><td colSpan={7} className="px-3 py-12 text-center text-muted-foreground">No approved requests are waiting for an issue.</td></tr>}</tbody></table></div></CardContent></Card>
    <Card className="rounded-2xl border-border/70 shadow-sm"><CardContent className="space-y-3 p-5"><div><h2 className="font-semibold">Issue register</h2><p className="text-sm text-muted-foreground">Posted stock issue documents linked to the originating request.</p></div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[750px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3">Issue #</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Requisition</th><th className="px-3 py-3">Recipient</th><th className="px-3 py-3">Warehouse</th><th className="px-3 py-3 text-right">Units</th><th className="px-3 py-3">Status</th></tr></thead><tbody>{issues.map((row) => <tr key={String(row.id)} className="border-t"><td className="px-3 py-3 font-semibold">{String(row.issue_no)}</td><td className="px-3 py-3">{new Date(String(row.issue_date)).toLocaleDateString()}</td><td className="px-3 py-3">{String(row.request_no)}</td><td className="px-3 py-3">{String(row.recipient_name)}</td><td className="px-3 py-3">{String(row.warehouse_name)}</td><td className="px-3 py-3 text-right tabular-nums">{Number(row.quantity).toLocaleString()}</td><td className="px-3 py-3"><Badge variant="secondary">{String(row.status)}</Badge></td></tr>)}{!loading && !issues.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No stock issues have been posted yet.</td></tr>}</tbody></table></div></CardContent></Card>

    <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Issue {selected?.request_no}</DialogTitle><DialogDescription>Posting this issue reduces on-hand stock at {selected?.warehouse_name}. Check quantities with the recipient before posting.</DialogDescription></DialogHeader><div className="space-y-2"><Label>Issued to / receiving person</Label><Input value={recipient} onChange={(event) => setRecipient(event.target.value)} maxLength={180} /></div><div className="space-y-2"><Label>Issue quantities</Label>{lines.map((line) => <div key={line.item_id} className="grid items-center gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_120px_100px]"><div><div className="font-medium">{line.item_name}</div><div className="font-mono text-xs text-muted-foreground">{line.item_code} · Remaining approved: {line.remaining} {line.uom_code || ""}</div></div><Input type="number" min="0" max={line.remaining} step="any" value={line.quantity} onChange={(event) => setLines((current) => current.map((candidate) => candidate.item_id === line.item_id ? { ...candidate, quantity: event.target.value } : candidate))} aria-label={`Issue quantity for ${line.item_name}`} /><span className="text-xs text-muted-foreground">{line.uom_code || "units"}</span></div>)}</div><div className="space-y-2"><Label>Notes</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} /></div><DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button><Button disabled={saving} onClick={() => void postIssue()}>{saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CircleCheck className="mr-2 h-4 w-4" />}Post stock issue</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
function Metric({ label, value }: { label: string; value: number }) { return <Card className="rounded-2xl border-border/70"><CardContent className="p-4"><div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString()}</div></CardContent></Card>; }
