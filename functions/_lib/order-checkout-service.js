"use strict";

import { sendOrderEmails } from "../_order-email.js";
import {
  createOrderRecord,
  findOrderIndexByPaymentSessionId,
  loadOrders,
  makeReference,
  saveOrders,
  validateOrderPayload
} from "../_orders-core.js";
import { ApiError } from "./errors.js";
import { recordAnalyticsEvent } from "./analytics.js";
import { priceOrderCart, resolveDeliveryFeeGBP } from "./order-menu.js";
import { defaultMenuCatalog, getSiteConfig } from "./site-config.js";
import {
  assertStripeWebhookSecret,
  createCheckoutSession,
  retrieveCheckoutSession,
  verifyStripeWebhookSignature
} from "./stripe.js";

const DRAFT_KEY_PREFIX = "order_checkout_draft:";

function normalizePostcode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function outwardCode(postcode) {
  const normalized = normalizePostcode(postcode);
  const match = normalized.match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  return match ? match[1] : "";
}

function isAllowedDeliveryPostcode(postcode, prefixes) {
  const outward = outwardCode(postcode);
  if (!outward) return false;
  return prefixes.some((prefix) => outward.startsWith(String(prefix || "").trim().toUpperCase()));
}

function randomId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `mco-draft-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function nowISO() {
  return new Date().toISOString();
}

function checkoutDraftKey(draftId) {
  return `${DRAFT_KEY_PREFIX}${String(draftId || "").trim()}`;
}

function normalizeDraft(raw) {
  if (!raw || typeof raw !== "object") return null;

  return {
    id: String(raw.id || "").trim(),
    status: String(raw.status || "checkout_created").trim().toLowerCase(),
    orderType: String(raw.orderType || "collection").trim().toLowerCase(),
    payload: raw.payload && typeof raw.payload === "object" ? { ...raw.payload } : null,
    pricedCart: raw.pricedCart && typeof raw.pricedCart === "object" ? { ...raw.pricedCart } : null,
    stripeSessionId: String(raw.stripeSessionId || "").trim(),
    stripePaymentIntentId: String(raw.stripePaymentIntentId || "").trim(),
    paymentStatus: String(raw.paymentStatus || "").trim().toLowerCase(),
    orderId: String(raw.orderId || "").trim(),
    orderReference: String(raw.orderReference || "").trim(),
    trackingToken: String(raw.trackingToken || "").trim(),
    emailStatus: String(raw.emailStatus || "").trim().toLowerCase(),
    emailErrors: Array.isArray(raw.emailErrors) ? raw.emailErrors.map((value) => String(value || "")) : [],
    createdAt: String(raw.createdAt || nowISO()),
    updatedAt: String(raw.updatedAt || raw.createdAt || nowISO())
  };
}

async function readDraft(env, draftId) {
  const key = checkoutDraftKey(draftId);
  if (!draftId) return null;

  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    const raw = await env.BOOKINGS_KV.get(key, "json");
    return normalizeDraft(raw);
  }

  const store = globalThis.__millersCafeOrderCheckoutDraftStore;
  const raw = store && typeof store === "object" ? store[key] : null;
  return normalizeDraft(raw);
}

async function writeDraft(env, draft) {
  const normalized = normalizeDraft({
    ...draft,
    updatedAt: nowISO()
  });

  if (!normalized?.id) {
    throw new ApiError("Checkout draft id is required.", 500);
  }

  const key = checkoutDraftKey(normalized.id);

  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    await env.BOOKINGS_KV.put(key, JSON.stringify(normalized));
    return normalized;
  }

  if (!globalThis.__millersCafeOrderCheckoutDraftStore || typeof globalThis.__millersCafeOrderCheckoutDraftStore !== "object") {
    globalThis.__millersCafeOrderCheckoutDraftStore = {};
  }
  globalThis.__millersCafeOrderCheckoutDraftStore[key] = normalized;
  return normalized;
}

function buildReturnUrl(requestUrl, orderType, checkoutState) {
  const orderPath = orderType === "delivery" ? "/delivery/" : "/collection/";
  const url = new URL(orderPath, requestUrl);
  url.searchParams.set("checkout", checkoutState);
  if (checkoutState === "success") {
    url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  }
  return url.toString();
}

function buildCheckoutForm(draft, requestUrl) {
  const form = new URLSearchParams();
  const pricedCart = draft.pricedCart;

  form.set("mode", "payment");
  form.set("client_reference_id", draft.id);
  form.set("success_url", buildReturnUrl(requestUrl, draft.orderType, "success"));
  form.set("cancel_url", buildReturnUrl(requestUrl, draft.orderType, "cancelled"));
  form.set("customer_email", draft.payload.email);
  form.set("billing_address_collection", "auto");
  form.set("metadata[order_draft_id]", draft.id);
  form.set("metadata[order_type]", draft.orderType);
  form.set("metadata[service_date]", draft.payload.date);
  form.set("metadata[service_time]", draft.payload.time);
  form.set("metadata[customer_phone]", draft.payload.phoneNumber);
  form.set("payment_intent_data[receipt_email]", draft.payload.email);
  form.set("payment_intent_data[metadata][order_draft_id]", draft.id);
  form.set("payment_intent_data[metadata][order_type]", draft.orderType);

  pricedCart.items.forEach((item, index) => {
    form.set(`line_items[${index}][quantity]`, String(item.checkoutQuantity ?? item.quantity));
    form.set(`line_items[${index}][price_data][currency]`, pricedCart.currency);
    form.set(`line_items[${index}][price_data][unit_amount]`, String(item.checkoutUnitAmountMinor ?? Math.round(item.unitPrice * 100)));
    form.set(`line_items[${index}][price_data][product_data][name]`, item.stripeName);
    if (item.stripeDescription) {
      form.set(`line_items[${index}][price_data][product_data][description]`, item.stripeDescription);
    }
  });

  if (pricedCart.deliveryFeeMinor > 0) {
    const deliveryIndex = pricedCart.items.length;
    form.set(`line_items[${deliveryIndex}][quantity]`, "1");
    form.set(`line_items[${deliveryIndex}][price_data][currency]`, pricedCart.currency);
    form.set(`line_items[${deliveryIndex}][price_data][unit_amount]`, String(pricedCart.deliveryFeeMinor));
    form.set(`line_items[${deliveryIndex}][price_data][product_data][name]`, "Delivery fee");
    form.set(`line_items[${deliveryIndex}][price_data][product_data][description]`, "Millers Café delivery charge");
  }

  return form;
}

function completedPayload(order, draft, emailStatus, emailErrors) {
  return {
    ok: true,
    status: "completed",
    reference: makeReference(order.id),
    orderId: order.id,
    trackingToken: order.trackingToken,
    orderType: order.orderType,
    paymentStatus: String(order.paymentStatus || draft?.paymentStatus || "paid"),
    emailStatus,
    emailErrors
  };
}

async function finalizePaidSession(env, session) {
  const sessionId = String(session?.id || "").trim();
  if (!sessionId) {
    throw new ApiError("Stripe checkout session id is missing.", 400);
  }

  const orders = await loadOrders(env);
  const existingOrderIndex = findOrderIndexByPaymentSessionId(orders, sessionId);
  const draftId = String(session?.client_reference_id || session?.metadata?.order_draft_id || "").trim();
  const draft = await readDraft(env, draftId);

  if (existingOrderIndex >= 0) {
    const existingOrder = orders[existingOrderIndex];
    if (draft && draft.status !== "completed") {
      await writeDraft(env, {
        ...draft,
        status: "completed",
        stripeSessionId: sessionId,
        stripePaymentIntentId: String(session?.payment_intent || "").trim(),
        paymentStatus: String(session?.payment_status || "paid").trim().toLowerCase(),
        orderId: existingOrder.id,
        orderReference: makeReference(existingOrder.id),
        trackingToken: existingOrder.trackingToken,
        emailStatus: draft.emailStatus || "sent"
      });
    }
    return completedPayload(existingOrder, draft, draft?.emailStatus || "sent", draft?.emailErrors || []);
  }

  if (String(session?.payment_status || "").trim().toLowerCase() !== "paid") {
    throw new ApiError("Stripe checkout session is not paid yet.", 409);
  }

  if (!draft || !draft.payload || !draft.pricedCart) {
    throw new ApiError("No matching order draft was found for this Stripe checkout session.", 404);
  }

  if (draft.status === "completed" && draft.orderId) {
    const matchedOrder = orders.find((order) => order.id === draft.orderId);
    if (matchedOrder) {
      return completedPayload(matchedOrder, draft, draft.emailStatus || "sent", draft.emailErrors || []);
    }
  }

  const siteConfig = await getSiteConfig(env);
  const creation = createOrderRecord(orders, draft.payload, {
    skipDuplicateCheck: true,
    rules: siteConfig.orders,
    paymentProvider: "stripe",
    paymentStatus: "paid",
    paymentSessionId: sessionId,
    paymentIntentId: String(session?.payment_intent || "").trim(),
    paymentAmountTotal: Number(session?.amount_total),
    paymentCurrency: String(session?.currency || "").trim().toLowerCase()
  });

  if (!creation.ok) {
    throw new ApiError(creation.error || "Paid order could not be created.", creation.status || 400);
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

  const emailStatus = Boolean(emailResult?.enabled && emailResult?.sentAll) ? "sent" : "pending";
  const emailErrors = emailResult?.errors || [];

  await writeDraft(env, {
    ...draft,
    status: "completed",
    stripeSessionId: sessionId,
    stripePaymentIntentId: String(session?.payment_intent || "").trim(),
    paymentStatus: "paid",
    orderId: creation.record.id,
    orderReference: creation.reference,
    trackingToken: creation.record.trackingToken,
    emailStatus,
    emailErrors
  });

  await recordAnalyticsEvent(env, "order_paid", {
    page: "checkout",
    orderType: creation.record.orderType
  });

  return completedPayload(creation.record, draft, emailStatus, emailErrors);
}

function processingPayload(draft, session) {
  return {
    ok: true,
    status: "processing",
    orderType: String(draft?.orderType || session?.metadata?.order_type || "collection"),
    paymentStatus: String(session?.payment_status || draft?.paymentStatus || "unpaid").trim().toLowerCase()
  };
}

export async function createOrderCheckout(env, requestUrl, payload) {
  const orderType = String(payload?.orderType || "").trim().toLowerCase() === "delivery" ? "delivery" : "collection";
  const siteConfig = await getSiteConfig(env);
  const menuCatalog = defaultMenuCatalog();

  if (orderType === "delivery") {
    const prefixes = Array.isArray(siteConfig.delivery?.allowedOutwardPrefixes)
      ? siteConfig.delivery.allowedOutwardPrefixes
      : [];
    const outsideAreaMode = String(siteConfig.delivery?.outsideAreaMode || "review").trim().toLowerCase();
    if (outsideAreaMode === "reject" && !isAllowedDeliveryPostcode(payload?.postcode, prefixes)) {
      throw new ApiError("This postcode is outside the online delivery area.", 400);
    }
  }

  const pricedCart = priceOrderCart(payload?.cartItems, {
    orderType,
    deliveryFeeGBP: resolveDeliveryFeeGBP(env, siteConfig.delivery?.baseFeeGBP),
    menuCatalog
  });
  if (!pricedCart.ok) {
    throw new ApiError(pricedCart.error || "Basket could not be priced.", 400);
  }

  const shapeCheck = validateOrderPayload({
    ...payload,
    orderType,
    cartItems: payload?.cartItems,
    itemsSummary: pricedCart.itemsSummary
  }, {
    rules: siteConfig.orders
  });
  if (!shapeCheck.ok) {
    throw new ApiError(shapeCheck.error || "Order details are invalid.", shapeCheck.status || 400);
  }

  const draft = await writeDraft(env, {
    id: randomId(),
    status: "checkout_created",
    orderType,
    payload: shapeCheck.data,
    pricedCart,
    paymentStatus: "unpaid",
    emailStatus: "",
    emailErrors: [],
    createdAt: nowISO()
  });

  const session = await createCheckoutSession(env, buildCheckoutForm(draft, requestUrl));
  await writeDraft(env, {
    ...draft,
    stripeSessionId: String(session?.id || "").trim()
  });

  return {
    ok: true,
    checkoutUrl: String(session?.url || "").trim(),
    sessionId: String(session?.id || "").trim(),
    amountTotal: pricedCart.totalMinor,
    currency: pricedCart.currency
  };
}

export async function getCheckoutSessionStatus(env, sessionId) {
  const session = await retrieveCheckoutSession(env, sessionId);
  const draftId = String(session?.client_reference_id || session?.metadata?.order_draft_id || "").trim();
  const draft = await readDraft(env, draftId);

  if (String(session?.payment_status || "").trim().toLowerCase() === "paid") {
    return finalizePaidSession(env, session);
  }

  if (String(session?.status || "").trim().toLowerCase() === "expired") {
    if (draft) {
      await writeDraft(env, {
        ...draft,
        status: "expired",
        stripeSessionId: String(session?.id || "").trim(),
        paymentStatus: String(session?.payment_status || "").trim().toLowerCase()
      });
    }
    return {
      ok: true,
      status: "expired",
      orderType: String(draft?.orderType || session?.metadata?.order_type || "collection")
    };
  }

  return processingPayload(draft, session);
}

export async function handleStripeWebhook(env, rawBody, signatureHeader) {
  const endpointSecret = assertStripeWebhookSecret(env);
  await verifyStripeWebhookSignature(rawBody, signatureHeader, endpointSecret);

  let event = null;
  try {
    event = JSON.parse(rawBody);
  } catch (error) {
    throw new ApiError("Stripe webhook payload is not valid JSON.", 400);
  }

  const eventType = String(event?.type || "").trim();
  const session = event?.data?.object;

  if (!eventType || !session || session.object !== "checkout.session") {
    return { ok: true, received: true, ignored: true };
  }

  if (eventType === "checkout.session.async_payment_failed") {
    const draftId = String(session?.client_reference_id || session?.metadata?.order_draft_id || "").trim();
    const draft = await readDraft(env, draftId);
    if (draft) {
      await writeDraft(env, {
        ...draft,
        status: "payment_failed",
        stripeSessionId: String(session?.id || "").trim(),
        stripePaymentIntentId: String(session?.payment_intent || "").trim(),
        paymentStatus: String(session?.payment_status || "unpaid").trim().toLowerCase()
      });
    }
    await recordAnalyticsEvent(env, "order_payment_failed", {
      page: "checkout"
    });
    return { ok: true, received: true, ignored: false };
  }

  if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
    if (String(session?.payment_status || "").trim().toLowerCase() === "paid") {
      await finalizePaidSession(env, session);
    }
  }

  return { ok: true, received: true, ignored: false };
}
