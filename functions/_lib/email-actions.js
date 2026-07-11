"use strict";

import { ApiError } from "./errors.js";
import { readTextBody, RequestBodyError } from "./json.js";

const DEFAULT_SITE_ORIGIN = "https://millers.cafe";
const TOKEN_VERSION = "v1";
const MAX_EMAIL_ACTION_BODY_BYTES = 64 * 1024;

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
  return String(env?.EMAIL_ACTION_SECRET || "").trim();
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
      const contentType = String(request.headers.get("content-type") || "").toLowerCase();
      if (contentType && !contentType.includes("application/x-www-form-urlencoded")) {
        throw new ApiError("Email action form encoding is invalid.", 415);
      }
      const rawBody = await readTextBody(request, {
        maxBytes: MAX_EMAIL_ACTION_BODY_BYTES
      });
      for (const [key, value] of new URLSearchParams(rawBody).entries()) {
        params.set(key, value);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof RequestBodyError) {
        throw new ApiError(error.message, error.status);
      }
      throw new ApiError("Email action form could not be read.", 400);
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
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="/styles.css?v=20260710a">
</head>
<body class="actionBody">
  <main class="actionPage">
    <section class="actionPanel">
      ${body}
    </section>
  </main>
</body>
</html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests; block-all-mixed-content",
      "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow"
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
