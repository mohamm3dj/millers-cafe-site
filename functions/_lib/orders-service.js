"use strict";

import { sendOrderEmails } from "../_order-email.js";
import {
  createOrderRecord,
  feedRows,
  loadOrders,
  saveOrders,
  toCSV
} from "../_orders-core.js";
import { ApiError } from "./errors.js";
import { getSiteConfig } from "./site-config.js";

export async function listOrderFeed(env, includePast = false, format = "csv") {
  const orders = await loadOrders(env);
  const rows = feedRows(orders, Boolean(includePast));
  if (format === "json") {
    return { format: "json", body: rows };
  }
  return { format: "csv", body: toCSV(rows) };
}

export async function createOrder(env, payload) {
  const orders = await loadOrders(env);
  const siteConfig = await getSiteConfig(env);
  const creation = createOrderRecord(orders, payload, {
    rules: siteConfig.orders
  });
  if (!creation.ok) {
    throw new ApiError(creation.error || "Invalid order request.", creation.status || 400);
  }

  orders.push(creation.record);
  await saveOrders(env, orders);

  let emailResult = null;
  try {
    emailResult = await sendOrderEmails(env, creation.record, creation.reference);
  } catch (error) {
    emailResult = {
      enabled: true,
      sentAll: false,
      delivered: 0,
      total: 2,
      errors: ["Email service request failed."]
    };
  }

  if (!emailResult.enabled || !emailResult.sentAll) {
    const rolledBack = orders.filter((order) => order.id !== creation.record.id);
    try {
      await saveOrders(env, rolledBack);
    } catch (rollbackError) {
      throw new ApiError(
        "Order could not be confirmed because emails failed and rollback did not complete. Please contact help@millers.cafe.",
        500,
        { emailErrors: emailResult.errors || [] }
      );
    }

    if (!emailResult.enabled) {
      throw new ApiError(
        "Order confirmation email service is not configured yet. Please try again shortly.",
        503,
        { emailErrors: emailResult.errors || [] }
      );
    }

    throw new ApiError(
      "Order could not be confirmed because confirmation emails were not delivered. Please try again.",
      502,
      { emailErrors: emailResult.errors || [] }
    );
  }

  return {
    ok: true,
    reference: creation.reference,
    orderId: creation.record.id,
    trackingToken: creation.record.trackingToken,
    emailStatus: "sent",
    emailDelivered: emailResult.delivered,
    emailTotal: emailResult.total,
    emailErrors: emailResult.errors
  };
}
