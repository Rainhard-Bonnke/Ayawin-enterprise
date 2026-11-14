const approvalRequests = new Map();
const approvalRequestsByCompany = new Map();

const DEFAULT_WORKFLOWS = Object.freeze({
  "sales.discount": {
    name: "Sales discount approval",
    documentType: "sales.discount",
    allowedActions: ["approve", "reject", "return", "delegate"],
    steps: [
      { order: 1, approver: { type: "role", value: "sales.manager" }, minAmount: 0, maxAmount: null, mode: "sequential" },
      { order: 2, approver: { type: "role", value: "finance.manager" }, minAmount: 10000, maxAmount: null, mode: "sequential" },
    ],
  },
  "sales.credit_override": {
    name: "Credit override approval",
    documentType: "sales.credit_override",
    allowedActions: ["approve", "reject", "return", "delegate"],
    steps: [
      { order: 1, approver: { type: "role", value: "sales.manager" }, minAmount: 0, maxAmount: null, mode: "sequential" },
      { order: 2, approver: { type: "role", value: "finance.manager" }, minAmount: 50000, maxAmount: null, mode: "sequential" },
    ],
  },
  "procurement.po_approval": {
    name: "Purchase order approval",
    documentType: "procurement.po_approval",
    allowedActions: ["approve", "reject", "return", "delegate"],
    steps: [
      { order: 1, approver: { type: "role", value: "procurement.manager" }, minAmount: 0, maxAmount: null, mode: "sequential" },
      { order: 2, approver: { type: "role", value: "finance.manager" }, minAmount: 250000, maxAmount: null, mode: "sequential" },
    ],
  },
  "finance.journal_post": {
    name: "Journal posting approval",
    documentType: "finance.journal_post",
    allowedActions: ["approve", "reject", "return", "delegate"],
    steps: [
      { order: 1, approver: { type: "role", value: "accountant" }, minAmount: 0, maxAmount: null, mode: "sequential" },
      { order: 2, approver: { type: "role", value: "finance.manager" }, minAmount: 1000000, maxAmount: null, mode: "sequential" },
    ],
  },
  "payroll.run_approval": {
    name: "Payroll run approval",
    documentType: "payroll.run_approval",
    allowedActions: ["approve", "reject", "return", "delegate"],
    steps: [
      { order: 1, approver: { type: "role", value: "hr.manager" }, minAmount: 0, maxAmount: null, mode: "sequential" },
      { order: 2, approver: { type: "role", value: "finance.manager" }, minAmount: 500000, maxAmount: null, mode: "sequential" },
    ],
  },
  "fleet.route_closure": {
    name: "Route closure approval",
    documentType: "fleet.route_closure",
    allowedActions: ["approve", "reject", "return", "delegate"],
    steps: [
      { order: 1, approver: { type: "role", value: "fleet.manager" }, minAmount: 0, maxAmount: null, mode: "sequential" },
    ],
  },
});

function inferWorkflow(documentType) {
  return DEFAULT_WORKFLOWS[documentType] || null;
}

function resolveWorkflowSteps(workflow, amount = 0) {
  if (!workflow || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    return [];
  }

  return [...workflow.steps]
    .filter((step) => {
      const lowerBound = Number(step.minAmount ?? 0);
      const upperBound = step.maxAmount == null ? Number.POSITIVE_INFINITY : Number(step.maxAmount);
      return Number(amount) >= lowerBound && Number(amount) <= upperBound;
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function createApprovalRequest({ companyId = null, documentType, documentId, requestedBy, amount = 0, workflowDefinition = null, requestId = null }) {
  const workflow = workflowDefinition || inferWorkflow(documentType);
  if (!workflow) {
    throw new Error(`No approval workflow is configured for ${documentType}`);
  }

  const steps = resolveWorkflowSteps(workflow, amount);
  if (steps.length === 0) {
    throw new Error(`No approval route is configured for ${documentType} at amount ${amount}`);
  }

  const id = String(requestId || `approval_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  const request = {
    id,
    companyId: companyId == null ? null : String(companyId),
    documentType: workflow.documentType,
    documentId,
    requestedBy,
    amount,
    workflowName: workflow.name,
    status: "pending",
    currentStep: steps[0].order,
    steps: steps.map((step) => ({ ...step, status: step.order === steps[0].order ? "pending" : "queued" })),
    actions: [],
    requestedAt: new Date().toISOString(),
  };

  approvalRequests.set(id, request);
  if (request.companyId) {
    const byCompany = approvalRequestsByCompany.get(request.companyId) || new Set();
    byCompany.add(id);
    approvalRequestsByCompany.set(request.companyId, byCompany);
  }
  return request;
}

function listApprovalRequests({ companyId = null } = {}) {
  const requests = companyId == null
    ? Array.from(approvalRequests.values())
    : Array.from(approvalRequestsByCompany.get(String(companyId)) || []).map((id) => approvalRequests.get(id)).filter(Boolean);

  return requests.map((request) => ({ ...request, steps: request.steps.map((step) => ({ ...step })) }));
}

function getApprovalRequest(id, { companyId = null } = {}) {
  const request = approvalRequests.get(id);
  if (!request) return null;
  if (companyId != null && request.companyId !== String(companyId)) return null;
  return { ...request, steps: request.steps.map((step) => ({ ...step })) };
}

function canApproveRequest(request, actor) {
  if (!request || !actor) return false;
  if (request.requestedBy === actor.id) return false;

  const current = request.steps.find((step) => step.order === request.currentStep);
  if (!current) return false;

  if (current.approver?.type === "user" && current.approver.value === actor.id) return true;
  if (current.approver?.type === "role" && actor.role === current.approver.value) return true;
  if (current.approver?.type === "position" && actor.position === current.approver.value) return true;
  if (current.approver?.type === "user" && actor.email === current.approver.value) return true;

  return false;
}

function applyApprovalActionById(id, action, actor, options = {}) {
  const request = approvalRequests.get(id);
  if (!request) {
    throw new Error(`Approval request ${id} was not found`);
  }

  if (options?.companyId != null && request.companyId !== String(options.companyId)) {
    throw new Error(`Approval request ${id} was not found`);
  }

  const updated = applyApprovalAction(request, action, actor, options);
  approvalRequests.set(id, updated);
  return updated;
}

function applyApprovalAction(request, action, actor, { comment = "" } = {}) {
  const normalized = String(action || "").toLowerCase();
  if (!request || !actor) {
    throw new Error("A request and actor are required");
  }

  if (!request.steps || request.steps.length === 0) {
    throw new Error("The request has no configured approval steps");
  }

  if (!canApproveRequest(request, actor)) {
    throw new Error("This actor is not eligible to act on the current approval step");
  }

  const current = request.steps.find((step) => step.order === request.currentStep);
  const actionRecord = {
    actorId: actor.id,
    actorRole: actor.role,
    action: normalized,
    comment: String(comment || "").trim(),
    timestamp: new Date().toISOString(),
  };

  request.actions.push(actionRecord);

  if (normalized === "approve") {
    const nextStep = request.steps.find((step) => step.order === current.order + 1);
    if (nextStep) {
      current.status = "approved";
      request.currentStep = nextStep.order;
      nextStep.status = "pending";
      request.status = "pending";
      return { ...request, status: "pending", currentStep: nextStep.order };
    }

    current.status = "approved";
    request.status = "approved";
    request.currentStep = current.order;
    return { ...request, status: "approved", currentStep: current.order };
  }

  if (normalized === "reject") {
    request.status = "rejected";
    current.status = "rejected";
    return { ...request, status: "rejected", currentStep: current.order };
  }

  if (normalized === "return") {
    request.status = "returned_for_changes";
    current.status = "returned";
    return { ...request, status: "returned_for_changes", currentStep: current.order };
  }

  if (normalized === "delegate") {
    request.status = "delegated";
    current.status = "delegated";
    return { ...request, status: "delegated", currentStep: current.order };
  }

  throw new Error(`Unsupported approval action: ${action}`);
}

module.exports = {
  DEFAULT_WORKFLOWS,
  approvalRequests,
  createApprovalRequest,
  listApprovalRequests,
  getApprovalRequest,
  canApproveRequest,
  applyApprovalAction,
  applyApprovalActionById,
  inferWorkflow,
  resolveWorkflowSteps,
};
