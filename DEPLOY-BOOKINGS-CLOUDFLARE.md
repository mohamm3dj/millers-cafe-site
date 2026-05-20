# Deploy Bookings + POS Feed (Cloudflare Pages)

This repo is now ready for online bookings + app feed, but it must run on Cloudflare Pages (not GitHub Pages) because it uses `functions/`.

## What is already done in code

- Website booking form with server-side availability checks:
  - Tue-Sun only
  - 12:00-16:00 only
  - 15-minute intervals only
  - blocks fully-booked slots
- Server endpoints:
  - `POST /api/bookings`
  - `GET /api/bookings/slots`
  - `GET /bookings/feed.csv`
  - `GET /bookings/feed.json`
- Feed output matches POS import columns.

## What you need to do (required)

1. Create a Cloudflare Pages project from this GitHub repo.
2. Set build settings:
   - Framework preset: `None`
   - Build command: *(blank)*
   - Build output directory: `.`
3. Create a KV namespace in Cloudflare and bind it to Pages:
   - Binding name: `BOOKINGS_KV`
4. Add custom domain `millers.cafe` to this Pages project.
5. In DNS, point `millers.cafe` to Cloudflare Pages as instructed by Cloudflare.
6. Remove/disable previous GitHub Pages domain routing for `millers.cafe` to avoid conflicts.

## Optional

1. Add Pages environment variable:
   - `BOOKINGS_FEED_TOKEN=<long-random-secret>`
2. Use tokenized app feed URL:
   - `https://millers.cafe/bookings/feed.csv?token=<secret>`
3. Optional POS menu catalog endpoint for admin/bridge integrations:
   - `POS_MENU_URL=https://your-pos.example/api/menu`
   - `POS_MENU_BEARER_TOKEN=<pos-menu-token>` if your POS uses bearer auth
   - `POS_MENU_API_KEY=<pos-api-key>` if your POS uses an API key
   - `POS_MENU_TIMEOUT_MS=5000`

If `POS_MENU_URL` is configured, `/api/menu-catalog` pulls from that POS endpoint. The customer-facing public menu, collection page, delivery page, and checkout pricing stay on the bundled website menu so stale POS/KV data cannot replace the live site menu. If the POS endpoint is down, `/api/menu-catalog` falls back to the last saved menu in KV, then the bundled menu.

## Required for booking confirmations

Add email confirmation variables:
   - `RESEND_API_KEY=<your-resend-api-key>`
   - `BOOKINGS_EMAIL_FROM=Millers Cafe <help@millers.cafe>`
   - `BOOKINGS_NOTIFICATION_EMAIL=help@millers.cafe`
   - `BOOKINGS_REPLY_TO=help@millers.cafe`
   - `ORDERS_EMAIL_FROM=Millers Cafe <help@millers.cafe>`
   - `ORDERS_NOTIFICATION_EMAIL=help@millers.cafe`
   - `ORDERS_REPLY_TO=help@millers.cafe`
   - `ACCOUNT_EMAIL_FROM=Millers Cafe <help@millers.cafe>`
   - `ACCOUNT_REPLY_TO=help@millers.cafe`
   - `SITE_ORIGIN=https://millers.cafe`
   - `EMAIL_ACTION_SECRET=<long-random-secret>` *(optional if `VENUE_BRIDGE_TOKEN` is already set)*
   - `EMAIL_ACTION_DEFAULT_ETA_MINUTES=35`

The `millers.cafe` domain must be verified in Resend with the DNS records Resend gives you. If email configuration is missing or Resend rejects delivery, the site returns `emailStatus: "pending"` for bookings and Stripe-paid orders so the booking/order is still saved, while unpaid direct order creation is rejected.

Staff booking/order notification emails include signed accept/decline links. Links open a confirmation page first, then update the same Cloudflare KV records used by the app/POS feeds and email the customer. Order accept links use `EMAIL_ACTION_DEFAULT_ETA_MINUTES` as the starting ETA, which staff can adjust on the confirmation page.

## Final app setting

In your iPad app website feed URL, use:

- `https://millers.cafe/bookings/feed.csv`

or tokenized version if you enabled token auth.

## Quick checks after deploy

- `GET https://millers.cafe/bookings/` loads booking form.
- `GET https://millers.cafe/api/bookings/slots?date=2026-02-18&partySize=2&durationMinutes=90` returns JSON.
- `GET https://millers.cafe/bookings/feed.csv` returns CSV (or 401 if token enabled and missing).
