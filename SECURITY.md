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

Note: this repo also sets CSP/referrer/permissions via HTML meta tags. Header-level policies in Cloudflare are stronger and should still be configured.

## Email DNS reminders

Mail records must stay `DNS only` (not proxied):

- MX records
- SPF/DMARC TXT records
- DKIM CNAME records
- `email` CNAME if required by provider
