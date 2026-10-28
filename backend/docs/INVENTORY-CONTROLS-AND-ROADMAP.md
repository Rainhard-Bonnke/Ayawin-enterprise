# Ayawin inventory controls and build roadmap

Audit date: 19 October 2026. This is based on the repository's routes, service code, migrations and front-end workflows; it is not a live stock-data reconciliation or compliance certification. Ayawin's current product design targets a Kenyan beverage wholesaler and distributor. Confirm any additional lines of business with the operations and accounts teams before enabling their policies.

## What a complete stock record needs to answer

For any SKU at any point in time, a supervisor should be able to establish:

1. What item is it, in which base and selling units, and how do case, pack and each quantities convert?
2. Which legal entity, branch, warehouse, bin, vehicle, batch/lot and expiry date owns or holds it?
3. How much is physically on hand, reserved for orders, allocated to picks, in transit, quarantined, damaged, consigned or available to promise?
4. Which source document caused each increase, decrease, reclassification, return or adjustment, who prepared it, who approved it, and which ledger/GL records were posted?
5. What is the cost basis and value by item, warehouse and period, and can the inventory subledger reconcile to the general ledger?
6. What should be counted, replenished, quarantined, recalled, returned or written off next?

## Core operating workflows

### Product and warehouse setup

- Maintain SKU, description, barcode/GS1 identifiers where available, product hierarchy, stock/sale/purchase flags, tax/excise classification, base UOM and approved pack conversions.
- Maintain warehouse, vehicle, receiving, dispatch, quarantine and bin locations; identify which locations can supply customer orders.
- Configure cost method, min/max or reorder parameters, lead time, supplier/item association, batch/expiry tracking, and count frequency.

### Receipt and put-away

Supplier need → purchase request → approval → purchase order → supplier delivery/GRN → count each SKU → record under/over-delivery, damage, supplier batch and expiry → quality hold when needed → accept/put away → post stock ledger and inventory/AP accrual. Supplier invoice matching should compare purchase order, receipt and bill before payment.

### Internal material consumption

Department request → requester submits purpose, stock location, item and quantity → authorized reviewer approves/rejects → storekeeper issues approved quantity → recipient acknowledgement → inventory ledger issue and cost trace. Partial issue leaves a visible open balance. Unused materials return against the original issue; damaged goods are tracked and written off distinctly.

### Replenishment and fulfilment

Available stock calculation → reorder suggestion using demand, lead time, supplier minimum and open purchase supply → approved replenishment request → reserve order demand → wave/pick with FEFO for dated goods → dispatch → driver load and proof of delivery → invoice/collection → customer return or credit note linked to original delivery/invoice.

### Transfers and vehicles

Transfer request → dispatch from source → in-transit balance → destination or driver confirms receipt → reconcile short/damaged quantities. A posted transfer should not imply the remote location physically received all items if delivery is still underway.

### Count, adjust and close

Schedule full or cycle count by ABC value/risk → freeze or snapshot the count scope → count blind where appropriate → investigate variance → separate preparer and approver → compare the snapshot with movements posted since the count → post a balanced stock adjustment and GL entry or recount → retain audit evidence. Reconcile quantity, valuation, subledger and GL before a financial period is closed.

## Controls now in code after this build

- Dedicated Inventory Master, Stock Analysis, Material Requisitions, Material Issues, Material Returns and Stock Adjustment Journal workspaces are available beside the existing stock, movements and reorder pages.
- Internal material requests have their own records and statuses, separate from supplier purchase requisitions. Review uses company-scoped authorization and prevents requesters from approving their own request.
- Material issue posts a negative stock ledger movement and respects approved, not merely requested, quantities. Partial issuance retains its remaining balance.
- Material return links to an issue and enforces the still-returnable quantity. Tracked issues persist the exact receipt layers consumed, and each return is allocated back to those same layers; accepted stock creates a child layer preserving the original supplier-receipt root. Damaged quantities are received into physical stock and immediately quarantined (tracked lot or untracked balance), creating a quarantine event for later independent release, write-off or supplier return.
- Stock adjustment drafts capture system and physical quantities at count time. An authorized different user posts the adjustment; posting fails if stock changed after count capture. Preparer can cancel a draft.
- Tracked stock issues allocate unexpired lot quantities FEFO; warehouse transfers copy batch, expiry and lot cost to the destination. Existing stock can be assigned opening lots only when lot quantity and value equal the stock-on-hand quantity and valuation; the audited reconciliation does not post another stock receipt.
- Positive stock adjustment journals capture batch and expiry for tracked items. Material returns tie the returned quantity to the source issue's lot and reject returns above the original unreturned batch quantity.
- Lot quarantine and release now record a reason and user in the lot-event history. Quarantined and expired quantities are excluded from available-to-promise and FEFO issue allocation; a lot with active order reservations cannot be quarantined below the reserved quantity, and expired stock cannot be released.
- Warehouse transfers now dispatch stock out of the source into an in-transit state and receive it into the destination only after a different authorized user confirms the count. Receipt can be partial; damaged quantities are received into on-hand quarantine, while shortages and damage reasons remain on the transfer audit record. Tracked transfers preserve the source FEFO batch and expiry.
- A quarantine disposition register covers tracked lots and untracked warehouse quarantine balances. Users prepare release, supplier-return or write-off drafts with reason/evidence; a different authorized user posts them. Release removes only the hold, while return/write-off reduces physical and quarantined stock, records the stock-ledger issue and posts the inventory credit with a configured claim asset or expense account. Expired lots cannot be released. Supplier return postings create a claim balance for later supplier credit-note reconciliation; they do not silently alter accounts payable.
- Supplier credit notes link to the original posted goods receipt and supplier invoice line, and validate returned quantity, remaining invoice value, input VAT and the Kenyan six-month issue window (including the court price-dispute exception). Each tracked receipt now creates a quantity layer, and tracked issues consume layers FIFO within FEFO lots. Transfers create destination layers linked to their source layer; quarantine, release, write-off and supplier-return dispositions record the source layers they affect. Receipt lines link to their layer, so a supplier credit must match quantity from the same source receipt that the disposition returned. A different approver posts the note. Its settlement can reduce open KES bills, record a bank/cash refund, or hold unapplied credit in an asset account. Posting debits Accounts Payable/bank/unapplied credit, clears the linked return-claim asset, reverses source input VAT, updates allocated bill balances and creates an audit-linked GL journal dated when the note was received. Drafts reserve claim value and can be cancelled by their preparer; posting does not create inventory movements a second time. Historical stock receives one legacy layer per current lot; their original receipt provenance is unknown. Average-cost valuation remains unchanged.
- Direct stock-in shortcuts are retired from the inventory workspace/API; supplier receipts must follow the PO goods-received process. Direct one-click quantity adjustment is retired in favor of an adjustment journal.
- Stock analysis reports current average-cost value, historical outflow, reorder comparison, approximate days cover, last movement and stale stock. Days cover is a simple planning indicator, not a forecast.

## Remaining inventory work before production-grade readiness

The new internal consumption and adjustment workflows are only one part of complete inventory. The code audit still identifies these material gaps:

1. **Lot balance and FEFO:** quantity layers now preserve receipt lineage through tracked FEFO issues, material returns, warehouse transfers, quarantine and disposition. Historical stock receives a legacy layer with unknown receipt provenance. Positive adjustments currently accept one lot per item variance; multi-lot counts, positive driver stocktake variances, lot-specific reservations and recall workflows remain. Supplier return credits can settle open KES bills, cash refunds or unapplied credit. Reservations are item/warehouse scoped rather than pinned to a specific lot.
2. **Movement state:** warehouse and vehicle transfers now remain in transit until a different authorized receiver confirms them, with partial receipt, damage quarantine and short-quantity capture. Short/damaged quantities still need reviewed financial write-off or recovery claims; partial dispatch, multiple item lines in the current UI, barcode scans, proof of handover and route-level vehicle loads remain future work.
3. **Reservations and available-to-promise:** distinguish physical on hand, blocked/quarantined, reserved, picked and sellable quantities consistently across all sales, warehouse, vehicle and stock reports. Lot quarantine checks protect active item-level order reservations, but do not commit each reservation to a lot. Non-lot damaged transfer receipts are excluded from sellable availability; the disposition workspace now clears held balances under approval.
4. **Receipt quality and supplier variance:** supplier return dispositions and supplier credit-note settlement are connected. Inspection/quarantine at receiving, over/under receipt policy, landed cost, full three-way match and supplier statement reconciliation still need connected flows.
5. **Inventory costing and accounting:** review FIFO versus moving weighted average, backdated movements, returns at historical cost, negative stock policy, period valuation, write-downs and stock-to-GL reconciliation. Do not present the simple days-cover report as a cost-accounting report.
6. **Warehouse structure:** bins, pick/put-away, batch capture on issue/transfer, barcode scanning, count sheets, count tolerance and replenishment tasks need a full operational process.
7. **Beverage packaging and route sales:** model case/pack conversion, empties or deposits where the business uses them, excise stamp evidence where legally applicable, load reconciliation, driver cash/POD and breakages. KRA requirements vary by goods and taxpayer authorization; do not infer a license from the ERP item category.
8. **Analytics:** add valuation by location/lot/currency, ABC classification, dead stock, expiry-at-risk, gross margin, shrinkage, supplier lead-time performance and reconciliations with drill-through to source documents.

## Design references

- Microsoft Dynamics Supply Chain documents separate counting, adjustment, transfer, movement and arrival journals; its transfer journal is immediate and its transfer order represents in-transit handling. [Inventory journals](https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/inventory-journals)
- Its inbound receiving flow accounts for registered versus received quantities, partial discrepancies, batch/serial capture and quarantine inspection. [Product receipt against purchase orders](https://learn.microsoft.com/en-us/dynamics365/supply-chain/procurement/product-receipt-against-purchase-orders), [Quarantine orders](https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/quarantine-orders)
- Cycle counts are recurring scoped audits; adjustment posting is a separate reconciliation step. [Cycle counting](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/cycle-counting)
- IAS 2 requires inventory measurement at the lower of cost and net realisable value and permits FIFO or weighted average for ordinarily interchangeable inventory; cost includes costs to bring stock to present location and condition. The ERP's current moving-average balance is not yet a complete IAS 2 valuation implementation. [IAS 2 Inventories](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/)
- GS1 traceability guidance connects product identification, batch/lot, source and destination locations, dispatch, receipt and event data. [GS1 Global Traceability Standard](https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard)
- KRA describes eTIMS system-to-system requirements separately from excise goods/stamps. These integrations need authorization, certification and real KRA responses; a database field or mock reference is not proof of compliance. [eTIMS system-to-system integration](https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/etims-system-to-system-integration), [KRA excise duty](https://www.kra.go.ke/business/companies-partnerships/companies-partnerships-pin-taxes/excise-duty)

## Delivery order

1. Finish the inventory operations pages and transaction controls in this phase.
2. Build lot-balance, FEFO allocation, quarantine availability and in-transit transfers before claiming traceable distribution stock.
3. Complete procure-to-pay and order-to-cash returns, matching, credit notes, collection and delivery confirmation.
4. Complete finance reconciliation and period close, then validate representative transactions with Ayawin's accountant. Configure and confirm the supplier-claim asset account and write-off expense policy before live use; validate return-credit postings with the accountant.
5. Complete people, asset and administration controls and verify Kenyan statutory rules against current primary sources.
6. Implement certified KRA and payment connectors with response capture, retries and reconciliation. Add AI only over those validated records, with human approval for transactions.

This is an implementation tracker, not a statement that the whole ERP is already complete.
