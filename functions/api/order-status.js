"use strict";

import { bearerTokenFromRequest, isTokenAuthorized, resolveOrderAdminTokens } from "../_lib/auth.js";
import { ApiError, errorResponse } from "../_lib/errors.js";
import { queryString, urlOf } from "../_lib/http.js";
import { json, methodNotAllowed, readJsonBody } from "../_lib/json.js";
import { readOrderStatus, updateOrderStatus } from "../_lib/order-status-service.js";

export async function onRequestGet(context) {
  try {
    const url = urlOf(context.request);
    const payload = await readOrderStatus(context.env, {
      reference: queryString(url, "reference", ""),
      tracking: bearerTokenFromRequest(context.request)
    });
    return json(payload);
  } catch (error) {
    return errorResponse(error, "Could not read order status.");
  }
}

export async function onRequestPost(context) {
  try {
    const tokens = resolveOrderAdminTokens(context.env);
    if (!isTokenAuthorized(context.request, tokens)) {
      throw new ApiError("Unauthorized.", 401);
    }

    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }

    const updated = await updateOrderStatus(context.env, payload);
    return json(updated);
  } catch (error) {
    return errorResponse(error, "Could not update order status.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET", "POST"]);
}
