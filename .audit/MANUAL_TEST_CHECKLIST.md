# Martin Enterprise ERP - Manual Test Execution Checklist

**Audit Date:** June 2, 2026  
**Test Environment:** Local Development (localhost:4000 API, localhost:3000 Frontend)  
**Tester:** Production Readiness Audit Team  

---

## PRE-TEST REQUIREMENTS

- [ ] Backend API running on port 4000
- [ ] Frontend running on port 3000
- [ ] Database (PostgreSQL) running and accessible
- [ ] .env configured with test credentials
- [ ] Test data seeded (if using demo mode)
- [ ] Browser: Chrome/Firefox (latest)
- [ ] Network: Internet connection for external APIs
- [ ] Time allocated: 4-6 hours

---

## PHASE 1: MODULE COMPLETENESS - MANUAL VERIFICATION

### 1.1 Authentication Module

#### Test Case 1.1.1: Login Flow
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to `http://localhost:3000/login`
2. Enter email: `admin@martin.local`
3. Enter password: `admin123`
4. Click "Login"
5. Verify: Redirected to dashboard with user menu visible

**Expected Result:** Login successful, JWT token in localStorage  
**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.1.2: Login with Wrong Password
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to login page
2. Enter email: `admin@martin.local`
3. Enter password: `wrongpassword`
4. Click "Login"
5. Verify: Error message shown (not stack trace)

**Expected Result:** "Invalid credentials" message, no system error exposed  
**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.1.3: Password Reset Flow
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. On login page, click "Forgot Password?"
2. Enter email: `admin@martin.local`
3. Click "Send Reset Link"
4. Check email (or demo inbox)
5. Click reset link
6. Enter new password
7. Verify: Can log in with new password

**Expected Result:** Password reset works end-to-end  
**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.1.4: Session Timeout
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Log in successfully
2. Leave browser idle for > JWT expiry time (configured as 8h)
3. Try to access any page
4. Verify: Redirected to login page

**Expected Result:** Session expires and forces re-login  
**Actual Result:** ________________  
**Notes:** For this test, you may need to manually modify JWT expiry to shorter time or fake timeout  

---

### 1.2 Sales Module - CRUD Operations

#### Test Case 1.2.1: Create Sales Order
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Log in as Sales Rep
2. Navigate to Sales → Sales Orders
3. Click "New Order"
4. Select Customer: Pick any active customer from dropdown
5. Select Warehouse: Any warehouse
6. Add Line Item:
   - Product: Select a product (e.g., "Tusker Lager")
   - Quantity: 100
   - Unit Price: Should auto-populate from product master
7. Click "Add Line"
8. Verify: Subtotal, VAT (16%), Excise calculated
9. Review: Order total = Subtotal + VAT + Excise
10. Click "Save"

**Expected Result:**
- Sales order created with unique order number (SO-2024-XXXXX)
- Status: Draft
- All calculated fields correct
- Audit log entry created

**Actual Result:** ________________  
**Calculation Check:**
- Subtotal: ___ KES
- VAT (16%): ___ KES  
- Excise: ___ KES
- **Total: ___ KES**

**Notes:** ________________  

---

#### Test Case 1.2.2: Confirm Sales Order (ATP Check)
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. From draft order created above, click "Confirm"
2. System should check Available-to-Promise (ATP)
3. If ATP sufficient: Order moves to "Confirmed" status
4. If ATP insufficient: Show error "Insufficient stock for [Product]"

**Expected Result:** Order confirms if stock available, blocked if not  
**ATP Check Passed:** [ ] YES [ ] NO [ ] BLOCKED_INSUFFICIENT_STOCK
**Stock Level Before:** ___ units  
**Stock Level After:** ___ units  

**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.2.3: Create Delivery Order
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. From confirmed sales order, click "Create Delivery"
2. Verify: Order details pre-filled
3. Select Warehouse
4. Click "Create Delivery Order"

**Expected Result:** Delivery order created, status = "Draft"  
**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.2.4: Record Proof of Delivery (POD)
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. From delivery order, click "Mark as Delivered"
2. Upload/sign POD:
   - Enter signature (or draw on canvas if available)
   - Optionally upload photo
3. Click "Confirm Delivery"

**Expected Result:** 
- Delivery status: "Delivered"
- Sales order status: "Delivered"
- Can now invoice

**Actual Result:** ________________  
**Notes:** ________________  

---

### 1.3 Invoicing Module

#### Test Case 1.3.1: Auto-Generate Invoice from Delivered Order
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Invoices
2. Click "New Invoice"
3. Select delivered sales order from dropdown
4. Verify: All line items populated with correct quantities and prices
5. VAT and excise calculated correctly
6. Click "Save"

**Expected Result:**
- Invoice created with unique invoice number (INV-2024-XXXXX)
- Invoice number never reused
- VAT: Correct amount
- Excise: Correct amount
- Status: Draft

**Invoice Number:** __________  
**VAT Amount:** ___ KES  
**Excise Amount:** ___ KES  
**Total:** ___ KES  

**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.3.2: Post Invoice to General Ledger
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. From invoice created above, click "Post"
2. Verify: Status changes to "Confirmed"
3. Journal entry created automatically

**Expected Result:**
- Debit: Accounts Receivable = Invoice Total
- Credit: Sales Revenue = Subtotal
- Credit: VAT Payable = VAT Amount
- Credit: Excise Payable = Excise Amount
- Balanced (Debit Total = Credit Total)

**GL Entry Verification:**
- [ ] AR account debited: ___ KES
- [ ] Sales account credited: ___ KES
- [ ] VAT account credited: ___ KES
- [ ] Excise account credited: ___ KES
- [ ] Balanced: YES / NO

**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.3.3: Generate Invoice PDF
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Open posted invoice
2. Click "Download PDF"
3. Open PDF in Adobe Reader or browser
4. Verify content:
   - [ ] Company logo visible
   - [ ] Company name, address, KRA PIN
   - [ ] Invoice number and date
   - [ ] Due date
   - [ ] Customer name and address
   - [ ] All line items with description, qty, unit price, amount
   - [ ] Subtotal
   - [ ] VAT line with amount
   - [ ] Excise duty line with amount
   - [ ] Grand total
   - [ ] Payment terms
   - [ ] Bank details
5. Print preview (Ctrl+P) - verify no cut-off text

**Expected Result:** Professional, complete invoice PDF  
**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.3.4: Record Payment
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Open invoice (unpaid)
2. Click "Record Payment"
3. Enter:
   - Payment amount: (full or partial)
   - Payment date: Today
   - Payment method: Bank Transfer
   - Reference: (e.g., bank transaction number)
4. Click "Save"

**Expected Result:**
- Payment recorded
- Outstanding balance updates
- Journal entry posted: Debit Bank, Credit AR
- Invoice status: Paid (if full payment)

**Payment Amount:** ___ KES  
**Previous Outstanding:** ___ KES  
**New Outstanding:** ___ KES  

**Actual Result:** ________________  
**Notes:** ________________  

---

### 1.4 Inventory Module

#### Test Case 1.4.1: Check Stock Levels
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Inventory → Stock Status
2. Verify stock levels display for all products:
   - Product name
   - SKU
   - Quantity on hand
   - Reorder level
   - Warehouse location
3. Search for specific product by name/SKU
4. Filter by warehouse

**Expected Result:** Real stock levels displayed, not hardcoded  
**Sample Check:**
- Product: "Tusker Lager" Stock: ___ units
- Product: "Smirnoff" Stock: ___ units

**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.4.2: Stock Movement on Sales Order Confirmation
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Check current stock of "Product A": ___ units
2. Create and confirm sales order for 50 units of "Product A"
3. Check stock again: Should be reduced by 50
4. Verify: Stock Movement ledger shows the transaction

**Expected Result:**
- Before: ___ units
- After: ___ units (should be Before - 50)
- Movement record shows: Sales Order #SO-XXXX, Issue, -50 units

**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.4.3: Batch/Lot Tracking
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Inventory → Batch Management (if feature exists)
2. Create batch for product:
   - Batch number: BAT-001
   - Expiry date: June 2028
3. Record receipt: 100 units
4. Issue 30 units from this batch
5. Verify: Remaining = 70 units of BAT-001

**Expected Result:** Batch tracked separately with expiry dates  
**Actual Result:** ________________  
**Notes:** ________________  

---

### 1.5 Finance / Accounting Module

#### Test Case 1.5.1: Trial Balance
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Reports → Trial Balance
2. Select period: Current month
3. View report

**Expected Result:**
- Total Debits = Total Credits (difference = 0.00)
- All accounts listed with balances
- No orphaned accounts

**Total Debits:** ___ KES  
**Total Credits:** ___ KES  
**Difference:** ___ KES (should be 0.00)

**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.5.2: General Ledger Report
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Reports → General Ledger
2. Select date range: Current month
3. View all accounts with activity
4. Click on specific account to see detail

**Expected Result:**
- All accounts with transactions shown
- Opening balance + transactions = closing balance
- Drill-down to journal entries works

**Account Checked:** _________  
**Opening Balance:** ___ KES  
**Debits:** ___ KES  
**Credits:** ___ KES  
**Closing Balance:** ___ KES  

**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.5.3: Profit & Loss Statement
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Reports → P&L Statement
2. Select period: Current month
3. Verify structure:
   - Income section (Sales Revenue, Other Income)
   - Expense section (Salaries, COGS, Rent, etc.)
   - Net Income = Total Income - Total Expenses

**Expected Result:**
- P&L correctly calculated
- Revenue matches sum of invoices
- Expenses match GL accounts
- Format professional

**Total Income:** ___ KES  
**Total Expenses:** ___ KES  
**Net Income (Loss):** ___ KES  

**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.5.4: Balance Sheet
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Reports → Balance Sheet
2. Select date: End of current month
3. Verify:
   - Assets section
   - Liabilities section
   - Equity section
4. Verify: Assets = Liabilities + Equity

**Assets Total:** ___ KES  
**Liabilities Total:** ___ KES  
**Equity Total:** ___ KES  
**Check (Assets - Liab - Equity):** ___ KES (should be 0.00)  

**Actual Result:** ________________  
**Notes:** ________________  

---

### 1.6 VAT & Excise Duty

#### Test Case 1.6.1: VAT Report
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Reports → VAT Report
2. Select period: Current month
3. View:
   - VAT collected on sales
   - VAT on purchases
   - Net VAT due

**Expected Result:**
- VAT collected = 16% × all sales amounts
- VAT paid = 16% × all purchase amounts
- Net VAT = Collected - Paid
- Report matches invoice line items

**VAT Collected:** ___ KES  
**VAT Paid:** ___ KES  
**Net VAT Due:** ___ KES  

**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.6.2: Excise Duty Report
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Reports → Excise Duty Report
2. Select period: Current month
3. View by category:
   - Beer
   - Spirits
   - Wine
   - Soft Drinks

**Expected Result:**
- Correct rates applied per category
- Total excise matches sum of invoice excise lines
- Matches KRA submission format

**Total Excise:** ___ KES  

**Actual Result:** ________________  
**Notes:** ________________  

---

### 1.7 HR & Payroll Module

#### Test Case 1.7.1: Employee Records
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to HR → Employees
2. Click "New Employee"
3. Fill form:
   - Name: Test Employee
   - National ID: (valid format)
   - KRA PIN: (11 chars)
   - NHIF Number
   - NSSF Number
   - Department: (select from dropdown)
   - Job Title
   - Date Hired
   - Base Salary: 50,000 KES
   - Bank Account
4. Save

**Expected Result:** Employee created with all fields validated  
**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.7.2: Payroll Computation
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Payroll → New Payroll Run
2. Select period: June 2026
3. Click "Compute"
4. Verify calculations for Employee A (50,000 KES base):
   - PAYE: Check against Kenya 2026 tax table
   - NHIF: Check against NHIF rate schedule
   - NSSF: 200 KES (capped)
   - Housing Levy: 1.5% = 750 KES
   - Net = 50,000 - PAYE - NHIF - 200 - 750

**Expected Result:** All deductions calculated correctly  
**Actual Calculations:**
- Gross: 50,000 KES
- PAYE: ___ KES
- NHIF: ___ KES
- NSSF: 200 KES
- Housing Levy: 750 KES
- **Net: ___ KES**

**Verification:** Manual check against Kenya tax tables: [ ] CORRECT [ ] INCORRECT  

**Actual Result:** ________________  
**Notes:** ________________  

---

#### Test Case 1.7.3: Payslip Generation
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. From payroll run, click "Generate Payslips"
2. Select format: PDF
3. Verify payslip content:
   - Employee name
   - Period: June 2026
   - Gross breakdown
   - All deductions itemized
   - Net salary
   - YTD totals
4. Download and open PDF

**Expected Result:** Professional payslip PDF, all data correct  
**Actual Result:** ________________  
**Notes:** ________________  

---

## PHASE 2: REAL-TIME DATA AUDIT

### Test Case 2.1: Stock Update in Real-Time
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Open Inventory page in Browser A
2. Open same page in Browser B
3. In Browser A: Create and confirm sales order (10 units)
4. In Browser B: Observe stock level - should update within 3 seconds WITHOUT refresh

**Expected Result:** Stock updates in real-time without page refresh  
**Time to Update:** ___ seconds  
**Actual Result:** ________________  
**Notes:** ________________  

---

### Test Case 2.2: Polling Fallback
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Open app in browser
2. DevTools → Network → Simulate offline
3. Try to update a form field
4. Go online again
5. Observe: Should reconnect silently with "Reconnecting..." indicator

**Expected Result:** Graceful reconnection without error  
**Actual Result:** ________________  
**Notes:** ________________  

---

## PHASE 3: PERFORMANCE TESTING

### Test Case 3.1: Dashboard Load Time
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Clear browser cache (Ctrl+Shift+Delete)
2. Navigate to dashboard
3. Measure time from click to full page loaded (all KPIs visible)
4. Check DevTools → Performance tab

**Expected Result:** Load time < 2 seconds  
**Actual Load Time:** ___ ms  
**Target:** 2000 ms  
**Status:** [ ] PASS [ ] FAIL  

**Actual Result:** ________________  
**Notes:** ________________  

---

### Test Case 3.2: List View Load Time
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to Sales → Orders (list of 100+ orders)
2. Measure load time

**Expected Result:** < 2 seconds  
**Actual Load Time:** ___ ms  
**Status:** [ ] PASS [ ] FAIL  

**Actual Result:** ________________  
**Notes:** ________________  

---

### Test Case 3.3: Form Submit Time
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Create new sales order form
2. Fill all fields
3. Click Save
4. Measure from click to confirmation toast

**Expected Result:** < 1 second  
**Actual Time:** ___ ms  
**Status:** [ ] PASS [ ] FAIL  

**Actual Result:** ________________  
**Notes:** ________________  

---

## PHASE 4: SECURITY AUDIT

### Test Case 4.1: SQL Injection Prevention
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Navigate to customer search
2. Try: `' OR '1'='1`
3. Verify: Treated as literal text (no SQL error)

**Expected Result:** No SQL error exposed  
**Actual Result:** ________________  
**Notes:** ________________  

---

### Test Case 4.2: XSS Prevention
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Create order/customer with name: `<img src=x onerror=alert('XSS')>`
2. Save and view list
3. Verify: No JavaScript executed, text rendered as-is

**Expected Result:** No alert shown, text escaped  
**Actual Result:** ________________  
**Notes:** ________________  

---

### Test Case 4.3: Authentication Required
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Log out (or clear JWT from localStorage)
2. Try to access API directly: `curl http://localhost:4000/api/v1/sales/orders`
3. Verify: Returns 401 Unauthorized

**Expected Result:** 401 without data exposure  
**Actual Result:** ________________  
**Notes:** ________________  

---

### Test Case 4.4: Authorization Enforced
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Log in as Sales Rep
2. Try to access payroll endpoints
3. Verify: Returns 403 Forbidden

**Expected Result:** Access denied, not 404  
**Actual Result:** ________________  
**Notes:** ________________  

---

## PHASE 5: DATA ACCURACY AUDIT

### Test Case 5.1: Financial Simulation (Complete Cycle)
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Setup:** Clear all transactional data for testing  

**Execution:**
1. Create 5 sales invoices:
   - Invoice 1: 100,000 KES
   - Invoice 2: 50,000 KES
   - Invoice 3: 75,000 KES
   - Invoice 4: 150,000 KES
   - Invoice 5: 25,000 KES
   - **Total:** 400,000 KES

2. Record payments:
   - Payment 1: 100,000 KES (Invoice 1, full)
   - Payment 2: 50,000 KES (Invoice 2, full)
   - Payment 3: 40,000 KES (Invoice 3, partial)
   - **Total Paid:** 190,000 KES

3. Outstanding:
   - Invoice 3: 35,000 KES (remaining)
   - Invoice 4: 150,000 KES
   - Invoice 5: 25,000 KES
   - **Total Outstanding:** 210,000 KES

**Verification:**
- AR balance should equal: 210,000 KES
- Check: Dashboard AR card vs sum of unpaid invoices
- Difference: ___ KES (should be 0.00)

**Actual Result:** ________________  
**Notes:** ________________  

---

### Test Case 5.2: Inventory Accuracy
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED

**Initial Stock:** 
- Product A: 500 units

**Transactions:**
1. Sale: -100 units
2. Purchase GRN: +200 units
3. Adjustment: -10 units (damage)

**Expected Final:** 500 - 100 + 200 - 10 = 590 units

**Verification:**
- Actual system stock: ___ units
- Expected: 590 units
- Variance: ___ units (should be 0)

**Actual Result:** ________________  
**Notes:** ________________  

---

## PHASE 6: UI/UX & USABILITY

### Test Case 6.1: Responsive Design - Mobile
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. DevTools → Toggle device toolbar
2. Select iPhone 12 (375px)
3. Navigate to Dashboard
4. Verify:
   - No horizontal scrollbar
   - Touch targets ≥ 48px
   - Text readable
   - Buttons clickable

**Expected Result:** Fully responsive, no layout issues  
**Actual Result:** ________________  
**Notes:** ________________  

---

### Test Case 6.2: Error Messages
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Try to create order with empty customer field
2. Try to create invoice with amount = 0
3. Verify: Human-readable error messages (not technical jargon)

**Expected Result:** User-friendly error messages  
**Actual Result:** ________________  
**Notes:** ________________  

---

## PHASE 7: END-TO-END FLOW TESTS

### Flow 1: Complete Sales Cycle
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Scenario:** Customer → Order → Delivery → Invoice → Payment → AR Update

**Checklist:**
- [ ] New customer created with credit limit
- [ ] Sales order created (within credit limit)
- [ ] Order confirmed (ATP check passed)
- [ ] Delivery created and POD recorded
- [ ] Invoice generated
- [ ] Journal entry posted correctly
- [ ] Payment recorded
- [ ] Outstanding balance updated
- [ ] Dashboard KPIs reflect changes

**Final Status:** [ ] ALL PASS [ ] SOME FAIL  
**Actual Result:** ________________  
**Notes:** ________________  

---

### Flow 2: Payroll Cycle
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Scenario:** Attendance → Leave Approval → Payroll Compute → Posting → Distribution

**Checklist:**
- [ ] Employee attendance recorded
- [ ] Leave approved
- [ ] Payroll computed (all deductions correct)
- [ ] Manager approval obtained
- [ ] Payslips generated
- [ ] Bank file created
- [ ] Journal entries posted
- [ ] P&L shows salary expense

**Final Status:** [ ] ALL PASS [ ] SOME FAIL  
**Actual Result:** ________________  
**Notes:** ________________  

---

### Flow 3: Month-End Close
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Scenario:** Period close, reporting, GL finalization

**Checklist:**
- [ ] All transactions finalized
- [ ] VAT report generated and verified
- [ ] Excise duty report generated
- [ ] Bank reconciliation done
- [ ] Trial balance balanced (difference = 0.00)
- [ ] P&L generated
- [ ] Balance sheet generated (Assets = Liab + Equity)
- [ ] Period marked closed

**Final Status:** [ ] ALL PASS [ ] SOME FAIL  
**Actual Result:** ________________  
**Notes:** ________________  

---

## PHASE 8: DEPLOYMENT READINESS

### Test Case 8.1: Database Backup & Restore
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Steps:**
1. Take database backup
2. Restore to staging/test database
3. Verify data integrity:
   - [ ] Row counts match
   - [ ] Foreign keys intact
   - [ ] Audit logs complete

**Expected Result:** Full recovery possible  
**Actual Result:** ________________  
**Notes:** ________________  

---

### Test Case 8.2: Environment Configuration
**Status:** [ ] TODO [ ] IN PROGRESS [ ] COMPLETE [ ] FAILED
**Checks:**
- [ ] .env file not in .git history
- [ ] All secrets in environment variables
- [ ] No hardcoded API keys
- [ ] Debug mode OFF
- [ ] HTTPS enforced

**Expected Result:** Secure configuration  
**Actual Result:** ________________  
**Notes:** ________________  

---

## FINAL SIGN-OFF

### Summary Results

| Phase | Status | Pass Rate | Critical Issues |
|-------|--------|-----------|-----------------|
| 1. Module Completeness | [ ] PASS [ ] FAIL | ___% | ___ |
| 2. Real-Time Data | [ ] PASS [ ] FAIL | ___% | ___ |
| 3. Performance | [ ] PASS [ ] FAIL | ___% | ___ |
| 4. Security | [ ] PASS [ ] FAIL | ___% | ___ |
| 5. Data Accuracy | [ ] PASS [ ] FAIL | ___% | ___ |
| 6. UI/UX | [ ] PASS [ ] FAIL | ___% | ___ |
| 7. E2E Flows | [ ] PASS [ ] FAIL | ___% | ___ |
| 8. Deployment | [ ] PASS [ ] FAIL | ___% | ___ |

### Overall Verdict
[ ] READY FOR PRODUCTION
[ ] NOT READY - Issues below

### Open Issues

| # | Severity | Issue | Owner | Target Date |
|---|----------|-------|-------|-------------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

---

### Sign-Off
- **Tested By:** _________________________ Date: ______
- **QA Lead Review:** _________________________ Date: ______
- **Technical Lead:** _________________________ Date: ______
- **Product Owner:** _________________________ Date: ______
- **Go-Live Authorized:** _________________________ Date: ______

---

**END OF MANUAL TEST CHECKLIST**
