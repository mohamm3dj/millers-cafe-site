# Booking Feed Integration

The booking system uses Cloudflare Pages Functions for:

- `POST /api/bookings`
- `GET /api/bookings/slots?date=YYYY-MM-DD&partySize=2&durationMinutes=90`
- `GET /bookings/feed.csv`
- `GET /bookings/feed.json`

See `../DEPLOY-BOOKINGS-CLOUDFLARE.md` for the complete deployment checklist.

## Required bindings and credentials

Bind a Cloudflare KV namespace as `BOOKINGS_KV` in both Production and Preview.
Create a dedicated `BOOKINGS_FEED_TOKEN` with at least 32 random bytes and store it
as an encrypted Cloudflare secret. Do not reuse an admin, order-feed, venue-bridge,
email-action, Stripe, or Resend credential.

The booking feed fails closed when `BOOKINGS_FEED_TOKEN` is absent. It never becomes
an anonymous feed.

## Configure the client

Use either endpoint:

- `https://millers.cafe/bookings/feed.csv`
- `https://millers.cafe/bookings/feed.json`

Send the credential as an HTTP header:

```text
Authorization: Bearer <BOOKINGS_FEED_TOKEN>
```

For example:

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $BOOKINGS_FEED_TOKEN" \
  https://millers.cafe/bookings/feed.json
```

Query-string tokens are not supported and are intentionally ignored. If a client
cannot attach a request header, update or replace that integration before using the
feed. Rotate any credential previously included in a URL.

## Required booking environment

In addition to the feed token and KV binding, configure:

- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `REQUIRE_TURNSTILE=true`
- `REQUIRE_DISTRIBUTED_RATE_LIMIT=true`
- `RESEND_API_KEY`
- `BOOKINGS_EMAIL_FROM=Millers Cafe <bookings@millers.cafe>`
- `BOOKINGS_NOTIFICATION_EMAIL=help@millers.cafe`
- `BOOKINGS_REPLY_TO=help@millers.cafe`
- `EMAIL_ACTION_SECRET=<independent-long-random-secret>`
- `SITE_ORIGIN=https://millers.cafe`

Verify the sender domain in Resend. Configure the same controls for Preview with
separate secrets where practical.

## Verify after deployment

Check that the public booking page and slots endpoint work, then exercise the feed
with and without authentication:

```bash
curl --fail-with-body \
  "https://millers.cafe/api/bookings/slots?date=2026-07-18&partySize=2&durationMinutes=90"

curl --fail-with-body \
  --header "Authorization: Bearer $BOOKINGS_FEED_TOKEN" \
  https://millers.cafe/bookings/feed.csv
```

Also confirm:

- no token returns `401`;
- a query-string token returns `401`;
- an order-feed or admin token returns `401`;
- the correct bearer token returns CSV or JSON without being logged in the URL;
- Turnstile is visible and a real booking can be submitted;
- the booking appears once in KV and in the authenticated feed;
- customer and staff email delivery succeeds.
