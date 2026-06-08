# Delivery & Logistics checklist — status

| # | Requirement | Status | Implementation |
|---|-------------|--------|----------------|
| 1 | Delivery order links to sales order correctly | **PASS** | `erp_delivery_notes.sales_order_id` FK; list/detail joins `order_no`; E2E `delivery-list.test.js` |
| 2 | Driver assignment updates driver's active delivery list | **PASS** | `assignDriver` + `GET /logistics/drivers/:id/active` (scheduled / in_transit) |
| 3 | Delivery status updates reflect on sales order status | **PASS** | `postDeliveryNote` sets SO `partial` / `delivered`; `updateLogisticsStatus` posts draft then marks delivered |
| 4 | Proof of delivery upload saves to correct record | **PASS** | `PATCH /sales/deliveries/:id/pod` → `erp_delivery_notes.pod_*` by delivery UUID |
| 5 | Delivery note PDF renders correctly | **PASS** | `deliveryPdfService.renderDeliveryPdfBuffer`; `GET /logistics/deliveries/pdf/:deliveryNo` |
| 6 | Failed delivery creates re-delivery task | **PASS** | `recordFailedDelivery` → `erp_delivery_redelivery_tasks`; `POST /logistics/redelivery-tasks/:id/schedule` |
| 7 | Vehicle mileage log saves per trip | **PASS** | `erp_vehicle_mileage_logs` + `POST /logistics/mileage` |
| 8 | Route optimization groups by correct geography | **PASS** | `optimizeRoutes` — Nairobi sub-zones + upcountry from customer address / `delivery_zone` |

## Migration

Run `029_delivery_logistics.sql` (drivers, zones, vehicles, mileage, re-delivery tasks).

## Key files

- `backend/src/services/deliveryService.js`
- `backend/src/services/deliveryPdfService.js`
- `backend/src/routes/v1/logistics.js`
- `backend/src/services/salesService.js` (dispatch + zone enrichment)
- `src/routes/_app.delivery.tsx`

## API

- `GET /logistics/deliveries`
- `PATCH /logistics/deliveries/:id/assign`
- `PATCH /logistics/deliveries/:id/status`
- `POST /logistics/deliveries/:id/fail`
- `GET /logistics/drivers/:driverId/active`
- `GET /logistics/routes/optimize`
- `POST /logistics/mileage`
- `GET /logistics/redelivery-tasks`
- `POST /logistics/redelivery-tasks/:id/schedule`
- `GET /logistics/deliveries/pdf/:deliveryNo`

## Tests

- `backend/test/delivery.test.js`
- `backend/test/e2e/delivery-list.test.js`
