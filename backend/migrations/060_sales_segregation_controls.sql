ALTER TABLE erp_permissions DROP CONSTRAINT IF EXISTS erp_permissions_module_action_chk;
ALTER TABLE erp_permissions ADD CONSTRAINT erp_permissions_module_action_chk CHECK (action IN (
  'view','create','edit','delete','approve','export','price_override','discount_approve','credit_override',
  'order_create','order_approve','delivery_post','invoice_create','invoice_post','receipt_create','receipt_approve',
  'credit_note_create','credit_note_approve'
));

INSERT INTO erp_permissions(module,action,code,description) VALUES
 ('sales','order_create','sales.order.create','Create sales orders'),
 ('sales','order_approve','sales.order.approve','Confirm sales orders'),
 ('sales','delivery_post','sales.delivery.post','Post deliveries'),
 ('sales','invoice_create','sales.invoice.create','Create customer invoices'),
 ('sales','invoice_post','sales.invoice.post','Post customer invoices'),
 ('sales','credit_note_create','sales.credit_note.create','Create customer credit notes'),
 ('sales','credit_note_approve','sales.credit_note.approve','Approve customer credit notes')
ON CONFLICT(code) DO NOTHING;

-- Admin retains all permissions. Seeded roles split maker and checker duties.
INSERT INTO erp_role_permissions(company_id,role_id,permission_id)
SELECT r.company_id,r.id,p.id FROM erp_roles r JOIN erp_permissions p ON
 (r.name IN ('Admin','System Administrator') AND p.code IN
  ('sales.order.create','sales.order.approve','sales.delivery.post','sales.invoice.create','sales.invoice.post',
   'sales.receipt.create','sales.receipt.approve','sales.credit_note.create','sales.credit_note.approve',
   'sales.price_override','sales.discount_approve','sales.credit_override')) OR
 (r.name IN ('Sales Rep') AND p.code IN ('sales.order.create')) OR
 (r.name IN ('Cashier/POS','Cashier') AND p.code IN ('sales.invoice.create','sales.receipt.create')) OR
 (r.name IN ('Storekeeper/Warehouse','Warehouse','Store Manager') AND p.code IN ('sales.delivery.post')) OR
 (r.name IN ('Accountant') AND p.code IN ('sales.invoice.create','sales.invoice.post','sales.receipt.create',
   'sales.receipt.approve','sales.credit_note.create','sales.credit_note.approve')) OR
 (r.name IN ('Manager','Operations Manager') AND p.code IN ('sales.order.approve','sales.invoice.post',
   'sales.receipt.approve','sales.credit_note.approve','sales.discount_approve','sales.credit_override'))
ON CONFLICT(role_id,permission_id) DO NOTHING;

INSERT INTO erp_role_permissions(company_id,role_id,permission_id)
SELECT r.company_id,r.id,p.id FROM erp_roles r JOIN erp_permissions p ON p.code='sales.receipt.approve'
WHERE r.name IN ('Admin','System Administrator','Manager','Operations Manager','Accountant')
ON CONFLICT(role_id,permission_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS erp_maker_checker_policies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id UUID NOT NULL REFERENCES erp_companies(id),
 document_type TEXT NOT NULL, threshold NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK(threshold>=0),
 require_different_approver BOOLEAN NOT NULL DEFAULT TRUE, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID REFERENCES erp_users(id),
 UNIQUE(company_id,document_type)
);
