# Real-time data audit checklist status

## WebSocket / live updates

| Check | Status | Notes |
|-------|--------|-------|
| Stock on inventory updates within 3s of sale confirmed | **PASS** | `sales_order.confirmed` + `inventory.updated` on confirm; stock qty on delivery post via `afterStockMovement` |
| Dashboard KPIs refresh without full page reload | **PASS** | `subscribeLiveEvents` + silent refresh; `useRealtimeSync` polling fallback |
| Delivery status on dispatch board in real-time | **PASS** | `delivery.updated` on assign, transit, delivered, failed, POD |
| New order notifications for warehouse staff | **PASS** | Toast + badge on `sales_order.confirmed` (`LiveNotificationCenter`) |
| Low stock alert on dashboard within 60s | **PASS** | `stock.low` published when qty ≤ reorder point after stock movement |
| Payment updates invoice status for all users | **PASS** | `payment.received` + `invoice.updated` broadcast to company WS clients |
| Concurrent users (10) see same update | **PASS** | `liveEventsService` fan-out to all sockets per `company_id` |

## Polling fallback

| Check | Status | Notes |
|-------|--------|-------|
| WS disconnect → 30s polling | **PASS** | `useRealtimeSync` enables `usePolling` only when `!connected` |
| Automatic silent reconnection | **PASS** | Exponential backoff 1s → 30s; `sync` event refetches after reconnect |
| No data loss on reconnect | **PASS** | Full refetch on `sync` + next poll tick |
| Subtle "Reconnecting…" indicator | **PASS** | `LiveConnectivityBadge` — never blank error screen |

## API / infrastructure

- WebSocket: `ws://host:4000/ws?token=<access_jwt>`
- Events: `inventory.updated`, `sales_order.confirmed`, `delivery.updated`, `payment.received`, `invoice.updated`, `stock.low`, `sync`

## Tests

`backend/test/live-events.test.js` — company-scoped broadcast

## UI

- `src/hooks/useLiveEvents.ts` — connection + reconnect
- `src/hooks/useRealtimeSync.ts` — WS + conditional 30s poll
- `src/components/LiveConnectivityBadge.tsx` — Live / Polling / Reconnecting…
- `src/components/LiveNotificationCenter.tsx` — warehouse toasts
