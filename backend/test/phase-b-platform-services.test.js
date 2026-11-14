const test = require("node:test");
const assert = require("node:assert/strict");
const { createApprovalRequest, canApproveRequest, applyApprovalAction, listApprovalRequests, getApprovalRequest, applyApprovalActionById } = require("../src/services/approvalWorkflowService");
const { createDocumentAttachment, listDocumentAttachments, getDocumentAttachment } = require("../src/services/documentAttachmentService");
const { createOrgNode, listOrgHierarchy, buildOrgTree, validateHierarchy } = require("../src/services/orgHierarchyService");
const { createBranchDimension, summarizeBranchBalances, consolidateBranchBalances, createBranchJournalEntry } = require("../src/services/branchDimensionService");
const { createReminder, listReminders, getDueReminders } = require("../src/services/notificationReminderService");
const { importOpeningBalance, validateOpeningBalanceRows } = require("../src/services/openingBalanceImportService");
const { applyRlsScope, canAccessRecord } = require("../src/services/rowLevelSecurityService");
const { renderDocumentPdf, buildQrPayload } = require("../src/services/documentEngine");

test("approval workflow selects threshold-based approval route and blocks the requester from approving", () => {
  const request = createApprovalRequest({
    documentType: "sales.discount",
    documentId: "SO-1001",
    requestedBy: "user-1",
    amount: 15000,
    workflowDefinition: {
      name: "Sales discount approval",
      documentType: "sales.discount",
      allowedActions: ["approve", "reject", "return", "delegate"],
      steps: [
        { order: 1, approver: { type: "role", value: "sales.manager" }, minAmount: 0, maxAmount: null },
        { order: 2, approver: { type: "role", value: "finance.manager" }, minAmount: 10000, maxAmount: null },
      ],
    },
  });

  assert.equal(request.status, "pending");
  assert.equal(request.currentStep, 1);
  assert.equal(request.steps[0].approver.value, "sales.manager");
  assert.equal(canApproveRequest(request, { id: "user-1", role: "sales.manager" }), false);
  assert.equal(canApproveRequest(request, { id: "user-2", role: "sales.manager" }), true);
});

test("approval actions advance the request through the workflow and reject invalid approvers", () => {
  const request = createApprovalRequest({
    documentType: "finance.journal_post",
    documentId: "JRNL-99",
    requestedBy: "u-operator",
    amount: 5000000,
    workflowDefinition: {
      name: "Journal posting approval",
      documentType: "finance.journal_post",
      allowedActions: ["approve", "reject", "return", "delegate"],
      steps: [
        { order: 1, approver: { type: "role", value: "accountant" }, minAmount: 0, maxAmount: null },
        { order: 2, approver: { type: "role", value: "finance.manager" }, minAmount: 1000000, maxAmount: null },
      ],
    },
  });

  const firstReview = applyApprovalAction(request, "approve", { id: "u-accountant", role: "accountant" }, { comment: "Looks clean" });
  assert.equal(firstReview.status, "pending");
  assert.equal(firstReview.currentStep, 2);

  assert.throws(() => applyApprovalAction(firstReview, "approve", { id: "u-accountant", role: "accountant" }, { comment: "No second pass" }), /not eligible/i);

  const secondReview = applyApprovalAction(firstReview, "approve", { id: "u-finance", role: "finance.manager" }, { comment: "Approved" });
  assert.equal(secondReview.status, "approved");
});

test("approval requests are stored in a registry so platform APIs can review and act on them", () => {
  const request = createApprovalRequest({
    documentType: "sales.discount",
    documentId: "SO-777",
    requestedBy: "user-100",
    amount: 12000,
  });

  const allRequests = listApprovalRequests();
  assert.ok(allRequests.some((item) => item.id === request.id));

  const updated = applyApprovalActionById(request.id, "approve", { id: "user-200", role: "sales.manager" }, { comment: "Approved by workflow API" });
  assert.equal(updated.status, "pending");
  assert.equal(updated.currentStep, 2);
});

test("approval requests are company-scoped and can be filtered by company context", () => {
  const companyARequest = createApprovalRequest({
    companyId: "company-a",
    documentType: "sales.discount",
    documentId: "SO-778",
    requestedBy: "user-101",
    amount: 9000,
  });
  createApprovalRequest({
    companyId: "company-b",
    documentType: "sales.discount",
    documentId: "SO-779",
    requestedBy: "user-102",
    amount: 11000,
  });

  const companyARequests = listApprovalRequests({ companyId: "company-a" });
  assert.ok(companyARequests.some((item) => item.id === companyARequest.id));
  assert.ok(companyARequests.every((item) => item.companyId === "company-a"));
  assert.equal(getApprovalRequest(companyARequest.id, { companyId: "company-a" }).companyId, "company-a");
  assert.equal(getApprovalRequest(companyARequest.id, { companyId: "company-b" }), null);
});

test("document attachments are scoped to the company and document, with file metadata and content checks", () => {
  const attachment = createDocumentAttachment({
    companyId: "company-1",
    documentType: "invoice",
    documentId: "INV-206",
    fileName: "invoice.pdf",
    contentType: "application/pdf",
    byteSize: 512,
    sha256: "a".repeat(64),
    uploadedBy: "user-42",
    metadata: { source: "customer-upload", notes: "Signed PDF" },
    blob: Buffer.alloc(512, "%PDF-1.4\n"),
  });

  assert.equal(attachment.companyId, "company-1");
  assert.equal(attachment.documentType, "invoice");
  assert.equal(getDocumentAttachment({ companyId: "company-1", documentType: "invoice", documentId: "INV-206", attachmentId: attachment.id }).id, attachment.id);
  assert.equal(listDocumentAttachments({ companyId: "company-1", documentType: "invoice", documentId: "INV-206" }).length, 1);
  assert.throws(() => createDocumentAttachment({
    companyId: "company-1",
    documentType: "invoice",
    documentId: "INV-206",
    fileName: "bad.txt",
    contentType: "text/plain",
    byteSize: 32,
    sha256: "b".repeat(64),
    uploadedBy: "user-42",
    metadata: {},
    blob: Buffer.from("not-a-pdf"),
  }), /not allowed/i);
});

test("org hierarchy records can be created and validated without cycles", () => {
  const companyId = "company-org-1";
  const headOffice = createOrgNode({ companyId, name: "Head Office", type: "company" });
  const nairobi = createOrgNode({ companyId, name: "Nairobi", type: "branch", parentId: headOffice.id });
  const sales = createOrgNode({ companyId, name: "Sales", type: "department", parentId: nairobi.id });

  assert.equal(listOrgHierarchy(companyId).length, 3);
  assert.equal(buildOrgTree(companyId)[0].children[0].name, "Nairobi");
  assert.equal(validateHierarchy(companyId).valid, true);
  assert.throws(() => createOrgNode({ companyId, name: "Broken", type: "branch", parentId: "missing-parent" }), /not found/i);
  assert.equal(sales.companyId, companyId);
});

test("branch dimensions summarize local balances and reconcile to the consolidated total", () => {
  const entries = [
    createBranchJournalEntry({ companyId: "company-1", branchId: "branch-a", accountCode: "1010", debit: 15000 }),
    createBranchJournalEntry({ companyId: "company-1", branchId: "branch-a", accountCode: "2010", credit: 15000 }),
    createBranchJournalEntry({ companyId: "company-1", branchId: "branch-b", accountCode: "1010", debit: 8000 }),
    createBranchJournalEntry({ companyId: "company-1", branchId: "branch-b", accountCode: "2010", credit: 8000 }),
  ];

  const consolidated = consolidateBranchBalances(entries);
  assert.equal(consolidated.consolidated, 0);
  assert.deepEqual(summarizeBranchBalances(entries).map((balance) => ({ branchId: balance.branchId, accountCode: balance.accountCode, net: balance.net })), [
    { branchId: "branch-a", accountCode: "1010", net: 15000 },
    { branchId: "branch-a", accountCode: "2010", net: -15000 },
    { branchId: "branch-b", accountCode: "1010", net: 8000 },
    { branchId: "branch-b", accountCode: "2010", net: -8000 },
  ]);

  createBranchDimension({ companyId: "company-1", branchId: "branch-a", branchName: "Nairobi" });
  createBranchDimension({ companyId: "company-1", branchId: "branch-b", branchName: "Mombasa" });
  assert.equal(consolidated.branches.length, 2);
});

test("reminders can be scheduled and become due based on the supplied timestamp", () => {
  const reminder = createReminder({
    companyId: "company-1",
    entityType: "invoice",
    entityId: "INV-102",
    recipient: "collections@ayawin.test",
    dueAt: "2026-11-01T00:00:00Z",
    subject: "Invoice follow-up",
    message: "Follow up on payment",
  });

  assert.equal(reminder.status, "pending");
  assert.equal(getDueReminders({ companyId: "company-1", now: "2026-11-15T00:00:00Z" }).length, 1);
  assert.equal(listReminders({ companyId: "company-1" }).length >= 1, true);
});

test("opening balances are journal-balanced and reject mismatched totals", () => {
  const journal = importOpeningBalance({
    companyId: "company-1",
    rows: [
      { account_code: "1010", debit: 22000, credit: 0, branch_id: "branch-a" },
      { account_code: "2010", debit: 0, credit: 22000, branch_id: "branch-a" },
    ],
  });

  assert.equal(journal.balanced, true);
  assert.equal(journal.totalDebit, 22000);
  assert.equal(journal.totalCredit, 22000);
  assert.throws(() => validateOpeningBalanceRows([
    { account_code: "1010", debit: 1000, credit: 0 },
    { account_code: "2010", debit: 0, credit: 500 },
  ]), /must balance/i);
});

test("row-level security filters by company and branch scope and blocks unauthorized records", () => {
  const records = [
    { companyId: "company-1", branchId: "branch-a", amount: 100 },
    { companyId: "company-1", branchId: "branch-b", amount: 250 },
    { companyId: "company-2", branchId: "branch-c", amount: 999 },
  ];

  const filtered = applyRlsScope(records, { companyId: "company-1", branchId: "branch-a", allowedBranches: ["branch-a"], role: "manager" });
  assert.equal(filtered.length, 1);
  assert.equal(canAccessRecord(records[1], { companyId: "company-1", allowedBranches: ["branch-a"], role: "manager" }), false);
  assert.equal(canAccessRecord(records[0], { companyId: "company-1", branchId: "branch-a", role: "manager" }), true);
});

test("the document engine renders a real PDF payload with document metadata and a verification QR payload", async () => {
  const pdf = await renderDocumentPdf({
    company: {
      name: "Ayawin Stock Solutions",
      taxRegistrationNo: "P051000099Z",
      address: "Industrial Area, Nairobi",
      contacts: "+254 700 000 000",
    },
    documentType: "invoice",
    title: "Tax Invoice",
    number: "INV-2026-0001",
    issuedAt: "2026-11-13",
    status: "draft",
    parties: { name: "Alpha Retailers Ltd", contact: "Jane Doe" },
    lines: [
      { description: "Coca-Cola 330ml", quantity: 12, unitPrice: 95.5, amount: 1146 },
      { description: "Sprite 500ml", quantity: 6, unitPrice: 80, amount: 480 },
    ],
    totals: { subtotal: 1626, tax: 243.9, total: 1869.9 },
    notes: "Payments to be made within 14 days.",
    preparedBy: "A. Njeri",
    approvedBy: "K. Otieno",
    qrUrl: "https://erp.ayawin.test/verify/invoice/INV-2026-0001",
  });

  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 500);
  const rawPdf = pdf.toString("latin1");
  assert.match(rawPdf, /^%PDF-/i);
  assert.ok(rawPdf.includes("/Type /Catalog"));
  assert.ok(rawPdf.includes("/Producer"));
  assert.ok(rawPdf.includes("/CreationDate"));
  assert.equal(buildQrPayload({ type: "invoice", id: "INV-2026-0001", verificationUrl: "https://erp.ayawin.test/verify/invoice/INV-2026-0001" }), "https://erp.ayawin.test/verify/invoice/INV-2026-0001");
});
