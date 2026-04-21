"use strict";

import { createOrderCheckout } from "../../_lib/order-checkout-service.js";
import { recordAnalyticsEvent } from "../../_lib/analytics.js";
import { ApiError, errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed, readJsonBody } from "../../_lib/json.js";
import { enforceRateLimit } from "../../_lib/rate-limit.js";
import { verifyTurnstileToken } from "../../_lib/turnstile.js";

export async function onRequestPost(context) {
  try {
    await enforceRateLimit(context.env, context.request, {
      prefix: "order_checkout_create",
      limit: 10,
      windowSeconds: 600,
      message: "Too many checkout attempts. Please wait a few minutes and try again."
    });

    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }

    await verifyTurnstileToken(context.env, context.request, payload.turnstileToken);

    const created = await createOrderCheckout(context.env, context.request.url, payload);
    await recordAnalyticsEvent(context.env, "order_checkout_created", {
      page: "checkout",
      route: "/api/orders/checkout",
      orderType: payload.orderType
    });
    return json(created, 201);
  } catch (error) {
    return errorResponse(error, "Checkout session could not be created.");
  }
}

export function onRequest() {
  return methodNotAllowed(["POST"]);
}
