ALTER TABLE erp_stocktake_sessions
  ADD COLUMN IF NOT EXISTS journal_id UUID REFERENCES erp_journals(id);

INSERT INTO erp_chart_of_accounts
  (company_id, account_code, account_name, account_type, level, is_postable, is_active)
SELECT id, '5200', 'Inventory Count Adjustments', 'expense', 1, TRUE, TRUE
FROM erp_companies
ON CONFLICT (company_id, account_code) DO NOTHING;
