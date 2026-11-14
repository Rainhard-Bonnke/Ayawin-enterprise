ALTER TABLE erp_journal_lines
  ADD COLUMN IF NOT EXISTS exchange_rate_direction TEXT NOT NULL DEFAULT 'base_per_transaction',
  ADD COLUMN IF NOT EXISTS exchange_rate_id UUID REFERENCES erp_exchange_rates (id);

ALTER TABLE erp_journal_lines DISABLE TRIGGER erp_journal_lines_immutable;

UPDATE erp_journal_lines jl
SET exchange_rate_direction = CASE
  WHEN jl.currency_code = c.base_currency_code THEN 'base_per_transaction'
  ELSE 'legacy_unknown'
END
FROM erp_companies c
WHERE c.id = jl.company_id;

ALTER TABLE erp_journal_lines ENABLE TRIGGER erp_journal_lines_immutable;

ALTER TABLE erp_journal_lines
  ADD CONSTRAINT erp_journal_lines_exchange_rate_direction_check
    CHECK (exchange_rate_direction IN ('base_per_transaction', 'legacy_unknown'));