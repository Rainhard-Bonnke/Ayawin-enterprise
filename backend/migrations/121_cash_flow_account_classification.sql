ALTER TABLE erp_chart_of_accounts
  ADD COLUMN IF NOT EXISTS cash_flow_activity TEXT NOT NULL DEFAULT 'operating'
    CHECK (cash_flow_activity IN ('operating', 'investing', 'financing', 'exclude'));

UPDATE erp_chart_of_accounts
SET cash_flow_activity = 'investing', updated_at = NOW()
WHERE account_code LIKE '15%' AND account_type = 'asset'
  AND cash_flow_activity = 'operating' AND is_deleted = FALSE;

UPDATE erp_chart_of_accounts
SET cash_flow_activity = 'financing', updated_at = NOW()
WHERE (account_type = 'equity' OR (account_type = 'liability' AND account_code LIKE '23%'))
  AND cash_flow_activity = 'operating' AND is_deleted = FALSE;

COMMENT ON COLUMN erp_chart_of_accounts.cash_flow_activity IS
  'Cash flow statement classification for counterpart GL movements; finance administrators may correct the default classification.';