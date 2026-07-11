# Millers Café Site Backend Architecture

This project keeps the existing frontend and visual design, but the Pages Functions backend is now organized in layered modules:

- `functions/api/*`
  Route handlers only. They parse request input, run auth checks, call services, and return responses.
- `functions/_lib/*`
  Shared infrastructure and orchestration:
  - `json.js`: response helpers (`json`, `jsonError`, `csv`, `methodNotAllowed`, `readJsonBody`)
  - `errors.js`: typed API errors and consistent error mapping
  - `http.js`: URL/query parsing helpers
  - `auth.js`: token extraction and authorization checks for feed/admin endpoints
  - `bookings-service.js`: booking feed/create/availability workflow
  - `orders-service.js`: order feed/create workflow
  - `order-status-service.js`: order status read/update workflow
- `functions/_booking-core.js`, `functions/_orders-core.js`
  Domain logic and persistence core (validation, scheduling rules, record generation, per-record recovery, feed shaping).
- `functions/_booking-email.js`, `functions/_order-email.js`
  Outbound email adapters.

## Design goals

- Keep customer-facing endpoint contracts stable; insecure legacy direct order creation is deliberately retired.
- Centralize cross-cutting concerns (auth, JSON responses, parsing, error handling).
- Keep route files small and testable.
- Make future migration to full TypeScript straightforward.

## Deployment boundary

`npm run build` creates an allowlisted `dist/` directory containing only public browser assets. Cloudflare Pages must use `dist` as its build output. The repository-level `functions/` directory remains the Pages Functions source and is not copied into the public asset output.

## Persistence model

The current Cloudflare KV namespace retains the legacy aggregate keys for compatibility, while booking and order mutations first write `booking_entity:*` or `order_entity:*` records. Reads merge both sources by freshness. This prevents a racing aggregate write from permanently dropping a record and supports migration without an outage.

KV is eventually consistent and has no compare-and-set transaction. The in-isolate locks and per-entity records improve durability and idempotency, but they cannot strictly serialize two simultaneous requests handled in different Cloudflare isolates. A D1 transaction or Durable Object is required for a hard global guarantee against simultaneous duplicate bookings or competing table assignments.

## Local verification

- `node --test tests/*.test.js`
  Runs the built-in `node:test` suite against booking rules, order rules, service behavior, and auth boundaries.
- `npm run check`
  Runs the complete test suite, checks every JavaScript file, and builds the public-only Pages output.

## Suggested next step

Move booking and order mutation coordination to D1 or a Durable Object before traffic grows enough for simultaneous writes to be routine. After that consistency boundary is in place, TypeScript conversion can be done incrementally behind the existing tests.
