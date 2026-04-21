"use strict";

import { sendOrderDecisionEmails } from "../_order-email.js";
import {
  findOrderIndexByReference,
  loadOrders,
  makeReference,
  saveOrders
} from "../_orders-core.js";
import { ApiError } from "./errors.js";
import { createRefund } from "./stripe.js";

function normalizedStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function validDecisionStatus(value) {
  const status = normalizedStatus(value);
  if (status === "accepted") return "accepted";
  if (status === "rejected" || status === "declined" || status === "cancelled") return "rejected";
  return "";
}

function parseEtaMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function refundPayload(order) {
  return {
    status: String(order.refundStatus || "").trim().toLowerCase(),
    refundId: String(order.refundId || "").trim(),
    amountTotal: Number(order.refundAmountTotal),
    createdAt: String(order.refundCreatedAt || "").trim()
  };
}

async function maybeRefundRejectedStripeOrder(env, order, reference, previousStatus, nextStatus) {
  if (nextStatus !== "rejected" || previousStatus === nextStatus) {
    return {
      attempted: false,
      ...refundPayload(order)
    };
  }

  if (String(order.paymentProvider || "").toLowerCase() !== "stripe" || !String(order.paymentIntentId || "").trim()) {
    return {
      attempted: false,
      ...refundPayload(order)
    };
  }

  if (String(order.refundStatus || "").toLowerCase() === "succeeded" && String(order.refundId || "").trim()) {
    return {
      attempted: false,
      ...refundPayload(order)
    };
  }

  const form = new URLSearchParams();
  form.set("payment_intent", String(order.paymentIntentId || "").trim());
  form.set("metadata[order_reference]", reference);
  form.set("metadata[order_id]", String(order.id || "").trim());

  try {
    const refund = await createRefund(env, form);
    order.refundStatus = String(refund?.status || "pending").trim().toLowerCase();
    order.refundId = String(refund?.id || "").trim();
    order.refundAmountTotal = Number.isFinite(Number(refund?.amount)) ? Number(refund.amount) : order.paymentAmountTotal;
    order.refundCreatedAt = Number.isFinite(Number(refund?.created))
      ? new Date(Number(refund.created) * 1000).toISOString()
      : new Date().toISOString();

    return {
      attempted: true,
      ...refundPayload(order)
    };
  } catch (error) {
    order.refundStatus = "failed";
    order.refundId = String(order.refundId || "").trim();
    order.refundAmountTotal = Number.isFinite(Number(order.refundAmountTotal))
      ? Number(order.refundAmountTotal)
      : Number(order.paymentAmountTotal);
    order.refundCreatedAt = String(order.refundCreatedAt || new Date().toISOString());

    return {
      attempted: true,
      ...refundPayload(order),
      error: error instanceof Error && error.message ? error.message : "Refund could not be created."
    };
  }
}

function orderStatusPayload(order, reference) {
  return {
    ok: true,
    reference,
    status: normalizedStatus(order.status || "submitted"),
    etaMinutes: parseEtaMinutes(order.etaMinutes),
    decisionDate: String(order.decisionDate || ""),
    decisionTime: String(order.decisionTime || ""),
    updatedAt: String(order.statusUpdatedAt || order.createdAt || new Date().toISOString())
  };
}

function findOrderOrThrow(orders, reference) {
  const index = findOrderIndexByReference(orders, reference);
  if (index < 0) {
    throw new ApiError("Order not found.", 404);
  }
  return { index, order: orders[index] };
}

export async function readOrderStatus(env, query) {
  const reference = String(query?.reference || "").trim();
  const trackingToken = String(query?.tracking || "").trim().toLowerCase();

  if (!reference) throw new ApiError("reference is required.", 400);
  if (!trackingToken) throw new ApiError("tracking token is required.", 400);

  const orders = await loadOrders(env);
  const { order } = findOrderOrThrow(orders, reference);
  if (String(order.trackingToken || "").trim().toLowerCase() !== trackingToken) {
    throw new ApiError("Order not found.", 404);
  }

  return orderStatusPayload(order, makeReference(order.id));
}

export async function updateOrderStatus(env, payload = {}) {
  const reference = String(payload.reference || "").trim();
  const nextStatus = validDecisionStatus(payload.status);
  if (!reference) throw new ApiError("reference is required.", 400);
  if (!nextStatus) throw new ApiError("status must be accepted or rejected.", 400);

  const orders = await loadOrders(env);
  const { index, order: existing } = findOrderOrThrow(orders, reference);

  const order = { ...existing };
  const previousStatus = normalizedStatus(order.status || "submitted");
  order.status = nextStatus;
  order.statusUpdatedAt = new Date().toISOString();
  order.etaMinutes = parseEtaMinutes(payload.etaMinutes);
  order.decisionDate = String(payload.scheduledDate || order.decisionDate || "").trim();
  order.decisionTime = String(payload.scheduledTime || order.decisionTime || "").trim().toUpperCase();

  orders[index] = order;
  await saveOrders(env, orders);

  const refund = await maybeRefundRejectedStripeOrder(env, order, makeReference(order.id), previousStatus, nextStatus);
  if (refund.attempted) {
    orders[index] = order;
    await saveOrders(env, orders);
  }

  const shouldNotify = payload.notify !== false && previousStatus !== nextStatus;
  let email = null;
  if (shouldNotify) {
    try {
      email = await sendOrderDecisionEmails(env, order, makeReference(order.id), {
        status: nextStatus,
        etaMinutes: order.etaMinutes,
        scheduledDate: order.decisionDate,
        scheduledTime: order.decisionTime,
        refundStatus: refund.status,
        refundId: refund.refundId
      });
    } catch (error) {
      email = {
        enabled: true,
        sentAll: false,
        delivered: 0,
        total: 2,
        errors: ["Decision email send failed."]
      };
    }
  }

  return {
    ...orderStatusPayload(order, makeReference(order.id)),
    notifyAttempted: shouldNotify,
    email,
    refund
  };
}
