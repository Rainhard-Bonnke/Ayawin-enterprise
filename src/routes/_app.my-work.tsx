import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { v1Api } from "@/lib/api-v1";
import { queryKeys } from "@/lib/queryKeys";
import { useAction, useList } from "@/lib/queryHooks";
import { KES, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SelfProfile = Record<string, unknown>;
type SelfLeave = Record<string, unknown>;
type SelfPayslip = Record<string, unknown>;

function todayInput() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const Route = createFileRoute("/_app/my-work")({
  component: MyWorkPage,
  head: () => ({ meta: [{ title: "My Work - Ayawin ERP" }] }),
});

function MyWorkPage() {
  const { token, user } = useAuth();
  const workspaceQuery = useList(
    queryKeys.hr.selfService(user?.id),
    async ({ signal }) => {
      const [profile, attendance, leaveTypes, leaveApplications, leaveBalancesResponse, payslips, claims, profileChangeRequests] = await Promise.all([
        v1Api.hr.selfProfile(token!, signal),
        v1Api.hr.selfAttendance(token!, signal),
        v1Api.hr.selfLeaveTypes(token!, signal),
        v1Api.hr.selfLeaveApplications(token!, signal),
        v1Api.hr.selfLeaveBalances(token!, signal),
        v1Api.hr.selfPayslips(token!, signal),
        v1Api.hr.selfClaims(token!, signal),
        v1Api.hr.selfProfileChangeRequests(token!, signal),
      ]);
      return { profile, attendance, leaveTypes, leaveApplications, leaveBalances: leaveBalancesResponse, payslips, claims, profileChangeRequests };
    },
    { enabled: Boolean(token) },
  );
  const profile = (workspaceQuery.data?.profile ?? null) as SelfProfile | null;
  const attendance = workspaceQuery.data?.attendance ?? [];
  const leaveTypes = workspaceQuery.data?.leaveTypes ?? [];
  const leaveApplications = (workspaceQuery.data?.leaveApplications ?? []) as SelfLeave[];
  const leaveBalances = (workspaceQuery.data?.leaveBalances ?? []) as Record<string, unknown>[];
  const payslips = (workspaceQuery.data?.payslips ?? []) as SelfPayslip[];
  const selfClaims = workspaceQuery.data?.claims ?? [];
  const selfProfileChanges = workspaceQuery.data?.profileChangeRequests ?? [];
  const loading = workspaceQuery.isPending;
  const loadError = workspaceQuery.error?.message ?? "";
  const [submittingLeave, setSubmittingLeave] = useState(false);
  const [selectedPayslip, setSelectedPayslip] = useState<SelfPayslip | null>(null);
  const [encashing, setEncashing] = useState<string | null>(null);
  const [submittingClaim, setSubmittingClaim] = useState(false);
  const [submittingProfileChange, setSubmittingProfileChange] = useState(false);
  const [claimForm, setClaimForm] = useState({ claim_date: todayInput(), description: "", category: "GENERAL", currency_code: "KES", total_amount: "" });
  const [profileChangeForm, setProfileChangeForm] = useState({ field_name: "phone", new_value: "" });
  const [leaveForm, setLeaveForm] = useState({
    leave_type_id: "",
    start_date: todayInput(),
    end_date: todayInput(),
    days_requested: "1",
    reason: "",
  });

  const leaveAction = useAction({
    mutationFn: (body: {
      leave_type_id: string;
      start_date: string;
      end_date: string;
      days_requested: number;
      reason: string;
    }) => v1Api.hr.requestSelfLeave(token!, body),
    invalidate: [queryKeys.hr.selfService(user?.id)],
  });

  const submitLeaveRequest = async () => {
    if (!token || !leaveForm.leave_type_id) {
      toast.error("Select a leave type");
      return;
    }
    setSubmittingLeave(true);
    try {
      await leaveAction.mutateAsync({
        leave_type_id: leaveForm.leave_type_id,
        start_date: leaveForm.start_date,
        end_date: leaveForm.end_date,
        days_requested: Number(leaveForm.days_requested),
        reason: leaveForm.reason,
      });
      setLeaveForm((form) => ({ ...form, reason: "" }));
      await workspaceQuery.refetch();
      toast.success("Leave request submitted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit leave request");
    } finally {
      setSubmittingLeave(false);
    }
  };

  const handleEncashLeave = async (leaveTypeId: string, days: number) => {
    if (!token) return;
    setEncashing(leaveTypeId);
    try {
      await v1Api.hr.encashSelfLeaveBalance(token, leaveTypeId, days);
      await workspaceQuery.refetch();
      toast.success("Leave balance encashed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to encash leave balance");
    } finally {
      setEncashing(null);
    }
  };

  const submitSelfClaim = async () => {
    if (!token) return;
    setSubmittingClaim(true);
    try {
      await v1Api.hr.submitSelfClaim(token, { ...claimForm, total_amount: Number(claimForm.total_amount) });
      setClaimForm((form) => ({ ...form, description: "", total_amount: "" }));
      await workspaceQuery.refetch();
      toast.success("Claim submitted for review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit claim");
    } finally {
      setSubmittingClaim(false);
    }
  };

  const submitSelfProfileChange = async () => {
    if (!token) return;
    setSubmittingProfileChange(true);
    try {
      await v1Api.hr.submitSelfProfileChangeRequest(token, profileChangeForm);
      setProfileChangeForm((form) => ({ ...form, new_value: "" }));
      await workspaceQuery.refetch();
      toast.success("Profile change submitted for review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit profile change");
    } finally {
      setSubmittingProfileChange(false);
    }
  };

  const displayName =
    `${String(profile?.first_name || "")} ${String(profile?.last_name || "")}`.trim();

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="My Work"
        description="Your employee details, attendance, leave and released payslips."
      />

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading your records...</p>
      ) : loadError ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <h2 className="font-semibold">Employee profile unavailable</h2>
            <p className="text-sm text-muted-foreground">
              {loadError.toLowerCase().includes("no unique active employee profile")
                ? "Your active login has not been linked to an employee record. Ask HR to link the account using the same work email recorded on your employee profile."
                : loadError}
            </p>
            <Button variant="outline" onClick={() => void workspaceQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : profile ? (
        <>
          <Card>
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Employee</div>
                <div className="font-medium">{displayName}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Employee code</div>
                <div className="font-medium">{String(profile.employee_code || "—")}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Role / department</div>
                <div className="font-medium">
                  {String(profile.job_title || "—")} · {String(profile.department || "—")}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Branch</div>
                <div className="font-medium">{String(profile.branch_name || "—")}</div>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="leave">
            <TabsList>
              <TabsTrigger value="leave">Leave</TabsTrigger>
              <TabsTrigger value="attendance">Attendance</TabsTrigger>
              <TabsTrigger value="payslips">Payslips</TabsTrigger>
              <TabsTrigger value="requests">Requests</TabsTrigger>
            </TabsList>

            <TabsContent value="leave" className="mt-4 space-y-4">
              <Card>
                <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Leave type</Label>
                    <Select
                      value={leaveForm.leave_type_id}
                      onValueChange={(value) =>
                        setLeaveForm((form) => ({ ...form, leave_type_id: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select leave type" />
                      </SelectTrigger>
                      <SelectContent>
                        {leaveTypes.map((type) => (
                          <SelectItem key={String(type.id)} value={String(type.id)}>
                            {String(type.name)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>From</Label>
                    <Input
                      type="date"
                      value={leaveForm.start_date}
                      onChange={(event) =>
                        setLeaveForm((form) => ({ ...form, start_date: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>To</Label>
                    <Input
                      type="date"
                      value={leaveForm.end_date}
                      onChange={(event) =>
                        setLeaveForm((form) => ({ ...form, end_date: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Days requested</Label>
                    <Input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={leaveForm.days_requested}
                      onChange={(event) =>
                        setLeaveForm((form) => ({ ...form, days_requested: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Reason</Label>
                    <Input
                      maxLength={1000}
                      value={leaveForm.reason}
                      onChange={(event) =>
                        setLeaveForm((form) => ({ ...form, reason: event.target.value }))
                      }
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      disabled={submittingLeave || !leaveForm.reason.trim()}
                      onClick={() => void submitLeaveRequest()}
                    >
                      {submittingLeave ? "Submitting..." : "Submit leave request"}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {leaveBalances.length ? (
                      leaveBalances.map((balance) => (
                        <div key={String(balance.leave_type_id)} className="rounded-md border border-border p-3">
                          <div className="text-xs text-muted-foreground">
                            {String(balance.leave_type_name || "Leave")}
                          </div>
                          <div className="mt-1 text-xl font-semibold">
                            {Number(balance.available_days || 0).toFixed(1)} days
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            Current {Number(balance.current_balance || 0).toFixed(1)} · accrued {Number(balance.projected_accrual_days || 0).toFixed(1)}
                          </div>
                          {Boolean(balance.encashment_allowed) && Number(balance.available_days || 0) > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2"
                              disabled={encashing === String(balance.leave_type_id)}
                              onClick={() =>
                                void handleEncashLeave(
                                  String(balance.leave_type_id),
                                  Math.min(Number(balance.available_days || 0), 1),
                                )
                              }
                            >
                              {encashing === String(balance.leave_type_id) ? "Processing..." : "Encash 1 day"}
                            </Button>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">
                        Leave balances are not configured yet for this employee.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="p-3">Request</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">From</th>
                          <th className="p-3">To</th>
                          <th className="p-3 text-right">Days</th>
                          <th className="p-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaveApplications.map((application) => (
                          <tr key={String(application.id)} className="border-b last:border-0">
                            <td className="p-3 font-mono text-xs">
                              {String(application.application_no)}
                            </td>
                            <td className="p-3">{String(application.leave_type_name)}</td>
                            <td className="p-3">
                              {fmtDate(String(application.start_date).slice(0, 10))}
                            </td>
                            <td className="p-3">
                              {fmtDate(String(application.end_date).slice(0, 10))}
                            </td>
                            <td className="p-3 text-right">{Number(application.days_requested)}</td>
                            <td className="p-3">
                              <StatusBadge status={String(application.status)} />
                            </td>
                          </tr>
                        ))}
                        {leaveApplications.length === 0 && (
                          <tr>
                            <td className="p-8 text-center text-muted-foreground" colSpan={6}>
                              No leave requests yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="requests" className="mt-4 space-y-4">
              <Card>
                <CardContent className="space-y-4 p-4">
                  <h2 className="font-semibold">Submit a claim</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-1.5"><Label>Claim date</Label><Input type="date" value={claimForm.claim_date} onChange={(event) => setClaimForm({ ...claimForm, claim_date: event.target.value })} /></div>
                    <div className="space-y-1.5"><Label>Category</Label><Input value={claimForm.category} onChange={(event) => setClaimForm({ ...claimForm, category: event.target.value })} required /></div>
                    <div className="space-y-1.5"><Label>Description</Label><Input maxLength={1000} value={claimForm.description} onChange={(event) => setClaimForm({ ...claimForm, description: event.target.value })} required /></div>
                    <div className="space-y-1.5"><Label>Amount</Label><Input type="number" min="0.01" step="0.01" value={claimForm.total_amount} onChange={(event) => setClaimForm({ ...claimForm, total_amount: event.target.value })} required /></div>
                    <div className="space-y-1.5"><Label>Currency</Label><Input minLength={3} maxLength={3} value={claimForm.currency_code} onChange={(event) => setClaimForm({ ...claimForm, currency_code: event.target.value.toUpperCase() })} required /></div>
                    <div className="flex items-end"><Button disabled={submittingClaim || !claimForm.description.trim() || !claimForm.total_amount} onClick={() => void submitSelfClaim()}>{submittingClaim ? "Submitting..." : "Submit claim"}</Button></div>
                  </div>
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Date</th><th className="p-2">Description</th><th className="p-2">Amount</th><th className="p-2">Status</th><th className="p-2">Payment reference</th></tr></thead><tbody>{selfClaims.length ? selfClaims.map((claim) => <tr key={String(claim.id)} className="border-b"><td className="p-2">{String(claim.claim_date || "").slice(0, 10)}</td><td className="p-2">{String(claim.description || "")}</td><td className="p-2">{String(claim.currency_code || "KES")} {String(claim.total_amount || "0")}</td><td className="p-2"><StatusBadge status={String(claim.status || "submitted")} /></td><td className="p-2">{String(claim.payment_reference || "—")}</td></tr>) : <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No claims submitted.</td></tr>}</tbody></table></div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-4 p-4">
                  <h2 className="font-semibold">Request a profile change</h2>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5"><Label>Field</Label><Select value={profileChangeForm.field_name} onValueChange={(field_name) => setProfileChangeForm({ ...profileChangeForm, field_name })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="phone">Phone</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="department">Department</SelectItem><SelectItem value="job_title">Job title</SelectItem></SelectContent></Select></div>
                    <div className="space-y-1.5"><Label>Requested value</Label><Input value={profileChangeForm.new_value} onChange={(event) => setProfileChangeForm({ ...profileChangeForm, new_value: event.target.value })} required /></div>
                    <div className="flex items-end"><Button disabled={submittingProfileChange || !profileChangeForm.new_value.trim()} onClick={() => void submitSelfProfileChange()}>{submittingProfileChange ? "Submitting..." : "Submit change"}</Button></div>
                  </div>
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Field</th><th className="p-2">Current value</th><th className="p-2">Requested value</th><th className="p-2">Status</th><th className="p-2">Decision note</th></tr></thead><tbody>{selfProfileChanges.length ? selfProfileChanges.map((request) => <tr key={String(request.id)} className="border-b"><td className="p-2">{String(request.field_name || "")}</td><td className="p-2">{String(request.old_value ?? "—")}</td><td className="p-2">{String(request.new_value ?? "—")}</td><td className="p-2"><StatusBadge status={String(request.status || "pending")} /></td><td className="p-2">{String(request.decision_note || "—")}</td></tr>) : <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No profile change requests.</td></tr>}</tbody></table></div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="attendance" className="mt-4">
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="p-3">Date</th>
                          <th className="p-3">Check in</th>
                          <th className="p-3">Check out</th>
                          <th className="p-3 text-right">Hours</th>
                          <th className="p-3">Status</th>
                          <th className="p-3">Approval</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendance.map((record) => (
                          <tr key={String(record.id)} className="border-b last:border-0">
                            <td className="p-3">
                              {fmtDate(String(record.attendance_date).slice(0, 10))}
                            </td>
                            <td className="p-3">{String(record.check_in || "—")}</td>
                            <td className="p-3">{String(record.check_out || "—")}</td>
                            <td className="p-3 text-right">
                              {Number(record.hours_worked || 0).toFixed(2)}
                            </td>
                            <td className="p-3">
                              <StatusBadge status={String(record.status)} />
                            </td>
                            <td className="p-3">
                              <StatusBadge status={String(record.approval_status || "approved")} />
                            </td>
                          </tr>
                        ))}
                        {attendance.length === 0 && (
                          <tr>
                            <td className="p-8 text-center text-muted-foreground" colSpan={6}>
                              No attendance entries found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payslips" className="mt-4">
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="p-3">Payroll period</th>
                          <th className="p-3">Run</th>
                          <th className="p-3 text-right">Gross</th>
                          <th className="p-3 text-right">Net</th>
                          <th className="p-3">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payslips.map((slip) => (
                          <tr key={String(slip.id)} className="border-b last:border-0">
                            <td className="p-3">
                              {fmtDate(String(slip.payroll_month).slice(0, 10))}
                            </td>
                            <td className="p-3 font-mono text-xs">{String(slip.run_no)}</td>
                            <td className="p-3 text-right">{KES(Number(slip.gross_pay || 0))}</td>
                            <td className="p-3 text-right">{KES(Number(slip.net_pay || 0))}</td>
                            <td className="p-3">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedPayslip(slip)}
                              >
                                View payslip
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {payslips.length === 0 && (
                          <tr>
                            <td className="p-8 text-center text-muted-foreground" colSpan={5}>
                              No released payslips are available.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <Dialog
            open={Boolean(selectedPayslip)}
            onOpenChange={(open) => {
              if (!open) setSelectedPayslip(null);
            }}
          >
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Payroll statement</DialogTitle>
                <DialogDescription>
                  {String(selectedPayslip?.run_no || "")} ·{" "}
                  {selectedPayslip?.payroll_month
                    ? fmtDate(String(selectedPayslip.payroll_month).slice(0, 10))
                    : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>Gross pay</div>
                <div className="text-right">{KES(Number(selectedPayslip?.gross_pay || 0))}</div>
                <div>PAYE</div>
                <div className="text-right">{KES(Number(selectedPayslip?.paye || 0))}</div>
                <div>SHIF</div>
                <div className="text-right">{KES(Number(selectedPayslip?.shif || 0))}</div>
                <div>NSSF</div>
                <div className="text-right">{KES(Number(selectedPayslip?.nssf || 0))}</div>
                <div>Housing levy</div>
                <div className="text-right">{KES(Number(selectedPayslip?.housing_levy || 0))}</div>
                <div className="font-semibold">Net pay</div>
                <div className="text-right font-semibold">
                  {KES(Number(selectedPayslip?.net_pay || 0))}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedPayslip(null)}>
                  Close
                </Button>
                <Button onClick={() => window.print()}>Print</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
