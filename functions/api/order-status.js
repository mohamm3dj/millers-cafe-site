"use strict";

import { sendOrderDecisionEmails } from "../_order-email.js";
import {
  findOrderIndexByReference,
  jsonResponse,
  loadOrders,
  makeReference,
  saveOrders
} from "../_orders-core.js";

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
  const rounded = Math.max(0, Math.round(parsed));
  return rounded;
}

function resolveAdminTokens(env) {
  const candidates = [
    String(env.ORDERS_ADMIN_TOKEN || "").trim(),
    String(env.ORDERS_FEED_TOKEN || "").trim(),
    String(env.BOOKINGS_FEED_TOKEN || "").trim()
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function isAuthorizedAdmin(request, env, bodyToken) {
  const configuredTokens = resolveAdminTokens(env);
  if (configuredTokens.length === 0) return true;

  const url = new URL(request.url);
  const queryToken = String(url.searchParams.get("token") || "").trim();
  const headerToken = String(
    request.headers.get("x-orders-admin-token") ||
    request.headers.get("x-api-key") ||
    ""
  ).trim();

  let bearerToken = "";
  const auth = String(request.headers.get("authorization") || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    bearerToken = auth.slice(7).trim();
  }

  const candidate = String(bodyToken || "").trim();
  return configuredTokens.includes(queryToken) ||
    configuredTokens.includes(headerToken) ||
    configuredTokens.includes(bearerToken) ||
    configuredTokens.includes(candidate);
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

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const reference = String(url.searchParams.get("reference") || "").trim();
  const trackingToken = String(url.searchParams.get("tracking") || "").trim().toLowerCase();

  if (!reference) {
    return jsonResponse({ error: "reference is required." }, 400);
  }
  if (!trackingToken) {
    return jsonResponse({ error: "tracking token is required." }, 400);
  }

  const orders = await loadOrders(context.env);
  const index = findOrderIndexByReference(orders, reference);
  if (index < 0) {
    return jsonResponse({ error: "Order not found." }, 404);
  }

  const order = orders[index];
  if (String(order.trackingToken || "").trim().toLowerCase() !== trackingToken) {
    return jsonResponse({ error: "Order not found." }, 404);
  }

  return jsonResponse(orderStatusPayload(order, makeReference(order.id)));
}

export async function onRequestPost(context) {
  let payload = null;
  try {
    payload = await context.request.json();
  } catch (error) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!isAuthorizedAdmin(context.request, context.env, payload?.token)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const reference = String(payload?.reference || "").trim();
  const nextStatus = validDecisionStatus(payload?.status);
  if (!reference) {
    return jsonResponse({ error: "reference is required." }, 400);
  }
  if (!nextStatus) {
    return jsonResponse({ error: "status must be accepted or rejected." }, 400);
  }

  const orders = await loadOrders(context.env);
  const index = findOrderIndexByReference(orders, reference);
  if (index < 0) {
    return jsonResponse({ error: "Order not found." }, 404);
  }

  const order = { ...orders[index] };
  const previousStatus = normalizedStatus(order.status || "submitted");
  order.status = nextStatus;
  order.statusUpdatedAt = new Date().toISOString();
  order.etaMinutes = parseEtaMinutes(payload?.etaMinutes);
  order.decisionDate = String(payload?.scheduledDate || order.decisionDate || "").trim();
  order.decisionTime = String(payload?.scheduledTime || order.decisionTime || "").trim().toUpperCase();

  orders[index] = order;
  await saveOrders(context.env, orders);

  const shouldNotify = payload?.notify !== false && previousStatus !== nextStatus;
  let emailResult = null;
  if (shouldNotify) {
    try {
      emailResult = await sendOrderDecisionEmails(context.env, order, makeReference(order.id), {
        status: nextStatus,
        etaMinutes: order.etaMinutes,
        scheduledDate: order.decisionDate,
        scheduledTime: order.decisionTime
      });
    } catch (error) {
      emailResult = {
        enabled: true,
        sentAll: false,
        delivered: 0,
        total: 2,
        errors: ["Decision email send failed."]
      };
    }
  }

  return jsonResponse({
    ...orderStatusPayload(order, makeReference(order.id)),
    notifyAttempted: shouldNotify,
    email: emailResult
  });
}
