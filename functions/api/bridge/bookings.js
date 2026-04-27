"use strict";

import { isTokenAuthorized, resolveVenueBridgeTokens } from "../../_lib/auth.js";
import { listBookingReviewFeed, updateBookingDecision } from "../../_lib/bookings-service.js";
import { ApiError, errorResponse } from "../../_lib/errors.js";
import { queryFlag, queryLower, urlOf } from "../../_lib/http.js";
import { json, methodNotAllowed, readJsonBody } from "../../_lib/json.js";

function assertBridgeAuthorized(context, bodyToken = "") {
  const tokens = resolveVenueBridgeTokens(context.env);
  if (tokens.length === 0 || !isTokenAuthorized(context.request, tokens, bodyToken)) {
    throw new ApiError("Unauthorized venue bridge token.", 401);
  }
}

export async function onRequestGet(context) {
  try {
    assertBridgeAuthorized(context);
    const url = urlOf(context.request);
    const payload = await listBookingReviewFeed(context.env, {
      includePast: queryFlag(url, "includePast"),
      status: queryLower(url, "status", "pending")
    });
    return json(payload);
  } catch (error) {
    return errorResponse(error, "Could not load booking review feed.");
  }
}

export async function onRequestPost(context) {
  try {
    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }

    assertBridgeAuthorized(context, payload.token);
    const updated = await updateBookingDecision(context.env, payload);
    return json(updated);
  } catch (error) {
    return errorResponse(error, "Could not update booking decision.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET", "POST"]);
}
