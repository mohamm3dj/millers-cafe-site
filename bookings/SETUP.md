# Bookings Integration Setup

This bookings section now uses Cloudflare Pages Functions for:

- `POST /api/bookings` (create booking)
- `GET /api/bookings/slots?date=YYYY-MM-DD&partySize=2&durationMinutes=90` (availability API)
- `GET /bookings/feed.csv` (POS CSV feed)
- `GET /bookings/feed.json` (POS JSON feed)

## 1. Deploy on Cloudflare Pages

GitHub Pages does not run `functions/`.  
To use online bookings + automatic POS feed, deploy this repo on Cloudflare Pages.

## 2. Add KV binding

Create a KV namespace and bind it to this project as:

- Binding name: `BOOKINGS_KV`

The functions store bookings under key `bookings_v1`.

## 3. Optional feed token

If you want the feed protected, add environment variable:

- `BOOKINGS_FEED_TOKEN=<your-secret-token>`

Then your app feed URL should include:

- `https://millers.cafe/bookings/feed.csv?token=<your-secret-token>`

## 4. Email confirmations (required)

To email both customer + staff receipts on each booking, add these env vars in Cloudflare Pages (Production):

- `RESEND_API_KEY=<your-resend-api-key>`
- `BOOKINGS_EMAIL_FROM=Millers Cafe <bookings@your-verified-domain>`
- `BOOKINGS_NOTIFICATION_EMAIL=help@millers.cafe`
- `BOOKINGS_REPLY_TO=help@millers.cafe`

Notes:

- `BOOKINGS_EMAIL_FROM` must use a sender/domain verified in Resend.
- If email vars are missing or delivery fails, booking creation is rejected.

## 5. App feed URL

In the MillersCafe app website import field, use one of:

- `https://millers.cafe/bookings/feed.csv`
- `https://millers.cafe/bookings/feed.json`

If token is enabled, append `?token=...`.

## Notes

- Booking rules are enforced server-side:
  - Tue-Sun only
  - 12:00-16:00 only
  - 15-minute intervals only
  - email required
  - phone format required: `XXXXX XXXXXX`
  - rejected if no table availability
- Tables are auto-assigned using the same table capacities and multi-table combinations as the app.

## Verify after deploy

Run:

```bash
bash bookings/verify-deployment.sh https://millers.cafe 2026-02-18
```
