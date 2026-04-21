"use strict";

import { ApiError } from "./errors.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function turnstileSiteKey(env) {
  return String(env?.TURNSTILE_SITE_KEY || "").trim();
}

function turnstileSecretKey(env) {
  return String(env?.TURNSTILE_SECRET_KEY || "").trim();
}

function clientIp(request) {
  const forwarded = String(request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "").trim();
  if (!forwarded) return "";
  return forwarded.split(",")[0].trim();
}

export function turnstileEnabled(env) {
  return Boolean(turnstileSiteKey(env) && turnstileSecretKey(env));
}

export function turnstileClientConfig(env) {
  return {
    enabled: turnstileEnabled(env),
    siteKey: turnstileSiteKey(env)
  };
}

export async function verifyTurnstileToken(env, request, token) {
  if (!turnstileEnabled(env)) {
    return { enabled: false, success: true };
  }

  const responseToken = String(token || "").trim();
  if (!responseToken) {
    throw new ApiError("Security verification is required.", 400);
  }

  const form = new URLSearchParams();
  form.set("secret", turnstileSecretKey(env));
  form.set("response", responseToken);
  const ip = clientIp(request);
  if (ip) {
    form.set("remoteip", ip);
  }

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: form.toString()
  });

  let body = {};
  try {
    body = await response.json();
  } catch (error) {
    body = {};
  }

  if (!response.ok || body?.success !== true) {
    throw new ApiError("Security verification failed. Please try again.", 400, {
      turnstile: Array.isArray(body?.["error-codes"]) ? body["error-codes"] : []
    });
  }

  return {
    enabled: true,
    success: true
  };
}
