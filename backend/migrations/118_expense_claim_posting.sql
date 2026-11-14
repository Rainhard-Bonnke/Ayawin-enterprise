ALTER TABLE erp_expense_claims
  ADD COLUMN IF NOT EXISTS approval_journal_id UUID REFERENCES erp_journals (id),
  ADD COLUMN IF NOT EXISTS payment_journal_id UUID REFERENCES erp_journals (id);

CREATE UNIQUE INDEX IF NOT EXISTS erp_expense_claims_approval_journal_uidx
  ON erp_expense_claims (approval_journal_id)
  WHERE approval_journal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS erp_expense_claims_payment_journal_uidx
  ON erp_expense_claims (payment_journal_id)
  WHERE payment_journal_id IS NOT NULL;

INSERT INTO erp_chart_of_accounts (
  company_id, parent_id, account_code, account_name, account_type,
  level, is_postable, currency_code, is_active
)
SELECT company.id, parent.id, account.account_code, account.account_name,
       account.account_type, parent.level + 1, TRUE,
       company.base_currency_code, TRUE
FROM erp_companies company
JOIN (VALUES
  ('2000', '2180', 'Employee Reimbursements Payable', 'liability'),
  ('6000', '6300', 'General Employee Expenses', 'expense'),
  ('6000', '6310', 'Travel Expense', 'expense'),
  ('6000', '6320', 'Meals Expense', 'expense'),
  ('6000', '6330', 'Mileage Expense', 'expense'),
  ('6000', '6340', 'Per Diem Expense', 'expense')
) AS account(parent_code, account_code, account_name, account_type) ON TRUE
JOIN erp_chart_of_accounts parent
  ON parent.company_id = company.id
 AND parent.account_code = account.parent_code
 AND parent.is_deleted = FALSE
WHERE company.is_deleted = FALSE
ON CONFLICT (company_id, account_code) DO NOTHING;

UPDATE erp_expense_categories category
SET expense_account_id = account.id,
    updated_at = NOW()
FROM erp_chart_of_accounts account
WHERE account.company_id = category.company_id
  AND account.account_code = CASE category.code
    WHEN 'TRAVEL' THEN '6310'
    WHEN 'MEALS' THEN '6320'
    WHEN 'MILEAGE' THEN '6330'
    WHEN 'PER_DIEM' THEN '6340'
    ELSE '6300'
  END
  AND account.is_active = TRUE
  AND account.is_deleted = FALSE
  AND category.expense_account_id IS NULL;