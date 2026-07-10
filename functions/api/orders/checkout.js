"use strict";

import { createOrderCheckout } from "../../_lib/order-checkout-service.js";
import { recordAnalyticsEvent } from "../../_lib/analytics.js";
import { ApiError, errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed } from "../../_lib/json.js";
import { enforceRateLimit } from "../../_lib/rate-limit.js";
import { verifyTurnstileToken } from "../../_lib/turnstile.js";

const MAX_CHECKOUT_BODY_BYTES = 128 * 1024;

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
      // Analytics must never change the checkout outcome.
    }
    return;
  }
  await task;
}

export async function onRequestPost(context) {
  try {
    await enforceRateLimit(context.env, context.request, {
      prefix: "order_checkout_create",
      limit: 10,
      windowSeconds: 600,
      message: "Too many checkout attempts. Please wait a few minutes and try again."
    });

    const payload = await readBoundedJsonBody(context.request, MAX_CHECKOUT_BODY_BYTES);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }

    await verifyTurnstileToken(context.env, context.request, payload.turnstileToken);

    const created = await createOrderCheckout(context.env, context.request.url, payload, {
      idempotencyKey: context.request.headers.get("idempotency-key")
    });
    await recordAnalyticsBestEffort(context, "order_checkout_created", {
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
