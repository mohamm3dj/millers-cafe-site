"use strict";

import { ApiError } from "./errors.js";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;
const DEFAULT_STRIPE_API_VERSION = "2026-02-25.clover";
const DEFAULT_STRIPE_TIMEOUT_MS = 10000;

function stripeSecretKey(env) {
  return String(env?.STRIPE_SECRET_KEY || "").trim();
}

function stripeWebhookSecret(env) {
  return String(env?.STRIPE_WEBHOOK_SECRET || "").trim();
}

function assertStripeSecretKey(env) {
  const secretKey = stripeSecretKey(env);
  if (!secretKey) {
    throw new ApiError("Stripe payments are not configured yet. Add STRIPE_SECRET_KEY first.", 503);
  }
  return secretKey;
}

export function assertStripeWebhookSecret(env) {
  const secret = stripeWebhookSecret(env);
  if (!secret) {
    throw new ApiError("Stripe webhook signing is not configured yet. Add STRIPE_WEBHOOK_SECRET.", 503);
  }
  return secret;
}

function buildStripeUrl(pathname, query) {
  const url = new URL(`${STRIPE_API_BASE}${pathname}`);
  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((entry) => url.searchParams.append(key, String(entry)));
        return;
      }
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url;
}

function normalizedIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key) return "";
  if (key.length > 255) {
    throw new ApiError("Stripe idempotency key must be 255 characters or fewer.", 400);
  }
  return key;
}

function stripeApiVersion(env) {
  return String(env?.STRIPE_API_VERSION || DEFAULT_STRIPE_API_VERSION).trim() || DEFAULT_STRIPE_API_VERSION;
}

function stripeTimeoutMs(env) {
  const parsed = Number(env?.STRIPE_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_STRIPE_TIMEOUT_MS;
  return Math.max(1000, Math.min(30000, Math.round(parsed)));
}

function stripeHeaders(env, secretKey, hasBody = false, idempotencyKey = "") {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    Accept: "application/json",
    "Stripe-Version": stripeApiVersion(env)
  };
  if (hasBody) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const normalizedKey = normalizedIdempotencyKey(idempotencyKey);
  if (normalizedKey) {
    headers["Idempotency-Key"] = normalizedKey;
  }
  return headers;
}

export async function stripeRequest(env, method, pathname, options = {}) {
  const secretKey = assertStripeSecretKey(env);
  const url = buildStripeUrl(pathname, options.query);
  const hasBody = options.form instanceof URLSearchParams;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), stripeTimeoutMs(env))
    : null;

  let response;
  let text;
  try {
    response = await fetch(url, {
      method,
      headers: stripeHeaders(env, secretKey, hasBody, options.idempotencyKey),
      body: hasBody ? options.form.toString() : undefined,
      signal: controller?.signal
    });
    text = await response.text();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiError("Stripe request timed out. Please try again.", 504);
    }
    throw new ApiError("Stripe is temporarily unavailable. Please try again.", 502);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    body = null;
  }

  if (!response.ok) {
    const stripeError = body?.error;
    throw new ApiError(
      stripeError?.message || `Stripe request failed with status ${response.status}.`,
      502,
      {
        stripeStatus: response.status,
        stripeCode: stripeError?.code || "",
        stripeType: stripeError?.type || ""
      }
    );
  }

  return body;
}

export async function createCheckoutSession(env, form, options = {}) {
  if (!(form instanceof URLSearchParams)) {
    throw new ApiError("Stripe checkout session payload must be form encoded.", 500);
  }
  return stripeRequest(env, "POST", "/checkout/sessions", {
    form,
    idempotencyKey: options.idempotencyKey
  });
}

export async function createRefund(env, form, options = {}) {
  if (!(form instanceof URLSearchParams)) {
    throw new ApiError("Stripe refund payload must be form encoded.", 500);
  }
  return stripeRequest(env, "POST", "/refunds", {
    form,
    idempotencyKey: options.idempotencyKey
  });
}

export async function retrieveCheckoutSession(env, sessionId) {
  const normalized = String(sessionId || "").trim();
  if (!normalized) {
    throw new ApiError("Checkout session id is required.", 400);
  }
  return stripeRequest(env, "GET", `/checkout/sessions/${encodeURIComponent(normalized)}`);
}

function parseStripeSignatureHeader(headerValue) {
  const header = String(headerValue || "").trim();
  if (!header) return { timestamp: 0, signatures: [] };

  const entries = header.split(",").map((part) => part.trim());
  const timestamp = Number(entries.find((entry) => entry.startsWith("t="))?.slice(2) || "0");
  const signatures = entries
    .filter((entry) => entry.startsWith("v1="))
    .map((entry) => entry.slice(3))
    .filter(Boolean);

  return { timestamp, signatures };
}

function timingSafeEqualHex(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmacSha256Hex(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return [...new Uint8Array(signature)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyStripeWebhookSignature(payload, signatureHeader, endpointSecret, toleranceSeconds = DEFAULT_WEBHOOK_TOLERANCE_SECONDS) {
  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || signatures.length === 0) {
    throw new ApiError("Missing Stripe signature header.", 400);
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (Number.isFinite(toleranceSeconds) && toleranceSeconds > 0 && ageSeconds > toleranceSeconds) {
    throw new ApiError("Stripe webhook timestamp is outside the allowed tolerance.", 400);
  }

  const expected = await hmacSha256Hex(endpointSecret, `${timestamp}.${payload}`);
  const matches = signatures.some((signature) => timingSafeEqualHex(signature, expected));
  if (!matches) {
    throw new ApiError("Stripe webhook signature verification failed.", 400);
  }
}
