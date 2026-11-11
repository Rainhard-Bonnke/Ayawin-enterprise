# Integration Go-Live Checklist

This is a release gate, not evidence that KRA or Safaricom has approved this taxpayer or software. Keep eTIMS and M-Pesa disabled or in sandbox until every external approval and every internal acceptance item below is complete. Automated tests use mocks only and must never send live provider requests.

## 1. Confirm External Requirements

1. Ask KRA to confirm that the OSCU/VSCU v2.0 specifications published April 2023 remain current. The repository review date is 2026-11-07; public KRA pages reviewed on 2026-11-09 still link to those PDFs.
2. Select OSCU or VSCU with KRA based on the operating model. Obtain taxpayer onboarding, branch/device details, sandbox credentials, current code lists, and the required testing, vetting, and certification steps.
3. Obtain written KRA confirmation for out-of-scope supplies, applicable tax codes/rates, item classifications, item types, origin, packaging, and quantity units. Do not map unresolved supplies or infer a tax code.
4. Obtain Safaricom production approval for the shortcode and API products in use, live credentials, operator/initiator roles, B2C approval if required, and callback requirements.
5. Re-verify Safaricom callback source IP ranges from its current developer documentation before enabling an allowlist. Do not treat the list reviewed on 2026-11-07 as permanent.

## 2. Configure Secrets and Workers

1. Configure independent values for `JWT_SECRET`, `MFA_ENCRYPTION_KEY`, and `INTEGRATION_ENCRYPTION_KEY`. Each must be at least 32 characters and must not be a placeholder or reused for another key.
2. Set `INTEGRATION_ENCRYPTION_KEY_VERSION` to the active envelope key version. Integration credentials are encrypted per company and environment; the settings API never returns secret values.
3. Configure `APP_BASE_URL` to the public API origin. The M-Pesa callback base URL may be overridden per company in `public_config.callbackBaseUrl`.
4. Deploy the required workers: `npm run worker:etims`, `npm run worker:mpesa`, `npm run worker:notifications`, and `npm run worker:reports`. Set their poll and batch limits explicitly for the deployment.
5. For key rotation, stop API and worker processes, set `INTEGRATION_ENCRYPTION_KEY_NEXT` and `INTEGRATION_ENCRYPTION_KEY_NEXT_VERSION`, run `npm run integration:keys:rotate`, then deploy with the new key as `INTEGRATION_ENCRYPTION_KEY` and the matching active version. Keep the old deployment configuration secured until the rotation is verified. Changing the key without this command makes stored credentials unreadable.

## 3. Configure Company Providers

Use authenticated integration settings endpoints:

- `GET /api/v1/integrations/{provider}/settings?environment=sandbox`
- `PUT /api/v1/integrations/{provider}/settings`
- `POST /api/v1/integrations/{provider}/production-certification`

Save sandbox settings and credentials separately from production settings. Send provider secrets only in the authenticated `PUT` request's `secrets` object. The response exposes only `has_secrets`.

For eTIMS, initialize and test the device in sandbox, then complete the current KRA sandbox test/vetting path. For M-Pesa, validate STK, callbacks, C2B, reconciliation, and idempotency in sandbox. No production settings may be activated until the company-level checklist is certified with `integrations.production_certify` by an authorized user.

The certification endpoint requires these affirmative checklist entries:

- eTIMS: `kra_approval_confirmed`, `taxpayer_onboarded`, `current_spec_confirmed`, `sandbox_vetting_complete`, `item_code_lists_and_registration_tested`, `sales_payload_gl_reconciliation_tested`, `credit_note_original_invoice_tested`, `purchase_stock_reporting_tested`, `ambiguous_timeout_lookup_tested`.
- M-Pesa: `safaricom_approval_confirmed`, `shortcode_enabled`, `https_callbacks_verified`, `callback_ranges_verified`, `asynchronous_status_callback_tested`, `statement_reconciliation_tested`, `unallocated_queue_reconciliation_tested`, `b2c_disabled_or_approved`.

Save production credentials in the `production` environment while the provider remains disabled, record and verify the external approvals, submit the checklist, then set `provider_mode` to `production` for that environment. Provider factories fail closed if certification is absent or incomplete. Email and SMS credentials are configured separately as `email` and `sms` provider settings.

## 4. Callback and Invoice Controls

1. Production callback URLs must use HTTPS and a company-scoped callback token. Keep the callback IP allowlist empty until the live Safaricom ranges have been re-verified, then set `public_config.callbackSourceIpAllowlist` to the approved CIDR list. Safaricom's Getting Started page listed 12 callback IPs on 2026-11-09; see [daraja-SPEC-NOTES.md](daraja-SPEC-NOTES.md). The default is off.
2. The M-Pesa callback router uses its own rate limit. Configure `MPESA_CALLBACK_RATE_LIMIT_WINDOW_MS` and `MPESA_CALLBACK_RATE_LIMIT_MAX` to match approved provider burst expectations.
3. Keep STK and invoice submission limited to `sales.receipt.create` and `sales.invoice.post` respectively. Fiscal acceptance remains distinct from internal posting.
4. Do not retry an eTIMS submission after an ambiguous timeout unless the adapter can look up the prior invoice status and explicitly confirms it was not received. The current sandbox adapter does not invent an undocumented lookup endpoint; such retries fail closed.

## 5. Current Release Blockers

Production certification must remain disabled until these Phase 5 items are completed and tested:

- KRA confirmation of the operative code lists, out-of-scope tax treatment, and whether the v2.0 singular `/saveItem` endpoint remains correct; the implementation keeps unresolved mappings blocked.
- eTIMS purchase submission is queued after supplier-bill evidence verification; stock events are transactionally queued for GRN, delivery, stock adjustment, transfer dispatch/completion, and customer return. Mock E2E coverage currently proves GRN enqueue/worker/retry; add source-specific acceptance tests for every other event and verify KRA sequence/movement semantics in sandbox.
- Confirm whether KRA expects v2.0 `/saveItem` or the prompt's `/saveItems`, and `/insertTrnsPurchase` versus `savePurchases`, `/insertStockIO` versus `saveStockItems`.
- Credit-note fiscal payload and source-invoice acceptance policy; KRA status lookup for ambiguous submissions.
- M-Pesa STK receipt posting waits for an asynchronous Transaction Status callback and is covered by a mock E2E, including non-final callback and replay. Confirm the live callback schema with Safaricom. Statement CSV matching covers C2B/STK receipts and bank-deposit references; fee/reversal account posting still needs source-specific E2E coverage. B2C has a guarded dual-approval API and remains disabled by default; add daily-limit boundary tests and reconcile confirmed provider disbursements to accounting records.
- The dashboard exception panel reports eTIMS/M-Pesa queue age and errors; authorized administrators can retry failed eTIMS invoice, purchase, and stock events. Rejected KRA responses are not manually retried as if they were transient.
- Company notification templates, opt-outs, recipient rate limits, and provider callback verification.
- End-to-end scheduled-report authorization, delivery/retry handling, and deployment storage/retention verification.

The KRA and Daraja references, retrieval dates, and known uncertainties are recorded in [etims-SPEC-NOTES.md](etims-SPEC-NOTES.md) and [daraja-SPEC-NOTES.md](daraja-SPEC-NOTES.md). Production is not approved by completing this checklist alone; external authorization and the remaining acceptance tests are still required.
