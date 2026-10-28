-- Make sale tax classification explicit and snapshot the applied setup per line.
ALTER TABLE erp_tax_groups
  ADD COLUMN tax_treatment TEXT NOT NULL DEFAULT 'standard'
  CHECK (tax_treatment IN ('standard', 'zero_rated', 'exempt', 'out_of_scope'));

ALTER TABLE erp_tax_rates
  ADD COLUMN effective_from DATE NOT NULL DEFAULT DATE '1900-01-01',
  ADD COLUMN effective_to DATE,
  ADD CONSTRAINT erp_tax_rates_effective_range_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE erp_tax_rates ALTER COLUMN effective_from SET DEFAULT CURRENT_DATE;
ALTER TABLE erp_tax_rates DROP CONSTRAINT IF EXISTS erp_tax_rates_company_id_code_key;
ALTER TABLE erp_tax_rates
  ADD CONSTRAINT erp_tax_rates_company_code_effective_unique UNIQUE (company_id, code, effective_from);

ALTER TABLE erp_sales_order_lines
  ADD COLUMN tax_group_id UUID REFERENCES erp_tax_groups (id),
  ADD COLUMN tax_rate_id UUID REFERENCES erp_tax_rates (id),
  ADD COLUMN tax_code TEXT NOT NULL DEFAULT 'VAT16',
  ADD COLUMN tax_treatment TEXT NOT NULL DEFAULT 'standard'
    CHECK (tax_treatment IN ('standard', 'zero_rated', 'exempt', 'out_of_scope')),
  ADD COLUMN tax_rate NUMERIC(12, 6) NOT NULL DEFAULT 16,
  ADD COLUMN tax_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE erp_customer_invoice_lines
  ADD COLUMN tax_group_id UUID REFERENCES erp_tax_groups (id),
  ADD COLUMN tax_rate_id UUID REFERENCES erp_tax_rates (id),
  ADD COLUMN tax_code TEXT NOT NULL DEFAULT 'VAT16',
  ADD COLUMN tax_treatment TEXT NOT NULL DEFAULT 'standard'
    CHECK (tax_treatment IN ('standard', 'zero_rated', 'exempt', 'out_of_scope')),
  ADD COLUMN tax_rate NUMERIC(12, 6) NOT NULL DEFAULT 16;

INSERT INTO erp_tax_rates (company_id, code, name, rate, tax_type, basis)
SELECT c.id, 'VAT16', 'VAT standard rate', 16, 'vat', 'percentage'
FROM erp_companies c
WHERE NOT EXISTS (SELECT 1 FROM erp_tax_rates r WHERE r.company_id = c.id AND r.code = 'VAT16');

INSERT INTO erp_tax_rates (company_id, code, name, rate, tax_type, basis)
SELECT c.id, 'VAT0', 'VAT zero rate', 0, 'vat', 'percentage'
FROM erp_companies c
WHERE NOT EXISTS (SELECT 1 FROM erp_tax_rates r WHERE r.company_id = c.id AND r.code = 'VAT0');

INSERT INTO erp_tax_groups (company_id, code, name, tax_treatment)
SELECT c.id, v.code, v.name, v.tax_treatment
FROM erp_companies c
CROSS JOIN (VALUES
  ('STD-VAT', 'Standard VAT', 'standard'),
  ('ZERO', 'Zero-rated supply', 'zero_rated'),
  ('EXEMPT', 'Exempt supply', 'exempt')
) AS v(code, name, tax_treatment)
WHERE NOT EXISTS (
  SELECT 1 FROM erp_tax_groups g WHERE g.company_id = c.id AND g.code = v.code
);

UPDATE erp_tax_groups SET tax_treatment = 'zero_rated'
WHERE code = 'ZERO' AND tax_treatment = 'standard';
UPDATE erp_tax_groups SET tax_treatment = 'exempt'
WHERE code = 'EXEMPT' AND tax_treatment = 'standard';

INSERT INTO erp_tax_group_rates (company_id, tax_group_id, tax_rate_id)
SELECT g.company_id, g.id, r.id
FROM erp_tax_groups g
JOIN erp_tax_rates r ON r.company_id = g.company_id
  AND r.code = CASE WHEN g.tax_treatment = 'zero_rated' THEN 'VAT0' ELSE 'VAT16' END
WHERE g.code IN ('STD-VAT', 'ZERO')
  AND NOT EXISTS (
    SELECT 1 FROM erp_tax_group_rates gr
    WHERE gr.tax_group_id = g.id AND gr.tax_rate_id = r.id
  );

-- Existing sales used a fixed 16% calculation. Default previously unclassified
-- saleable items to that existing treatment; finance should review exceptions.
UPDATE erp_items i
SET tax_group_id = g.id
FROM erp_tax_groups g
WHERE i.company_id = g.company_id AND g.code = 'STD-VAT'
  AND i.tax_group_id IS NULL AND i.is_saleable = TRUE AND i.is_deleted = FALSE;

UPDATE erp_sales_order_lines sol
SET tax_group_id = i.tax_group_id,
    tax_rate_id = r.id,
    tax_code = r.code,
    tax_treatment = g.tax_treatment,
    tax_rate = r.rate,
    tax_amount = ROUND(sol.quantity * sol.unit_price * r.rate / 100, 2)
FROM erp_items i
JOIN erp_tax_groups g ON g.id = i.tax_group_id AND g.company_id = i.company_id
JOIN erp_tax_group_rates gr ON gr.tax_group_id = g.id AND gr.company_id = i.company_id
JOIN erp_tax_rates r ON r.id = gr.tax_rate_id AND r.company_id = i.company_id
WHERE sol.item_id = i.id AND sol.company_id = i.company_id AND r.tax_type = 'vat';

UPDATE erp_customer_invoice_lines il
SET tax_group_id = i.tax_group_id,
    tax_rate_id = r.id,
    tax_code = r.code,
    tax_treatment = g.tax_treatment,
    tax_rate = r.rate
FROM erp_items i
JOIN erp_tax_groups g ON g.id = i.tax_group_id AND g.company_id = i.company_id
JOIN erp_tax_group_rates gr ON gr.tax_group_id = g.id AND gr.company_id = i.company_id
JOIN erp_tax_rates r ON r.id = gr.tax_rate_id AND r.company_id = i.company_id
WHERE il.item_id = i.id AND il.company_id = i.company_id AND r.tax_type = 'vat';
