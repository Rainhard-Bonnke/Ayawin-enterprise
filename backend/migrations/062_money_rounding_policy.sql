ALTER TABLE erp_sales_orders ALTER COLUMN subtotal TYPE NUMERIC(18,2) USING ROUND(subtotal,2),
 ALTER COLUMN discount_amount TYPE NUMERIC(18,2) USING ROUND(discount_amount,2),
 ALTER COLUMN tax_amount TYPE NUMERIC(18,2) USING ROUND(tax_amount,2),
 ALTER COLUMN total_amount TYPE NUMERIC(18,2) USING ROUND(total_amount,2);
ALTER TABLE erp_sales_order_lines ALTER COLUMN unit_price TYPE NUMERIC(18,2) USING ROUND(unit_price,2),
 ALTER COLUMN line_total TYPE NUMERIC(18,2) USING ROUND(line_total,2),
 ALTER COLUMN discount_amount TYPE NUMERIC(18,2) USING ROUND(discount_amount,2);
ALTER TABLE erp_customer_invoices ALTER COLUMN subtotal TYPE NUMERIC(18,2) USING ROUND(subtotal,2),
 ALTER COLUMN discount_amount TYPE NUMERIC(18,2) USING ROUND(discount_amount,2),
 ALTER COLUMN tax_amount TYPE NUMERIC(18,2) USING ROUND(tax_amount,2),
 ALTER COLUMN total_amount TYPE NUMERIC(18,2) USING ROUND(total_amount,2),
 ALTER COLUMN amount_paid TYPE NUMERIC(18,2) USING ROUND(amount_paid,2),
 ALTER COLUMN credited_amount TYPE NUMERIC(18,2) USING ROUND(credited_amount,2);
ALTER TABLE erp_customer_receipts ALTER COLUMN amount TYPE NUMERIC(18,2) USING ROUND(amount,2),
 ALTER COLUMN unapplied_amount TYPE NUMERIC(18,2) USING ROUND(unapplied_amount,2);
ALTER TABLE erp_journals ALTER COLUMN total_debit TYPE NUMERIC(18,2) USING ROUND(total_debit,2),
 ALTER COLUMN total_credit TYPE NUMERIC(18,2) USING ROUND(total_credit,2);
ALTER TABLE erp_journal_lines ALTER COLUMN debit TYPE NUMERIC(18,2) USING ROUND(debit,2),
 ALTER COLUMN credit TYPE NUMERIC(18,2) USING ROUND(credit,2);

INSERT INTO erp_system_settings(company_id,category,setting_key,setting_value,description)
SELECT id,'finance','money_rounding_policy','"half_up_line_2dp"'::jsonb,
 'Round half up to 2 decimals at each invoice line for net and tax amounts'
FROM erp_companies ON CONFLICT(company_id,category,setting_key) DO NOTHING;
