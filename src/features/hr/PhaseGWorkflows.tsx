import { useEffect, useState, type FormEvent } from "react";
import { Check, CreditCard, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { v1Api } from "@/lib/api-v1";
import type { BackendEmployee } from "@/lib/api-types";

type Row = Record<string, unknown>;
type PhaseGData = {
  claims: Row[];
  profileChanges: Row[];
  leaveTypes: Row[];
  leaveRules: Row[];
  futureEvents: Row[];
  retentionPolicies: Row[];
};

const emptyData: PhaseGData = {
  claims: [],
  profileChanges: [],
  leaveTypes: [],
  leaveRules: [],
  futureEvents: [],
  retentionPolicies: [],
};

function currentDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function loadPhaseGData(token: string): Promise<PhaseGData> {
  const [claims, profileChanges, leaveTypes, leaveRules, futureEvents, retentionPolicies] = await Promise.all([
    v1Api.hr.claims(token),
    v1Api.hr.profileChangeRequests(token),
    v1Api.hr.leaveTypes(token),
    v1Api.hr.payrollLeaveRules(token),
    v1Api.hr.futureEvents(token),
    v1Api.hr.retentionPolicies(token),
  ]);
  return { claims, profileChanges, leaveTypes, leaveRules, futureEvents, retentionPolicies };
}

function text(value: unknown, fallback = "—") {
  return value == null || value === "" ? fallback : String(value);
}

function EmployeeSelect({
  employees,
  value,
  onChange,
}: {
  employees: BackendEmployee[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label="Employee"
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required
    >
      <option value="">Select employee</option>
      {employees.map((employee) => (
        <option key={employee.id} value={employee.id}>{employee.name}</option>
      ))}
    </select>
  );
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-7 text-center text-sm text-muted-foreground">No records</td>
    </tr>
  );
}

export function PhaseGWorkflows({ employees }: { employees: BackendEmployee[] }) {
  const { token, user } = useAuth();
  const [data, setData] = useState<PhaseGData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [claimDraft, setClaimDraft] = useState({ claim_date: currentDate(), description: "", category: "TRAVEL", currency_code: "KES", total_amount: "" });
  const [profileDraft, setProfileDraft] = useState({ field_name: "department", new_value: "" });
  const [leaveRuleDraft, setLeaveRuleDraft] = useState({ leave_type_id: "", payroll_deduction_percent: "0", minimum_balance_days: "0", effective_from: currentDate(), paid_leave_requires_balance: true });
  const [futureDraft, setFutureDraft] = useState({ field_name: "department", new_value: "", effective_date: currentDate() });
  const [retentionDraft, setRetentionDraft] = useState({ policy_name: "", data_type: "employee_documents", retention_days: "2555", archival_required: true });
  const [paymentReference, setPaymentReference] = useState("");
  const canCreate = user?.role === "Admin" || user?.permissions?.includes("hr.create");
  const canApprove = user?.role === "Admin" || user?.permissions?.includes("hr.approve");

  const reload = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setData(await loadPhaseGData(token));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load HR controls");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    void loadPhaseGData(token)
      .then((result) => { if (active) setData(result); })
      .catch((error: unknown) => { if (active) toast.error(error instanceof Error ? error.message : "Unable to load HR controls"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const execute = async (action: () => Promise<unknown>, successMessage: string) => {
    if (!token) return;
    setSaving(true);
    try {
      await action();
      await reload();
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The HR action could not be completed");
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>, action: () => Promise<unknown>, message: string) => {
    event.preventDefault();
    void execute(action, message);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      <Tabs defaultValue="claims">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="profile">Profile changes</TabsTrigger>
          <TabsTrigger value="leave-rules">Payroll leave rules</TabsTrigger>
          <TabsTrigger value="future">Future changes</TabsTrigger>
          <TabsTrigger value="retention">Retention</TabsTrigger>
        </TabsList>

        <TabsContent value="claims" className="mt-4">
          <Card><CardContent className="space-y-5 p-4">
            {canCreate && <form className="grid gap-3 border-b pb-5 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => submit(event, () => v1Api.hr.createClaim(token!, { ...claimDraft, employee_id: employeeId, total_amount: Number(claimDraft.total_amount) }), "Claim submitted") }>
              <div className="space-y-1.5"><Label>Employee</Label><EmployeeSelect employees={employees} value={employeeId} onChange={setEmployeeId} /></div>
              <div className="space-y-1.5"><Label>Claim date</Label><Input type="date" value={claimDraft.claim_date} onChange={(event) => setClaimDraft({ ...claimDraft, claim_date: event.target.value })} required /></div>
              <div className="space-y-1.5"><Label>Category</Label><Input value={claimDraft.category} onChange={(event) => setClaimDraft({ ...claimDraft, category: event.target.value })} required /></div>
              <div className="space-y-1.5"><Label>Description</Label><Input value={claimDraft.description} onChange={(event) => setClaimDraft({ ...claimDraft, description: event.target.value })} maxLength={1000} required /></div>
              <div className="space-y-1.5"><Label>Amount</Label><Input type="number" min="0.01" step="0.01" value={claimDraft.total_amount} onChange={(event) => setClaimDraft({ ...claimDraft, total_amount: event.target.value })} required /></div>
              <div className="space-y-1.5"><Label>Currency</Label><Input minLength={3} maxLength={3} value={claimDraft.currency_code} onChange={(event) => setClaimDraft({ ...claimDraft, currency_code: event.target.value.toUpperCase() })} required /></div>
              <div className="sm:col-span-2 lg:col-span-3"><Button disabled={saving || !employeeId}><Plus className="mr-2 h-4 w-4" /> Submit claim</Button></div>
            </form>}
            {data.claims.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No claims have been submitted.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Employee</th><th className="p-2">Date</th><th className="p-2">Description</th><th className="p-2">Amount</th><th className="p-2">Status</th><th className="p-2 text-right">Actions</th></tr></thead><tbody>
              {data.claims.map((row) => <tr key={text(row.id)} className="border-b"><td className="p-2">{`${text(row.first_name, "")} ${text(row.last_name, "")}`.trim()}</td><td className="p-2">{text(row.claim_date).slice(0, 10)}</td><td className="max-w-64 truncate p-2">{text(row.description)}</td><td className="p-2">{text(row.currency_code)} {text(row.total_amount)}</td><td className="p-2"><StatusBadge status={text(row.status)} /></td><td className="p-2"><div className="flex justify-end gap-1">
                {canApprove && row.status === "submitted" && <><Button size="icon" variant="ghost" title="Approve claim" aria-label="Approve claim" disabled={saving} onClick={() => void execute(() => v1Api.hr.decideClaim(token!, text(row.id), { decision: "approved" }), "Claim approved")}><Check className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Reject claim" aria-label="Reject claim" disabled={saving} onClick={() => void execute(() => v1Api.hr.decideClaim(token!, text(row.id), { decision: "rejected" }), "Claim rejected")}><X className="h-4 w-4" /></Button></>}
                {canApprove && row.status === "approved" && <><Input aria-label="Payment reference" className="h-8 w-36" placeholder="Payment reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /><Button size="icon" variant="ghost" title="Mark claim paid" aria-label="Mark claim paid" disabled={saving || !paymentReference.trim()} onClick={() => void execute(() => v1Api.hr.decideClaim(token!, text(row.id), { decision: "paid", payment_reference: paymentReference }), "Claim marked paid")}><CreditCard className="h-4 w-4" /></Button></>}
              </div></td></tr>)}
            </tbody></table></div>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="profile" className="mt-4">
          <Card><CardContent className="space-y-5 p-4">
            {canCreate && <form className="grid gap-3 border-b pb-5 sm:grid-cols-3" onSubmit={(event) => submit(event, () => v1Api.hr.createProfileChangeRequest(token!, { employee_id: employeeId, ...profileDraft }), "Profile change submitted for review")}>
              <div className="space-y-1.5"><Label>Employee</Label><EmployeeSelect employees={employees} value={employeeId} onChange={setEmployeeId} /></div>
              <div className="space-y-1.5"><Label>Field</Label><select aria-label="Profile field" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={profileDraft.field_name} onChange={(event) => setProfileDraft({ ...profileDraft, field_name: event.target.value })}><option value="department">Department</option><option value="job_title">Job title</option><option value="email">Email</option><option value="phone">Phone</option></select></div>
              <div className="space-y-1.5"><Label>Requested value</Label><Input value={profileDraft.new_value} onChange={(event) => setProfileDraft({ ...profileDraft, new_value: event.target.value })} required /></div>
              <div className="sm:col-span-3"><Button disabled={saving || !employeeId}><Plus className="mr-2 h-4 w-4" /> Request change</Button></div>
            </form>}
            {data.profileChanges.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No profile changes are awaiting or have completed review.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Employee</th><th className="p-2">Field</th><th className="p-2">From</th><th className="p-2">To</th><th className="p-2">Status</th><th className="p-2 text-right">Review</th></tr></thead><tbody>{data.profileChanges.map((row) => <tr key={text(row.id)} className="border-b"><td className="p-2">{`${text(row.first_name, "")} ${text(row.last_name, "")}`.trim()}</td><td className="p-2">{text(row.field_name)}</td><td className="p-2">{text(row.old_value)}</td><td className="p-2">{text(row.new_value)}</td><td className="p-2"><StatusBadge status={text(row.status)} /></td><td className="p-2 text-right">{canApprove && row.status === "pending" && <div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Approve profile change" aria-label="Approve profile change" disabled={saving} onClick={() => void execute(() => v1Api.hr.decideProfileChangeRequest(token!, text(row.id), { decision: "approved" }), "Profile change approved")}><Check className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Reject profile change" aria-label="Reject profile change" disabled={saving} onClick={() => void execute(() => v1Api.hr.decideProfileChangeRequest(token!, text(row.id), { decision: "rejected" }), "Profile change rejected")}><X className="h-4 w-4" /></Button></div>}</td></tr>)}</tbody></table></div>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="leave-rules" className="mt-4">
          <Card><CardContent className="space-y-5 p-4">
            {canCreate && <form className="grid gap-3 border-b pb-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => submit(event, () => v1Api.hr.savePayrollLeaveRule(token!, { ...leaveRuleDraft, payroll_deduction_percent: Number(leaveRuleDraft.payroll_deduction_percent), minimum_balance_days: Number(leaveRuleDraft.minimum_balance_days) }), "Payroll leave rule saved")}>
              <div className="space-y-1.5"><Label>Leave type</Label><select aria-label="Leave type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={leaveRuleDraft.leave_type_id} onChange={(event) => setLeaveRuleDraft({ ...leaveRuleDraft, leave_type_id: event.target.value })} required><option value="">Select type</option>{data.leaveTypes.map((row) => <option key={text(row.id)} value={text(row.id)}>{text(row.name)}</option>)}</select></div>
              <div className="space-y-1.5"><Label>Payroll deduction (%)</Label><Input type="number" min="0" max="100" step="0.01" value={leaveRuleDraft.payroll_deduction_percent} onChange={(event) => setLeaveRuleDraft({ ...leaveRuleDraft, payroll_deduction_percent: event.target.value })} required /></div>
              <div className="space-y-1.5"><Label>Minimum balance (days)</Label><Input type="number" min="0" step="0.01" value={leaveRuleDraft.minimum_balance_days} onChange={(event) => setLeaveRuleDraft({ ...leaveRuleDraft, minimum_balance_days: event.target.value })} required /></div>
              <div className="space-y-1.5"><Label>Effective from</Label><Input type="date" value={leaveRuleDraft.effective_from} onChange={(event) => setLeaveRuleDraft({ ...leaveRuleDraft, effective_from: event.target.value })} required /></div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={leaveRuleDraft.paid_leave_requires_balance} onChange={(event) => setLeaveRuleDraft({ ...leaveRuleDraft, paid_leave_requires_balance: event.target.checked })} /> Require sufficient balance for paid leave</label>
              <div className="sm:col-span-2"><Button disabled={saving || !leaveRuleDraft.leave_type_id}><Plus className="mr-2 h-4 w-4" /> Save leave rule</Button></div>
            </form>}
            {data.leaveRules.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No payroll leave rules configured.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Leave type</th><th className="p-2">Deduction</th><th className="p-2">Minimum balance</th><th className="p-2">Effective</th><th className="p-2">Balance required</th><th className="p-2">Status</th></tr></thead><tbody>{data.leaveRules.map((row) => <tr key={text(row.id)} className="border-b"><td className="p-2">{text(row.leave_type_name)}</td><td className="p-2">{text(row.payroll_deduction_percent)}%</td><td className="p-2">{text(row.minimum_balance_days)}</td><td className="p-2">{text(row.effective_from).slice(0, 10)}</td><td className="p-2">{row.paid_leave_requires_balance ? "Yes" : "No"}</td><td className="p-2"><Button size="sm" variant="outline" disabled={saving} onClick={() => void execute(() => v1Api.hr.setPayrollLeaveRuleActive(token!, text(row.id), !row.is_active), row.is_active ? "Rule deactivated" : "Rule activated")}>{row.is_active ? "Deactivate" : "Activate"}</Button></td></tr>)}</tbody></table></div>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="future" className="mt-4">
          <Card><CardContent className="space-y-5 p-4">
            {canCreate && <form className="grid gap-3 border-b pb-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => submit(event, () => v1Api.hr.createFutureEvent(token!, { entity_type: "erp_employees", entity_id: employeeId, ...futureDraft }), "Future change submitted for review")}>
              <div className="space-y-1.5"><Label>Employee</Label><EmployeeSelect employees={employees} value={employeeId} onChange={setEmployeeId} /></div>
              <div className="space-y-1.5"><Label>Field</Label><select aria-label="Scheduled field" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={futureDraft.field_name} onChange={(event) => setFutureDraft({ ...futureDraft, field_name: event.target.value })}><option value="department">Department</option><option value="job_title">Job title</option><option value="email">Email</option><option value="phone">Phone</option></select></div>
              <div className="space-y-1.5"><Label>New value</Label><Input value={futureDraft.new_value} onChange={(event) => setFutureDraft({ ...futureDraft, new_value: event.target.value })} required /></div>
              <div className="space-y-1.5"><Label>Effective date</Label><Input type="date" min={currentDate()} value={futureDraft.effective_date} onChange={(event) => setFutureDraft({ ...futureDraft, effective_date: event.target.value })} required /></div>
              <div className="sm:col-span-2 lg:col-span-4"><Button disabled={saving || !employeeId}><Plus className="mr-2 h-4 w-4" /> Schedule change</Button></div>
            </form>}
            {data.futureEvents.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No future employee changes are pending or scheduled.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Employee</th><th className="p-2">Field</th><th className="p-2">New value</th><th className="p-2">Effective</th><th className="p-2">Status</th><th className="p-2 text-right">Review</th></tr></thead><tbody>{data.futureEvents.map((row) => <tr key={text(row.id)} className="border-b"><td className="p-2">{text(row.entity_id)}</td><td className="p-2">{text(row.field_name)}</td><td className="p-2">{text(row.new_value)}</td><td className="p-2">{text(row.effective_from).slice(0, 10)}</td><td className="p-2"><StatusBadge status={text(row.status)} /></td><td className="p-2 text-right">{canApprove && row.status === "pending" && <div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Approve scheduled change" aria-label="Approve scheduled change" disabled={saving} onClick={() => void execute(() => v1Api.hr.decideFutureEvent(token!, text(row.id), { decision: "approved" }), "Scheduled change approved")}><Check className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Reject scheduled change" aria-label="Reject scheduled change" disabled={saving} onClick={() => void execute(() => v1Api.hr.decideFutureEvent(token!, text(row.id), { decision: "rejected" }), "Scheduled change rejected")}><X className="h-4 w-4" /></Button></div>}</td></tr>)}</tbody></table></div>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="retention" className="mt-4">
          <Card><CardContent className="space-y-5 p-4">
            {canCreate && <form className="grid gap-3 border-b pb-5 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => submit(event, () => v1Api.hr.saveRetentionPolicy(token!, { ...retentionDraft, retention_days: Number(retentionDraft.retention_days) }), "Retention policy saved")}>
              <div className="space-y-1.5"><Label>Policy name</Label><Input value={retentionDraft.policy_name} onChange={(event) => setRetentionDraft({ ...retentionDraft, policy_name: event.target.value })} required /></div>
              <div className="space-y-1.5"><Label>HR data type</Label><select aria-label="HR data type" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={retentionDraft.data_type} onChange={(event) => setRetentionDraft({ ...retentionDraft, data_type: event.target.value })}><option value="employee_documents">Employee documents</option><option value="employee_dependants">Employee dependants</option><option value="employee_claims">Employee claims</option><option value="profile_change_requests">Profile change requests</option><option value="attendance">Attendance</option></select></div>
              <div className="space-y-1.5"><Label>Retention period (days)</Label><Input type="number" min="1" step="1" value={retentionDraft.retention_days} onChange={(event) => setRetentionDraft({ ...retentionDraft, retention_days: event.target.value })} required /></div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={retentionDraft.archival_required} onChange={(event) => setRetentionDraft({ ...retentionDraft, archival_required: event.target.checked })} /> Archive before disposal</label>
              <div className="sm:col-span-2 lg:col-span-4"><Button disabled={saving}><Plus className="mr-2 h-4 w-4" /> Save policy</Button></div>
            </form>}
            {data.retentionPolicies.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No HR retention policies configured.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Policy</th><th className="p-2">Data type</th><th className="p-2">Days</th><th className="p-2">Archive</th><th className="p-2">Status</th><th className="p-2 text-right">Action</th></tr></thead><tbody>{data.retentionPolicies.map((row) => <tr key={text(row.id)} className="border-b"><td className="p-2">{text(row.policy_name)}</td><td className="p-2">{text(row.data_type)}</td><td className="p-2">{text(row.retention_days)}</td><td className="p-2">{row.archival_required ? "Required" : "Not required"}</td><td className="p-2"><StatusBadge status={text(row.status)} /></td><td className="p-2 text-right">{canCreate && <Button size="sm" variant="outline" disabled={saving} onClick={() => void execute(() => v1Api.hr.setRetentionPolicyStatus(token!, text(row.id), row.status === "active" ? "inactive" : "active"), row.status === "active" ? "Policy deactivated" : "Policy activated")}>{row.status === "active" ? "Deactivate" : "Activate"}</Button>}</td></tr>)}</tbody></table></div>}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}