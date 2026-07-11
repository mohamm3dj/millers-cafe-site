"use strict";

import { resolveFeedTokens, isTokenAuthorized } from "../_lib/auth.js";
import { recordAnalyticsEvent } from "../_lib/analytics.js";
import { createBooking, listBookingFeed } from "../_lib/bookings-service.js";
import { errorResponse, ApiError } from "../_lib/errors.js";
import { queryFlag, queryLower, urlOf } from "../_lib/http.js";
import { csv, json, methodNotAllowed } from "../_lib/json.js";
import { enforceRateLimit } from "../_lib/rate-limit.js";
import { verifyTurnstileToken } from "../_lib/turnstile.js";

const MAX_BOOKING_BODY_BYTES = 32 * 1024;

async function readBoundedJsonBody(request, maxBytes) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
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
    if (totalBytes > maxBytes) {
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
      // Analytics must never change the booking outcome.
    }
    return;
  }
  await task;
}

export async function onRequestGet(context) {
  try {
    const tokens = resolveFeedTokens(context.env, "bookings");
    if (!isTokenAuthorized(context.request, tokens)) {
      throw new ApiError("Unauthorized feed token.", 401);
    }

    const url = urlOf(context.request);
    const includePast = queryFlag(url, "includePast");
    const format = queryLower(url, "format", "");
    const result = await listBookingFeed(context.env, includePast, format);
    if (result.format === "json") {
      return json(result.body);
    }
    return csv(result.body);
  } catch (error) {
    return errorResponse(error, "Could not load booking feed.");
  }
}

export async function onRequestPost(context) {
  try {
    await enforceRateLimit(context.env, context.request, {
      prefix: "booking_create",
      limit: 8,
      windowSeconds: 600,
      message: "Too many booking attempts. Please wait a few minutes and try again."
    });

    const payload = await readBoundedJsonBody(context.request, MAX_BOOKING_BODY_BYTES);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }
    await verifyTurnstileToken(context.env, context.request, payload.turnstileToken);
    const created = await createBooking(context.env, payload);
    await recordAnalyticsBestEffort(context, "booking_submit", {
      page: "bookings",
      route: "/api/bookings"
    });
    return json(created, 201);
  } catch (error) {
    return errorResponse(error, "Booking could not be created.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET", "POST"]);
}
