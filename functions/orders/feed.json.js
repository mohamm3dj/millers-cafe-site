"use strict";

import { isTokenAuthorized, resolveFeedTokens } from "../_lib/auth.js";
import { ApiError, errorResponse } from "../_lib/errors.js";
import { queryFlag, urlOf } from "../_lib/http.js";
import { json, methodNotAllowed } from "../_lib/json.js";
import { listOrderFeed } from "../_lib/orders-service.js";

export async function onRequestGet(context) {
  try {
    if (!isTokenAuthorized(context.request, resolveFeedTokens(context.env, "orders"))) {
      throw new ApiError("Unauthorized feed token.", 401);
    }
    const includePast = queryFlag(urlOf(context.request), "includePast");
    const result = await listOrderFeed(context.env, includePast, "json");
    return json(result.body);
  } catch (error) {
    return errorResponse(error, "Could not load orders JSON feed.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET"]);
}
