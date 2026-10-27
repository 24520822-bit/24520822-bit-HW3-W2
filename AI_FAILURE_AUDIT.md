# AI Failure Audit

This audit records concrete implementation mistakes an AI coding assistant could introduce in this flash-sale engine, their user-visible consequences, and the checks that prevent them.

## 1. Decrementing a displayed countdown

**Failure mode:** Implement the timer as `remainingSeconds -= 1` from a repeating interval and treat that counter as the deadline.

**Concrete impact:** Browsers throttle timers in background tabs and busy event loops. The display can fall behind the real deadline, making an expired lock look valid and encouraging a checkout that the server must reject.

**Safeguard:** Reservations carry an absolute `expiresAt`; each animation frame recomputes `Math.max(0, expiresAt - Date.now())`. The server independently checks the same deadline and expires the reservation. Countdown tests advance wall-clock time across delayed frames and verify the displayed remainder catches up.

## 2. Check-then-decrement without a version check

**Failure mode:** Let two buyers read the same available stock, then accept both requests based on those stale reads.

**Concrete impact:** The UI can promise units that do not exist; `available` can become negative or the sum of available, reserved, and sold units can exceed total stock.

**Safeguard:** Each product has a version. The in-process service checks the caller's expected version and synchronously moves stock from available to reserved before handling the next request. The 20-request unit test and the interactive buyer-race test verify that stale requests lose and the inventory invariant remains true. This guarantee is limited to one Node.js process; it is not distributed locking.

## 3. Releasing inventory more than once or checking out a terminal lock

**Failure mode:** Let a timer callback release stock after checkout, release stock on every repeated expiry callback, or allow an expired reservation to proceed through checkout.

**Concrete impact:** Repeated releases inflate available inventory; a late callback can corrupt the stock totals after an order has been confirmed.

**Safeguard:** Reservations transition only from `RESERVED` to `EXPIRED` or `CHECKED_OUT`. Terminal states are not transitioned again, overdue locks are swept before inventory-changing operations, and checkout cancels the expiry timer. Fake-clock tests cover the exact deadline, a delayed callback, repeated expiry reads, expired checkout, and repeated checkout.

## 4. Polling continuously after a zero-time sync failure

**Failure mode:** Recreate an already-expired animation-frame timer after a status request fails or the browser clock is ahead of the server.

**Concrete impact:** Each frame can trigger another reservation lookup and inventory request, producing sustained API load while the tab remains open.

**Safeguard:** The client marks that reservation as awaiting authoritative expiry and retries its status with exponential backoff capped at 30 seconds. UI tests exercise both a temporary API failure and a server response that still reports `RESERVED`, verifying that zero-time frames stop.

## 5. Sweeping and retaining every historical reservation

**Failure mode:** Scan all terminal reservations on every inventory request and keep every completed record forever.

**Concrete impact:** An otherwise healthy sale becomes progressively slower and consumes unbounded process memory as reservation turnover grows.

**Safeguard:** Expiry sweeps visit only active reservations; a bounded FIFO keeps the latest 10,000 terminal records and evicts older IDs. A turnover regression test verifies eviction and preserved inventory totals.
