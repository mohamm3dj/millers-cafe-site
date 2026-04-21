"use strict";

import { errorResponse } from "../../_lib/errors.js";
import { handleStripeWebhook } from "../../_lib/order-checkout-service.js";

export async function onRequestPost(context) {
  try {
    const rawBody = await context.request.text();
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
