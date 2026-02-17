"use strict";

import {
  feedRows,
  isFeedAuthorized,
  jsonResponse,
  loadOrders
} from "../_orders-core.js";

export async function onRequestGet(context) {
  if (!isFeedAuthorized(context.request, context.env)) {
    return jsonResponse({ error: "Unauthorized feed token." }, 401);
  }

  const url = new URL(context.request.url);
  const includePast = url.searchParams.get("includePast") === "1";

  const orders = await loadOrders(context.env);
  return jsonResponse(feedRows(orders, includePast));
}
