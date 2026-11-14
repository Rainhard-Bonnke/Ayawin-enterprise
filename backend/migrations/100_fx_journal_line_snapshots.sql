ALTER TABLE erp_journal_lines
  ADD COLUMN IF NOT EXISTS transaction_debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transaction_credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_debit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_credit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS exchange_rate_source TEXT,
  ADD COLUMN IF NOT EXISTS exchange_rate_effective_date DATE;

ALTER TABLE erp_journal_lines DISABLE TRIGGER erp_journal_lines_immutable;

UPDATE erp_journal_lines jl
SET base_debit = jl.debit,
    base_credit = jl.credit,
    transaction_debit = CASE
      WHEN jl.currency_code = c.base_currency_code THEN jl.debit
      ELSE GREATEST(jl.amount_foreign, 0)
    END,
    transaction_credit = CASE
      WHEN jl.currency_code = c.base_currency_code THEN jl.credit
      ELSE GREATEST(-jl.amount_foreign, 0)
    END,
    exchange_rate = CASE
      WHEN jl.currency_code = c.base_currency_code THEN 1
      ELSE j.exchange_rate
    END,
    exchange_rate_source = CASE
      WHEN jl.currency_code = c.base_currency_code THEN 'base_currency'
      ELSE 'legacy_snapshot'
    END,
    exchange_rate_effective_date = j.entry_date
FROM erp_journals j, erp_companies c
WHERE j.id = jl.journal_id
  AND c.id = jl.company_id
  AND (jl.transaction_debit = 0 AND jl.transaction_credit = 0
    AND jl.base_debit = 0 AND jl.base_credit = 0
    OR jl.exchange_rate_effective_date IS NULL);

ALTER TABLE erp_journal_lines ENABLE TRIGGER erp_journal_lines_immutable;

ALTER TABLE erp_journal_lines
  ADD CONSTRAINT erp_journal_lines_transaction_amounts_nonnegative
    CHECK (transaction_debit >= 0 AND transaction_credit >= 0),
  ADD CONSTRAINT erp_journal_lines_base_amounts_nonnegative
    CHECK (base_debit >= 0 AND base_credit >= 0),
  ADD CONSTRAINT erp_journal_lines_snapshot_single_sided
    CHECK ((transaction_debit = 0 OR transaction_credit = 0)
      AND (base_debit = 0 OR base_credit = 0)),
  ADD CONSTRAINT erp_journal_lines_snapshot_rate_positive
    CHECK (exchange_rate > 0);