"use strict";

import { findOrderIndexByReference, loadOrders, makeReference } from "../../_orders-core.js";
import { updateOrderStatus } from "../../_lib/order-status-service.js";
import { ApiError } from "../../_lib/errors.js";
import {
  actionParamsFromRequest,
  confirmationForm,
  defaultOrderEtaMinutes,
  htmlEscape,
  pageResponse,
  verifyEmailAction
} from "../../_lib/email-actions.js";
import { methodNotAllowed } from "../../_lib/json.js";

function normalizedStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function parseEtaMinutes(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(240, Math.round(parsed)));
}

async function findOrder(env, reference) {
  const orders = await loadOrders(env);
  const index = findOrderIndexByReference(orders, reference);
  if (index < 0) throw new ApiError("Order not found.", 404);
  const order = orders[index];
  return {
    order,
    reference: makeReference(order.id),
    status: normalizedStatus(order.status || "submitted")
  };
}

function hiddenFields(action, etaMinutes) {
  return [
    ["reference", action.reference],
    ["status", action.status],
    ["token", action.token],
    ["etaMinutes", action.status === "accepted" ? String(etaMinutes) : ""]
  ].map(([name, value]) => `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}">`).join("");
}

function confirmationPage(action, current, etaMinutes) {
  const accepted = action.status === "accepted";
  const title = accepted ? "Accept Order" : "Reject Order";
  const actionLabel = accepted ? "Confirm accept order" : "Confirm reject order";
  const actionClass = accepted ? "" : "reject";
  const etaField = accepted
    ? `<label for="etaMinutes">ETA minutes</label>
      <input id="etaMinutes" name="etaMinutes" type="number" min="1" max="240" value="${htmlEscape(etaMinutes)}">`
    : "";
  const refundWarning = !accepted && String(current.order.paymentProvider || "").toLowerCase() === "stripe"
    ? "<p><strong>Rejecting this Stripe-paid order will attempt a refund.</strong></p>"
    : "";

  return pageResponse(title, [
    `<h1>${htmlEscape(title)}</h1>`,
    `<p>Order <strong>${htmlEscape(current.reference)}</strong> is currently <strong>${htmlEscape(current.status)}</strong>.</p>`,
    "<p>This will update the website/app feed and email the customer.</p>",
    refundWarning,
    confirmationForm({
      actionLabel,
      actionClass,
      hiddenFields: hiddenFields(action, etaMinutes),
      extraFields: etaField
    }),
    "<p class=\"muted\">If this order has already been handled, use the app/admin view to make further changes.</p>"
  ].join(""));
}

function alreadyHandledPage(action, current) {
  const desired = action.status;
  if (current.status === desired) {
    return pageResponse("Order Already Updated", [
      "<h1>Order already updated</h1>",
      `<p>Order <strong>${htmlEscape(current.reference)}</strong> is already <strong>${htmlEscape(current.status)}</strong>.</p>`,
      "<p>No further change was made.</p>"
    ].join(""));
  }

  return pageResponse("Order Already Decided", [
    "<h1>Order already decided</h1>",
    `<p>Order <strong>${htmlEscape(current.reference)}</strong> is currently <strong>${htmlEscape(current.status)}</strong>.</p>`,
    "<p>Email links can only handle newly submitted orders. Use the app/admin view to change an existing decision.</p>"
  ].join(""), 409);
}

export async function onRequestGet(context) {
  try {
    const params = await actionParamsFromRequest(context.request);
    const action = await verifyEmailAction(context.env, {
      kind: "order",
      ...params
    });
    const current = await findOrder(context.env, action.reference);
    if (current.status !== "submitted") return alreadyHandledPage(action, current);
    const etaMinutes = parseEtaMinutes(params.etaMinutes, defaultOrderEtaMinutes(context.env));
    return confirmationPage(action, current, etaMinutes);
  } catch (error) {
    const normalized = error instanceof ApiError ? error : new ApiError("Email action could not be opened.", 500);
    return pageResponse("Email Action Error", [
      "<h1>Email action could not be opened</h1>",
      `<p>${htmlEscape(normalized.message)}</p>`
    ].join(""), normalized.status);
  }
}

export async function onRequestPost(context) {
  try {
    const params = await actionParamsFromRequest(context.request);
    const action = await verifyEmailAction(context.env, {
      kind: "order",
      ...params
    });
    const current = await findOrder(context.env, action.reference);
    if (current.status !== "submitted") return alreadyHandledPage(action, current);

    const etaMinutes = parseEtaMinutes(params.etaMinutes, defaultOrderEtaMinutes(context.env));
    const updated = await updateOrderStatus(context.env, {
      reference: action.reference,
      status: action.status,
      etaMinutes: action.status === "accepted" ? etaMinutes : null
    });
    const nextStatus = String(updated?.status || action.status).trim().toLowerCase();
    const refundLine = updated?.refund?.attempted
      ? `<p>Refund status: <strong>${htmlEscape(updated.refund.status || "pending")}</strong>.</p>`
      : "";
    return pageResponse("Order Updated", [
      "<h1>Order updated</h1>",
      `<p>Order <strong>${htmlEscape(action.reference)}</strong> is now <strong>${htmlEscape(nextStatus)}</strong>.</p>`,
      action.status === "accepted" ? `<p>ETA set to <strong>${htmlEscape(etaMinutes)} minutes</strong>.</p>` : "",
      refundLine,
      "<p>The app/feed now shows the updated status, and the customer notification email has been queued.</p>"
    ].join(""));
  } catch (error) {
    const normalized = error instanceof ApiError ? error : new ApiError("Could not update order from email.", 500);
    return pageResponse("Order Update Error", [
      "<h1>Order could not be updated</h1>",
      `<p>${htmlEscape(normalized.message)}</p>`
    ].join(""), normalized.status);
  }
}

export function onRequest() {
  return methodNotAllowed(["GET", "POST"]);
}
