"use strict";

import { ApiError, errorResponse } from "../../_lib/errors.js";
import { getCheckoutSessionStatus } from "../../_lib/order-checkout-service.js";
import { json, methodNotAllowed } from "../../_lib/json.js";

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const sessionId = String(url.searchParams.get("session_id") || "").trim();
    if (!sessionId) {
      throw new ApiError("Checkout session id is required.", 400);
    }

    const status = await getCheckoutSessionStatus(context.env, sessionId);
    return json(status);
  } catch (error) {
    return errorResponse(error, "Checkout session could not be read.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET"]);
}
