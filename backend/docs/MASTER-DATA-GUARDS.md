# Master-data guards and Kenyan tax IDs

The generic master-data delete endpoint soft-deletes records only after checking linked open documents, balances, stock, active reservations, transfers, active employee contracts and open payroll runs. A blocked operation returns HTTP 409 and identifies blocking document types and references. Use `is_active=false` to deactivate records that should remain visible in history.

Customer and vendor `tax_id`, and company `kra_pin`, are normalized to uppercase and validated as `^[AP][0-9]{9}[A-Z]$`; database checks and unique indexes also enforce the format and uniqueness. VAT registration and VAT number fields are stored separately. `requires_tax_invoice` identifies customers whose tax invoices require a PIN for a later eTIMS integration.

Item tax group, unit of measure (`uom_id`), costing method and standard cost cannot be changed after posted delivery or goods-receipt transactions. A formal approved migration workflow for historical item reclassification is still needed.
