"use strict";

import { isTokenAuthorized, resolveFeedTokens } from "../_lib/auth.js";
import { listBookingFeed } from "../_lib/bookings-service.js";
import { ApiError, errorResponse } from "../_lib/errors.js";
import { queryFlag, urlOf } from "../_lib/http.js";
import { csv, methodNotAllowed } from "../_lib/json.js";

export async function onRequestGet(context) {
  try {
    const tokens = resolveFeedTokens(context.env, "bookings");
    if (tokens.length === 0) {
      throw new ApiError("Bookings feed is not configured.", 503);
    }
    if (!isTokenAuthorized(context.request, tokens)) {
      throw new ApiError("Unauthorized feed token.", 401);
    }
    const includePast = queryFlag(urlOf(context.request), "includePast");
    const result = await listBookingFeed(context.env, includePast, "csv");
    return csv(result.body);
  } catch (error) {
    return errorResponse(error, "Could not load bookings CSV feed.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET"]);
}
