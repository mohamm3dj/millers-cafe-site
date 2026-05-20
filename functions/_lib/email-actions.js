"use strict";

import { ApiError } from "./errors.js";

const DEFAULT_SITE_ORIGIN = "https://millers.cafe";
const TOKEN_VERSION = "v1";

const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(binary, "binary").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function normalizeKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  if (kind === "booking" || kind === "order") return kind;
  return "";
}

export function normalizeEmailActionStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "accepted" || status === "accept" || status === "approved" || status === "confirmed") {
    return "accepted";
  }
  if (status === "rejected" || status === "reject" || status === "declined" || status === "decline") {
    return "rejected";
  }
  return "";
}

export function emailActionSecret(env) {
  return String(
    env?.EMAIL_ACTION_SECRET ||
    env?.VENUE_BRIDGE_TOKEN ||
    env?.ORDERS_ADMIN_TOKEN ||
    env?.RESEND_API_KEY ||
    ""
  ).trim();
}

export function emailActionsEnabled(env) {
  return Boolean(emailActionSecret(env));
}

export function siteOrigin(env) {
  const origin = String(env?.SITE_ORIGIN || env?.PUBLIC_SITE_ORIGIN || DEFAULT_SITE_ORIGIN).trim();
  return origin.replace(/\/+$/g, "") || DEFAULT_SITE_ORIGIN;
}

export function defaultOrderEtaMinutes(env) {
  const parsed = Number(env?.EMAIL_ACTION_DEFAULT_ETA_MINUTES || env?.ORDERS_EMAIL_ACCEPT_ETA_MINUTES || 35);
  if (!Number.isFinite(parsed)) return 35;
  return Math.max(1, Math.min(240, Math.round(parsed)));
}

async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64Url(new Uint8Array(signature));
}

export async function emailActionToken(env, options = {}) {
  const secret = emailActionSecret(env);
  const kind = normalizeKind(options.kind);
  const status = normalizeEmailActionStatus(options.status);
  const reference = String(options.reference || "").trim().toUpperCase();
  if (!secret || !kind || !status || !reference) return "";
  return hmacSha256(secret, [TOKEN_VERSION, kind, reference, status].join(":"));
}

export async function emailActionUrl(env, options = {}) {
  const kind = normalizeKind(options.kind);
  const status = normalizeEmailActionStatus(options.status);
  const reference = String(options.reference || "").trim().toUpperCase();
  const token = await emailActionToken(env, { kind, status, reference });
  if (!kind || !status || !reference || !token) return "";

  const path = kind === "booking" ? "/api/email-actions/bookings" : "/api/email-actions/orders";
  const url = new URL(path, siteOrigin(env));
  url.searchParams.set("reference", reference);
  url.searchParams.set("status", status);
  url.searchParams.set("token", token);

  if (kind === "order" && status === "accepted") {
    const etaMinutes = Math.max(1, Math.round(Number(options.etaMinutes || defaultOrderEtaMinutes(env))));
    url.searchParams.set("etaMinutes", String(etaMinutes));
  }

  return url.toString();
}

export async function verifyEmailAction(env, options = {}) {
  const kind = normalizeKind(options.kind);
  const status = normalizeEmailActionStatus(options.status);
  const reference = String(options.reference || "").trim().toUpperCase();
  const token = String(options.token || "").trim();
  if (!kind) throw new ApiError("Invalid email action type.", 400);
  if (!reference) throw new ApiError("Missing reference.", 400);
  if (!status) throw new ApiError("Action must be accepted or rejected.", 400);
  if (!token) throw new ApiError("Missing action token.", 400);

  const expected = await emailActionToken(env, { kind, status, reference });
  if (!expected || !safeEqual(expected, token)) {
    throw new ApiError("This email action link is invalid.", 403);
  }

  return { kind, reference, status, token };
}

export async function actionParamsFromRequest(request) {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);

  if (String(request.method || "").toUpperCase() === "POST") {
    try {
      const form = await request.formData();
      for (const [key, value] of form.entries()) {
        params.set(key, String(value || ""));
      }
    } catch (error) {
      // Non-form POSTs can still use query-string parameters.
    }
  }

  return {
    reference: params.get("reference") || "",
    status: params.get("status") || "",
    token: params.get("token") || "",
    etaMinutes: params.get("etaMinutes") || "",
    reason: params.get("reason") || ""
  };
}

export function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

export function pageResponse(title, body, status = 200) {
  const safeTitle = htmlEscape(title);
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #f8fafc;
      color: #111827;
      line-height: 1.5;
    }
    main {
      max-width: 620px;
      margin: 0 auto;
      padding: 40px 18px;
    }
    .panel {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
    }
    h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.2; }
    p { margin: 0 0 16px; }
    label { display: block; margin: 16px 0 6px; font-weight: 700; }
    input, textarea {
      box-sizing: border-box;
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 12px;
      font: inherit;
    }
    textarea { min-height: 92px; resize: vertical; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
    button, .link-button {
      border: 0;
      border-radius: 6px;
      padding: 11px 16px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      color: #fff;
      background: #166534;
      text-decoration: none;
      display: inline-block;
    }
    .reject { background: #991b1b; }
    .secondary { background: #475569; }
    .muted { color: #64748b; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      ${body}
    </section>
  </main>
</body>
</html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function confirmationForm({ actionLabel, actionClass = "", hiddenFields = "", extraFields = "" }) {
  return `<form method="post">
    ${hiddenFields}
    ${extraFields}
    <div class="actions">
      <button class="${htmlEscape(actionClass)}" type="submit">${htmlEscape(actionLabel)}</button>
    </div>
  </form>`;
}
