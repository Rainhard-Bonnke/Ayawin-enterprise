INSERT INTO erp_role_permissions(company_id,role_id,permission_id)
SELECT role.company_id,role.id,permission.id
FROM erp_roles role
CROSS JOIN erp_permissions permission
WHERE role.name='POS Operator'
  AND permission.code IN ('sales.order.create','sales.invoice.create','sales.receipt.create')
ON CONFLICT(role_id,permission_id) DO NOTHING;
