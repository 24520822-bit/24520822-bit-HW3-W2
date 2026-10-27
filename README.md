# High-Concurrency Flash-Sale Engine

A TypeScript demo of a Vietnam 11.11 midnight flash sale. It combines an in-memory Node.js API with a vanilla TypeScript/Vite interface for reserving limited inventory, watching a server-issued countdown, checking out, and simulating competing buyers.

## Requirements

- Node.js 20.19+ (or 22.12+)
- npm

## Run locally

Install dependencies:

```powershell
npm install
```

Start the API in one PowerShell terminal:

```powershell
npm run server
```

Start the web app in another terminal:

```powershell
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` requests to the Node API at `http://127.0.0.1:3000`. To try the production client bundle, run `npm run build` and `npm run preview` while the API is running.

Reservation locks last five minutes by default. Configure a different positive integer duration in milliseconds when starting the API:

```powershell
$env:RESERVATION_TTL_MS = "60000"
npm run server
```

The supported timer range is 1–2,147,483,647 milliseconds. Invalid values stop server startup instead of silently falling back.

## API

- `GET /api/products` — current inventory and optimistic version for each product.
- `POST /api/reservations` — reserve `{ "productId": "...", "quantity": 1, "expectedVersion": 0 }`.
- `GET /api/reservations/:id` — retrieve the reservation state.
- `POST /api/reservations/:id/checkout` — finalize an unexpired reservation.

The buyer-race control submits multiple requests using the same product version. A successful request increments that version; other requests with the stale version receive a conflict instead of overselling stock.

After a displayed countdown reaches zero, the browser checks the server for the final state. Temporary failures or client/server clock skew are retried with bounded exponential backoff rather than a per-frame request loop. The service sweeps only active reservations and retains the most recent 10,000 terminal reservation records; older terminal IDs return `404`.

## Verification

```powershell
npm test
npm run typecheck
npm run build
```

The test suite includes inventory and state-transition tests, fake-clock expiry tests, HTTP integration tests, DOM-level UI tests, a delayed-frame countdown test, and a static audit of the UI source for prohibited legacy/unsafe APIs.

## Scope and limitations

All inventory and reservation state lives in memory in one Node.js process. Restarting the process resets the sale. The synchronous version check protects concurrent requests handled by that process; this demo does **not** provide persistence, cross-process or multi-server locking, durable checkout, payments, or production-grade distributed coordination. Do not run multiple API instances against this in-memory store.
