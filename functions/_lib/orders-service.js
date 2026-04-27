"use strict";

import { sendOrderEmails } from "../_order-email.js";
import {
  createOrderRecord,
  feedRows,
  loadOrders,
  makeReference,
  saveOrders,
  toCSV
} from "../_orders-core.js";
import { updateOrderStatus } from "./order-status-service.js";
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

function normalizedStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function todayISODateInLondon() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function joinedAddress(order) {
  return [order.addressLine1, order.addressLine2, order.townCity, order.postcode]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function orderReviewRecord(order) {
  return {
    reference: makeReference(String(order.id || "")),
    orderId: String(order.id || ""),
    type: order.orderType,
    date: order.date,
    time: order.time,
    customerName: order.customerName,
    phoneNumber: order.phoneNumber,
    email: order.email,
    specialOccasion: order.specialOccasion,
    itemsSummary: order.itemsSummary,
    cartItems: Array.isArray(order.cartItems) ? order.cartItems : [],
    addressLine1: order.addressLine1,
    addressLine2: order.addressLine2,
    townCity: order.townCity,
    postcode: order.postcode,
    addressSummary: joinedAddress(order),
    notes: order.notes,
    status: normalizedStatus(order.status || "submitted"),
    etaMinutes: order.etaMinutes,
    decisionDate: order.decisionDate || "",
    decisionTime: order.decisionTime || "",
    paymentProvider: order.paymentProvider || "",
    paymentStatus: order.paymentStatus || "",
    paymentAmountTotal: order.paymentAmountTotal,
    paymentCurrency: order.paymentCurrency || "",
    refundStatus: order.refundStatus || "",
    source: order.source,
    createdAt: order.createdAt,
    statusUpdatedAt: order.statusUpdatedAt || order.createdAt
  };
}

export async function listOrderReviewFeed(env, options = {}) {
  const orders = await loadOrders(env);
  const includePast = Boolean(options.includePast);
  const requestedStatus = normalizedStatus(options.status || "submitted");
  const today = todayISODateInLondon();

  const rows = orders
    .filter((order) => includePast || String(order.date || "") >= today)
    .filter((order) => requestedStatus === "all" || normalizedStatus(order.status) === requestedStatus)
    .sort((left, right) => {
      const dateCompare = String(left.date || "").localeCompare(String(right.date || ""));
      if (dateCompare !== 0) return dateCompare;
      const timeCompare = String(left.time || "").localeCompare(String(right.time || ""));
      if (timeCompare !== 0) return timeCompare;
      return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
    })
    .map(orderReviewRecord);

  return {
    ok: true,
    orders: rows,
    count: rows.length
  };
}

export async function updateOrderDecision(env, payload = {}) {
  return updateOrderStatus(env, payload);
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
