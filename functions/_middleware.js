"use strict";

const MAINTENANCE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Millers Café — Temporarily closed</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f6efe4; color: #2d2118; }
    main { width: min(100%, 620px); padding: clamp(28px, 6vw, 52px); border: 1px solid #d9c9b8; border-radius: 24px; background: #fffdf9; box-shadow: 0 18px 60px rgba(71, 45, 26, .12); text-align: center; }
    p { margin: 14px auto 0; max-width: 46ch; line-height: 1.65; }
    a { color: #7a3e16; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>We’re taking a short holiday break</h1>
    <p>Millers Café is temporarily closed while we complete planned website maintenance. Please check back soon.</p>
    <p>Need to reach us? Email <a href="mailto:help@millers.cafe">help@millers.cafe</a>.</p>
  </main>
</body>
</html>`;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "form-action 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "upgrade-insecure-requests"
].join("; ");

const MAINTENANCE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

const MAINTENANCE_BRIDGE_PATHS = new Set([
  "/api/bridge/bookings",
  "/api/bridge/menu",
  "/api/bridge/orders"
]);

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isMaintenanceBridgeRequest(request) {
  try {
    return MAINTENANCE_BRIDGE_PATHS.has(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

function applySecurityHeaders(headers, contentSecurityPolicy = CONTENT_SECURITY_POLICY) {
  headers.set("Content-Security-Policy", contentSecurityPolicy);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-site");
  headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return headers;
}

function maintenanceResponse(request) {
  const headers = applySecurityHeaders(new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "text/html; charset=utf-8",
    "Retry-After": "3600",
    "X-Robots-Tag": "noindex, nofollow, noarchive"
  }), MAINTENANCE_CONTENT_SECURITY_POLICY);
  const body = request.method === "HEAD" ? null : MAINTENANCE_HTML;
  return new Response(body, { status: 503, headers });
}

export async function onRequest(context) {
  if (isEnabled(context.env?.MAINTENANCE_MODE) && !isMaintenanceBridgeRequest(context.request)) {
    return maintenanceResponse(context.request);
  }

  const response = await context.next();
  const headers = applySecurityHeaders(new Headers(response.headers));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
