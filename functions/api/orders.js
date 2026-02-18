"use strict";

import { sendOrderEmails } from "../_order-email.js";
import {
  createOrderRecord,
  jsonResponse,
  loadOrders,
  saveOrders
} from "../_orders-core.js";

export async function onRequestPost(context) {
  let payload = null;
  try {
    payload = await context.request.json();
  } catch (error) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const orders = await loadOrders(context.env);
  const creation = createOrderRecord(orders, payload);
  if (!creation.ok) {
    return jsonResponse({ error: creation.error }, creation.status || 400);
  }

  orders.push(creation.record);
  await saveOrders(context.env, orders);

  let emailResult = null;
  try {
    emailResult = await sendOrderEmails(context.env, creation.record, creation.reference);
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
      await saveOrders(context.env, rolledBack);
    } catch (rollbackError) {
      return jsonResponse({
        error: "Order could not be confirmed because emails failed and rollback did not complete. Please contact help@millers.cafe.",
        emailErrors: emailResult.errors || []
      }, 500);
    }

    if (!emailResult.enabled) {
      return jsonResponse({
        error: "Order confirmation email service is not configured yet. Please try again shortly.",
        emailErrors: emailResult.errors || []
      }, 503);
    }

    return jsonResponse({
      error: "Order could not be confirmed because confirmation emails were not delivered. Please try again.",
      emailErrors: emailResult.errors || []
    }, 502);
  }

  return jsonResponse({
    ok: true,
    reference: creation.reference,
    orderId: creation.record.id,
    trackingToken: creation.record.trackingToken,
    emailStatus: "sent",
    emailDelivered: emailResult.delivered,
    emailTotal: emailResult.total,
    emailErrors: emailResult.errors
  }, 201);
}
