ALTER TABLE erp_customer_invoices
  DROP CONSTRAINT IF EXISTS erp_customer_invoices_status_check,
  DROP CONSTRAINT IF EXISTS erp_customer_invoices_status_chk;

ALTER TABLE erp_customer_invoices
  ADD CONSTRAINT erp_customer_invoices_status_check
  CHECK (status IN ('draft', 'posted', 'paid', 'partial', 'overdue', 'cancelled', 'void'));

DO $$
DECLARE
  target_company_id UUID;
  target_journal RECORD;
  reversal_journal_id UUID;
BEGIN
  SELECT id INTO target_company_id
  FROM erp_companies
  WHERE code = 'MARTIN';

  IF target_company_id IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM erp_payroll_remittance_payments
  WHERE company_id = target_company_id
    AND (
      journal_id IN (
        SELECT id FROM erp_journals
        WHERE company_id = target_company_id
          AND journal_no IN ('JE-2026-0001', 'JE-2026-0002', 'JE-2026-0003')
      )
      OR remittance_id IN (
        SELECT remittance.id
        FROM erp_payroll_statutory_remittances remittance
        JOIN erp_payroll_runs run ON run.id = remittance.payroll_run_id
        WHERE run.company_id = target_company_id
          AND run.run_no IN ('PR-2026-05', 'PR-2026-11', 'PR-2026-12')
      )
    );

  DELETE FROM erp_payroll_statutory_remittances
  WHERE company_id = target_company_id
    AND payroll_run_id IN (
      SELECT id FROM erp_payroll_runs
      WHERE company_id = target_company_id
        AND run_no IN ('PR-2026-05', 'PR-2026-11', 'PR-2026-12')
    );

  DELETE FROM erp_payroll_inputs
  WHERE company_id = target_company_id
    AND (
      consumed_by_run_id IN (
        SELECT id FROM erp_payroll_runs
        WHERE company_id = target_company_id
          AND run_no IN ('PR-2026-05', 'PR-2026-11', 'PR-2026-12')
      )
      OR employee_id IN (
        SELECT id FROM erp_employees
        WHERE company_id = target_company_id
          AND (employee_code ~ '^E[0-9]{3}$' OR employee_code LIKE 'PII-%')
      )
    );

  UPDATE erp_payroll_runs
  SET status = 'cancelled', is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND run_no IN ('PR-2026-05', 'PR-2026-11', 'PR-2026-12');

  DELETE FROM erp_stock_ledger
  WHERE company_id = target_company_id
    AND (
      (reference_type = 'goods_receipt' AND reference_id IN (
        SELECT id FROM erp_goods_receipts
        WHERE company_id = target_company_id AND grn_number = 'GRN-2026-0001'
      ))
      OR (reference_type = 'delivery_note' AND reference_id IN (
        SELECT id FROM erp_delivery_notes
        WHERE company_id = target_company_id AND delivery_no = 'DN-2026-0001'
      ))
    );

  UPDATE erp_stock_on_hand
  SET quantity = 0, is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND warehouse_id IN (
      SELECT id FROM erp_warehouses
      WHERE company_id = target_company_id
        AND code IN ('WH-NRB', 'WH-MBA', 'WH-KSM')
    );

  UPDATE erp_customer_invoices
  SET status = 'void', void_reason = 'Demo fixture cleanup', voided_at = COALESCE(voided_at, NOW()),
      is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id AND invoice_no = 'INV-2026-0001';

  UPDATE erp_delivery_note_lines
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND delivery_note_id IN (
      SELECT id FROM erp_delivery_notes
      WHERE company_id = target_company_id AND delivery_no = 'DN-2026-0001'
    );

  UPDATE erp_delivery_notes
  SET status = 'cancelled', is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id AND delivery_no = 'DN-2026-0001';

  UPDATE erp_sales_order_lines
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND sales_order_id IN (
      SELECT id FROM erp_sales_orders
      WHERE company_id = target_company_id AND order_no = 'SO-2026-0001'
    );

  UPDATE erp_sales_orders
  SET status = 'cancelled', is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id AND order_no = 'SO-2026-0001';

  UPDATE erp_quotation_lines
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND quotation_id IN (
      SELECT id FROM erp_quotations
      WHERE company_id = target_company_id AND quote_no = 'QT-2026-0001'
    );

  UPDATE erp_quotations
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id AND quote_no = 'QT-2026-0001';

  UPDATE erp_opportunities
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id AND opportunity_no = 'OPP-001';

  UPDATE erp_leads
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id AND lead_no IN ('LD-001', 'LD-002');

  UPDATE erp_goods_receipt_lines
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND goods_receipt_id IN (
      SELECT id FROM erp_goods_receipts
      WHERE company_id = target_company_id AND grn_number = 'GRN-2026-0001'
    );

  UPDATE erp_goods_receipts
  SET status = 'cancelled', is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id AND grn_number = 'GRN-2026-0001';

  UPDATE erp_purchase_order_lines
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND purchase_order_id IN (
      SELECT id FROM erp_purchase_orders
      WHERE company_id = target_company_id AND po_number = 'PO-2026-0001'
    );

  UPDATE erp_purchase_orders
  SET status = 'cancelled', is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id AND po_number = 'PO-2026-0001';

  UPDATE erp_purchase_requisition_lines
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND requisition_id IN (
      SELECT id FROM erp_purchase_requisitions
      WHERE company_id = target_company_id AND requisition_no = 'PR-2026-0001'
    );

  UPDATE erp_purchase_requisitions
  SET status = 'cancelled', is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id AND requisition_no = 'PR-2026-0001';

  FOR target_journal IN
    SELECT * FROM erp_journals
    WHERE company_id = target_company_id
      AND journal_no IN ('JE-2026-0001', 'JE-2026-0002', 'JE-2026-0003')
      AND status = 'posted'
    FOR UPDATE
  LOOP
    SELECT id INTO reversal_journal_id
    FROM erp_journals
    WHERE reversal_of_id = target_journal.id;

    IF reversal_journal_id IS NULL THEN
      INSERT INTO erp_journals (
        company_id, fiscal_period_id, branch_id, journal_no, journal_type, entry_date,
        reference_no, description, currency_code, exchange_rate, status, source_type,
        source_id, total_debit, total_credit, reversal_of_id, created_by
      ) VALUES (
        target_journal.company_id, target_journal.fiscal_period_id, target_journal.branch_id,
        'REV-DEMO-' || target_journal.journal_no, target_journal.journal_type,
        target_journal.entry_date, target_journal.journal_no,
        'Demo fixture cleanup reversal for ' || target_journal.journal_no,
        target_journal.currency_code, target_journal.exchange_rate, 'draft',
        'demo_cleanup_reversal', target_journal.id, target_journal.total_credit,
        target_journal.total_debit, target_journal.id, target_journal.created_by
      ) RETURNING id INTO reversal_journal_id;

      INSERT INTO erp_journal_lines (
        company_id, journal_id, line_no, account_id, description, debit, credit,
        currency_code, amount_foreign, cost_centre, department, project_code
      )
      SELECT company_id, reversal_journal_id, line_no, account_id,
             'Reversal: ' || COALESCE(description, ''), credit, debit,
             currency_code, -amount_foreign, cost_centre, department, project_code
      FROM erp_journal_lines
      WHERE journal_id = target_journal.id;

      UPDATE erp_journals
      SET status = 'posted', posted_at = NOW(), updated_at = NOW()
      WHERE id = reversal_journal_id;
    END IF;

    UPDATE erp_journals
    SET status = 'reversed', reversed_by_id = reversal_journal_id, updated_at = NOW()
    WHERE id = target_journal.id;
  END LOOP;

  DELETE FROM erp_employee_lifecycle_events
  WHERE company_id = target_company_id
    AND employee_id IN (
      SELECT id FROM erp_employees
      WHERE company_id = target_company_id
        AND (employee_code ~ '^E[0-9]{3}$' OR employee_code LIKE 'PII-%')
    );

  UPDATE erp_attendance
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND employee_id IN (
      SELECT id FROM erp_employees
      WHERE company_id = target_company_id
        AND (employee_code ~ '^E[0-9]{3}$' OR employee_code LIKE 'PII-%')
    );

  UPDATE erp_leave_applications
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND employee_id IN (
      SELECT id FROM erp_employees
      WHERE company_id = target_company_id
        AND (employee_code ~ '^E[0-9]{3}$' OR employee_code LIKE 'PII-%')
    );

  UPDATE erp_leave_balances
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND employee_id IN (
      SELECT id FROM erp_employees
      WHERE company_id = target_company_id
        AND (employee_code ~ '^E[0-9]{3}$' OR employee_code LIKE 'PII-%')
    );

  UPDATE erp_employee_contracts
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND employee_id IN (
      SELECT id FROM erp_employees
      WHERE company_id = target_company_id
        AND (employee_code ~ '^E[0-9]{3}$' OR employee_code LIKE 'PII-%')
    );

  UPDATE erp_payslips
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND employee_id IN (
      SELECT id FROM erp_employees
      WHERE company_id = target_company_id
        AND (employee_code ~ '^E[0-9]{3}$' OR employee_code LIKE 'PII-%')
    );

  DELETE FROM erp_employee_onboarding
  WHERE company_id = target_company_id
    AND employee_id IN (
      SELECT id FROM erp_employees
      WHERE company_id = target_company_id
        AND employee_code LIKE 'PII-%'
    );

  UPDATE erp_employees
  SET is_active = FALSE, is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND (employee_code ~ '^E[0-9]{3}$' OR employee_code LIKE 'PII-%');

  UPDATE erp_price_list_items
  SET is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND price_list_id IN (
      SELECT id FROM erp_price_lists
      WHERE company_id = target_company_id AND code = 'RETAIL-2026'
    );

  UPDATE erp_price_lists
  SET is_active = FALSE, is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id AND code = 'RETAIL-2026';

  UPDATE erp_customers
  SET is_active = FALSE, is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND customer_code IN ('C001', 'C002', 'C003');

  UPDATE erp_vendors
  SET is_active = FALSE, is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND vendor_code IN ('V001', 'V002', 'V003');

  UPDATE erp_warehouses
  SET is_active = FALSE, is_deleted = TRUE, updated_at = NOW()
  WHERE company_id = target_company_id
    AND code IN ('WH-NRB', 'WH-MBA', 'WH-KSM');

  UPDATE erp_gl_balances
  SET opening_debit = 0,
      opening_credit = 0,
      period_debit = 0,
      period_credit = 0,
      closing_debit = 0,
      closing_credit = 0,
      updated_at = NOW()
  WHERE company_id = target_company_id;
END $$;