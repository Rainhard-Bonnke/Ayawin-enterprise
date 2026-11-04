# Inventory valuation controls

`GET /api/v1/inventory/valuation-reconciliation?as_of=YYYY-MM-DD` compares the inventory stock ledger, including outstanding transfer value in transit, with the posted balance of inventory control account `1300`. The response includes totals, variance, per-item on-hand and in-transit values, and movement reference types that do not yet have a GL journal.

Delivery COGS comes from inventory issues: lot-tracked items use the cost of the consumed receipt layers, while other items use moving average cost. A delivery note and its COGS journal post in one transaction. Stock count adjustments and approved stocktakes post their offset through account `5200` (Inventory Count Adjustments).

Material issues and returns currently affect stock without an associated GL journal because the company has no configured consumption expense or original-expense reversal mapping. Internal warehouse transfers do not post a GL journal; outstanding dispatch value is included in in-transit inventory. Reconciliation may therefore show differences caused by legacy opening balances or unjournaled material movements; investigate the listed movement references before posting a correcting journal.
