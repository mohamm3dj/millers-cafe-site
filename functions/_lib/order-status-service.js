"use strict";

import { sendOrderDecisionEmails } from "../_order-email.js";
import {
  findOrderIndexByReference,
  loadOrders,
  makeReference,
  saveOrderEntity,
  saveOrdersAfterEntity,
  withOrdersMutationLock
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
  const rounded = Math.round(parsed);
  if (rounded < 0 || rounded > 24 * 60) return null;
  return rounded;
}

function isRealISODate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]);
}

function isRealClock(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "ASAP") return true;
  const match = /^(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) return false;
  return Number(match[1]) >= 0 && Number(match[1]) <= 23 &&
    Number(match[2]) >= 0 && Number(match[2]) <= 59;
}

function refundPayload(order) {
  const rawAmountTotal = order.refundAmountTotal;
  const amountTotal = rawAmountTotal === null || rawAmountTotal === undefined || rawAmountTotal === ""
    ? null
    : Number(rawAmountTotal);
  return {
    status: String(order.refundStatus || "").trim().toLowerCase(),
    refundId: String(order.refundId || "").trim(),
    amountTotal: Number.isFinite(amountTotal) ? amountTotal : null,
    createdAt: String(order.refundCreatedAt || "").trim(),
    attempts: Math.max(0, Math.round(Number(order.refundAttempts || 0))),
    lastError: String(order.refundLastError || "").trim(),
    updatedAt: String(order.refundUpdatedAt || "").trim(),
    idempotencyKey: String(order.refundIdempotencyKey || "").trim()
  };
}

async function maybeRefundRejectedStripeOrder(env, order, reference, nextStatus) {
  if (nextStatus !== "rejected") {
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

  if (String(order.refundStatus || "").toLowerCase() === "succeeded") {
    return {
      attempted: false,
      ...refundPayload(order)
    };
  }

  const form = new URLSearchParams();
  form.set("payment_intent", String(order.paymentIntentId || "").trim());
  form.set("metadata[order_reference]", reference);
  form.set("metadata[order_id]", String(order.id || "").trim());
  const idempotencyKey = String(order.refundIdempotencyKey || "").trim() ||
    `order-refund:${String(order.id || "").trim()}:${String(order.paymentIntentId || "").trim()}`;
  order.refundIdempotencyKey = idempotencyKey;
  order.refundAttempts = Math.max(0, Math.round(Number(order.refundAttempts || 0))) + 1;
  order.refundStatus = "processing";
  order.refundLastError = "";
  order.refundUpdatedAt = new Date().toISOString();

  try {
    const refund = await createRefund(env, form, { idempotencyKey });
    order.refundStatus = String(refund?.status || "pending").trim().toLowerCase();
    order.refundId = String(refund?.id || "").trim();
    order.refundAmountTotal = Number.isFinite(Number(refund?.amount)) ? Number(refund.amount) : order.paymentAmountTotal;
    order.refundCreatedAt = Number.isFinite(Number(refund?.created))
      ? new Date(Number(refund.created) * 1000).toISOString()
      : new Date().toISOString();
    order.refundLastError = "";
    order.refundUpdatedAt = new Date().toISOString();

    return {
      attempted: true,
      ...refundPayload(order)
    };
  } catch (error) {
    const errorMessage = error instanceof Error && error.message ? error.message : "Refund could not be created.";
    order.refundStatus = "failed";
    order.refundId = String(order.refundId || "").trim();
    const existingRefundAmount = order.refundAmountTotal === null ||
      order.refundAmountTotal === undefined ||
      order.refundAmountTotal === ""
      ? null
      : Number(order.refundAmountTotal);
    order.refundAmountTotal = Number.isFinite(existingRefundAmount)
      ? existingRefundAmount
      : Number(order.paymentAmountTotal);
    order.refundCreatedAt = String(order.refundCreatedAt || "");
    order.refundLastError = errorMessage.slice(0, 500);
    order.refundUpdatedAt = new Date().toISOString();

    return {
      attempted: true,
      ...refundPayload(order),
      error: errorMessage
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
  if (reference.length > 64 || trackingToken.length > 64) {
    throw new ApiError("Order tracking details are invalid.", 400);
  }

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
  const etaMinutes = parseEtaMinutes(payload.etaMinutes);
  if (!reference) throw new ApiError("reference is required.", 400);
  if (reference.length > 64) throw new ApiError("reference is invalid.", 400);
  if (!nextStatus) throw new ApiError("status must be accepted or rejected.", 400);
  if (nextStatus === "accepted" && (!Number.isFinite(etaMinutes) || etaMinutes <= 0)) {
    throw new ApiError("etaMinutes is required when accepting an order.", 400);
  }
  const scheduledDate = String(payload.scheduledDate || "").trim();
  const scheduledTime = String(payload.scheduledTime || "").trim().toUpperCase();
  if (scheduledDate && !isRealISODate(scheduledDate)) {
    throw new ApiError("scheduledDate must be a real date in yyyy-MM-dd format.", 400);
  }
  if (scheduledTime && !isRealClock(scheduledTime)) {
    throw new ApiError("scheduledTime must be a real time in HH:mm format or ASAP.", 400);
  }

  const mutation = await withOrdersMutationLock(async () => {
    const orders = await loadOrders(env);
    const { index, order: existing } = findOrderOrThrow(orders, reference);
    const order = { ...existing };
    const previousStatus = normalizedStatus(order.status || "submitted");
    const refundAttempts = Math.max(0, Math.round(Number(order.refundAttempts || 0)));

    if (nextStatus === "accepted" && previousStatus === "rejected" && refundAttempts > 0) {
      throw new ApiError("An order with a refund attempt cannot be accepted again.", 409);
    }

    order.status = nextStatus;
    order.statusUpdatedAt = new Date().toISOString();
    order.etaMinutes = nextStatus === "accepted" ? etaMinutes : null;
    order.decisionDate = scheduledDate || String(order.decisionDate || "").trim();
    order.decisionTime = scheduledTime || String(order.decisionTime || "").trim().toUpperCase();

    const refund = await maybeRefundRejectedStripeOrder(
      env,
      order,
      makeReference(order.id),
      nextStatus
    );
    orders[index] = order;
    await saveOrderEntity(env, order);
    await saveOrdersAfterEntity(env, orders);
    return { order, previousStatus, refund };
  });

  const { order, previousStatus, refund } = mutation;

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
