"use strict";

import { sendOrderEmails } from "../_order-email.js";
import {
  createOrderRecord,
  feedRows,
  loadOrders,
  makeReference,
  saveOrderEntity,
  saveOrdersAfterEntity,
  toCSV,
  withOrdersMutationLock
} from "../_orders-core.js";
import { updateOrderStatus } from "./order-status-service.js";
import { ApiError } from "./errors.js";
import { getSiteConfig } from "./site-config.js";

export async function listOrderFeed(env, includePast = false, format = "csv") {
  const orders = await loadOrders(env, { includeEntities: true });
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
  const orders = await loadOrders(env, { includeEntities: true });
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
  const siteConfig = await getSiteConfig(env);
  const creation = await withOrdersMutationLock(async () => {
    const orders = await loadOrders(env);
    const result = createOrderRecord(orders, payload, {
      rules: siteConfig.orders
    });
    if (!result.ok) {
      throw new ApiError(result.error || "Invalid order request.", result.status || 400);
    }

    orders.push(result.record);
    await saveOrderEntity(env, result.record);
    await saveOrdersAfterEntity(env, orders);
    return result;
  });

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

  const emailsSentAll = Boolean(emailResult?.enabled && emailResult?.sentAll);

  return {
    ok: true,
    reference: creation.reference,
    orderId: creation.record.id,
    trackingToken: creation.record.trackingToken,
    emailStatus: emailsSentAll ? "sent" : "pending",
    emailDelivered: Number(emailResult?.delivered || 0),
    emailTotal: Number(emailResult?.total || 0),
    emailErrors: emailResult?.errors || [],
    emailMessage: emailsSentAll
      ? "Order received and confirmation emails sent."
      : "Order received. Email confirmation is delayed right now."
  };
}
