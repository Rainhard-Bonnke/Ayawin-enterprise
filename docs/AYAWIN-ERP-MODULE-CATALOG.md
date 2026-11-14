# Ayawin ERP module catalogue and document register

**Company context:** Ayawin, Kenya
**Reviewed:** 11 November 2026
**Purpose:** Product scope and document-control specification. This catalogue describes required records and outputs; inclusion here does not mean every workflow is already implemented. See [Kenya ERP readiness](../backend/docs/KENYA-ERP-MODULE-READINESS.md) and [module review](../backend/docs/MODULE-BY-MODULE-REVIEW.md) for the code-level status and known gaps.

## Document and posting rules

- Give each business document a unique, company/branch-scoped number, owner, creation time, status, source link and audit history. Preserve the issued number when a document is voided; never reuse it.
- Drafts may be edited by authorized users. Approval and posting record actor and time. Posted documents are immutable; correct them with linked reversal, return, credit note or debit note documents.
- Retain the evidence that supports a transaction: original supplier/customer documents, approvals, delivery/receipt proof and relevant tax references. Store attachments privately, enforce role and company access, and record access where sensitive.
- PDFs and print views should show Ayawin legal details, document number/date, parties, branch, line descriptions, quantities, unit prices, tax treatment, totals in figures and currency, status, and linked source documents as relevant. Use KES as the default display currency; preserve transaction currency and exchange-rate snapshot where different.
- These are operational document requirements, not a claim of KRA certification or legal sufficiency. Confirm current tax, payroll, retention and statutory forms with Ayawin's accountant and advisers before production use.

## Sales and customer management

| Submodule | Core records and workflow | Required documents / outputs | Key controls |
|---|---|---|---|
| Point of sale (POS) | Till session, operator, items, tender, receipt | Till opening/closing sheet; numbered sales receipt; tender and cash-up summary; refund/void slip | No receipt without a committed sale; permissioned void/refund; reconcile cash, card and M-Pesa separately |
| Customer relationship management (CRM) | Lead, opportunity, activity, contact, territory | Lead/opportunity record; call/visit note; quotation; activity and pipeline report | Consent and contact-purpose controls; convert to customer/order with traceable source |
| Sales orders | Customer order, lines, pricing, credit check, reservation, approval | Customer PO/order evidence; Ayawin sales order/confirmation; pick list; backorder/cancellation record | Check customer status, price, credit and available-to-promise; reserve/release stock explicitly |
| Invoicing | Delivery/order-linked invoice and tax snapshot | Sequential tax invoice; invoice PDF; eTIMS submission/acceptance evidence when connected; credit note for correction | Prevent duplicate invoices; snapshot tax/rates; distinguish draft from posted; retain KRA response and retry history |
| Delivery management | Dispatch, route, driver/vehicle, delivered quantities | Pick/dispatch note; delivery note; proof of delivery with confirmed timestamp and private photo/signed-document attachments; shortage/damage report | Dispatch reduces stock once; record recipient and discrepancies; link delivery to order and invoice; structured e-signature and GPS evidence are future capabilities |
| Sales returns | Return request against posted sale, inspection, disposition | Customer return authorization; goods-return/inspection note; linked credit note; refund voucher or exchange note | Cap return quantity at delivered/invoiced remainder; separate resellable from damaged/quarantined stock; maker-checker posting |
| Receivables | Open invoices, follow-ups, receipts and allocations | Customer statement; receipt voucher; allocation advice; collection call/promise/dispute log; aged AR report | Allocate receipts to invoices; reconcile receipt to cash/bank and GL; approval and audit for write-offs/refunds |
| Pricing and discounts | Price list, effective date, customer tier, discount approval | Price list/change request; approved exception/discount record; customer quotation | Effective dates, margin floors and approval thresholds; retain the price used on each posted line |
| Sales targets and receipts reporting | Target by period/branch/rep; actual sales and collections | Approved target sheet; sales/receipt register; attainment, margin and collection reports | Define gross/net sales, returns, tax and cash basis consistently; drill report totals to source documents |

## Inventory and warehouse

| Submodule | Core records and workflow | Required documents / outputs | Key controls |
|---|---|---|---|
| Inventory master | SKU, category, UOM/conversion, tax group, warehouse/bin, reorder settings | Item creation/change request; item catalogue/barcode label; UOM conversion record | Unique SKU/barcode; approved edits; prevent invalid units and inactive-item transactions |
| Stock receiving | PO receipt, counted quantity, lot, expiry, condition | Goods received note (GRN); supplier delivery note; inspection/shortage/damage report; put-away sheet | Receive against approved PO; record actual quantities and lot/expiry; do not silently accept over-receipts |
| Stock transfer | Source, destination, items/lots, dispatch and receipt | Transfer request/approval; transfer dispatch note; transfer receipt/variance report | In-transit balance; source and destination confirmation; lot identity preserved |
| Stock sheet / stocktaking | Count scope, blind count, recount and variance approval | Numbered stock count sheet; signed/recount sheet; variance investigation; approved adjustment journal | Freeze or snapshot book quantity; independent approval; post adjustment as movement, never overwrite stock |
| Expiry and lot tracking | Lot/batch, received/manufactured/expiry dates, status | Lot register; near-expiry/expired report; quarantine/recall notice; disposal certificate | FEFO picking; block expired stock; trace affected receipts, transfers and customers |
| Reorder point | Minimum, maximum, lead time, demand and suggested replenishment | Reorder exception report; purchase requisition generated from reviewed suggestion | Branch/warehouse-specific settings; suggestions do not order automatically without authorization |
| Inventory valuation | Cost layers/policy, landed cost, write-down and period snapshot | Valuation report by SKU/warehouse/lot; cost adjustment approval; inventory-to-GL reconciliation | Effective costing policy; period snapshot; investigate negative stock and subledger/GL differences |
| Returns | Customer/supplier return linkage and stock disposition | Return authorization; inspection/disposition form; return-to-vendor dispatch note; customer return receipt | Preserve original source and cost; separate sellable, damaged and quarantined quantities |
| Inventory reports | On-hand, available/reserved, movement, aging, variance, valuation | Stock card; movement ledger; availability, slow/obsolete, expiry and valuation reports | Reconcile report totals to movement ledger and GL; date/time and filter scope visible |

## Finance and accounting

| Submodule | Core records and workflow | Required documents / outputs | Key controls |
|---|---|---|---|
| General ledger and chart of accounts | Account hierarchy, journal, dimensions, source posting | Approved chart-of-accounts change; journal voucher with support; posting/reversal report | Balanced debits/credits; source and idempotency link; period and branch validation; maker-checker for manual journals |
| Automated postings | Sales, purchases, inventory, payroll, assets and cash subledger events | Posting preview/mapping; source document; generated journal and exception report | Versioned account mappings; post atomically with source; no duplicate journals; reconcile control accounts |
| Initial balances | Opening trial balance and subledger migration | Signed opening-balance pack; AR/AP open-item schedules; stock quantity/value schedule; bank confirmation | Balance to agreed cutover date; independent review; retain source workbook and import/error log |
| Financial periods | Open/close/reopen and posting-date control | Period close checklist; close approval; controlled reopen authorization and reason | Block backdating into closed period; log all close/reopen actions |
| Multi-branch accounting | Branch/dimension ownership and inter-branch activity | Branch mapping; inter-branch journal/reconciliation; branch trial balance | Enforce branch scope; balance inter-branch accounts; consolidated reports eliminate internal balances |
| Accounts receivable | Customer invoices, receipts, allocations, credit control | Invoice; receipt voucher; customer statement; aging/collection report; approved write-off | Invoice-level open balance; allocation trace; segregate receipt and write-off authority |
| Accounts payable | Supplier bills, GRN matching, credits and payments | Supplier invoice; PO/GRN match sheet; supplier credit note; payment voucher/remittance advice; aging report | Three-way match or approved variance; supplier statement reconciliation; payment approval separation |
| Cash and bank | Cashbook, bank accounts, deposits, payments, reconciliation | Petty-cash voucher; receipt/payment voucher; deposit slip; bank statement; reconciliation and outstanding-item report | Reconcile to statement and GL; dual review; secure bank details; account for fees and uncleared items |
| Budget and forecasting | Versioned budgets, assumptions, actual-versus-budget | Department/branch budget request; approved budget; forecast and variance report | Version/owner/period; approval; drill to actual source entries; label forecast assumptions |
| Fixed assets | Acquisition, capitalization, custody, depreciation, transfer/disposal | Asset request/approval; supplier invoice; capitalization form; asset register/tag; depreciation schedule; disposal approval | Capitalization policy; useful life/residual value approval; reconcile register to GL; retain disposal evidence |
| Tax management | VAT, withholding and other configured tax liabilities/credits | Tax code/rate change approval; input/output VAT schedules; tax return workpaper; payment evidence; eTIMS evidence | Effective-dated rules; invoice-level source; reviewer approval; reconcile control accounts; do not represent draft return as filed |
| Expenses management | Claim, coding, approval, reimbursement | Expense claim; itemized receipt/tax invoice; approval; reimbursement voucher | Policy limits, cost center, evidence and duplicate checks; claimant cannot approve own claim |
| Payroll accounting integration | Approved payroll run to GL/liability accounts | Payroll control summary; posting journal; statutory liability/remittance schedule; reconciliation | Aggregate sensitive detail by permission; reconcile net pay and liabilities; posted run is locked |
| Financial reporting | Trial balance, P&L, balance sheet, cash flow and notes | Period financial pack; report definitions; close/reconciliation sign-off | Accrual basis and comparative periods; drill-through; report date, currency and branch scope visible |
| Multi-currency | Transaction currency, rate snapshot, settlement and revaluation | Rate source/import log; foreign-currency invoice/payment; realized/unrealized FX schedule | Keep source and functional amounts; approve rate source; reconcile FX gains/losses |
| Audit and compliance | Immutable audit events, access, approvals and evidence | Audit log/export; approval history; access review; retention/incident evidence | Least privilege; timestamps and actor IDs; protect logs from ordinary edits; retention policy |
| Finance reports | Journals, aging, cash, tax, budget, assets and close | Standard report pack; exception and reconciliation schedules | Role-controlled exports; consistent filters; trace balances to ledgers and source documents |

## Purchasing and procurement

| Submodule | Core records and workflow | Required documents / outputs | Key controls |
|---|---|---|---|
| Supplier/vendor management | Legal identity, KRA PIN, contacts, terms, bank details | Supplier onboarding and due-diligence form; PIN/VAT evidence; bank change verification; supplier statement | Duplicate checks; verify bank changes out of band; restrict sensitive fields |
| Purchase requisition | Need, item, quantity, budget and requester | Numbered purchase requisition; budget check; approval trail | Requester, approver and receiver separation; no PO before approval |
| Request for quotation (RFQ) | Scope, invited suppliers, bid and evaluation | RFQ pack; supplier quotations; bid-opening/evaluation matrix; award memo | Equal specification/deadline; retain bids; conflict declarations and approval thresholds |
| Purchase orders | Supplier commitment, price, delivery terms and approval | Approved PO; supplier acknowledgement; amendment/cancellation record | Approved supplier and budget; controlled amendments; outstanding commitment report |
| Goods received (GRN) | Actual received quantities/lots/condition against PO | GRN; supplier delivery note; inspection/variance report | Independent count; PO/warehouse/item checks; receipt accrual posted once |
| Supplier invoicing | Bill capture, PO/GRN match, tax and due date | Supplier invoice; matching worksheet; approved variance; posted AP voucher | Duplicate invoice check; input-tax evidence/review; three-way match; period control |
| Purchase returns | Return authorization, dispatch, supplier credit/refund | Supplier return note; dispatch proof; supplier credit note/refund advice | Link to original GRN/bill; restore stock and reverse accrual/tax correctly |
| Procurement approval | Thresholds, delegation and conflicts | Approval matrix; approval/rejection record with reason; delegation evidence | Segregation of duties; no self-approval; audit threshold changes |
| Contract/tender management | Tender, evaluation, award, contract, milestones | Tender notice/pack; bids; evaluation and award; signed contract; variation and expiry notices | Versioned contract; authorized signatories; renewal/expiry alerts; retain procurement file |
| Cost and expense allocation | Freight, insurance, duty and other landed cost | Supplier charge document; allocation basis/workpaper; approved cost adjustment | Consistent allocation basis; capitalize eligible inventory cost only under approved policy; reconcile invoice to allocation |
| Procurement reports | Spend, supplier performance, commitments and exceptions | Spend analysis; open PO/GRN/bill aging; price variance; supplier performance report | Use posted/approved status consistently; drill down to requisition, PO, GRN and bill |

## Human resources and payroll

| Submodule | Core records and workflow | Required documents / outputs | Key controls |
|---|---|---|---|
| Employee management | Employee profile, job, contract, lifecycle events | Approved employee requisition; signed offer/contract; onboarding checklist; change and exit forms | PII role restrictions; effective-dated changes; no credentials or bank data in general reports |
| Recruitment and hiring | Vacancy, applicants, interviews, offer | Approved vacancy; job description; application/CV; interview scorecard; reference/offer record | Limited applicant access; consent and retention; record decision reason fairly |
| Attendance and time | Roster, clock event, absence/overtime correction | Timesheet/attendance register; correction approval; overtime authorization; exception report | Preserve raw clock event; approved corrections; reconcile to payroll period |
| Leave management | Entitlement, application, approval and balance | Leave application; approval/rejection; handover/return record; balance statement | Entitlement rules by policy; prevent conflicting dates; audit adjustments and encashment |
| Payroll management | Effective-dated pay, deductions, run, payslip | Payroll change authorization; payroll register; individual payslip; approval; bank payment file; statutory schedules/remittance receipts | Preview/reconcile before posting; restrict payslips; version tax rules; lock posted runs |
| Performance management | Goals, review, feedback, development plan | Agreed objectives; appraisal; moderation/acknowledgement; improvement plan | Employee/manager access boundaries; dated review and correction trail |
| Training and development | Skills, course, attendance, competency | Training request/approval; attendance/certificate; competency assessment; training matrix | Verify completion evidence; track mandatory renewals and costs |
| Discipline and compliance | Case, policy, notices, response, outcome | Restricted case file; notice and response; hearing minutes; decision/appeal record | Strict access; consistent process; immutable timestamps; retention/legal review |
| Employee self-service | Leave, payslips, profile updates, claims, attendance | Leave request; payslip download/access receipt; profile change request; expense/benefit claim; attendance view | Employee sees own records only; sensitive changes require HR approval; audit downloads/updates |
| Benefits and claims | Benefit enrollment, dependants, claims and reimbursements | Enrollment/change form; supporting receipt/medical evidence as policy permits; claim approval/payment | Minimum necessary health data; eligibility and limits; separate approval/payment |
| Organization structure | Company, branch, department, reporting line and position | Approved organization chart; position request/change; delegation-of-authority schedule | Effective dates; no orphan reporting lines; access/approval roles follow approved hierarchy |
| HR reports | Headcount, movement, leave, attendance, payroll summaries | Workforce dashboard; statutory payroll summary; leave liability/absence/training reports | Aggregate by default; suppress small-group PII; scope by role and branch |

## Shared document lifecycle and required metadata

Every document should provide, as applicable: document type and number; company and branch; business date and posting date; creator and approver; counterparty; currency; line-level quantity/UOM/price/tax; subtotal, tax and total; status; attachments; source and reversal links; created/updated/posted timestamps; audit events; and printable/exportable output. Payroll, employee relations, bank and identity evidence require stricter access than ordinary commercial documents.

The shared lifecycle is **Draft → Submitted → Approved/Rejected → Posted/Issued → Settled/Closed**, with explicit **Cancelled, Reversed, Partially fulfilled** or **Disputed** states where relevant. Not every document uses every state. Status transitions must be permission checked and audited on the server.

## Existing implementation entry points

Current user-facing routes include sales/POS, customers, invoices, delivery, procurement, suppliers, GRN, inventory/stock movements/transfers/lots/count adjustments, accounting, AR/AP, bank reconciliation, assets/depreciation, HR/leave-attendance/payroll, reports, master data and audit logs. These entry points are not a completeness guarantee. Review the linked readiness documents for implemented workflows, known gaps and production prerequisites before treating a document type or process as live.
