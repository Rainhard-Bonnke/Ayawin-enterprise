# Kenya Withholding Income Tax

Status: category enablement and transaction-specific bases require finance approval. No withholding category is enabled for supplier payments by this document.

## Official Source Reviewed

Kenya Revenue Authority, “Everything about Withholding Tax,” including its published rate table and remittance FAQ: https://www.kra.go.ke/helping-tax-payers/faqs/everything-about-withholding-tax

Reviewed on 2026-11-09. KRA states that a withholder deducts tax at source on specified income, remits it within five working days, and that a certificate is issued to the withholdee after remittance.

## Published Rate Table

| Payment category | Resident | Non-resident | KRA final-tax note |
| --- | ---: | ---: | --- |
| Qualifying dividends | 10% | 15% | Advance / final for individuals |
| Qualifying interest / interest | 15% | 15% | Final for individuals for the listed financial-institution cases |
| Royalties | 5% | 20% | Advance / final |
| Management, professional, training fees | 5% | 20% | Advance / final |
| Contractual payments (construction, supplies) | 3% | 20% | Advance / final |
| Commission | 5% / 10% | 20% | KRA page does not distinguish the two resident rates in this table |
| Commercial rent | 10% | 30% | Advance / final |
| Residential rent under the Monthly Rental Income regime | 7.5% | 30% | Advance / final |
| Appearance / performance fees | Not applicable | 20% | Advance / final |
| Winnings | 5% | 5% | Advance / final |
| Supply of goods to a public entity | 0.5% | 5% | Advance / final |

## Configuration Gate

The table gives rates but does not fully specify thresholds, taxable bases, exemptions, residency evidence, category-specific timing, or the distinction behind the two resident commission rates. Do not apply WHT automatically to all supplier payments. Before enabling a category, the company accountant must select the categories used and confirm the applicable base, residency rule, thresholds, and supporting evidence. The system should store the approval and effective dates with each enabled rate.

These rates are reference data only, not a tax determination. Verify the current KRA guidance and the Income Tax Act before production use.