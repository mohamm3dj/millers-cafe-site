# Millers Cafe Site Backend Architecture

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
  Domain logic and persistence core (validation, scheduling rules, record generation, feed shaping).
- `functions/_booking-email.js`, `functions/_order-email.js`
  Outbound email adapters.

## Design goals

- Keep endpoint contracts stable for the existing frontend.
- Centralize cross-cutting concerns (auth, JSON responses, parsing, error handling).
- Keep route files small and testable.
- Make future migration to full TypeScript straightforward.

## Local verification

- `node --test`
  Runs the built-in `node:test` suite against booking rules, order rules, service behavior, and auth boundaries.
- `npm test`
  Equivalent script entry if `npm` is installed on the machine.

## Suggested next step

If you want this to go further, the next high-impact move is converting `_lib` and `api` to TypeScript while keeping `_booking-core.js` and `_orders-core.js` behavior unchanged during the first TS transition. The new test harness provides enough safety to do that incrementally instead of in one risky jump.
