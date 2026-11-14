CREATE UNIQUE INDEX IF NOT EXISTS erp_employees_company_user_active_uq
  ON erp_employees(company_id, user_id)
  WHERE user_id IS NOT NULL AND is_deleted = FALSE;
