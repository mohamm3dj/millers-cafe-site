# Security Hardening Notes

This site is static and should be fronted by Cloudflare.

## Cloudflare baseline

- SSL/TLS mode: `Full (strict)`
- Always Use HTTPS: `On`
- Automatic HTTPS Rewrites: `On`
- Under Attack Mode: `Off` (unless actively mitigating an attack)
- Bot Fight Mode: `On` (monitor and tune if challenges are too aggressive)

## Recommended response headers (Cloudflare Response Header Transform Rules)

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`

The repository-level `_headers` file applies the Turnstile-compatible CSP to static Pages assets, and the root Pages middleware applies it to Function responses. Do not also set CSP in a Cloudflare Response Header Transform Rule: multiple CSP headers are intersected, so an older edge policy that limits `script-src`, `connect-src`, or `frame-src` to `'self'` still blocks Turnstile even when the application keys are configured.

## Required production controls

The deployed configuration in `wrangler.toml` sets:

- `REQUIRE_TURNSTILE=true`
- `REQUIRE_DISTRIBUTED_RATE_LIMIT=true`

Before deploying this revision, configure `TURNSTILE_SITE_KEY` and the secret `TURNSTILE_SECRET_KEY` for both Production and Preview. Confirm that the `BOOKINGS_KV` binding exists in both environments. Protected customer actions return `503` when these controls are missing or unavailable rather than silently running without them.

Turnstile and application limits are defense in depth, not a replacement for Cloudflare WAF/rate-limiting rules. Add edge limits for booking creation, checkout creation, account-code request/verification, analytics ingestion, checkout-session reads, and menu/POS proxy traffic.

## Credential scopes

Generate an independent random secret of at least 32 bytes for every scope:

- `BOOKINGS_FEED_TOKEN`: read booking feeds only.
- `ORDERS_FEED_TOKEN`: read order feeds only.
- `ORDERS_ADMIN_TOKEN`: update order status and trigger refund workflows only.
- `VENUE_BRIDGE_TOKEN_V2`: venue bridge routes only; the retired legacy name is intentionally ignored.
- `ADMIN_API_TOKENS` or `ADMIN_API_TOKEN`: admin configuration, menu, and analytics only.
- `EMAIL_ACTION_SECRET`: sign staff email actions only.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`: Stripe only.

Send API credentials with `Authorization: Bearer <token>`. Query-string tokens are not accepted. Do not reuse a read-only feed token for a write-capable route.

Feeds and admin routes fail closed when their scoped credentials are absent. The legacy unpaid `POST /api/orders` route is disabled; customer orders must use Stripe-backed `/api/orders/checkout`.

## Deployment verification

After every production or preview deployment, verify:

- Anonymous booking and order feeds return `401` or `503`, never `200`.
- The correct bearer token reads only its matching feed.
- Feed tokens cannot access admin, bridge, or order-status mutation routes.
- Turnstile renders on booking, checkout, and account sign-in flows.
- A missing/invalid Turnstile token is rejected.
- `POST /api/orders` returns `410`.
- Security headers match the Turnstile-compatible policy above.

Rotate a credential immediately if it appears in a URL, log, public file, or browser history.

## Email DNS reminders

Mail records must stay `DNS only` (not proxied):

- MX records
- SPF/DMARC TXT records
- DKIM CNAME records
- `email` CNAME if required by provider
