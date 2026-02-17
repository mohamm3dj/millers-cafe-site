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

## Required for booking confirmations

Add email confirmation variables:
   - `RESEND_API_KEY=<your-resend-api-key>`
   - `BOOKINGS_EMAIL_FROM=Millers Cafe <bookings@your-verified-domain>`
   - `BOOKINGS_NOTIFICATION_EMAIL=help@millers.cafe`
   - `BOOKINGS_REPLY_TO=help@millers.cafe`

If these are missing or delivery fails, booking creation is rejected.

## Final app setting

In your iPad app website feed URL, use:

- `https://millers.cafe/bookings/feed.csv`

or tokenized version if you enabled token auth.

## Quick checks after deploy

- `GET https://millers.cafe/bookings/` loads booking form.
- `GET https://millers.cafe/api/bookings/slots?date=2026-02-18&partySize=2&durationMinutes=90` returns JSON.
- `GET https://millers.cafe/bookings/feed.csv` returns CSV (or 401 if token enabled and missing).
