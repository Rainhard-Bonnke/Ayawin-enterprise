# Kenya integrations (eTIMS & M-Pesa)

Production adapters live in `backend/src/services/integrationService.js`. Until credentials are configured, calls are logged and return safe stubs.

## eTIMS (KRA electronic tax invoicing)

| Env var | Purpose |
|---------|---------|
| `ETIMS_ENABLED=true` | Turn on live submission path (still needs full KRA API wiring) |
| `ETIMS_API_URL` | KRA OSCU / VSCU endpoint (when implemented) |
| `ETIMS_DEVICE_SERIAL` | Registered device serial |

**Current behaviour:** `submitEtimsInvoice()` logs to `erp_integration_logs` and returns `STUB-*` when disabled.

**Go-live steps:**
1. Register device with KRA and obtain OSCU credentials.
2. Map `erp_customer_invoices` lines to KRA item codes and tax categories.
3. Replace stub block in `submitEtimsInvoice` with signed HTTP calls; persist `etims_ref` on invoice row.
4. Hook from `salesService` after invoice post.

## M-Pesa (Safaricom Daraja)

| Env var | Purpose |
|---------|---------|
| `MPESA_CONSUMER_KEY` | Daraja app consumer key |
| `MPESA_CONSUMER_SECRET` | Daraja app consumer secret |
| `MPESA_SHORTCODE` | Paybill / till |
| `MPESA_PASSKEY` | Lipa na M-Pesa passkey |
| `MPESA_CALLBACK_URL` | STK / C2B callback URL (HTTPS) |

**Current behaviour:** `initiateMpesaPayment()` returns `STUB-*` when `MPESA_CONSUMER_KEY` is unset.

**Go-live steps:**
1. Create Daraja app; configure STK Push and validation URL on backend.
2. Add `POST /api/v1/integrations/mpesa/callback` route to confirm payments and call `sales.recordCustomerPayment`.
3. Wire invoice “Pay via M-Pesa” UI to `initiateMpesaPayment` with customer phone.

## Audit trail

All attempts are stored in `erp_integration_logs` (`provider`, `action`, `status`, payloads).
