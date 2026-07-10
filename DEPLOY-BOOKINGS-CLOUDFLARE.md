# Deploy Bookings, Orders, and POS Feeds on Cloudflare Pages

This site must run on Cloudflare Pages, not GitHub Pages, because its booking,
checkout, account, admin, email-action, and feed endpoints use Pages Functions.

## Pages build settings

Create the Pages project from this repository with these settings:

- Framework preset: `None`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: leave blank (the repository root)

The build copies only public browser assets into `dist`. Tests, Functions source,
documentation, backups, local scripts, `.dev.vars.example`, and repository metadata
are deliberately excluded. Keep the `functions/` directory at the repository root;
Cloudflare discovers and deploys it separately from the static output directory.

If deploying with Wrangler, `pages_build_output_dir` in `wrangler.toml` must also be
`"dist"`. Do not point Pages at the repository root.

## Required Cloudflare configuration

Configure both Production and Preview unless a value is intentionally
environment-specific.

1. Create a KV namespace and bind it as `BOOKINGS_KV`.
2. Set `TURNSTILE_SITE_KEY` and the encrypted secret `TURNSTILE_SECRET_KEY`.
3. Keep `REQUIRE_TURNSTILE=true` and
   `REQUIRE_DISTRIBUTED_RATE_LIMIT=true` in production.
4. Create separate, randomly generated credentials for each scope:
   - `BOOKINGS_FEED_TOKEN`: read-only booking feed
   - `ORDERS_FEED_TOKEN`: read-only order feed
   - `ORDERS_ADMIN_TOKEN`: order-status administration
   - `VENUE_BRIDGE_TOKEN`: POS/venue write integration
   - `ADMIN_API_TOKENS`: site configuration, menu, and analytics administration
   - `EMAIL_ACTION_SECRET`: signed staff email actions
5. Configure Stripe and Resend secrets described in `README.md` and
   `.dev.vars.example`.
6. Set `SITE_ORIGIN=https://millers.cafe`.
7. While the business is closed, set Production `MAINTENANCE_MODE=true` and
   Preview `MAINTENANCE_MODE=false`.
8. Keep Production `ONLINE_ORDERING_ENABLED=false` (or unset) until the
   owner-verified recipe/supplier allergen matrix in `ALLERGEN-DATA-TEMPLATE.md`
   is complete. Set it to `true` only after that release gate passes.

Generate every token independently with at least 32 random bytes. Store tokens and
API keys as encrypted Cloudflare secrets, never as values committed to Git. A
read-only feed token must not be reused for any write-capable route.

## Feed authentication

Booking and order feeds always require their own scoped bearer token. Send it in
the `Authorization` header:

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $BOOKINGS_FEED_TOKEN" \
  https://millers.cafe/bookings/feed.csv
```

The JSON booking feed uses the same booking-feed credential. The order feeds use
`ORDERS_FEED_TOKEN` instead.

Tokens in query strings are intentionally ignored. Do not put credentials in feed
URLs: URLs leak into browser history, access logs, analytics, referrers, screenshots,
and support messages. Update the iPad/POS client to attach the bearer header. If its
feed field can only store a URL and cannot add headers, it is not compatible with
the protected feed and needs an integration update before deployment.

Rotate any token that was previously used in a `?token=` URL.

## Email and payment configuration

At minimum, configure:

- `RESEND_API_KEY`
- `BOOKINGS_EMAIL_FROM`, `BOOKINGS_NOTIFICATION_EMAIL`, `BOOKINGS_REPLY_TO`
- `ORDERS_EMAIL_FROM`, `ORDERS_NOTIFICATION_EMAIL`, `ORDERS_REPLY_TO`
- `ACCOUNT_EMAIL_FROM`, `ACCOUNT_REPLY_TO`
- `EMAIL_ACTION_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `SITE_ORIGIN=https://millers.cafe`

Verify `millers.cafe` in Resend using the DNS records Resend provides. Register the
Stripe webhook endpoint as `https://millers.cafe/api/stripe/webhook` and subscribe
to the checkout events used by the application.

The legacy unpaid `POST /api/orders` route is retired and returns `410`. Website
orders must go through the Stripe checkout endpoint.

## Security headers and Turnstile

The repository `_headers` file covers static Pages assets. The root
`functions/_middleware.js` applies the compatible security headers to Pages
Function responses and also implements the `MAINTENANCE_MODE` 503 shield.

Before enabling traffic, remove or replace any existing dashboard Response Header
Transform Rule that sends a stricter, incompatible Content Security Policy. The
effective policy must allow `https://challenges.cloudflare.com` in `script-src`,
`frame-src`, and `connect-src`. Multiple CSP headers are intersected by browsers, so
adding a permissive policy does not override an older restrictive one.

Remove the incompatible dashboard CSP rule rather than stacking another policy,
then test booking, checkout, and account-code forms in Production and Preview.

## Domain cutover

1. Add `millers.cafe` as the Pages custom domain.
2. Follow Cloudflare's DNS instructions.
3. Remove the old GitHub Pages custom-domain routing to avoid split traffic.
4. Confirm HTTPS is active before submitting live forms or webhooks.

## Pre-deployment verification

Run locally:

```bash
npm test
npm run check:js
npm run build
```

Then verify the Preview deployment before promoting it:

- `/`, `/menu/`, and `/bookings/` load normally.
- An unknown path returns the custom `404.html` with HTTP 404.
- Offline navigation to a nested route shows the offline page, not the homepage.
- Booking, checkout, and account-code forms render Turnstile and submit.
- A feed request without a bearer token returns `401`.
- A feed request with the correct scoped bearer token returns `200`.
- A query-string token still returns `401`.
- A booking token cannot read orders or authorize bridge/admin routes.
- Stripe webhook delivery succeeds and a paid test order finalizes once.
- KV-backed rate limiting is active.
- Production returns the maintenance `503` while `MAINTENANCE_MODE=true`.
- Preview ordering works only when `ONLINE_ORDERING_ENABLED=true`.

Dashboard changes (bindings, encrypted secrets, custom-domain routing, the CSP
Transform Rule, and any WAF/rate-limit rules) cannot be completed by committing this
repository and must be checked manually for both Preview and Production.
