"use strict";

import { resolveFeedTokens, isTokenAuthorized } from "../_lib/auth.js";
import { recordAnalyticsEvent } from "../_lib/analytics.js";
import { createBooking, listBookingFeed } from "../_lib/bookings-service.js";
import { errorResponse, ApiError } from "../_lib/errors.js";
import { queryFlag, queryLower, urlOf } from "../_lib/http.js";
import { csv, json, methodNotAllowed, readJsonBody } from "../_lib/json.js";
import { enforceRateLimit } from "../_lib/rate-limit.js";
import { verifyTurnstileToken } from "../_lib/turnstile.js";

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

    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }
    await verifyTurnstileToken(context.env, context.request, payload.turnstileToken);
    const created = await createBooking(context.env, payload);
    await recordAnalyticsEvent(context.env, "booking_submit", {
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
