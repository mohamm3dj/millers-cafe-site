"use strict";

import { ApiError, errorResponse } from "../_lib/errors.js";
import { json, methodNotAllowed, readJsonBody } from "../_lib/json.js";
import { recordAnalyticsEvent } from "../_lib/analytics.js";

const ALLOWED_CLIENT_EVENTS = new Set([
  "page_view",
  "order_step_continue",
  "order_checkout_redirect",
  "order_checkout_return_success",
  "order_checkout_return_cancelled",
  "booking_form_view",
  "booking_submit",
  "account_page_view",
  "account_code_requested",
  "account_code_verified",
  "menu_page_view"
]);

export async function onRequestPost(context) {
  try {
    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }

    const event = String(payload.event || "").trim().toLowerCase();
    if (!ALLOWED_CLIENT_EVENTS.has(event)) {
      throw new ApiError("Unsupported analytics event.", 400);
    }

    await recordAnalyticsEvent(context.env, event, {
      route: payload.route,
      path: payload.path,
      orderType: payload.orderType,
      page: payload.page
    });

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Analytics event could not be recorded.");
  }
}

export function onRequest() {
  return methodNotAllowed(["POST"]);
}
