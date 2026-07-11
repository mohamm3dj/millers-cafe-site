"use strict";

import { ApiError } from "./errors.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_TURNSTILE_TIMEOUT_MS = 8000;

function turnstileSiteKey(env) {
  return String(env?.TURNSTILE_SITE_KEY || "").trim();
}

function turnstileSecretKey(env) {
  return String(env?.TURNSTILE_SECRET_KEY || "").trim();
}

function enabledFlag(value) {
  return ["1", "true", "yes", "on", "required"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function turnstileTimeoutMs(env) {
  const parsed = Number(env?.TURNSTILE_TIMEOUT_MS || DEFAULT_TURNSTILE_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TURNSTILE_TIMEOUT_MS;
  return Math.max(1000, Math.min(15000, Math.round(parsed)));
}

function clientIp(request) {
  const forwarded = String(request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "").trim();
  if (!forwarded) return "";
  return forwarded.split(",")[0].trim().slice(0, 128);
}

export function turnstileEnabled(env) {
  return Boolean(turnstileSiteKey(env) && turnstileSecretKey(env));
}

export function turnstileRequired(env) {
  return enabledFlag(env?.REQUIRE_TURNSTILE);
}

export function turnstileClientConfig(env) {
  return {
    enabled: turnstileEnabled(env),
    required: turnstileRequired(env),
    siteKey: turnstileSiteKey(env)
  };
}

export async function verifyTurnstileToken(env, request, token) {
  const siteKey = turnstileSiteKey(env);
  const secretKey = turnstileSecretKey(env);
  const hasPartialConfiguration = Boolean(siteKey) !== Boolean(secretKey);

  if (hasPartialConfiguration || (turnstileRequired(env) && !siteKey && !secretKey)) {
    throw new ApiError("Security verification is temporarily unavailable.", 503);
  }

  if (!siteKey && !secretKey) {
    return { enabled: false, success: true };
  }

  const responseToken = String(token || "").trim();
  if (!responseToken) {
    throw new ApiError("Security verification is required.", 400);
  }

  const form = new URLSearchParams();
  form.set("secret", secretKey);
  form.set("response", responseToken);
  const ip = clientIp(request);
  if (ip) {
    form.set("remoteip", ip);
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), turnstileTimeoutMs(env))
    : null;

  let response;
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: form.toString(),
      signal: controller?.signal
    });
  } catch (error) {
    throw new ApiError("Security verification is temporarily unavailable.", 503);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  let body = {};
  try {
    body = await response.json();
  } catch (error) {
    body = {};
  }

  if (!response.ok) {
    throw new ApiError("Security verification is temporarily unavailable.", 503);
  }

  if (body?.success !== true) {
    throw new ApiError("Security verification failed. Please try again.", 400, {
      turnstile: Array.isArray(body?.["error-codes"]) ? body["error-codes"] : []
    });
  }

  return {
    enabled: true,
    success: true
  };
}
