"use strict";

import { ApiError } from "./errors.js";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

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

function stripeHeaders(secretKey, hasBody = false) {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    Accept: "application/json"
  };
  if (hasBody) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  return headers;
}

export async function stripeRequest(env, method, pathname, options = {}) {
  const secretKey = assertStripeSecretKey(env);
  const url = buildStripeUrl(pathname, options.query);
  const hasBody = options.form instanceof URLSearchParams;

  const response = await fetch(url, {
    method,
    headers: stripeHeaders(secretKey, hasBody),
    body: hasBody ? options.form.toString() : undefined
  });

  const text = await response.text();
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

export async function createCheckoutSession(env, form) {
  if (!(form instanceof URLSearchParams)) {
    throw new ApiError("Stripe checkout session payload must be form encoded.", 500);
  }
  return stripeRequest(env, "POST", "/checkout/sessions", { form });
}

export async function createRefund(env, form) {
  if (!(form instanceof URLSearchParams)) {
    throw new ApiError("Stripe refund payload must be form encoded.", 500);
  }
  return stripeRequest(env, "POST", "/refunds", { form });
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
