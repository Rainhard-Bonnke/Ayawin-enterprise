# Martin Enterprise ERP — Production Readiness Audit

**Audit Date:** June 2, 2026  
**System:** Martin Enterprise Suite (Node.js/Express + React/TanStack)  
**Target:** Live deployment for Kenyan beverage distribution company  
**Audit Philosophy:** Assume nothing works until proven. Test happy paths AND all failure paths.

---

## PHASE 1: MODULE COMPLETENESS AUDIT

### 1.1 Authentication Module

**CRUD Verification**
- [ ] **Login Flow**
  - [ ] Test: Login with correct credentials → Success
  - [ ] Test: Login with wrong password → Graceful error (no stack trace)
  - [ ] Test: Account lock after 5 failed attempts (if implemented)
  - [ ] Verify: Lock duration and unlock mechanism
- [ ] **Password Reset**
  - [ ] Test: Request password reset → Email sent
  - [ ] Test: Link in email is valid
  - [ ] Test: Link expires after 24 hours
  - [ ] Test: New password accepted after reset
  - [ ] Test: Old password no longer works
- [ ] **JWT Token Management**
  - [ ] Test: Token expires correctly (check expiry time)
  - [ ] Test: Expired token rejected by API
  - [ ] Test: Token refreshed correctly (if applicable)
  - [ ] Test: Logout invalidates token immediately
- [ ] **Role Permissions**
  - [ ] Test: Sales rep cannot access payroll
  - [ ] Test: Accountant cannot access HR
  - [ ] Test: API endpoints enforce permissions (not just UI hiding)
  - [ ] Verify: Every role's permission matrix

**Form Validation**
- [ ] Required fields enforced (email, password)
- [ ] Email format validated (RFC 5322)
- [ ] Password strength enforced (min 8 chars, mix of upper/lower/number/special)
- [ ] Session management tested across tabs/windows

---

### 1.2 Dashboard Module

**CRUD Verification**
- [ ] **KPI Cards**
  - [ ] Total Sales (YTD) → Real data, not hardcoded
  - [ ] Outstanding AR → Matches sum of unpaid invoices
  - [ ] Inventory Value → Matches valuation report
  - [ ] Cash Position → Matches bank balance
  - [ ] Each card refreshes without full page reload
- [ ] **Charts**
  - [ ] Revenue trend → Data loads correctly
  - [ ] Top products → Accurate ranking
  - [ ] Customer aging → Correct bucket calculations
  - [ ] Stock turnover → Real inventory movements

**Form Validation**
- [ ] Date range picker allows valid ranges only
- [ ] Start date cannot be after end date

**Data Integrity**
- [ ] KPI totals match source tables exactly (zero discrepancy)
- [ ] All metrics recalculate when underlying data changes
- [ ] No hardcoded test data visible

---

### 1.3 Sales Module

**CRUD Verification**

**CREATE (New Order)**
- [ ] Customer dropdown loads all active customers
- [ ] Product search works by:
  - [ ] Product name
  - [ ] SKU
  - [ ] Barcode (if applicable)
- [ ] Quantity field:
  - [ ] Allows integer entry
  - [ ] Prevents negative quantities
  - [ ] Prevents overselling (checks ATP)
- [ ] Price:
  - [ ] Correct list price displays
  - [ ] Discount field enforces maximum per role
  - [ ] Price tier auto-applies based on customer type
- [ ] Order total:
  - [ ] Calculates correctly with VAT (16%)
  - [ ] Includes excise duty per product category
  - [ ] All line items sum correctly
- [ ] Form validation:
  - [ ] Cannot save with empty required fields
  - [ ] Order number auto-generates (unique, never reused)
  - [ ] Audit log entry created on save

**READ (Order List)**
- [ ] List loads with pagination (default 20 rows)
- [ ] Search works by:
  - [ ] Order number
  - [ ] Customer name
- [ ] Filter by:
  - [ ] Status (Draft/Confirmed/Dispatched/Delivered/Invoiced)
  - [ ] Date range
  - [ ] Sales rep
- [ ] Sort by:
  - [ ] Order date
  - [ ] Customer
  - [ ] Total amount
  - [ ] Status
- [ ] Detail view pre-fills correctly when opened

**UPDATE (Edit Order)**
- [ ] Can only edit orders in Draft status (if applicable)
- [ ] Changes are saved as deltas (audit trail)
- [ ] Order total recalculates on line edit
- [ ] Audit log records all changes

**DELETE (Cancel Order)**
- [ ] Soft delete only (record archived, not hard deleted)
- [ ] Cancellation creates stock reversal entry
- [ ] Credit note issued if payment received
- [ ] Audit log records cancellation reason

**Workflow Transitions**
- [ ] Draft → Confirmed (with authorization check)
- [ ] Confirmed → Dispatched (with delivery confirmation)
- [ ] Dispatched → Delivered (with proof of delivery)
- [ ] Delivered → Invoiced (automatic or manual)
- [ ] Cannot skip workflow steps

**Special Operations**
- [ ] **Quotation to Order Conversion**
  - [ ] Convert quotation without data loss
  - [ ] Order inherits all quotation details
  - [ ] New order number assigned
- [ ] **Return Order**
  - [ ] Creates credit note
  - [ ] Reverses stock
  - [ ] Updates AR balance
- [ ] **Bulk Operations**
  - [ ] Bulk export to Excel
  - [ ] Bulk status update (if applicable)

---

### 1.4 Invoicing Module

**CRUD Verification**

**CREATE (Invoice)**
- [ ] Auto-generates from confirmed sales order
- [ ] Invoice number:
  - [ ] Sequential
  - [ ] Unique
  - [ ] Never reused
  - [ ] Format: INV-YYYY-NNNNNN or similar
- [ ] Line items copied from sales order:
  - [ ] Quantities
  - [ ] Unit prices
  - [ ] Discounts
- [ ] VAT calculation:
  - [ ] 16% on each line item (verify amounts)
  - [ ] Total VAT = sum of line VATs
- [ ] Excise duty calculation:
  - [ ] Beer category → Correct rate
  - [ ] Spirits category → Correct rate
  - [ ] Wine category → Correct rate
  - [ ] Soft drinks → Rate (if applicable)
  - [ ] Total excise = sum of all duties
- [ ] Payment terms:
  - [ ] Due date calculated correctly
  - [ ] Default payment terms applied
  - [ ] Terms enforced (e.g., COD, 30 days, 60 days)
- [ ] Journal entries:
  - [ ] Debit AR account
  - [ ] Credit Sales Revenue account
  - [ ] Entries balanced (debits = credits)

**READ (Invoice List)**
- [ ] List loads with pagination
- [ ] Search by:
  - [ ] Invoice number
  - [ ] Customer name
  - [ ] Date range
- [ ] Filter by:
  - [ ] Status (Draft/Confirmed/Paid/Partial/Cancelled)
  - [ ] Payment status (Unpaid/Partial/Paid)
  - [ ] Date range

**UPDATE (Amend Invoice)**
- [ ] Only draft invoices can be amended
- [ ] Changes recalculate totals
- [ ] Audit log records amendments

**DELETE (Cancel Invoice)**
- [ ] Soft delete only
- [ ] Creates reversal journal entry
- [ ] AR balance restored
- [ ] Stock reversal if returned

**Payment Recording**
- [ ] Payment amount field validates ≤ outstanding balance
- [ ] Partial payments supported
- [ ] Payment method recorded (cash, check, M-Pesa, bank transfer)
- [ ] Payment date recorded
- [ ] Journal entry posts (debit Bank, credit AR)
- [ ] Outstanding balance recalculates in real-time

**PDF Generation**
- [ ] PDF renders without errors
- [ ] Includes:
  - [ ] Company logo
  - [ ] Company name, address, phone
  - [ ] Company KRA PIN
  - [ ] Customer name and address
  - [ ] Invoice number and date
  - [ ] Due date
  - [ ] All line items (description, qty, unit price, amount)
  - [ ] VAT line with amount
  - [ ] Excise duty line with amount
  - [ ] Invoice total
  - [ ] Payment terms
  - [ ] Bank account for payment
- [ ] Formatting:
  - [ ] No truncated text
  - [ ] Proper margins for printing
  - [ ] Professional layout

**Email Delivery**
- [ ] Email sends successfully
- [ ] PDF attaches to email
- [ ] Customer email address correct
- [ ] Email content includes invoice details

**Proforma Invoice**
- [ ] Proforma invoices do NOT post to ledger
- [ ] Clearly marked as "PROFORMA"
- [ ] Can convert to final invoice

**Credit Notes**
- [ ] Auto-generate on return orders
- [ ] Credit note number sequential and unique
- [ ] Reduces AR balance by credit amount
- [ ] Posts reversal journal entry (debit Sales, credit AR)

**Overdue Invoice Logic**
- [ ] Fires at 00:01 on due date
- [ ] Marks invoice as overdue in system
- [ ] Flag visible on dashboard
- [ ] Notification sent (email or in-app alert)

---

### 1.5 Inventory Module

**CRUD Verification**

**Stock Level Management**
- [ ] Stock levels update in real-time:
  - [ ] After sales order confirmation
  - [ ] After purchase order GRN receipt
  - [ ] After inventory adjustments
- [ ] Negative stock impossible:
  - [ ] Blocked at order confirmation
  - [ ] Error message shown: "Insufficient stock for [Product]"
- [ ] Recount stock queries:
  - [ ] SUM(receipt_qty - issue_qty) = current stock level

**Batch/Lot Tracking**
- [ ] Lot numbers captured at receipt
- [ ] Lot assigned to issues (FIFO or FEFO)
- [ ] Lot traceability end-to-end
- [ ] Expiry dates captured and enforced
- [ ] FEFO (First Expiry First Out) picking logic

**Stock Adjustments**
- [ ] Adjustment form requires:
  - [ ] Product
  - [ ] Adjustment quantity (+ or -)
  - [ ] Reason code (Damage, Theft, Inventory Count, etc.)
  - [ ] Approver sign-off
- [ ] Stock updated on approval
- [ ] Audit log records:
  - [ ] Who created
  - [ ] When created
  - [ ] Reason
  - [ ] Who approved
  - [ ] When approved
- [ ] Variance analysis captured

**Inter-Warehouse Transfer**
- [ ] Transfer order links source and destination warehouses
- [ ] On creation: source stock reduced, destination increased atomically
- [ ] Status flow: Draft → Confirmed → In Transit → Received
- [ ] Transfer in transit shows on both warehouses
- [ ] Proof of receipt required before status change

**Barcode Management**
- [ ] Barcode lookup returns correct product
- [ ] Test cases:
  - [ ] Valid barcode → Product found
  - [ ] Invalid barcode → "Not found" error
  - [ ] Duplicate barcode → Prevented at master data entry

**Stock Valuation**
- [ ] Valuation method: Weighted Average Cost (WAC)
- [ ] Valuation = SUM(quantity × WAC) per product
- [ ] Report matches balance sheet inventory value
- [ ] Revaluation on GRN:
  - [ ] WAC updates correctly
  - [ ] Inventory gain/loss journal posted (if using moving average)

**Minimum Stock Alerts**
- [ ] Threshold set per product
- [ ] Alert fires when:
  - [ ] Current stock ≤ minimum threshold
  - [ ] Alert visible on inventory dashboard
  - [ ] Can link to create purchase requisition

**Stock Movement Report**
- [ ] Completeness check:
  - [ ] Opening stock = closing stock last period
  - [ ] Opening + Receipts - Issues = Closing stock
  - [ ] Any variance explained by adjustments

---

### 1.6 Procurement Module

**CRUD Verification**

**PO Creation**
- [ ] Supplier dropdown loads active suppliers only
- [ ] Product/item selection:
  - [ ] Can add multiple line items
  - [ ] Unit of measure correct per product
  - [ ] Quantity field enforces positive integers
- [ ] Pricing:
  - [ ] Unit cost applied (from supplier master or entered)
  - [ ] Line total calculates correctly
  - [ ] PO total accurate
- [ ] Terms:
  - [ ] Delivery date required
  - [ ] Payment terms (COD, 30 days, etc.)
- [ ] Approval workflow:
  - [ ] PO created in Draft status
  - [ ] Submit for approval (triggers workflow)
  - [ ] Approver notified
  - [ ] Approval field shows approver name and date

**Authorization Limits**
- [ ] PO ≤ KES 50,000 → Warehouse Manager approves
- [ ] PO KES 50,001 - KES 100,000 → Procurement Manager approves
- [ ] PO > KES 100,000 → MD approves
- [ ] Verify: Only authorized users can approve

**PO Amendments**
- [ ] Cannot edit approved PO without re-approval
- [ ] Amendment creates audit trail
- [ ] Supplier notification on material amendments

**GRN (Goods Receipt Note)**
- [ ] Links to correct PO
- [ ] Allows partial receipt:
  - [ ] Remaining balance shown
  - [ ] PO stays open until fully received
- [ ] Receipt updates stock:
  - [ ] Product quantity increased
  - [ ] Batch/lot numbers captured
  - [ ] Expiry dates captured
- [ ] GRN number sequential and unique

**3-Way Match (Invoice Matching)**
- [ ] Supplier invoice matches:
  - [ ] [ ] PO quantity matches GRN quantity
  - [ ] [ ] PO unit price matches invoice unit price
  - [ ] [ ] GRN matches invoice quantity received
- [ ] System blocks payment if mismatch:
  - [ ] Quantity variance > tolerance (e.g., 2%)
  - [ ] Price variance > tolerance
- [ ] Variance resolution:
  - [ ] Documented reason
  - [ ] Approver sign-off
  - [ ] Debit/credit note issued if needed

**Supplier Invoice Posting**
- [ ] Invoice matches GRN before allowing posting
- [ ] Journal entry:
  - [ ] Debit Inventory (or Expense if direct)
  - [ ] Credit Accounts Payable
- [ ] Supplier AP balance updated
- [ ] Landed cost allocation (if applicable):
  - [ ] Freight, customs, handling allocated to products
  - [ ] Inventory value adjusted

**Payment Scheduling**
- [ ] Payment due date calculated correctly
- [ ] Partial payment supported
- [ ] Early payment discount offered (if terms allow)
- [ ] Payment journal entry:
  - [ ] Debit AP
  - [ ] Credit Bank

**Supplier Management**
- [ ] Supplier balance always accurate:
  - [ ] Outstanding invoices summed correctly
  - [ ] Payments reduce balance
  - [ ] Credit notes reduce balance

---

### 1.7 CRM / Customer Module

**CRUD Verification**

**Customer Records**
- [ ] Create:
  - [ ] Customer name required
  - [ ] KRA PIN required (format validation: 11 chars)
  - [ ] Business type (Distributor, Retail, Restaurant, etc.)
  - [ ] Primary contact (name, email, phone)
  - [ ] Business address
  - [ ] Delivery address (if different)
  - [ ] Credit limit set
  - [ ] Payment terms defined
- [ ] Edit:
  - [ ] All fields editable
  - [ ] Changes tracked in audit log
- [ ] Soft delete:
  - [ ] Customer marked inactive
  - [ ] No new orders allowed for inactive customer
  - [ ] Existing orders remain visible

**Customer Statement**
- [ ] Shows all invoices, payments, credit notes in chronological order
- [ ] Calculation:
  - [ ] Opening balance (from prior period)
  - [ ] +Invoices (debit)
  - [ ] -Payments (credit)
  - [ ] -Credit notes (credit)
  - [ ] = Closing balance
- [ ] Matches AR sub-ledger exactly

**Credit Limit Enforcement**
- [ ] At order creation:
  - [ ] Check: Current AR + New Order Total ≤ Credit Limit
  - [ ] If exceeded:
    - [ ] Block order (hard stop), or
    - [ ] Show warning and require approval
- [ ] Report on customers exceeding credit limit

**Customer Aging**
- [ ] Buckets: Current / 30 / 60 / 90 / 90+ days overdue
- [ ] Calculation based on invoice due date
- [ ] Aging report matches:
  - [ ] Sum of Current = sum of invoices not yet due
  - [ ] Sum of 30-60 = invoices 30-60 days overdue
  - [ ] Etc.
- [ ] Total aging = Total AR

**Duplicate Detection**
- [ ] Cannot create customer with:
  - [ ] Same name + same KRA PIN
- [ ] Warning if similar names exist (fuzzy match)

**Inactive Customers**
- [ ] Toggle inactive status
- [ ] New orders blocked for inactive customers
- [ ] Historical data remains accessible

---

### 1.8 Accounting / Finance Module

**CRUD Verification**

**Chart of Accounts**
- [ ] All required Kenyan standard accounts present:
  - [ ] **Assets:** Cash, AR, Inventory, Fixed Assets, etc.
  - [ ] **Liabilities:** AP, Bank Loans, Tax Payable, VAT Payable, etc.
  - [ ] **Equity:** Share Capital, Retained Earnings, etc.
  - [ ] **Revenue:** Sales, Service Revenue, etc.
  - [ ] **Expenses:** COGS, Salaries, Rent, Depreciation, etc.

**Journal Entries**
- [ ] Every financial transaction posts a balanced journal entry
- [ ] Debit total = Credit total (ALWAYS, no exceptions)
- [ ] Entry includes:
  - [ ] Date
  - [ ] Narrative
  - [ ] Account codes and amounts
  - [ ] Posting user and timestamp
  - [ ] Approval status (if required)
- [ ] Reversal entries for corrections (no deletions)
- [ ] Audit trail shows original + reversal

**Trial Balance**
- [ ] Balances to zero (difference = 0.00 KES)
- [ ] Tests integrity of all postings
- [ ] Report generated for every period

**Profit & Loss Statement**
- [ ] Period: Month, Quarter, Year
- [ ] Income section:
  - [ ] Sales Revenue (from invoices)
  - [ ] Other income
  - [ ] Total Income
- [ ] Expenses section:
  - [ ] COGS (Inventory write-off)
  - [ ] Salaries
  - [ ] Rent
  - [ ] Utilities
  - [ ] Depreciation
  - [ ] Other expenses
  - [ ] Total Expenses
- [ ] Net Income = Income - Expenses
- [ ] Matches dashboard YTD sales exactly

**Balance Sheet**
- [ ] As of specific date
- [ ] Assets = Liabilities + Equity (ALWAYS)
- [ ] Current Assets:
  - [ ] Cash
  - [ ] AR (matches total outstanding invoices)
  - [ ] Inventory (matches valuation report)
- [ ] Fixed Assets
- [ ] Current Liabilities:
  - [ ] AP (matches total outstanding supplier invoices)
  - [ ] VAT Payable
  - [ ] Excise Duty Payable
- [ ] Equity:
  - [ ] Share capital
  - [ ] Retained earnings

**VAT Management**
- [ ] VAT Report:
  - [ ] VAT collected = sum of VAT on all invoices in period
  - [ ] VAT paid = sum of VAT on all supplier invoices in period
  - [ ] VAT due = VAT collected - VAT paid
- [ ] Journal entries for VAT payable

**Excise Duty Management**
- [ ] Excise Duty Report:
  - [ ] Total excise collected = sum of excise on all customer invoices
  - [ ] Report format matches KRA submission
- [ ] Journal entries for excise payable

**Bank Reconciliation**
- [ ] Balances bank statement to general ledger
- [ ] Clears matched transactions
- [ ] Identifies uncleared items
- [ ] Posting of reconciling entries

**Financial Year Close**
- [ ] Process:
  - [ ] All transactions finalized
  - [ ] Adjusting entries posted
  - [ ] Trial balance balanced
  - [ ] P&L closed to retained earnings
  - [ ] New fiscal year created
- [ ] No corruption of prior year data
- [ ] Re-opening closed periods (if required) audited

**Multi-Period Reporting**
- [ ] Compare current period to:
  - [ ] Prior period
  - [ ] Year-to-date
  - [ ] Same period last year
- [ ] Variance calculations accurate

---

### 1.9 Delivery & Logistics Module

**CRUD Verification**

**Delivery Order**
- [ ] Links to sales order:
  - [ ] All line items copied
  - [ ] Quantities match sales order
- [ ] Warehouse allocation:
  - [ ] Stock reserved on DO creation
  - [ ] If ATP check fails, DO creation blocked
- [ ] Status flow:
  - [ ] Draft → Picked → Packed → Ready for Dispatch → Dispatched → In Transit → Delivered

**Driver Assignment**
- [ ] Assigned driver:
  - [ ] Added to driver's active delivery list
  - [ ] Mobile app shows assigned deliveries
- [ ] Driver updates status:
  - [ ] En route
  - [ ] At customer location
  - [ ] Delivered
  - [ ] Failed (with reason)

**Delivery Note PDF**
- [ ] Renders correctly
- [ ] Includes:
  - [ ] Delivery order number
  - [ ] Customer name and address
  - [ ] All line items (product, qty, batch/lot if applicable)
  - [ ] Barcode for each product (for scanning)
- [ ] Print-ready format

**Proof of Delivery (POD)**
- [ ] Driver captures:
  - [ ] Signature (or thumbprint for illiterate drivers)
  - [ ] Photo (if required)
  - [ ] Timestamp
  - [ ] Customer name (print)
  - [ ] Any comments
- [ ] POD links to correct delivery
- [ ] Triggers sales order status to "Delivered"
- [ ] Enables invoicing if not auto-invoiced

**Failed Delivery**
- [ ] Reason captured (Customer not available, refused, address not found, etc.)
- [ ] Creates re-delivery task
- [ ] Stock reversal or hold (based on process)

**Vehicle Mileage Log**
- [ ] Captured per trip:
  - [ ] Vehicle ID
  - [ ] Start mileage
  - [ ] End mileage
  - [ ] Date
  - [ ] Driver
- [ ] Used for:
  - [ ] Vehicle maintenance scheduling
  - [ ] Fuel cost allocation
  - [ ] Performance metrics

**Route Optimization**
- [ ] Grouping logic:
  - [ ] Nairobi zones (CBD, Westlands, South B, etc.)
  - [ ] Upcountry regions (Coast, Rift Valley, etc.)
- [ ] Delivery order sequencing by geography
- [ ] Estimated time to complete route

---

### 1.10 HR & Payroll Module

**CRUD Verification**

**Employee Records**
- [ ] Create:
  - [ ] Employee name (first, last)
  - [ ] ID number (national ID or passport)
  - [ ] KRA PIN (personal)
  - [ ] NHIF number
  - [ ] NSSF number
  - [ ] Department
  - [ ] Job title
  - [ ] Date of hire
  - [ ] Employment type (Full-time, Part-time, Contract, etc.)
  - [ ] Base salary
  - [ ] Allowances (transport, housing, etc.)
  - [ ] Bank account (for salary transfer)
  - [ ] All mandatory fields required
- [ ] Edit:
  - [ ] Salary changes tracked with effective date
  - [ ] History maintained
- [ ] Soft delete:
  - [ ] Mark as inactive
  - [ ] Stop payroll processing
  - [ ] Retain historical data

**Attendance Tracking**
- [ ] Records:
  - [ ] Employee ID
  - [ ] Date
  - [ ] Presence (Present, Absent, Leave)
  - [ ] Hours worked (if applicable)
- [ ] Links to correct employee
- [ ] Used for:
  - [ ] Bonus calculations (if applicable)
  - [ ] Leave deduction tracking
  - [ ] Performance metrics

**Leave Management**
- [ ] Leave types:
  - [ ] Annual leave (standard 21 days/year in Kenya)
  - [ ] Sick leave (3 days/year)
  - [ ] Compassionate leave
  - [ ] Maternity/Paternity leave
- [ ] Leave request form:
  - [ ] Employee submits
  - [ ] Manager approves
  - [ ] Dates specified
- [ ] Leave balance:
  - [ ] Deducts on approval
  - [ ] Cannot approve more than available balance
  - [ ] Rolls over unused days (if policy allows)
  - [ ] Lapsed days tracked
- [ ] Leave calendar shows team availability

**Payroll Computation**
- [ ] Monthly process:
  - [ ] Cannot process twice for same month/employee
- [ ] Calculation formula:
  - [ ] **Gross Salary** = Base + Allowances
  - [ ] **PAYE** = Gross × tax bracket (Kenya 2024 rates)
  - [ ] **NHIF** = Gross × NHIF bracket (Kenya rates)
  - [ ] **NSSF Tier I** = KES 200 max (if salary ≥ KES 5,999)
  - [ ] **NSSF Tier II** = Optional, captured separately
  - [ ] **Housing Levy** = 1.5% of gross (effective June 2023)
  - [ ] **Net Salary** = Gross - PAYE - NHIF - NSSF - Housing Levy

**PAYE Calculation**
- [ ] Uses Kenya 2024 tax bands (verify current rates)
- [ ] Example: Jun 2026 likely has updated bands
- [ ] Manual verification against KRA tax table (spot check 3 salaries)

**NHIF Deduction**
- [ ] Uses NHIF rates bands (Kenya 2024)
- [ ] Contributions tied to salary level
- [ ] Verify against NHIF website

**NSSF Tier I**
- [ ] Fixed contribution capped at KES 200
- [ ] Both employer and employee contribute
- [ ] Only if gross salary ≥ KES 5,999

**Housing Levy**
- [ ] 1.5% of gross salary
- [ ] Effective from June 2023
- [ ] Applies to all employees with gross > KES 12,000
- [ ] Employee and employer both contribute

**Payslip Generation**
- [ ] PDF renders without errors
- [ ] Includes:
  - [ ] Employee name, ID, department
  - [ ] Gross salary breakdown:
    - [ ] Base
    - [ ] Allowances
  - [ ] Deductions itemized:
    - [ ] PAYE amount
    - [ ] NHIF amount
    - [ ] NSSF amount
    - [ ] Housing Levy amount
  - [ ] Net salary
  - [ ] Month and year
  - [ ] Company name and address
- [ ] Professional layout, readable fonts

**Payroll Journal Entry**
- [ ] Dual entries:
  - [ ] Debit Salary Expense = Sum of all gross salaries
  - [ ] Credit Bank = Sum of all net salaries (for transfer)
  - [ ] Credit various liability accounts for taxes/contributions
- [ ] Total debits = Total credits

**Bank File Export**
- [ ] Exports employee bank details:
  - [ ] Account numbers
  - [ ] Bank codes
  - [ ] Net salary amounts
- [ ] File format compatible with local banks (e.g., SWIFT, local format)
- [ ] Encrypted transmission

**Payroll Lock**
- [ ] Once approved, payroll cannot be reprocessed
- [ ] Corrections via reversal + rerun (not overwrite)

---

### 1.11 Reports Module

**CRUD Verification**

**Report Data Accuracy**
- [ ] Every report loads REAL data (not hardcoded)
- [ ] Spot checks:
  - [ ] Sales report total = sum of invoice amounts
  - [ ] AR aging = sum of outstanding invoices
  - [ ] Inventory valuation = sum of (qty × WAC)
  - [ ] Payroll expense = sum of gross salaries
- [ ] **ZERO discrepancies allowed**

**Report Filtering**
- [ ] Date range:
  - [ ] Applies to all data in report
  - [ ] Start date and end date inclusive
- [ ] Department (for HR reports)
- [ ] Customer (for AR reports)
- [ ] Product (for inventory reports)
- [ ] Warehouse (for inventory reports)

**Report Exports**
- [ ] **PDF Export:**
  - [ ] Renders without errors
  - [ ] All data included (no truncation)
  - [ ] Headers, footers, page numbers visible
  - [ ] Professional formatting
  - [ ] Tested in Chrome, Firefox print preview
- [ ] **Excel Export:**
  - [ ] Opens in Microsoft Excel without errors
  - [ ] Column headers formatted
  - [ ] Data types correct (numbers right-aligned, dates formatted)
  - [ ] Large datasets complete (no row limit reached)

**Report Performance**
- [ ] Loads < 5 seconds for standard dataset (100 invoices, 50 customers)
- [ ] Large dataset export (1000+ rows) completes without timeout
- [ ] No memory leaks (checked via browser dev tools)

**Report-KPI Consistency**
- [ ] Dashboard revenue = Sales report total (exact match)
- [ ] Dashboard AR = AR aging grand total (exact match)
- [ ] Dashboard inventory = Inventory valuation total (exact match)

**Specific Reports to Verify**
- [ ] **Sales Register:** Order number, date, customer, amount, status
- [ ] **Invoice Register:** Invoice number, date, amount, VAT, excise, payment status
- [ ] **AR Aging:** Customer name, invoices in each bucket (0, 30, 60, 90, 90+ days)
- [ ] **Inventory Stock Status:** Product name, qty on hand, unit cost, valuation, re-order level
- [ ] **Payroll Register:** Employee, gross, PAYE, NHIF, NSSF, Housing Levy, net
- [ ] **VAT Report:** Period, total VAT on sales, total VAT on purchases, net VAT payable
- [ ] **Excise Duty Report:** Product category, quantity, rate, amount
- [ ] **Financial Statements:** P&L, Balance Sheet, Trial Balance (as of date)

---

## PHASE 2: REAL-TIME DATA AUDIT

### 2.1 WebSocket / Live Updates

```
Test Scenario: One user makes change, all other connected users see update within 3 seconds

TEST CASE 1: Stock Update
- Open inventory page on Browser A (User A)
- Open same inventory page on Browser B (User B)
- In Browser A: Confirm a sales order with 10 units of "Tusker Lager"
- Verify in Browser B: Stock level decreases by 10 units WITHOUT refresh
- Time to update: < 3 seconds
- [ ] PASS / [ ] FAIL

TEST CASE 2: Invoice Payment
- Open customer detail page on Browser A (User A)
- Open same customer on Browser B (User B)
- In Browser A: Record payment of KES 50,000
- Verify in Browser B: Outstanding AR balance decreases WITHOUT refresh
- Time to update: < 3 seconds
- [ ] PASS / [ ] FAIL

TEST CASE 3: Dashboard KPI Refresh
- Open dashboard on Browser A
- Open dashboard on Browser B
- In Browser A: Confirm a sale for KES 100,000
- Verify in Browser B: "Total Sales (YTD)" card updates WITHOUT page reload
- Time to update: < 3 seconds
- [ ] PASS / [ ] FAIL

TEST CASE 4: Delivery Status Update
- Open dispatch board on Browser A
- Open dispatch board on Browser B
- In Browser A: Mark delivery as "In Transit"
- Verify in Browser B: Status changes WITHOUT refresh
- Time to update: < 3 seconds
- [ ] PASS / [ ] FAIL

TEST CASE 5: Low Stock Alert
- Open inventory dashboard on Browser A
- Open same dashboard on Browser B
- In Browser A: Confirm a sale that brings stock below minimum
- Verify in Browser B: Low stock alert appears WITHOUT refresh
- Time to update: < 60 seconds
- [ ] PASS / [ ] FAIL

TEST CASE 6: Concurrent User Test
- Log in 10 users simultaneously
- User 1 creates a sales order
- Verify all 9 other users see new order in real-time
- [ ] PASS / [ ] FAIL
```

### 2.2 Polling Fallback

```
TEST CASE 1: WebSocket Disconnect
- Open app in browser
- Open browser dev tools → Network tab
- Simulate offline (DevTools → Offline)
- Wait 10 seconds
- User should see subtle "Reconnecting..." indicator
- Verify: No blank error screen
- [ ] PASS / [ ] FAIL

TEST CASE 2: Automatic Reconnection
- With offline mode still active
- Go back online
- System should automatically reconnect (silent)
- Verify: No manual refresh required
- [ ] PASS / [ ] FAIL

TEST CASE 3: No Data Loss
- During disconnection:
  - Try to update a form field
  - Field should remain editable (optimistic)
- On reconnection:
  - Changes should sync automatically
  - Or UI prompts to retry
- [ ] PASS / [ ] FAIL

TEST CASE 4: Polling Interval
- Check network requests in DevTools
- If WebSocket disconnected:
  - Should see API calls every 30 seconds
  - Not more frequent than necessary
- [ ] PASS / [ ] FAIL
```

---

## PHASE 3: PERFORMANCE TESTING

### 3.1 Load Benchmarks

```
HARDWARE: Standard business laptop / desktop
- Processor: Intel i5 or equivalent
- RAM: 8 GB
- Connection: 4G / standard broadband (10 Mbps)

TEST 1: Dashboard Load Time
- Clear browser cache
- Open dashboard
- Measure from click to fully rendered (all KPIs loaded)
- Target: < 2 seconds
- [ ] PASS (actual: ___ ms)
- [ ] FAIL

TEST 2: List View Load Time (Orders)
- Clear cache
- Open sales orders list (100+ orders in DB)
- Measure from click to full list rendered
- Target: < 2 seconds
- [ ] PASS (actual: ___ ms)
- [ ] FAIL

TEST 3: Form Submit Time
- New sales order form filled
- Click Save
- Measure from click to confirmation toast
- Target: < 1 second
- [ ] PASS (actual: ___ ms)
- [ ] FAIL

TEST 4: Report Generation
- Sales report (date range 30 days, 500+ invoices)
- Click "Generate Report"
- Measure to PDF ready for download
- Target: < 5 seconds
- [ ] PASS (actual: ___ ms)
- [ ] FAIL

TEST 5: Bulk Export
- Export 1000 sales orders to Excel
- Measure from click to file download
- Target: < 10 seconds
- [ ] PASS (actual: ___ ms)
- [ ] FAIL

TEST 6: Large Data Import
- Import 500 customer records
- Measure from upload to completion
- Target: < 20 seconds
- [ ] PASS (actual: ___ ms)
- [ ] FAIL
```

### 3.2 Database Performance

```
TEST 1: Query Response Time
- Run AR aging query (all customers)
- Measure database response
- Target: < 500 ms
- [ ] PASS (actual: ___ ms)
- [ ] FAIL

TEST 2: Index Verification
- Check all main queries use indexes (via EXPLAIN PLAN)
- [ ] All indexes present
- [ ] No full table scans on large tables

TEST 3: Connection Pooling
- Check configuration
- Min connections: 5, Max: 20
- [ ] Configured correctly
- [ ] Pool recycling working

TEST 4: Database Backup
- Nightly backup runs successfully
- [ ] Last backup completed without error
- [ ] Backup size reasonable (not bloated)
- [ ] Restore tested on copy (recovery drill)

TEST 5: Backup Restore
- Simulate restore from backup
- Data integrity check post-restore
- [ ] All tables restored
- [ ] No data corruption
- [ ] Audit logs intact
```

---

## PHASE 4: SECURITY AUDIT

### 4.1 Authentication & Authorization

```
TEST 1: API Authentication
- [ ] All endpoints return 401 if JWT missing
- [ ] All endpoints return 401 if JWT invalid
- [ ] All endpoints return 401 if JWT expired

TEST 2: Role-Based Access Control
- Create test users for each role:
  - [ ] Sales Rep
  - [ ] Warehouse Manager
  - [ ] Accountant
  - [ ] HR Manager
  - [ ] MD (Admin)

TEST 3: Horizontal Privilege Escalation
- Sales Rep A logs in
- Tries to access Sales Rep B's orders via URL manipulation:
  - [ ] /api/v1/sales/orders/:order_id (another rep's order)
  - [ ] Should return 403 (not 200, not 404)
- Tries to modify Sales Rep B's order:
  - [ ] Should return 403

TEST 4: Admin-Only Endpoints
- Non-admin user tries:
  - [ ] /api/v1/users (list all users)
  - [ ] /api/v1/companies (manage companies)
  - [ ] /api/v1/audit (view audit logs)
- Should return 403, not 404

TEST 5: Token Expiration
- Obtain JWT token
- Check expiration time (should be documented, e.g., 24 hours)
- [ ] Token validity: ____ hours
- Wait until expiration
- Try API call with expired token
- [ ] Should return 401

TEST 6: Logout Token Invalidation
- Log in user
- Record JWT token
- Click Logout
- Try API call with same token
- [ ] Should return 401

TEST 7: Session Management
- Log in user A in Browser Tab 1
- Log in user A again in Browser Tab 2 (if allowed) OR
- Log in user B in Browser Tab 2
- Log out in Tab 1
- Verify Tab 2 session status:
  - [ ] If same user: Still logged in (separate sessions OK)
  - [ ] If different user: Not applicable
```

### 4.2 Input Security

```
TEST 1: SQL Injection
- Customer form, name field:
  - Enter: ' OR '1'='1
  - [ ] Should be treated as literal text
  - [ ] No database error exposed
- Invoice search:
  - Enter: 1; DROP TABLE erp_invoices;
  - [ ] Should return no results (treated as literal)
  - [ ] No error

TEST 2: XSS Protection
- Customer name field:
  - Enter: <img src=x onerror=alert('XSS')>
  - Save
  - View customer list
  - [ ] Should NOT execute JavaScript
  - [ ] Text should display escaped

- Invoice description:
  - Enter: <script>alert('test')</script>
  - [ ] Should not execute on view
  - [ ] Should display as text

TEST 3: File Upload Validation
- Try to upload exe file where only PDF expected:
  - [ ] Rejected before upload
- Try to upload 1GB file:
  - [ ] Rejected (size limit enforced)
- Upload valid PDF:
  - [ ] Accepted

TEST 4: API Rate Limiting
- Send 101 requests in 1 minute
- User should receive:
  - [ ] Request 101+ returns 429 (Too Many Requests)
  - [ ] Error message: "Rate limit exceeded"
  - [ ] Limit resets after window (e.g., 1 minute)

TEST 5: CSRF Protection
- Log in user
- Open browser console
- Try CSRF attack simulation (if framework allows):
  - [ ] POST requests require CSRF token
  - [ ] Token mismatch returns 403
```

### 4.3 Data Security

```
TEST 1: Password Hashing
- Check backend code
- Passwords should be hashed with bcrypt (cost ≥ 12)
- [ ] bcrypt with cost ≥ 12 confirmed
- [ ] No plaintext passwords in database

TEST 2: Sensitive Data Encryption
- KRA PIN (if stored):
  - [ ] Encrypted at rest (AES-256)
- Salary data:
  - [ ] Encrypted at rest
- Bank account details:
  - [ ] Encrypted at rest
- Check: Database column encryption via pgcrypto or similar
- [ ] Confirmed

TEST 3: HTTPS Enforcement
- Open app in browser
- Navigate to http://localhost or http://domain
- [ ] Automatically redirects to https://
- [ ] All API calls use https://

TEST 4: Security Headers
- Open app in browser
- DevTools → Network tab
- Click on document request
- Check Response Headers:
  - [ ] Content-Security-Policy present
  - [ ] Strict-Transport-Security (HSTS) present
  - [ ] X-Frame-Options: DENY present
  - [ ] X-Content-Type-Options: nosniff present

TEST 5: Database Access Control
- Verify:
  - [ ] Database not accessible from public internet (port 5432 not open)
  - [ ] Only app server can connect
  - [ ] Database user has minimal required permissions (not superuser)

TEST 6: Environment Variables
- Check .env file:
  - [ ] Is in .gitignore (not in version control)
  - [ ] Contains all secrets: DB password, JWT secret, API keys
  - [ ] Production has different values than dev

TEST 7: API Key Exposure
- Search codebase for:
  - [ ] API keys hardcoded: NONE found
  - [ ] Database passwords hardcoded: NONE found
  - [ ] JWT secrets hardcoded: NONE found
```

### 4.4 Audit & Compliance

```
TEST 1: Audit Logging
- Create a sales order
- Check audit log:
  - [ ] Entry created with: User ID, Timestamp, Action (CREATE), Table (erp_sales_orders)
- Edit the order
  - [ ] Entry created with: User ID, Timestamp, Action (UPDATE), Before values, After values
- Delete (soft delete) the order
  - [ ] Entry created with: User ID, Timestamp, Action (DELETE), Record ID

TEST 2: Audit Log Security
- Try to delete an audit log entry:
  - [ ] Should be rejected (audit logs are immutable)
- Try to edit an audit log entry:
  - [ ] Should be rejected
- Check user permissions:
  - [ ] Only admin can VIEW audit logs
  - [ ] No one can EDIT or DELETE

TEST 3: Failed Login Logging
- Attempt login with wrong password 5 times
- Check audit log:
  - [ ] All 5 attempts logged with: Email, IP address, Timestamp, Result (Failed)
- Attempt login with correct password:
  - [ ] Logged with: Email, IP address, Timestamp, Result (Success)

TEST 4: Sensitive Action Re-authentication
- Logged in as admin
- Try to delete a user:
  - [ ] Prompted to re-enter password
  - [ ] Only after correct password can delete proceed
- Try to run payroll:
  - [ ] Prompted for re-authentication
  - [ ] Approval workflow triggered

TEST 5: Data Retention Policy
- Check documentation:
  - [ ] Audit logs retained for 7 years (Kenyan tax requirement)
  - [ ] Financial records retained per policy
  - [ ] Employee records retained per labor law
```

---

## PHASE 5: DATA ACCURACY AUDIT

### 5.1 Financial Accuracy Simulation

```
SCENARIO: Run a complete month

SETUP:
- Clear all transactional data (keep masters: customers, products, suppliers)
- Set period: June 1-30, 2026

EXECUTION:
1. Create 50 sales invoices:
   - 50 different order lines
   - Include mix of:
     - Products from all categories (Beer, Spirits, Wine, Soft Drinks)
     - Different customer types (retail, wholesale, distribution)
     - Various VAT scenarios (standard 16%)
     - Excise duties varying by category
   - [ ] All 50 created successfully

2. Record 20 payments:
   - [ ] 10 full payments (matching invoice amounts)
   - [ ] 5 partial payments (various amounts)
   - [ ] 5 overpayments (amount > invoice, creating credit)
   - [ ] All payments posted correctly

3. Create 5 credit notes:
   - [ ] 3 for returns (linked to invoices)
   - [ ] 2 for adjustments
   - [ ] All reduce AR balance correctly

VERIFICATION:

[ ] AR Aging Report:
- Current (0-30 days): sum = ___
- 30-60 days: sum = ___
- 60-90 days: sum = ___
- 90+ days: sum = ___
- TOTAL AR = ___ (should match outstanding invoice balance exactly)

[ ] VAT Reconciliation:
- Total VAT on all 50 invoices: ___ KES
- VAT Report total VAT collected: ___ KES
- DIFFERENCE: ___  (should be 0.00)

[ ] Excise Duty Reconciliation:
- Beer excise (50 invoices, Beer items): ___ KES
- Spirits excise: ___ KES
- Wine excise: ___ KES
- Excise Duty Report total: ___ KES
- DIFFERENCE: ___ (should be 0.00)

[ ] P&L Statement:
- Revenue (from invoices): ___ KES
- Should match: SUM(invoices in period) = ___ KES
- DIFFERENCE: ___ (should be 0.00)

[ ] Cash Position:
- Bank account balance (GL): ___ KES
- Should match: SUM(all payment transactions) = ___ KES
- DIFFERENCE: ___ (should be 0.00)

[ ] Trial Balance:
- Total Debits: ___ KES
- Total Credits: ___ KES
- DIFFERENCE: ___ (should be 0.00 exactly)
```

### 5.2 Inventory Accuracy Simulation

```
EXECUTION:

1. Create 10 sales orders:
   - [ ] Confirm each order (should reduce stock)
   - [ ] Dispatch each order
   - [ ] Deliver each order
   - All stock movements tracked

2. Record 3 purchase orders:
   - [ ] Create GRN for each
   - [ ] Receive stock (stock levels increase)
   - All stock movements tracked

3. Create 2 adjustments:
   - [ ] Adjustment 1: Damage, quantity -5
   - [ ] Adjustment 2: Count discrepancy, quantity +3
   - Both approved with reason codes

VERIFICATION:

[ ] Stock Movement Report:
- Opening stock (as of date): ___ units
- + Receipts (from GRNs): ___ units
- - Issues (from sales): ___ units
- +/- Adjustments: ___ units
- = Closing stock (as of date): ___ units
- Physical count taken today: ___ units
- VARIANCE: ___ (should be 0 or fully explained by later adjustments)

[ ] Valuation Report:
- Product 1: qty × WAC = ___ KES
- Product 2: qty × WAC = ___ KES
- ...
- TOTAL INVENTORY VALUE: ___ KES
- Balance sheet inventory value: ___ KES
- DIFFERENCE: ___ (should be 0.00)

[ ] Stock Audit Trail:
- Every receipt, issue, and adjustment has:
  - [ ] User who performed action
  - [ ] Timestamp
  - [ ] Reason code (for adjustments)
  - [ ] Approval (for adjustments)
  - All auditable
```

### 5.3 Payroll Accuracy Simulation

```
EMPLOYEES:
- Employee A: Gross KES 50,000
- Employee B: Gross KES 80,000
- Employee C: Gross KES 120,000
- 7 more employees at various salary levels

EXECUTION:
- [ ] Run payroll for all 10 employees for June 2026
- [ ] Generate payslips

VERIFICATION - EMPLOYEE A (KES 50,000):
- Gross: 50,000 KES
- PAYE (using Kenya 2026 table): ___ KES
  - Manual check from KRA table: ___ KES
  - [ ] Match: YES / NO
- NHIF (using Kenya rates): ___ KES
  - Manual check from NHIF schedule: ___ KES
  - [ ] Match: YES / NO
- NSSF Tier I: 200 KES (capped)
- Housing Levy (1.5% of 50,000): 750 KES
- Net = 50,000 - PAYE - NHIF - 200 - 750 = ___ KES

VERIFICATION - EMPLOYEE B (KES 80,000):
- Repeat above checks
- [ ] All rates correct

VERIFICATION - EMPLOYEE C (KES 120,000):
- Repeat above checks
- [ ] All rates correct

[ ] Payroll Journal Entry:
- Debit Salary Expense: (sum of all gross salaries) = ___ KES
- Credit Bank: (sum of all net salaries) = ___ KES
- Credit PAYE Payable: (sum of all PAYE deducted) = ___ KES
- Credit NHIF Payable: (sum of all NHIF deducted) = ___ KES
- Credit NSSF Payable: (sum of all NSSF deducted) = ___ KES
- Credit Housing Levy Payable: (sum of all Housing Levy deducted) = ___ KES
- Entries balanced: [ ] YES / [ ] NO

[ ] Payslips:
- All employees have payslips generated
- [ ] Each payslip shows correct gross, deductions, net
- [ ] PDFs render correctly
```

---

## PHASE 6: UI/UX & USABILITY AUDIT

### 6.1 Responsiveness Testing

```
DEVICES & BREAKPOINTS:
- [ ] 1920px desktop (large monitor)
- [ ] 1366px laptop
- [ ] 768px tablet (iPad size)
- [ ] 375px mobile (iPhone size)

TEST: Dashboard Page
- [ ] 1920px: No horizontal scrollbar, all KPI cards visible
- [ ] 1366px: Cards reflow gracefully, readable
- [ ] 768px: Single column, cards stack vertically, readable
- [ ] 375px: Single column, text readable, no overflow

TEST: Sales Order Form
- [ ] 1920px: Form layout comfortable, all fields visible
- [ ] 1366px: Form readable, no truncation
- [ ] 768px: Form scrollable vertically, fields stacked
- [ ] 375px: Form usable, no horizontal scroll
  - [ ] Input fields large enough (48px minimum touch target)
  - [ ] Mobile keyboard doesn't cover critical fields
  - [ ] Can scroll to see all fields

TEST: Table / List View
- [ ] 1920px: Table fully visible, columns clear
- [ ] 1366px: Table scrollable horizontally if needed
- [ ] 768px: Table scrollable horizontally, but usable
- [ ] 375px: Table horizontal scroll smooth, no layout break

TEST: Navigation
- [ ] 1920px: Sidebar visible
- [ ] 1366px: Sidebar visible
- [ ] 768px: Sidebar visible or collapsible
- [ ] 375px: Sidebar collapses to hamburger menu
  - [ ] Hamburger icon visible and tappable
  - [ ] Menu opens/closes smoothly
  - [ ] No overlap with content
```

### 6.2 Usability Audit

```
TEST: Feedback on Actions
Every user action should have clear feedback:

[ ] Create order:
  - Submit button click
  - [ ] Loading spinner appears (or button disables)
  - [ ] Success toast: "Order #SO-2024-001 created"
  - [ ] Page redirects to order detail
  - [ ] No silent failures

[ ] Delete customer:
  - [ ] Confirmation dialog appears: "Delete customer XYZ? This cannot be undone."
  - [ ] Cancel and Delete buttons visible
  - [ ] Only on Delete click does action proceed
  - [ ] Success message shown
  - [ ] Undo option (if applicable)

[ ] Long operation (export 1000 records):
  - [ ] "Generating report... 0%" message
  - [ ] Progress bar or spinner shown
  - [ ] Not a blank screen
  - [ ] Can cancel if needed

TEST: Error Handling
- [ ] Error messages are human-readable:
  - ✗ Bad: "UNIQUE constraint failed on erp_sales_orders.order_number"
  - ✓ Good: "Order number already exists. Please check."
- [ ] Error messages actionable:
  - ✓ "Customer is over credit limit. Approve or adjust order amount."
  - ✗ Bad: "Validation failed."
- [ ] No technical error codes shown to user (stack traces hidden)

TEST: Empty States
- [ ] Open "Sales Orders" when no orders exist
  - ✓ Shows: "No sales orders yet. Create your first order."
  - ✗ Bad: Blank page
- [ ] AR aging report with no overdue invoices
  - ✓ Shows: "No overdue invoices."
  - ✗ Bad: Blank report

TEST: Navigation
- [ ] Breadcrumbs present on all detail pages:
  - Home > Sales > Orders > Order #SO-2024-001
- [ ] Back button works (or browser back button)
- [ ] Search available on every list page

TEST: Help & Guidance
- [ ] Tooltips on complex fields:
  - [ ] "ATP Check" → Tooltip explains: "Available to Promise - stock actually available for sale"
- [ ] Required field indicators:
  - [ ] Red asterisk or "Required" label
  - [ ] Consistent across form
- [ ] Help text on error:
  - [ ] Invalid email: "Please enter a valid email address (e.g., john@example.com)"
```

### 6.3 Print & PDF Audit

```
TEST: Invoice PDF

CONTENT CHECK:
- [ ] Company logo visible (clear, not blurry)
- [ ] Company name (Martin Enterprises Pty Ltd)
- [ ] Company address
- [ ] Company phone, email
- [ ] Company KRA PIN
- [ ] Customer name and address
- [ ] Invoice number (INV-2024-000001)
- [ ] Invoice date
- [ ] Due date
- [ ] All line items:
  - [ ] Product name
  - [ ] SKU
  - [ ] Quantity
  - [ ] Unit price
  - [ ] Discount (if any)
  - [ ] Line total
- [ ] Subtotal
- [ ] VAT calculation (16%)
- [ ] Excise duty (by category)
- [ ] Grand total
- [ ] Payment terms
- [ ] Bank details for payment
- [ ] Notes (if any)

FORMAT CHECK:
- [ ] Open in Chrome print preview (Ctrl+P)
  - [ ] All content visible
  - [ ] No content cut off
  - [ ] Proper margins
  - [ ] Page size A4
- [ ] Open in Firefox print preview
  - [ ] All content visible
  - [ ] Proper formatting
- [ ] Save as PDF from print dialog
  - [ ] File saves successfully
  - [ ] PDF opens in Adobe Reader
  - [ ] Print from PDF looks good

TEST: Delivery Note PDF
- [ ] Same checks as invoice
- [ ] Include:
  - [ ] Delivery order number
  - [ ] Customer address
  - [ ] All line items with barcodes (if applicable)
  - [ ] Signature block (for POD)

TEST: Payslip PDF
- [ ] Professional layout
- [ ] All sections visible:
  - [ ] Employee details
  - [ ] Gross salary breakdown
  - [ ] Deductions itemized
  - [ ] Net salary
  - [ ] YTD totals
  - [ ] Company details
- [ ] Print-ready: No cut-off text, proper spacing

TEST: Report PDF (Sales Register)
- [ ] Headers: Column names visible
- [ ] All data rows included (no truncation)
- [ ] Footers: Page numbers, date generated
- [ ] Large reports (10+ pages): All pages complete
- [ ] Multi-page PDF: Page breaks clean, no data split mid-row
```

---

## PHASE 7: INTEGRATION & END-TO-END FLOW TEST

### 7.1 Complete Sales Cycle

```
FLOW: New Customer → Credit Check → Sales Order → Invoice → Delivery → Payment → AR Update

STEP 1: Create New Customer
- [ ] Open CRM → New Customer
- [ ] Enter:
  - [ ] Name: "ABC Trading Ltd"
  - [ ] Business type: "Retail"
  - [ ] KRA PIN: "A012345678K" (valid format)
  - [ ] Address
  - [ ] Contact person
  - [ ] Credit limit: KES 500,000
- [ ] Save
- [ ] Customer ID generated: _______

STEP 2: Create Sales Order
- [ ] Open Sales → New Order
- [ ] Select customer: "ABC Trading Ltd"
- [ ] Credit check automatic:
  - [ ] Customer credit limit: KES 500,000
  - [ ] Current AR: KES 0
  - [ ] Order amount: KES 250,000
  - [ ] Result: ✓ Within limit
- [ ] Add line items:
  - [ ] Product: Tusker Lager (Beer) - qty: 100 cases - price: 1,200/case
  - [ ] Product: Smirnoff Vodka (Spirits) - qty: 50 bottles - price: 2,500/bottle
  - [ ] Subtotal: (100 × 1,200) + (50 × 2,500) = 245,000 KES
- [ ] Apply VAT (16%): 245,000 × 0.16 = 39,200 KES
- [ ] Apply Excise:
  - [ ] Beer (Tusker): 100 cases × (assume KES 50/case) = 5,000 KES
  - [ ] Spirits (Smirnoff): 50 bottles × (assume KES 100/bottle) = 5,000 KES
  - [ ] Total excise: 10,000 KES
- [ ] **Grand Total: 245,000 + 39,200 + 10,000 = 294,200 KES**
- [ ] Save order
- [ ] Order #: SO-2024-______ generated
- [ ] Status: Draft
- [ ] Stock check passed (ATP)
- [ ] [ ] Audit log entry created

STEP 3: Confirm Order
- [ ] Open order SO-2024-______
- [ ] Click "Confirm"
- [ ] Status changes: Draft → Confirmed
- [ ] Stock reserved:
  - [ ] Tusker stock: -100 units
  - [ ] Smirnoff stock: -50 units
- [ ] Confirm toast: "Order confirmed"
- [ ] [ ] Audit log entry created

STEP 4: Dispatch Order
- [ ] Status changes: Confirmed → Dispatched
- [ ] Delivery order created
- [ ] Driver assigned (manually or auto)
- [ ] Delivery status: Ready for Dispatch
- [ ] [ ] Audit log entry created

STEP 5: Delivery Confirmation
- [ ] Driver marks as "In Transit"
- [ ] At destination: Mark as "Delivered"
- [ ] Proof of delivery captured:
  - [ ] Driver signature
  - [ ] Timestamp
  - [ ] Photo (optional)
- [ ] Status: Delivered
- [ ] Sales order status auto-updates: Dispatched → Delivered
- [ ] [ ] Audit log entry created

STEP 6: Create Invoice
- [ ] System auto-generates invoice from delivered order (if configured)
  OR
- [ ] Manually create invoice:
  - [ ] Open Sales → Invoices → New
  - [ ] Link to order SO-2024-______
  - [ ] All line items auto-populate
  - [ ] VAT recalculates: ✓ 39,200 KES
  - [ ] Excise recalculates: ✓ 10,000 KES
  - [ ] Save
- [ ] Invoice #: INV-2024-______ generated
- [ ] Invoice date: Today
- [ ] Due date: Today + 30 days (if terms allow)
- [ ] Status: Confirmed
- [ ] Journal entry posted:
  - [ ] Debit AR: 294,200 KES
  - [ ] Credit Sales Revenue: 245,000 KES
  - [ ] Credit VAT Payable: 39,200 KES
  - [ ] Credit Excise Payable: 10,000 KES
  - [ ] Balanced: ✓

STEP 7: Record Payment
- [ ] Open Customer: "ABC Trading Ltd"
- [ ] Outstanding invoices shown:
  - [ ] INV-2024-______ for 294,200 KES (due 30 days)
- [ ] Record Payment:
  - [ ] Payment amount: 294,200 KES (full payment)
  - [ ] Payment method: Bank transfer
  - [ ] Payment date: Today
  - [ ] Bank reference: (record number)
- [ ] Save
- [ ] Journal entry posted:
  - [ ] Debit Bank: 294,200 KES
  - [ ] Credit AR: 294,200 KES
  - [ ] Balanced: ✓
- [ ] Invoice status: Paid
- [ ] AR aging: No balance for ABC Trading Ltd
- [ ] Toast: "Payment recorded successfully"
- [ ] [ ] Audit log entry created

STEP 8: Verify AR Update
- [ ] Dashboard AR card:
  - [ ] Before payment: KES 294,200
  - [ ] After payment: KES 0 (or previous balance if other invoices exist)
- [ ] AR aging report:
  - [ ] ABC Trading Ltd not listed (fully paid)
- [ ] GL Report:
  - [ ] AR balance: matches sum of outstanding invoices
  - [ ] VAT Payable: includes 39,200 KES
  - [ ] Excise Payable: includes 10,000 KES

STEP 9: Receipt Generation (Optional)
- [ ] Click "Generate Receipt" on paid invoice
- [ ] Receipt PDF:
  - [ ] Shows: "RECEIPT #RCP-2024-______"
  - [ ] Invoice number
  - [ ] Payment amount
  - [ ] Payment method
  - [ ] Date
- [ ] Email sent to customer

**FLOW COMPLETE: [ ] PASS / [ ] FAIL**
```

### 7.2 Complete Procurement Cycle

```
FLOW: Low Stock Alert → Draft PO → Approval → Supplier Invoice → Payment → AP Update

STEP 1: Low Stock Alert
- [ ] Dashboard shows: "Stock alert: Guinness (10 units) below minimum (20 units)"
- [ ] Click alert
- [ ] Inventory detail opens with reorder suggestion

STEP 2: Create Purchase Order
- [ ] Open Procurement → New PO
- [ ] Supplier: Select "East African Beverages Ltd" (verified supplier)
- [ ] Delivery date: 7 days from today
- [ ] Payment terms: Net 30
- [ ] Add line items:
  - [ ] Product: Guinness (Beer) - qty: 500 cases - unit cost: 900/case (from supplier master)
  - [ ] Total: 500 × 900 = 450,000 KES
- [ ] PO total: 450,000 KES
- [ ] Save
- [ ] PO #: PO-2024-______ generated
- [ ] Status: Draft
- [ ] [ ] Audit log entry created

STEP 3: Authorization Check
- [ ] PO amount: 450,000 KES (> 100,000)
- [ ] Required approval: MD
- [ ] Click "Submit for Approval"
- [ ] Status: Pending Approval
- [ ] MD notified (email or in-app)
- [ ] [ ] Audit log entry created

STEP 4: Approval
- [ ] MD logs in
- [ ] Approval queue shows: PO-2024-______ for KES 450,000
- [ ] MD reviews:
  - [ ] Supplier verified: ✓
  - [ ] Pricing reasonable: ✓
  - [ ] Quantity appropriate: ✓
- [ ] Click "Approve"
- [ ] Status: Approved
- [ ] Toast: "PO approved"
- [ ] [ ] Audit log entry created

STEP 5: Send to Supplier
- [ ] PO status: Approved
- [ ] Email sent to supplier:
  - [ ] PO attachment (PDF)
  - [ ] Delivery address
  - [ ] Contact details
- [ ] Status changes: Approved → Sent to Supplier
- [ ] [ ] Audit log entry created

STEP 6: Goods Receipt (GRN)
- [ ] Goods delivered after 5 days
- [ ] Warehouse receives 500 cases Guinness
- [ ] Create GRN:
  - [ ] Link to PO-2024-______
  - [ ] Received quantity: 500 cases (matches PO)
  - [ ] Batch/lot: ABC-123
  - [ ] Expiry date: June 2028
- [ ] Save GRN
- [ ] GRN #: GRN-2024-______ generated
- [ ] Stock updated:
  - [ ] Guinness stock: +500 cases
  - [ ] Valuation: 500 × 900 = 450,000 KES
- [ ] Journal entry posted:
  - [ ] Debit Inventory: 450,000 KES
  - [ ] Credit AP (Accounts Payable): 450,000 KES
- [ ] [ ] Audit log entry created

STEP 7: Supplier Invoice
- [ ] Supplier sends invoice:
  - [ ] Invoice #: EAB-INV-2024-12345
  - [ ] Amount: 450,000 KES
  - [ ] Matches PO (3-way match):
    - [ ] PO qty: 500 ✓
    - [ ] GRN qty: 500 ✓
    - [ ] Invoice qty: 500 ✓
    - [ ] Unit price: 900 ✓
- [ ] Post supplier invoice:
  - [ ] Link GRN-2024-______
  - [ ] Status: Approved (all matches)
- [ ] AP balance updated:
  - [ ] East African Beverages Ltd: +450,000 KES (outstanding)
- [ ] Journal entry (reversal of GRN entry):
  - [ ] Debit Inventory: 450,000 KES
  - [ ] Credit AP: 450,000 KES
  - [ ] (This moves from accrual to actual invoice)
- [ ] [ ] Audit log entry created

STEP 8: Payment
- [ ] AP aging shows: East African Beverages Ltd - 450,000 KES (due 30 days)
- [ ] Record Payment:
  - [ ] Supplier: East African Beverages Ltd
  - [ ] Invoice: EAB-INV-2024-12345
  - [ ] Amount: 450,000 KES
  - [ ] Payment method: Bank transfer
  - [ ] Date: 30 days later (on/before due date)
- [ ] Journal entry:
  - [ ] Debit AP: 450,000 KES
  - [ ] Credit Bank: 450,000 KES
  - [ ] Balanced: ✓
- [ ] AP balance: 0 KES
- [ ] [ ] Audit log entry created

STEP 9: Verify AP Update
- [ ] Dashboard AP card: Reflects payment
- [ ] AP aging report: East African Beverages Ltd cleared
- [ ] GL Report: AP balance matches sum of outstanding invoices

**FLOW COMPLETE: [ ] PASS / [ ] FAIL**
```

### 7.3 Complete Payroll Cycle

```
FLOW: Attendance → Leave Approval → Payroll Computation → Statutory Deductions → Approval → Execution

STEP 1: Attendance Recording
- [ ] June attendance marked for all 10 employees:
  - [ ] Employee A: 20 days present, 2 days leave, 0 absent
  - [ ] Employee B: 18 days present, 4 days leave, 0 absent
  - [ ] (Continue for all 10)
- [ ] Data entry completed by June 28

STEP 2: Leave Approval
- [ ] Open HR → Leave Requests
- [ ] 4 pending leave requests:
  - [ ] Employee A: 2 days annual leave (June 10-11)
  - [ ] Employee B: 1 day sick leave (June 15)
  - [ ] Employee C: 1 day compassionate (June 20)
  - [ ] Employee D: (none)
- [ ] Verify leave balances:
  - [ ] Employee A: 21 annual available, requesting 2 → ✓ Approved
  - [ ] Employee B: 3 sick available, requesting 1 → ✓ Approved
  - [ ] Employee C: Compassionate (unlimited) → ✓ Approved
- [ ] Approve all
- [ ] Leave balances updated:
  - [ ] Employee A: 21 - 2 = 19 remaining
  - [ ] Employee B: 3 - 1 = 2 remaining
  - [ ] Employee C: Unchanged (compassionate)
- [ ] [ ] Audit log entries created

STEP 3: Payroll Setup
- [ ] Open Payroll → Compute for June 2026
- [ ] Verify employee data:
  - [ ] All 10 employees active
  - [ ] Salary rates current
  - [ ] Bank accounts recorded
- [ ] Close option: "Process for June 2026"

STEP 4: Payroll Computation
- [ ] System calculates:

**Employee A (Gross 50,000 KES):**
- Gross: 50,000 KES
- PAYE (2026 rates): ___ KES (manual verification required)
- NHIF: ___ KES
- NSSF Tier I: 200 KES (capped)
- Housing Levy (1.5%): 750 KES
- NET: 50,000 - PAYE - NHIF - 200 - 750 = ___ KES

**Employee B (Gross 80,000 KES):**
- Gross: 80,000 KES
- PAYE: ___ KES
- NHIF: ___ KES
- NSSF: 200 KES (capped)
- Housing Levy: 1,200 KES
- NET: ___ KES

**(Continue for all 10)**

- [ ] Verify calculations manually (spot check 3 employees against KRA/NHIF/NSSF tables)
- [ ] All calculations correct: [ ] YES / [ ] NO
- [ ] Payroll summary displays:
  - [ ] Total gross payroll: (sum of all)
  - [ ] Total PAYE: (sum of all)
  - [ ] Total NHIF: (sum of all)
  - [ ] Total NSSF: (sum of all)
  - [ ] Total Housing Levy: (sum of all)
  - [ ] Total net payroll: (sum of all nets)

STEP 5: Approval
- [ ] Payroll in "Pending Approval" status
- [ ] HR Manager reviews:
  - [ ] All employees included: ✓
  - [ ] Calculations appear correct: ✓
- [ ] Finance Manager reviews:
  - [ ] Budget: June salary budget is 600,000 KES, payroll is ___
  - [ ] Approval: ✓
- [ ] Click "Approve"
- [ ] Payroll status: Approved

STEP 6: Payslip Generation
- [ ] System generates 10 payslips (PDF)
- [ ] Each payslip includes:
  - [ ] Employee name
  - [ ] Employee ID
  - [ ] Period: June 2026
  - [ ] Gross breakdown
  - [ ] Deductions itemized:
    - [ ] PAYE
    - [ ] NHIF
    - [ ] NSSF
    - [ ] Housing Levy
  - [ ] Net salary
  - [ ] YTD totals
  - [ ] Company name and details
- [ ] All PDFs generated successfully
- [ ] Emails sent to employees (if configured)
- [ ] [ ] Audit log entry created

STEP 7: Payroll Posting
- [ ] Click "Execute Payroll"
- [ ] Payroll status: Processed
- [ ] Bank file generated (for salary transfer):
  - [ ] Employee bank accounts
  - [ ] Net amounts
  - [ ] File format: Standard SWIFT or local bank format
- [ ] Journal entries posted:
  - [ ] **Debit Salary Expense:** (total gross) KES
  - [ ] **Credit Bank:** (total net) KES
  - [ ] **Credit PAYE Payable:** (total PAYE) KES
  - [ ] **Credit NHIF Payable:** (total NHIF) KES
  - [ ] **Credit NSSF Payable:** (total NSSF) KES
  - [ ] **Credit Housing Levy Payable:** (total levy) KES
  - [ ] All entries balanced: ✓

STEP 8: Verification
- [ ] GL Salary Expense account:
  - [ ] Debit: Total gross payroll KES
- [ ] GL Bank account:
  - [ ] Credit: Total net payroll KES
- [ ] P&L shows Salary Expense for June: ✓
- [ ] Payroll cannot be reprocessed for June (locked)
- [ ] Dashboard shows Payroll Processed: ✓

**FLOW COMPLETE: [ ] PASS / [ ] FAIL**
```

### 7.4 Month-End Close Cycle

```
FLOW: Finalize → VAT Report → Excise Report → Bank Reconciliation → Trial Balance → P&L → BS

STEP 1: Transactions Finalization
- [ ] All June transactions entered:
  - [ ] Sales invoices: ✓
  - [ ] Payments: ✓
  - [ ] Procurements: ✓
  - [ ] Payroll: ✓
- [ ] No outstanding drafts

STEP 2: VAT Report
- [ ] Open Reports → VAT Report
- [ ] Period: June 1-30, 2026
- [ ] Report shows:
  - [ ] Total sales (VAT-able): ___ KES
  - [ ] VAT on sales (16%): ___ KES
  - [ ] Total purchases (VAT-able): ___ KES
  - [ ] VAT on purchases: ___ KES
  - [ ] Net VAT due: (VAT on sales - VAT on purchases) = ___ KES
- [ ] Reconcile:
  - [ ] Sum of all invoice VATs = VAT on sales line: ✓
  - [ ] Sum of all supplier invoice VATs = VAT on purchases line: ✓
- [ ] Report ready for KRA filing

STEP 3: Excise Duty Report
- [ ] Open Reports → Excise Duty Report
- [ ] Period: June 1-30, 2026
- [ ] Report shows by category:
  - [ ] Beer sales (units): ___, Excise collected: ___ KES
  - [ ] Spirits sales (units): ___, Excise collected: ___ KES
  - [ ] Wine sales (units): ___, Excise collected: ___ KES
  - [ ] Soft drinks (units): ___, Excise collected: ___ KES
  - [ ] Total excise: ___ KES
- [ ] Verify:
  - [ ] Sum of invoice excise duties = total excise: ✓
- [ ] Report ready for KRA filing

STEP 4: Bank Reconciliation
- [ ] Open Finance → Bank Reconciliation
- [ ] Bank account: Main operating account
- [ ] Bank statement obtained (or simulated):
  - [ ] Opening balance: ___ KES
  - [ ] Deposits: ___ KES
  - [ ] Withdrawals: ___ KES
  - [ ] Closing balance: ___ KES
- [ ] GL cash balance: ___ KES
- [ ] Outstanding items:
  - [ ] Uncleared checks: ___ KES
  - [ ] Deposits in transit: ___ KES
- [ ] Reconciliation:
  - [ ] Bank balance ± outstanding items = GL balance: ✓
- [ ] Clear matched items
- [ ] Post any bank charges/interest as journals
- [ ] Reconciliation marked "Complete"

STEP 5: Trial Balance
- [ ] Open Reports → Trial Balance (as of June 30, 2026)
- [ ] Report lists:
  - [ ] All accounts with debit/credit balances
  - [ ] Total debits: ___
  - [ ] Total credits: ___
  - [ ] Difference: ___ (should be 0.00 exactly)
- [ ] If difference ≠ 0:
  - [ ] Investigate and post correcting entries
  - [ ] Rerun trial balance until balanced
- [ ] Final verification: **Difference = 0.00 KES**

STEP 6: P&L Statement
- [ ] Open Reports → Profit & Loss
- [ ] Period: June 2026
- [ ] Report shows:
  - [ ] **Income:**
    - [ ] Sales revenue: ___ KES
    - [ ] Other income: ___ KES
    - [ ] Total income: ___ KES
  - [ ] **Expenses:**
    - [ ] COGS: ___ KES
    - [ ] Salaries (from payroll): ___ KES
    - [ ] Depreciation: ___ KES
    - [ ] Rent: ___ KES
    - [ ] Utilities: ___ KES
    - [ ] Total expenses: ___ KES
  - [ ] **Net Income: Total Income - Total Expenses = ___ KES**
- [ ] Verify:
  - [ ] Revenue = sum of all invoices: ✓
  - [ ] Salaries = total payroll gross: ✓
  - [ ] COGS = inventory write-off: ✓

STEP 7: Balance Sheet
- [ ] Open Reports → Balance Sheet (as of June 30, 2026)
- [ ] Report shows:
  - [ ] **Assets:**
    - [ ] Cash: ___ KES
    - [ ] AR: ___ KES
    - [ ] Inventory: ___ KES
    - [ ] Fixed assets (net): ___ KES
    - [ ] Total Assets: ___ KES
  - [ ] **Liabilities:**
    - [ ] AP: ___ KES
    - [ ] VAT Payable: ___ KES
    - [ ] Excise Payable: ___ KES
    - [ ] Loans: ___ KES
    - [ ] Total Liabilities: ___ KES
  - [ ] **Equity:**
    - [ ] Share capital: ___ KES
    - [ ] Retained earnings: ___ KES
    - [ ] June net income: ___ KES
    - [ ] Total Equity: ___ KES
  - [ ] **Verification: Assets = Liabilities + Equity: ✓**
- [ ] Verify AR = sum of unpaid invoices: ✓
- [ ] Verify Inventory = valuation report total: ✓

STEP 8: Reporting & Distribution
- [ ] All reports generated and exported:
  - [ ] VAT report (for KRA filing)
  - [ ] Excise duty report (for KRA filing)
  - [ ] Trial balance
  - [ ] P&L
  - [ ] Balance sheet
  - [ ] Bank reconciliation summary
- [ ] All PDF reports:
  - [ ] Render correctly
  - [ ] Print-ready format
  - [ ] Headers and footers present
- [ ] Reports reviewed by Finance Manager: ✓
- [ ] Signed off for management review

**MONTH-END CLOSE COMPLETE: [ ] PASS / [ ] FAIL**
```

### 7.5 Stock Discrepancy Resolution

```
FLOW: Physical Count → Discrepancy → Adjustment → Approval → Resolution → Audit

STEP 1: Physical Inventory Count
- [ ] Physical count performed on June 30, 2026
- [ ] Counting teams cover all warehouses
- [ ] Each product counted manually:
  - [ ] Product: Tusker Lager
    - [ ] System stock: 250 cases
    - [ ] Physical count: 245 cases
    - [ ] Variance: -5 cases (SHORTAGE)
  - [ ] Product: Smirnoff Vodka
    - [ ] System stock: 100 bottles
    - [ ] Physical count: 102 bottles
    - [ ] Variance: +2 bottles (OVERAGE)
  - [ ] (Continue for all products)

STEP 2: Discrepancy Analysis
- [ ] Reconcile system vs. physical:
  - [ ] Tusker Lager: -5 cases
  - [ ] Smirnoff Vodka: +2 bottles
  - [ ] (Others match or have discrepancies)
- [ ] Investigate causes:
  - [ ] Tusker: "Damaged during receipt" (should have been noted in GRN)
  - [ ] Smirnoff: "Over-receipt at delivery" (check with GRN)
  - [ ] Note: Can only adjust what's documented

STEP 3: Create Adjustment
- [ ] Open Inventory → Adjustments → New
- [ ] Adjustment 1:
  - [ ] Product: Tusker Lager
  - [ ] Quantity: -5 cases
  - [ ] Reason code: Damage
  - [ ] Notes: "Found damaged during count - likely from receipt"
  - [ ] Approver: Warehouse Manager
- [ ] Adjustment 2:
  - [ ] Product: Smirnoff Vodka
  - [ ] Quantity: +2 bottles
  - [ ] Reason code: Count Variance
  - [ ] Notes: "Over-receipt noted in GRN, system entry not updated"
  - [ ] Approver: Warehouse Manager
- [ ] Save both adjustments
- [ ] Adjustment #'s: ADJ-2024-______, ADJ-2024-______
- [ ] Status: Pending Approval
- [ ] [ ] Audit log entries created

STEP 4: Approval
- [ ] Warehouse Manager reviews:
  - [ ] Adjustment 1: "Damage" reason acceptable → Approve
  - [ ] Adjustment 2: "Over-receipt" needs GRN verification
    - [ ] Check GRN: GRN shows 102 units received, but system posted 100
    - [ ] Historical entry error confirmed
    - [ ] Approve correction
- [ ] Click "Approve" on both adjustments
- [ ] Status: Approved
- [ ] [ ] Audit log entries created

STEP 5: Stock Update
- [ ] System applies adjustments:
  - [ ] Tusker Lager: 250 - 5 = 245 cases ✓
  - [ ] Smirnoff Vodka: 100 + 2 = 102 bottles ✓
- [ ] Valuation recalculated:
  - [ ] Tusker: 245 × 900 = 220,500 KES
  - [ ] Smirnoff: 102 × 2,500 = 255,000 KES
- [ ] Inventory account updated
- [ ] Journal entries posted:
  - [ ] Debit Inventory Loss (Damage): 5 cases × 900 = 4,500 KES
  - [ ] Credit Inventory: 4,500 KES
  - [ ] Debit Inventory: 2 bottles × 2,500 = 5,000 KES
  - [ ] Credit Inventory Gain (Recount): 5,000 KES

STEP 6: Audit Log Review
- [ ] Open Audit Log
- [ ] Filter by: Adjustments, June 2026
- [ ] Verify entries show:
  - [ ] ADJ-2024-______ created by (user), timestamp, "Damage"
  - [ ] ADJ-2024-______ approved by (warehouse manager), timestamp
  - [ ] Stock updated to 245 cases
  - [ ] Stock updated to 102 bottles
  - [ ] Journal entries posted (all visible)
- [ ] Complete chain of custody: ✓

STEP 7: Closure
- [ ] Both adjustments marked "Processed"
- [ ] Month-end inventory recount complete: ✓
- [ ] Valuation reconciled with GL: ✓
- [ ] All discrepancies explained and documented

**RESOLUTION COMPLETE: [ ] PASS / [ ] FAIL**
```

---

## PHASE 8: DEPLOYMENT & INFRASTRUCTURE AUDIT

### 8.1 Environment Verification

```
TEST: Production Environment Separation
- [ ] Development database: Separate from production (different server/schema)
- [ ] Development API: Separate endpoint (api-dev.domain.com vs. api.domain.com)
- [ ] Development has test data; Production has real data: ✓

TEST: Environment Variables (Production)
- [ ] Database connection: Points to production DB
- [ ] API base URL: Points to production API
- [ ] JWT secret: Strong, random, not shared with dev
- [ ] Debug mode: OFF (process.env.DEBUG = false)
- [ ] Error logging: To file/service (not console.log)
- [ ] All secrets: In .env (not in code, not in .gitignore)

TEST: Error Handling (Production)
- [ ] 500 error triggered:
  - [ ] User sees: "An error occurred. Please contact support."
  - [ ] NOT shown: Full stack trace, SQL query, file path
- [ ] 404 error triggered:
  - [ ] User sees: "Page not found"
  - [ ] NOT shown: System details

TEST: Logging
- [ ] Error log file exists: /var/log/app/error.log (or cloud logging)
- [ ] Request logs exist: /var/log/app/access.log
- [ ] Log rotation configured: Daily, max 30 files
- [ ] Sensitive data not logged (passwords, card numbers)
```

### 8.2 Backup & Recovery

```
TEST: Automated Backup
- [ ] Backup scheduled: Daily at 2:00 AM
- [ ] Last backup completed: (check timestamp)
- [ ] Backup size: ___ GB (reasonable)
- [ ] Backup location: Off-site (AWS S3, Azure Blob, etc.)
- [ ] Encryption: Yes, encrypted at rest

TEST: Backup Restoration
- [ ] Restore backup to staging environment
- [ ] Verify data integrity:
  - [ ] All tables present
  - [ ] Row counts match production snapshot
  - [ ] Foreign keys intact
  - [ ] Indexes present
  - [ ] Audit logs complete
- [ ] RTO (Recovery Time Objective): < 1 hour documented
- [ ] RPO (Recovery Point Objective): < 24 hours (daily backup)

TEST: Manual Backup
- [ ] Backup command tested: ✓
- [ ] Compression: Yes
- [ ] Retention: Keep last 7 daily, last 4 weekly, last 12 monthly
```

### 8.3 Monitoring & Uptime

```
TEST: Application Uptime Monitoring
- [ ] Monitoring service: DataDog, New Relic, or equivalent
- [ ] Health check endpoint: /health (returns 200 OK)
- [ ] Check frequency: Every 5 minutes
- [ ] Alert if down: Yes (email/SMS to on-call)
- [ ] Dashboard: Shows uptime % (target 99.5%)
- [ ] Last month uptime: ___% (should be >99.5%)

TEST: Database Monitoring
- [ ] Query performance tracked
- [ ] Slow query log: Queries > 1 second logged
- [ ] Connection pool health: Monitored
- [ ] Disk space: Monitored (alert at 80%)
- [ ] Alert if unusual load: Yes

TEST: Error Rate Monitoring
- [ ] 5xx errors tracked
- [ ] Alert if 5xx rate > 1% in 5 min window: Yes
- [ ] 4xx errors tracked (but not alarmed)
- [ ] Dashboard shows error trend
```

### 8.4 Security Hardening

```
TEST: SSL/TLS Certificate
- [ ] Certificate: Valid, issued by trusted CA
- [ ] Expiry: Not within 30 days
- [ ] Next renewal: ___ (scheduled automation)
- [ ] Check: https://www.ssllabs.com/ssltest/
  - [ ] Grade: A+ or A
  - [ ] No weak ciphers
  - [ ] TLS 1.2+

TEST: Firewall Rules
- [ ] Inbound: Only HTTPS (443) and SSH (22, restricted IPs)
- [ ] Outbound: Restricted to necessary services (email, payment, logging)
- [ ] Database port (5432): Not open to public
- [ ] Admin ports: Not exposed

TEST: User Access Control
- [ ] SSH key-based only (no password ssh)
- [ ] sudo limited to specific admins
- [ ] No root login directly (use sudo)
- [ ] SSH keys rotated regularly

TEST: Data Encryption
- [ ] Passwords: bcrypt (cost ≥ 12)
- [ ] Sensitive fields: AES-256 in database
- [ ] Backups: Encrypted at rest
- [ ] HTTPS: All data in transit encrypted
```

### 8.5 Scalability & Performance

```
TEST: Load Testing (Simulated)
- [ ] Concurrent users: Can handle 50+ simultaneous
- [ ] Response time under load: < 3 seconds
- [ ] Database: Connection pool doesn't exhaust
- [ ] No memory leaks observed

TEST: Database Indexing
- [ ] Verify indexes on:
  - [ ] erp_sales_orders (company_id, order_date, customer_id)
  - [ ] erp_invoices (company_id, invoice_date, customer_id)
  - [ ] erp_inventory_movements (warehouse_id, product_id, date)
  - [ ] erp_audit_logs (entity, entity_id, timestamp)
- [ ] EXPLAIN PLAN: No full table scans on large tables

TEST: Caching (if implemented)
- [ ] Redis or similar cache configured
- [ ] Cache strategy: Customer list, product master, roles/permissions
- [ ] Cache invalidation: Automatic on data change
- [ ] Test: Clear cache, verify data refreshes
```

### 8.6 Code Quality & Testing

```
TEST: Unit Tests
- [ ] Test suite exists
- [ ] Coverage: > 80%
- [ ] All critical paths tested
- [ ] Run: npm test or equivalent
- [ ] All tests pass: ✓

TEST: Integration Tests
- [ ] E2E tests: ✓
- [ ] API tests: ✓
- [ ] Database integration: ✓
- [ ] All tests pass: ✓

TEST: Code Quality
- [ ] ESLint configured
- [ ] No errors on run: ✓
- [ ] No warnings (or documented exceptions): ✓
- [ ] Prettier configured for consistent formatting
- [ ] Code reviews enforced (PR process)
```

---

## FINAL SIGN-OFF CHECKLIST

```
PHASE 1: MODULE COMPLETENESS
- [ ] Authentication: PASS / FAIL (critical)
- [ ] Dashboard: PASS / FAIL
- [ ] Sales Module: PASS / FAIL (critical)
- [ ] Invoicing: PASS / FAIL (critical)
- [ ] Inventory: PASS / FAIL (critical)
- [ ] Procurement: PASS / FAIL
- [ ] CRM/Customers: PASS / FAIL
- [ ] Accounting: PASS / FAIL (critical)
- [ ] Delivery: PASS / FAIL
- [ ] HR/Payroll: PASS / FAIL (critical)
- [ ] Reports: PASS / FAIL (critical)

PHASE 2: REAL-TIME DATA
- [ ] WebSocket updates: PASS / FAIL
- [ ] Polling fallback: PASS / FAIL
- [ ] No data loss on reconnect: PASS / FAIL

PHASE 3: PERFORMANCE
- [ ] Dashboard load < 2sec: PASS / FAIL
- [ ] List load < 2sec: PASS / FAIL
- [ ] Form submit < 1sec: PASS / FAIL
- [ ] Report generation < 5sec: PASS / FAIL
- [ ] Large export < 10sec: PASS / FAIL

PHASE 4: SECURITY
- [ ] API authentication enforced: PASS / FAIL
- [ ] Authorization working: PASS / FAIL
- [ ] SQL injection impossible: PASS / FAIL
- [ ] XSS protection: PASS / FAIL
- [ ] HTTPS enforced: PASS / FAIL
- [ ] Audit logging working: PASS / FAIL

PHASE 5: DATA ACCURACY
- [ ] Financial simulation: PASS / FAIL (critical)
- [ ] Inventory accuracy: PASS / FAIL (critical)
- [ ] Payroll accuracy: PASS / FAIL (critical)
- [ ] Zero discrepancies: PASS / FAIL (critical)

PHASE 6: UI/UX
- [ ] Responsive at all breakpoints: PASS / FAIL
- [ ] Feedback on all actions: PASS / FAIL
- [ ] Error messages helpful: PASS / FAIL
- [ ] PDF outputs professional: PASS / FAIL

PHASE 7: END-TO-END FLOWS
- [ ] Sales cycle complete: PASS / FAIL (critical)
- [ ] Procurement cycle complete: PASS / FAIL
- [ ] Payroll cycle complete: PASS / FAIL (critical)
- [ ] Month-end close complete: PASS / FAIL (critical)
- [ ] Stock discrepancy resolution: PASS / FAIL

PHASE 8: DEPLOYMENT
- [ ] Environment separated: PASS / FAIL
- [ ] Backups working: PASS / FAIL (critical)
- [ ] Monitoring active: PASS / FAIL (critical)
- [ ] Security hardened: PASS / FAIL (critical)

CRITICAL ITEMS (ALL MUST BE PASS):
- [ ] Authentication: PASS
- [ ] Sales module: PASS
- [ ] Invoicing: PASS
- [ ] Accounting: PASS
- [ ] Inventory: PASS
- [ ] Payroll: PASS
- [ ] Reports: PASS
- [ ] Financial accuracy: PASS
- [ ] Data accuracy: PASS
- [ ] Payroll accuracy: PASS
- [ ] Month-end close: PASS
- [ ] Backups: PASS
- [ ] Monitoring: PASS
- [ ] Security: PASS

FINAL VERDICT:
[ ] READY FOR PRODUCTION
[ ] NOT READY (fails identified, see below)

FAILURES & ISSUES:
(List any FAIL items above with severity and remediation)
```

---

## APPENDIX: TEST EXECUTION TRACKING

Use this section to record test results:

**Date:** ___________  
**Tester:** ___________  
**Build:** ___________  

### Results Summary
- Total tests: ___
- Passed: ___
- Failed: ___
- Blocked: ___
- Pass rate: ___%

### Critical Failures
(List any failures in critical items)

### Recommendations
(Improvements, nice-to-haves for future releases)

### Sign-Off
- Tester: _________________________ Date: _______
- QA Lead: _________________________ Date: _______
- Product Owner: __________________ Date: _______

---

**END OF AUDIT DOCUMENT**
