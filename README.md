# Millers Cafe Site

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

- `node --test`
  Runs smoke tests for booking rules, order rules, service behavior, and auth boundaries.
- `npm test`
  Equivalent script entry if `npm` is installed on the machine.

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

## POS bridge

Bookings now enter the site as pending requests. The venue POS bridge should use a Cloudflare Pages secret named `VENUE_BRIDGE_TOKEN`, then read pending bookings from `GET /api/bridge/bookings?status=pending` and post decisions to `POST /api/bridge/bookings`.
