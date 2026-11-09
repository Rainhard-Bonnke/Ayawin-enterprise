# KRA eTIMS Specification Notes

Retrieved: 2026-11-07

## Official sources reviewed

- KRA eTIMS overview: https://www.kra.go.ke/online-services/etims
- KRA types of eTIMS solutions: https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/types-of-etims-solutions
- KRA system-to-system integration: https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/etims-system-to-system-integration
- OSCU Specification Document v2.0 (April 2023): https://www.kra.go.ke/images/publications/OSCU_Specification_Document_v2.0.pdf
- VSCU Specification Document v2.0 (April 2023): https://www.kra.go.ke/images/publications/VSCU_Specification_Document_v2.0.pdf
- Technical Specification of TIS for OSCU/VSCU v2.0 (April 2023): https://www.kra.go.ke/images/publications/TIS-for-OSCU--VSCU-Technical-Specifications-v2.0.pdf
- KRA sandbox: https://etims-sbx.kra.go.ke/

The three PDFs were downloaded from the linked KRA publication URLs and text-extracted locally for review on the retrieval date above. Their published revision is April 2023; confirm with KRA that these remain the operative specifications before production certification.

## Findings

- KRA describes System-to-System integration through an API and offers OSCU and VSCU. KRA describes OSCU for invoicing systems that are always online and VSCU for bulk invoicing that is not always online.
- Recommendation: implement the OSCU adapter first. This ERP is centrally hosted and expected to be online during posting; OSCU avoids requiring a locally deployed VSCU JAR at every branch. This is a product/architecture recommendation, not KRA approval. A VSCU deployment is a better fit only if branches require local operation during internet outages and can operate the required local service.
- System-to-system integration requires development, testing, vetting, and certification by KRA. Production credentials/onboarding are not implied by these public specifications.
- KRA says each eTIMS solution has its own invoice-number sequence and a credit note must be generated from the same solution as the original invoice.
- The OSCU spec documents test base URL `https://etims-api-sbx.kra.go.ke/etims-api/` and production base URL `https://etims-api.kra.go.ke/etims-api/`. Its device initialization method uses `/selectInitInfo` with taxpayer PIN (`tin`), branch ID (`bhfId`), and device serial (`dvcSrlNo`). Sales submission is documented at `/saveTrnsSalesOsdc`; it includes `tin`, `bhfId`, communication key (`cmcKey`), trader invoice number, invoice number, optional customer PIN/name, receipt/payment/status codes, dates, totals/tax-by-type fields, and item lines. KRA taxpayer approval and sandbox credential validation are still required.
- Item registration is documented under `/items/saveItems`; fields include KRA item classification, item code/type/name, origin country, packaging unit and quantity, and tax type. KRA code data includes item classifications, packaging/weight/quantity units, PIN/branch data and notices.
- Purchase transactions and stock management are part of the documented API. The V2.0 OSCU route catalogue includes purchase save (`/trnsPurchase/savePurchases`), stock master (`/stockMaster/saveStockMaster`), stock movement lookup (`/stock/selectStockItems`), and stock in/out (`/saveStockItems/saveStockItems`). Thus purchases and stock movement reporting cannot be omitted from an OSCU/VSCU implementation without a KRA-confirmed exception.
- The TIS specification requires receipt information including seller/buyer PIN where applicable, receipt and transaction type, a sequential receipt number, items/quantities/prices, totals, tax rates/VAT, payment means, SCU timestamp/ID/counters/signature, and TIS timestamp. It says receipt output depends on a functioning assigned SCU and that SCU response/signature data is printed on the final receipt. VSCU has local operation and the VSCU spec says it stops issuing receipt numbers after 24 hours without internet following its signature/internal-data operation.
- The V2.0 taxation code table lists A = exempt, B = 16%, C = 0%, D = non-VAT, E = 8%. Item and invoice fields carry taxation type codes; dynamic code data should be fetched and validated rather than assuming this older table is sufficient for every company's current registrations. The example sales payload elsewhere in this same 2023 PDF still shows 18% for B, which conflicts with the code table and confirms that live code/rate data must be authoritative.

## Tax-group mapping status

- Standard 16%: candidate code B, subject to current KRA code-list validation.
- Zero-rated: candidate code C, subject to current KRA code-list validation.
- Exempt: candidate code A, subject to current KRA code-list validation.
- Out-of-scope: unresolved. The document defines D as "Non-VAT"; it does not establish that D is a valid classification for an out-of-scope supply by a VAT-registered seller. Do not map automatically until KRA confirms the tax treatment/code.
- Code E is listed as 8%; current applicability and rates must be verified against current KRA code data and tax law before enabling it.

## Posting and outage policy

Keep the accounting posting transaction independent from eTIMS network availability: persist the posted accounting document and a durable pending integration state in the same local transaction. Do not print or expose it as a final tax invoice until a real SCU response supplies fiscal data. Retrying must use a stable local idempotency key and must not invent a CU number, signature, internal data, or QR payload. The TIS specification does not authorize an arbitrary deferred/fiscal-data fabrication path. VSCU's documented local-signing behavior is not equivalent to permission for a cloud application to issue an unsigned tax invoice.

## Unverified items / assumptions

- KRA must confirm whether these April 2023 v2.0 PDFs are still current and provide the current OSCU sandbox endpoint/transport and approved onboarding steps for this taxpayer and software vendor.
- KRA must confirm treatment/code for out-of-scope supplies and the currently valid code list/rates, including whether code E is applicable.
- KRA must confirm current item classification, item type, origin, package, quantity, and tax-code data for the beverage catalog, and required purchase/stock event coverage for this taxpayer's operating model.
- Public material does not settle whether a failed OSCU submission may be deferred while the accounting document is posted; the design assumes accounting posting can complete but the document cannot be represented/printed as a final tax invoice until accepted/signed by KRA's SCU.
- Public pages do not establish whether an "already submitted" retry response returns the original fiscal response. Reconcile by provider-supported invoice identity/status lookup before retrying ambiguous timeouts.
- Supplier invoice lookup/validation is present as a purchase-sales lookup path in the specification; production availability and the exact eligibility behavior need sandbox confirmation.
