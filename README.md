# Millers Café Site

Static frontend pages plus Cloudflare Pages Functions for bookings, orders, and order-status flows.

## Structure

- `index.html`, `menu/`, `bookings/`, `delivery/`, `collection/`
  Static site pages and browser-side JavaScript.
- `functions/api/*`
  Thin Pages Function route handlers.
- `functions/_lib/*`
  Shared API infrastructure and workflow services.
- `functions/_booking-core.js`, `functions/_orders-core.js`
  Booking and order domain logic, validation, persistence, and feed shaping.
- `functions/_booking-email.js`, `functions/_order-email.js`
  Outbound email adapters.
- `functions/_lib/order-menu.js`, `functions/_lib/order-checkout-service.js`, `functions/_lib/stripe.js`
  Stripe checkout pricing, checkout-session workflow, webhook verification, and paid-order finalization.

## Local checks

- `node --test tests/*.test.js`
  Runs smoke tests for booking rules, order rules, service behavior, and auth boundaries.
- `npm run check`
  Runs the complete test suite, checks every JavaScript file, and creates the public-only deployment output.

## Build and deploy boundary

Run `npm run build` to create `dist/`. The build uses an explicit allowlist so source code, tests, credentials, and operational documentation cannot be published as static files.

Configure Cloudflare Pages with:

- Build command: `npm run build`
- Build output directory: `dist`

Keep the repository-level `functions/` directory in place for Cloudflare Pages Functions; it is intentionally not copied into `dist/`.

For local Pages development, copy `.dev.vars.example` to `.dev.vars` and replace only the credentials needed for the flow you are testing. The example disables production-only Turnstile and distributed-rate-limit requirements; `wrangler.toml` enables both requirements for deployed environments.

## Release controls

- `MAINTENANCE_MODE=true` makes every route return a non-cacheable `503` holiday/maintenance page. Keep it enabled only in Production while the business is closed; Preview should remain `false` for testing.
- `ONLINE_ORDERING_ENABLED=true` explicitly enables Stripe checkout. When the variable is absent, the `millers.cafe` production hostname fails closed while local and Preview hosts remain testable.

Keep Production online ordering disabled until the recipe and supplier evidence in `ALLERGEN-DATA-TEMPLATE.md` has been completed and the resulting item and modifier allergen codes have been owner-verified. The site deliberately does not infer allergen claims from names or descriptions.

## Required security configuration

Set every credential below as a Cloudflare Pages secret in both Production and Preview. Use a separate random value of at least 32 bytes for each scope; do not reuse feed, admin, bridge, email-action, or Stripe credentials.

- `BOOKINGS_FEED_TOKEN`
  Read-only access to booking CSV/JSON feeds.
- `ORDERS_FEED_TOKEN`
  Read-only access to order CSV/JSON feeds.
- `ORDERS_ADMIN_TOKEN`
  Write access to order decisions and refund-triggering status changes.
- `VENUE_BRIDGE_TOKEN_V2`
  Read/write access to venue bridge routes.
- `ADMIN_API_TOKENS`
  Comma-separated admin tokens for site configuration, menu management, and analytics. `ADMIN_API_TOKEN` is also accepted for a single admin credential.
- `EMAIL_ACTION_SECRET`
  Dedicated HMAC secret for staff email action links.
- `TURNSTILE_SECRET_KEY`
  Cloudflare Turnstile server-side secret.

Set `TURNSTILE_SITE_KEY` as a regular Pages variable. Deployed requests fail closed when either Turnstile key or the `BOOKINGS_KV` binding is unavailable. Keep `REQUIRE_TURNSTILE=true` and `REQUIRE_DISTRIBUTED_RATE_LIMIT=true` in deployed environments.

Protected API credentials must be sent in an HTTP header, preferably:

```text
Authorization: Bearer <scope-specific-token>
```

`X-API-Key` and the legacy `X-Orders-Admin-Token` header are also recognized. Query-string credentials such as `?token=...` are intentionally ignored because URLs leak into logs and browser history.

`POST /api/orders` is retired and returns `410 Gone`; all customer orders must use `POST /api/orders/checkout` so pricing and payment are verified server-side.

## Stripe Setup

This site now uses hosted Stripe Checkout for collection and delivery orders.

### Required configuration

- Cloudflare Pages secret: `STRIPE_SECRET_KEY`
  Use your Stripe secret key from the Stripe Dashboard. In production this should be your live key.
- Cloudflare Pages secret: `STRIPE_WEBHOOK_SECRET`
  This is the signing secret for the Stripe webhook endpoint below.
- Cloudflare Pages variable: `ORDER_DELIVERY_FEE_GBP`
  Optional flat delivery fee in pounds. Defaults to `2.00` if omitted.

### Webhook endpoint

Create a Stripe webhook endpoint that points to:

- `https://your-domain.example/api/stripe/webhook`

Subscribe it to these events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

### What “linking your Stripe account” means here

This integration does not use Stripe Connect or OAuth. To link the website to your Stripe account, you add your own Stripe API keys and webhook secret to the Cloudflare Pages project that runs this site. Payments then go directly into that Stripe account.

### Deployment notes

- Stripe receipts and branding are controlled in your Stripe Dashboard.
- The order is only finalized after Stripe confirms payment.
- If a Stripe-paid order is later rejected in the order-status flow, the site now attempts a full Stripe refund automatically.
- The webhook is the primary fulfillment path; the return page also checks the checkout session so the customer sees confirmation quickly.

## Notes

- Frontend design is intentionally preserved while backend structure is being strengthened.
- More detail on the current backend layout is in `ARCHITECTURE.md`.

## POS menu source

The public menu, collection order page, delivery order page, and checkout pricing render from the bundled website menu so stale POS/KV data cannot replace the customer-facing menus.

The `/api/menu-catalog` endpoint is still available for admin/POS bridge integrations. To pull that catalog directly from a POS system, configure these Cloudflare Pages variables:

- `POS_MENU_URL`: HTTPS JSON endpoint for the POS menu.
- `POS_MENU_BEARER_TOKEN`: optional bearer token for the POS menu endpoint.
- `POS_MENU_API_KEY`: optional API key sent as `X-API-Key`.
- `POS_MENU_TIMEOUT_MS`: optional timeout, default `5000`.

The POS response can be a category array, `{ "menu": [...] }`, `{ "categories": [...] }`, or a flat item/product list with category fields. If the POS source is unavailable, the endpoint falls back to the last saved catalog in KV, then the bundled catalog.

## POS bridge

Bookings now enter the site as pending requests. The venue POS bridge should use a dedicated Cloudflare Pages secret named `VENUE_BRIDGE_TOKEN_V2`, send it as a bearer token, then read pending bookings from `GET /api/bridge/bookings?status=pending` and post decisions to `POST /api/bridge/bookings`.

The POS can still push a menu into the site with `PUT /api/bridge/menu`; that saved menu becomes the fallback cache for the direct POS pull.
