"use strict";

import { errorResponse } from "../../_lib/errors.js";
import { readTextBody } from "../../_lib/json.js";
import { handleStripeWebhook } from "../../_lib/order-checkout-service.js";

const MAX_STRIPE_WEBHOOK_BODY_BYTES = 1024 * 1024;

export async function onRequestPost(context) {
  try {
    const rawBody = await readTextBody(context.request, {
      maxBytes: MAX_STRIPE_WEBHOOK_BODY_BYTES
    });
    const signature = context.request.headers.get("stripe-signature");
    const result = await handleStripeWebhook(context.env, rawBody, signature);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return errorResponse(error, "Stripe webhook could not be processed.");
  }
}

export function onRequest() {
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Allow: "POST"
    }
  });
}
