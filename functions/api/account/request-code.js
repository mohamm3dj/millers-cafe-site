"use strict";

import { ApiError, errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed } from "../../_lib/json.js";
import { recordAnalyticsEvent } from "../../_lib/analytics.js";
import { enforceRateLimit } from "../../_lib/rate-limit.js";
import { requestAccountSignInCode } from "../../_lib/account-auth.js";
import { verifyTurnstileToken } from "../../_lib/turnstile.js";

const MAX_ACCOUNT_BODY_BYTES = 8 * 1024;

async function readBoundedJsonBody(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ACCOUNT_BODY_BYTES) {
    throw new ApiError("Request body is too large.", 413);
  }

  if (!request.body || typeof request.body.getReader !== "function") return null;
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_ACCOUNT_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch (error) {
        // The size error below is authoritative.
      }
      throw new ApiError("Request body is too large.", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    return null;
  }
}

async function recordAnalyticsBestEffort(context, name, details) {
  const task = recordAnalyticsEvent(context.env, name, details).catch(() => null);
  if (typeof context.waitUntil === "function") {
    try {
      context.waitUntil(task);
    } catch (error) {
      // Analytics must never change the sign-in outcome.
    }
    return;
  }
  await task;
}

export async function onRequestPost(context) {
  try {
    await enforceRateLimit(context.env, context.request, {
      prefix: "account_request_code",
      limit: 5,
      windowSeconds: 300,
      message: "Too many sign-in code requests. Please wait a few minutes and try again."
    });

    const payload = await readBoundedJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }
    if (String(payload.email || "").trim().length > 254) {
      throw new ApiError("Email address must be 254 characters or fewer.", 400);
    }

    await verifyTurnstileToken(context.env, context.request, payload.turnstileToken);
    const result = await requestAccountSignInCode(context.env, payload.email);
    await recordAnalyticsBestEffort(context, "account_code_requested", {
      page: "account",
      route: "/api/account/request-code"
    });
    return json(result);
  } catch (error) {
    return errorResponse(error, "Sign-in code could not be requested.");
  }
}

export function onRequest() {
  return methodNotAllowed(["POST"]);
}
