"use strict";

import { sendOrderEmails } from "../_order-email.js";
import {
  createOrderRecord,
  createOrderRecordFromValidatedDraft,
  findOrderIndexByPaymentSessionId,
  loadOrderEntity,
  loadOrders,
  makeReference,
  saveOrderEntity,
  saveOrdersAfterEntity,
  validateOrderPayload,
  withOrdersMutationLock
} from "../_orders-core.js";
import { ApiError } from "./errors.js";
import { recordAnalyticsEvent } from "./analytics.js";
import { isCashOrderingEnabled, isOnlineOrderingEnabled } from "./feature-flags.js";
import { priceOrderCart, resolveDeliveryFeeGBP } from "./order-menu.js";
import { defaultMenuCatalog, getSiteConfig } from "./site-config.js";
import {
  assertStripeWebhookSecret,
  createCheckoutSession,
  expireCheckoutSession,
  retrieveCheckoutSession,
  verifyStripeWebhookSignature
} from "./stripe.js";

const DRAFT_KEY_PREFIX = "order_checkout_draft:";
const COMPLETION_KEY_PREFIX = "order_checkout_completion:";
const ACTIVE_DRAFT_TTL_SECONDS = 2 * 24 * 60 * 60;
const MAX_CHECKOUT_CART_LINES = 50;
const MAX_CHECKOUT_TOTAL_QUANTITY = 100;
const MAX_CHECKOUT_MODIFIERS_PER_LINE = 20;

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

function checkoutCompletionKey(sessionId) {
  return `${COMPLETION_KEY_PREFIX}${String(sessionId || "").trim()}`;
}

function getCheckoutStore() {
  if (!globalThis.__millersCafeOrderCheckoutDraftStore || typeof globalThis.__millersCafeOrderCheckoutDraftStore !== "object") {
    globalThis.__millersCafeOrderCheckoutDraftStore = {};
  }
  return globalThis.__millersCafeOrderCheckoutDraftStore;
}

function getFinalizeLockStore() {
  if (!(globalThis.__millersCafeCheckoutFinalizeLocks instanceof Map)) {
    globalThis.__millersCafeCheckoutFinalizeLocks = new Map();
  }
  return globalThis.__millersCafeCheckoutFinalizeLocks;
}

async function withFinalizeLock(sessionId, work) {
  const key = String(sessionId || "").trim();
  const locks = getFinalizeLockStore();
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  locks.set(key, current);

  try {
    return await current;
  } finally {
    if (locks.get(key) === current) {
      locks.delete(key);
    }
  }
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) return "";
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value || ""))
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fallbackHashHex(value) {
  const source = String(value || "");
  const chunks = [];
  for (let seed = 0; seed < 8; seed += 1) {
    let hash = (2166136261 ^ seed) >>> 0;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index) + seed;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    chunks.push(hash.toString(16).padStart(8, "0"));
  }
  return chunks.join("");
}

async function stableOrderIdentity(sessionId) {
  const source = `millers-order:${String(sessionId || "").trim()}`;
  const digest = await sha256Hex(source) || fallbackHashHex(source);
  return {
    recordId: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`,
    trackingToken: digest.slice(32, 52)
  };
}

async function draftIdForRequestKey(requestKey) {
  const normalized = String(requestKey || "").trim();
  if (!normalized) return randomId();
  const digest = await sha256Hex(normalized) || fallbackHashHex(normalized);
  return `mco-draft-${digest.slice(0, 40)}`;
}

function normalizeCheckoutRequestKey(value) {
  const normalized = String(value || "").trim();
  if (normalized.length > 200) {
    throw new ApiError("Checkout idempotency key must be 200 characters or fewer.", 400);
  }
  return normalized;
}

function normalizePaymentMethod(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "card";
  if (normalized === "card" || normalized === "cash") return normalized;
  throw new ApiError("Payment method must be card or cash.", 400);
}

function checkoutRequestIdentity(payload) {
  const cartItems = Array.isArray(payload?.cartItems)
    ? payload.cartItems.map((item) => ({
      itemName: String(item?.itemName || item?.name || "").trim(),
      posItemId: String(item?.posItemId || item?.itemId || item?.menuItemId || "").trim(),
      quantity: Number(item?.quantity),
      modifierSelections: Array.isArray(item?.modifierSelections)
        ? item.modifierSelections.map((selection) => ({
          groupName: String(selection?.groupName || "").trim(),
          optionName: String(selection?.optionName || "").trim(),
          posModifierGroupId: String(selection?.posModifierGroupId || selection?.groupId || "").trim(),
          posModifierOptionId: String(selection?.posModifierOptionId || selection?.optionId || "").trim(),
          isTextInput: Boolean(selection?.isTextInput)
        }))
        : []
    }))
    : [];

  return {
    orderType: String(payload?.orderType || "").trim().toLowerCase(),
    customerName: String(payload?.customerName || "").trim(),
    phoneNumber: String(payload?.phoneNumber || "").trim(),
    email: String(payload?.email || "").trim(),
    date: String(payload?.date || "").trim(),
    time: String(payload?.time || "").trim().toUpperCase(),
    specialOccasion: String(payload?.specialOccasion || "").trim(),
    notes: String(payload?.notes || "").trim(),
    sensitiveInfoConsent: Boolean(payload?.sensitiveInfoConsent),
    addressLine1: String(payload?.addressLine1 || "").trim(),
    addressLine2: String(payload?.addressLine2 || "").trim(),
    townCity: String(payload?.townCity || "").trim(),
    postcode: normalizePostcode(payload?.postcode),
    cartItems
  };
}

async function checkoutRequestFingerprint(payload) {
  const source = JSON.stringify(checkoutRequestIdentity(payload));
  return await sha256Hex(source) || fallbackHashHex(source);
}

function assertCheckoutCartBounds(rawCartItems) {
  if (!Array.isArray(rawCartItems) || rawCartItems.length === 0) {
    throw new ApiError("Please add at least one menu item.", 400);
  }
  if (rawCartItems.length > MAX_CHECKOUT_CART_LINES) {
    throw new ApiError(`Order basket cannot contain more than ${MAX_CHECKOUT_CART_LINES} lines.`, 400);
  }

  let totalQuantity = 0;
  for (const item of rawCartItems) {
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new ApiError("Order basket contains an invalid quantity.", 400);
    }
    totalQuantity += quantity;
    const selections = Array.isArray(item?.modifierSelections) ? item.modifierSelections : [];
    if (selections.length > MAX_CHECKOUT_MODIFIERS_PER_LINE) {
      throw new ApiError("Order basket contains too many modifier selections.", 400);
    }
    for (const selection of selections) {
      if (String(selection?.groupName || "").trim().length > 120 || String(selection?.optionName || "").trim().length > 120) {
        throw new ApiError("Order basket contains a modifier value that is too long.", 400);
      }
    }
  }

  if (totalQuantity > MAX_CHECKOUT_TOTAL_QUANTITY) {
    throw new ApiError(`Order basket cannot contain more than ${MAX_CHECKOUT_TOTAL_QUANTITY} items.`, 400);
  }
}

function normalizeDraft(raw) {
  if (!raw || typeof raw !== "object") return null;

  return {
    id: String(raw.id || "").trim(),
    status: String(raw.status || "checkout_created").trim().toLowerCase(),
    orderType: String(raw.orderType || "collection").trim().toLowerCase(),
    paymentMethod: String(raw.paymentMethod || "").trim().toLowerCase() === "cash" ? "cash" : "card",
    requestFingerprint: String(raw.requestFingerprint || "").trim().toLowerCase(),
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

  const raw = getCheckoutStore()[key] || null;
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
    await env.BOOKINGS_KV.put(key, JSON.stringify(normalized), {
      expirationTtl: ACTIVE_DRAFT_TTL_SECONDS
    });
    return normalized;
  }

  getCheckoutStore()[key] = normalized;
  return normalized;
}

function normalizeCompletion(raw) {
  if (!raw || typeof raw !== "object" || raw.status !== "completed") return null;
  const reference = String(raw.reference || "").trim();
  const orderId = String(raw.orderId || "").trim();
  const trackingToken = String(raw.trackingToken || "").trim();
  if (!reference || !orderId || !trackingToken) return null;
  const paymentMethod = String(raw.paymentMethod || "").trim().toLowerCase() === "cash" ||
    String(raw.paymentProvider || "").trim().toLowerCase() === "cash"
    ? "cash"
    : "card";
  const rawAmountTotal = raw.amountTotal;
  const amountTotal = rawAmountTotal === null || rawAmountTotal === undefined || rawAmountTotal === ""
    ? null
    : Number(rawAmountTotal);
  return {
    ok: true,
    status: "completed",
    reference,
    orderId,
    trackingToken,
    orderType: String(raw.orderType || "collection").trim().toLowerCase() === "delivery" ? "delivery" : "collection",
    paymentMethod,
    paymentProvider: paymentMethod === "cash" ? "cash" : "stripe",
    paymentStatus: String(raw.paymentStatus || (paymentMethod === "cash" ? "unpaid" : "paid")).trim().toLowerCase(),
    amountTotal: Number.isSafeInteger(amountTotal) && amountTotal >= 0 ? amountTotal : null,
    currency: /^[a-z]{3}$/.test(String(raw.currency || "").trim().toLowerCase())
      ? String(raw.currency).trim().toLowerCase()
      : "",
    emailStatus: String(raw.emailStatus || "pending").trim().toLowerCase(),
    emailErrors: Array.isArray(raw.emailErrors) ? raw.emailErrors.map((value) => String(value || "")) : []
  };
}

async function readCompletion(env, sessionId) {
  const key = checkoutCompletionKey(sessionId);
  if (!sessionId) return null;
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    return normalizeCompletion(await env.BOOKINGS_KV.get(key, "json"));
  }
  return normalizeCompletion(getCheckoutStore()[key]);
}

async function writeCompletion(env, sessionId, payload) {
  const normalized = normalizeCompletion({ ...payload, status: "completed" });
  if (!normalized) {
    throw new ApiError("Completed checkout result is invalid.", 500);
  }
  const key = checkoutCompletionKey(sessionId);
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    await env.BOOKINGS_KV.put(key, JSON.stringify(normalized));
    return normalized;
  }
  getCheckoutStore()[key] = normalized;
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

function isValidHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch (error) {
    return false;
  }
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
  const paymentProvider = String(order.paymentProvider || "").trim().toLowerCase();
  const paymentMethod = paymentProvider === "cash" ? "cash" : "card";
  const rawAmountTotal = order.paymentAmountTotal;
  const amountTotal = rawAmountTotal === null || rawAmountTotal === undefined || rawAmountTotal === ""
    ? null
    : Number(rawAmountTotal);
  return {
    ok: true,
    status: "completed",
    reference: makeReference(order.id),
    orderId: order.id,
    trackingToken: order.trackingToken,
    orderType: order.orderType,
    paymentMethod,
    paymentProvider: paymentMethod === "cash" ? "cash" : "stripe",
    paymentStatus: String(order.paymentStatus || draft?.paymentStatus || (paymentMethod === "cash" ? "unpaid" : "paid")),
    amountTotal: Number.isSafeInteger(amountTotal) && amountTotal >= 0 ? amountTotal : null,
    currency: String(order.paymentCurrency || draft?.pricedCart?.currency || "").trim().toLowerCase(),
    emailStatus,
    emailErrors
  };
}

function assertStripeSessionMatchesDraft(session, draft) {
  const sessionId = String(session?.id || "").trim();
  const clientReferenceId = String(session?.client_reference_id || "").trim();
  const metadataDraftId = String(session?.metadata?.order_draft_id || "").trim();
  const metadataOrderType = String(session?.metadata?.order_type || "").trim().toLowerCase();
  const expectedAmount = Number(draft?.pricedCart?.totalMinor);
  const actualAmount = Number(session?.amount_total);
  const expectedCurrency = String(draft?.pricedCart?.currency || "").trim().toLowerCase();
  const actualCurrency = String(session?.currency || "").trim().toLowerCase();

  if (!draft?.id || !draft.payload || !draft.pricedCart) {
    throw new ApiError("No matching order draft was found for this Stripe checkout session.", 404);
  }
  if (draft.paymentMethod !== "card") {
    throw new ApiError("Stripe checkout cannot finalize an order draft that was not created for card payment.", 409);
  }
  if (clientReferenceId && clientReferenceId !== draft.id) {
    throw new ApiError("Stripe checkout session does not match the saved order draft.", 409);
  }
  if (metadataDraftId && metadataDraftId !== draft.id) {
    throw new ApiError("Stripe checkout metadata does not match the saved order draft.", 409);
  }
  if (draft.stripeSessionId && draft.stripeSessionId !== sessionId) {
    throw new ApiError("Stripe checkout session does not match the saved order draft.", 409);
  }
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount < 0 || actualAmount !== expectedAmount) {
    throw new ApiError("Stripe payment amount does not match the saved order total.", 409);
  }
  if (!expectedCurrency || actualCurrency !== expectedCurrency) {
    throw new ApiError("Stripe payment currency does not match the saved order total.", 409);
  }
  if (metadataOrderType && metadataOrderType !== draft.orderType) {
    throw new ApiError("Stripe checkout order type does not match the saved order draft.", 409);
  }
}

async function finalizePaidSessionUnlocked(env, session) {
  const sessionId = String(session?.id || "").trim();
  if (!sessionId) {
    throw new ApiError("Stripe checkout session id is missing.", 400);
  }

  if (String(session?.payment_status || "").trim().toLowerCase() !== "paid") {
    throw new ApiError("Stripe checkout session is not paid yet.", 409);
  }

  const draftId = String(session?.client_reference_id || session?.metadata?.order_draft_id || "").trim();
  const draft = await readDraft(env, draftId);
  assertStripeSessionMatchesDraft(session, draft);

  const completed = await readCompletion(env, sessionId);
  if (completed) return completed;
  const identity = await stableOrderIdentity(sessionId);

  const result = await withOrdersMutationLock(async () => {
    const orders = await loadOrders(env);
    const existingOrderIndex = findOrderIndexByPaymentSessionId(orders, sessionId);
    if (existingOrderIndex >= 0) {
      return { order: orders[existingOrderIndex], created: false };
    }

    const creation = createOrderRecordFromValidatedDraft(orders, draft.payload, {
      recordId: identity.recordId,
      trackingToken: identity.trackingToken,
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

    const sameIdentityIndex = orders.findIndex((order) => order.id === creation.record.id);
    if (sameIdentityIndex >= 0) {
      const sameIdentityOrder = orders[sameIdentityIndex];
      if (String(sameIdentityOrder.paymentSessionId || "").trim() !== sessionId) {
        throw new ApiError("A conflicting paid order identity already exists.", 409);
      }
      return { order: sameIdentityOrder, created: false };
    }

    orders.push(creation.record);
    await saveOrderEntity(env, creation.record);
    const aggregateSaved = await saveOrdersAfterEntity(env, orders);
    if (!aggregateSaved) {
      throw new ApiError("Paid order storage is still syncing. Please retry shortly.", 503);
    }
    return { order: creation.record, created: true };
  });

  if (!result.created) {
    const payload = completedPayload(result.order, draft, "pending", []);
    try {
      await writeCompletion(env, sessionId, payload);
    } catch (error) {
      // The saved order is authoritative. A later status poll can rebuild this marker.
    }
    return payload;
  }

  let emailResult = null;
  try {
    emailResult = await sendOrderEmails(env, result.order, makeReference(result.order.id), {
      idempotencyKeyPrefix: `stripe-order-email:${sessionId}`
    });
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
  const payload = completedPayload(result.order, draft, emailStatus, emailErrors);

  try {
    await writeCompletion(env, sessionId, payload);
  } catch (error) {
    // Completion markers are an optimization; the persisted paid order remains authoritative.
  }

  await recordAnalyticsEvent(env, "order_paid", {
    page: "checkout",
    orderType: result.order.orderType
  }).catch(() => null);

  return payload;
}

async function finalizePaidSession(env, session) {
  const sessionId = String(session?.id || "").trim();
  if (!sessionId) {
    throw new ApiError("Stripe checkout session id is missing.", 400);
  }
  return withFinalizeLock(sessionId, () => finalizePaidSessionUnlocked(env, session));
}

function checkoutDraftDetailsMatch(existing, candidate) {
  if (!existing || !candidate) return false;
  return existing.orderType === candidate.orderType &&
    (!existing.requestFingerprint || existing.requestFingerprint === candidate.requestFingerprint) &&
    Number(existing.pricedCart?.totalMinor) === Number(candidate.pricedCart?.totalMinor) &&
    String(existing.pricedCart?.currency || "") === String(candidate.pricedCart?.currency || "") &&
    JSON.stringify(existing.payload) === JSON.stringify(candidate.payload);
}

function checkoutDraftMatches(existing, candidate) {
  return existing?.paymentMethod === candidate?.paymentMethod && checkoutDraftDetailsMatch(existing, candidate);
}

function persistedCashOrderMatchesDraft(order, draft) {
  if (!order || !draft?.payload || !draft?.pricedCart) return false;
  const payload = draft.payload;
  const textFields = [
    "orderType",
    "customerName",
    "phoneNumber",
    "phoneDigits",
    "email",
    "date",
    "time",
    "specialOccasion",
    "itemsSummary",
    "notes",
    "addressLine1",
    "addressLine2",
    "townCity",
    "postcode"
  ];
  if (textFields.some((field) => String(order[field] || "") !== String(payload[field] || ""))) return false;
  if (Boolean(order.sensitiveInfoConsent) !== Boolean(payload.sensitiveInfoConsent)) return false;
  if (JSON.stringify(order.cartItems || []) !== JSON.stringify(payload.cartItems || [])) return false;
  return String(order.paymentProvider || "").trim().toLowerCase() === "cash" &&
    Number(order.paymentAmountTotal) === Number(draft.pricedCart.totalMinor) &&
    String(order.paymentCurrency || "").trim().toLowerCase() === String(draft.pricedCart.currency || "").trim().toLowerCase();
}

async function finalizeCashDraftUnlocked(env, draft) {
  const completionId = `cash:${draft.id}`;
  const completed = await readCompletion(env, completionId);
  const identity = await stableOrderIdentity(completionId);
  const result = await withOrdersMutationLock(async () => {
    let orders = await loadOrders(env);
    let existingOrder = orders.find((order) => String(order.id || "") === identity.recordId);
    let recoveredEntity = false;
    if (!existingOrder) {
      existingOrder = await loadOrderEntity(env, identity.recordId);
      recoveredEntity = Boolean(existingOrder);
    }
    if (existingOrder) {
      if (!persistedCashOrderMatchesDraft(existingOrder, draft)) {
        throw new ApiError("A conflicting cash order identity already exists.", 409);
      }
      if (recoveredEntity) {
        orders.push(existingOrder);
        const aggregateSaved = await saveOrdersAfterEntity(env, orders);
        if (!aggregateSaved) {
          throw new ApiError("Cash order storage is still syncing. Please retry shortly.", 503);
        }
      }
      return {
        order: existingOrder,
        shouldSendEmail: !completed,
        completed
      };
    }
    if (completed) {
      throw new ApiError("The completed cash order could not be verified against its saved record.", 409);
    }

    const creation = createOrderRecord(orders, draft.payload, {
      recordId: identity.recordId,
      trackingToken: identity.trackingToken,
      skipWindowValidation: true,
      paymentProvider: "cash",
      paymentStatus: "unpaid",
      paymentSessionId: "",
      paymentIntentId: "",
      paymentAmountTotal: Number(draft.pricedCart.totalMinor),
      paymentCurrency: String(draft.pricedCart.currency || "").trim().toLowerCase()
    });

    if (!creation.ok) {
      throw new ApiError(creation.error || "Cash order could not be created.", creation.status || 400);
    }

    orders.push(creation.record);
    await saveOrderEntity(env, creation.record);
    const aggregateSaved = await saveOrdersAfterEntity(env, orders);
    if (!aggregateSaved) {
      throw new ApiError("Cash order storage is still syncing. Please retry shortly.", 503);
    }
    return { order: creation.record, shouldSendEmail: true, completed: null };
  });

  if (!result.shouldSendEmail) {
    if (result.completed) return result.completed;
    const payload = completedPayload(result.order, draft, "pending", []);
    try {
      await writeCompletion(env, completionId, payload);
    } catch (error) {
      // The persisted order remains authoritative if the completion marker cannot be rebuilt.
    }
    return payload;
  }

  let emailResult = null;
  try {
    emailResult = await sendOrderEmails(env, result.order, makeReference(result.order.id), {
      idempotencyKeyPrefix: `cash-order-email:${result.order.id}`
    });
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
  const payload = completedPayload(result.order, draft, emailStatus, emailErrors);
  try {
    await writeCompletion(env, completionId, payload);
  } catch (error) {
    // Completion markers are an optimization; the persisted cash order remains authoritative.
  }

  await recordAnalyticsEvent(env, "order_cash_placed", {
    page: "checkout",
    orderType: result.order.orderType
  }).catch(() => null);

  return payload;
}

async function finalizeCashDraft(env, draft) {
  const completionId = `cash:${String(draft?.id || "").trim()}`;
  if (!draft?.id) {
    throw new ApiError("Cash order draft id is missing.", 500);
  }
  return withFinalizeLock(completionId, () => finalizeCashDraftUnlocked(env, draft));
}

async function hasPersistedCashOrder(env, draft) {
  if (!draft?.id) return false;
  const completionId = `cash:${draft.id}`;
  const identity = await stableOrderIdentity(completionId);
  const [completed, entity] = await Promise.all([
    readCompletion(env, completionId),
    loadOrderEntity(env, identity.recordId)
  ]);
  return Boolean(completed || entity);
}

function stripeSessionState(session) {
  return {
    paymentStatus: String(session?.payment_status || "").trim().toLowerCase(),
    status: String(session?.status || "").trim().toLowerCase()
  };
}

async function switchExpiredCardDraftToCash(env, cardDraft, cashCandidate) {
  return writeDraft(env, {
    ...cashCandidate,
    createdAt: cardDraft.createdAt,
    stripeSessionId: cardDraft.stripeSessionId,
    stripePaymentIntentId: "",
    paymentStatus: "unpaid",
    status: "checkout_created"
  });
}

async function supersedeCardDraftWithCash(env, cardDraft, cashCandidate) {
  const sessionId = String(cardDraft?.stripeSessionId || "").trim();
  if (!sessionId) {
    throw new ApiError(
      "The earlier card checkout cannot be safely cancelled. Please refresh and start a new checkout.",
      409
    );
  }

  let session = await retrieveCheckoutSession(env, sessionId);
  assertStripeSessionMatchesDraft(session, cardDraft);
  let state = stripeSessionState(session);

  if (state.paymentStatus === "paid") {
    return { completed: await finalizePaidSession(env, session), draft: cardDraft };
  }
  if (state.status === "expired") {
    return { completed: null, draft: await switchExpiredCardDraftToCash(env, cardDraft, cashCandidate) };
  }
  if (state.status !== "open") {
    throw new ApiError(
      "The earlier card checkout is still processing and cannot be changed to cash yet.",
      409
    );
  }

  try {
    session = await expireCheckoutSession(env, sessionId, {
      idempotencyKey: `order-checkout-expire:${cardDraft.id}`
    });
  } catch (error) {
    // Payment and expiry can race. Re-read Stripe before deciding which outcome won.
    session = await retrieveCheckoutSession(env, sessionId);
  }

  assertStripeSessionMatchesDraft(session, cardDraft);
  state = stripeSessionState(session);
  if (state.paymentStatus === "paid") {
    return { completed: await finalizePaidSession(env, session), draft: cardDraft };
  }
  if (state.status !== "expired") {
    throw new ApiError(
      "The earlier card checkout could not be safely cancelled. Please retry shortly.",
      409
    );
  }

  return { completed: null, draft: await switchExpiredCardDraftToCash(env, cardDraft, cashCandidate) };
}

function processingPayload(draft, session) {
  return {
    ok: true,
    status: "processing",
    orderType: String(draft?.orderType || session?.metadata?.order_type || "collection"),
    paymentStatus: String(session?.payment_status || draft?.paymentStatus || "unpaid").trim().toLowerCase()
  };
}

export async function createOrderCheckout(env, requestUrl, payload, options = {}) {
  const paymentMethod = normalizePaymentMethod(payload?.paymentMethod);
  const requestKey = normalizeCheckoutRequestKey(options.idempotencyKey || payload?.checkoutRequestId);
  const draftId = requestKey ? await draftIdForRequestKey(requestKey) : "";
  const requestFingerprint = requestKey ? await checkoutRequestFingerprint(payload) : "";

  if (paymentMethod === "cash" && requestKey) {
    const retryDraft = await readDraft(env, draftId);
    if (retryDraft?.paymentMethod === "cash") {
      if (!retryDraft.requestFingerprint || retryDraft.requestFingerprint !== requestFingerprint) {
        throw new ApiError("The checkout idempotency key was already used for different order details.", 409);
      }
      if (await hasPersistedCashOrder(env, retryDraft)) {
        return finalizeCashDraft(env, retryDraft);
      }
    } else if (retryDraft?.requestFingerprint && retryDraft.requestFingerprint !== requestFingerprint) {
      throw new ApiError("The checkout idempotency key was already used for different order details.", 409);
    }
  }

  if (!isOnlineOrderingEnabled(env, requestUrl)) {
    throw new ApiError("Online ordering is temporarily paused. Please contact Millers Café if you need help.", 503);
  }

  if (paymentMethod === "cash" && !isCashOrderingEnabled(env)) {
    throw new ApiError("Cash ordering is temporarily unavailable. Please choose card payment.", 503);
  }

  const orderType = String(payload?.orderType || "").trim().toLowerCase();
  if (orderType !== "collection" && orderType !== "delivery") {
    throw new ApiError("Order type must be collection or delivery.", 400);
  }
  assertCheckoutCartBounds(payload?.cartItems);
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
    cartItems: pricedCart.items,
    itemsSummary: pricedCart.itemsSummary
  }, {
    rules: siteConfig.orders
  });
  if (!shapeCheck.ok) {
    throw new ApiError(shapeCheck.error || "Order details are invalid.", shapeCheck.status || 400);
  }

  if (paymentMethod === "cash" && !requestKey) {
    throw new ApiError("An idempotency key is required for cash orders.", 400);
  }
  const resolvedDraftId = draftId || await draftIdForRequestKey(requestKey);
  const candidateDraft = normalizeDraft({
    id: resolvedDraftId,
    status: "checkout_created",
    orderType,
    paymentMethod,
    requestFingerprint,
    payload: shapeCheck.data,
    pricedCart,
    paymentStatus: "unpaid",
    emailStatus: "",
    emailErrors: [],
    createdAt: nowISO()
  });

  return withFinalizeLock(`draft:${resolvedDraftId}`, async () => {
    let draft = requestKey ? await readDraft(env, resolvedDraftId) : null;
    if (draft) {
      if (!checkoutDraftDetailsMatch(draft, candidateDraft)) {
        throw new ApiError("The checkout idempotency key was already used for different order details.", 409);
      }

      if (draft.paymentMethod === "card" && paymentMethod === "cash") {
        const transition = await supersedeCardDraftWithCash(env, draft, candidateDraft);
        if (transition.completed) return transition.completed;
        return finalizeCashDraft(env, transition.draft);
      }

      if (draft.paymentMethod === "cash" && paymentMethod === "card") {
        if (await hasPersistedCashOrder(env, draft)) {
          return finalizeCashDraft(env, draft);
        }
        throw new ApiError("This checkout request has already been started as a cash order.", 409);
      }

      if (draft.status !== "checkout_created") {
        throw new ApiError("This checkout request has already finished. Please start a new checkout.", 409);
      }
      if (!checkoutDraftMatches(draft, candidateDraft)) {
        throw new ApiError("The checkout idempotency key was already used for different order details.", 409);
      }
    } else {
      draft = await writeDraft(env, candidateDraft);
    }

    if (paymentMethod === "cash") {
      return finalizeCashDraft(env, draft);
    }

    const session = await createCheckoutSession(env, buildCheckoutForm(draft, requestUrl), {
      idempotencyKey: `order-checkout:${draft.id}`
    });
    const sessionId = String(session?.id || "").trim();
    const checkoutUrl = String(session?.url || "").trim();
    if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId) || !isValidHttpsUrl(checkoutUrl)) {
      throw new ApiError("Stripe returned an invalid checkout session.", 502);
    }
    if (draft.stripeSessionId && draft.stripeSessionId !== sessionId) {
      throw new ApiError("Stripe returned a conflicting checkout session for this request.", 409);
    }

    draft = await writeDraft(env, {
      ...draft,
      stripeSessionId: sessionId,
      paymentStatus: String(session?.payment_status || "unpaid").trim().toLowerCase()
    });

    return {
      ok: true,
      status: "redirect_required",
      paymentMethod: "card",
      paymentProvider: "stripe",
      checkoutUrl,
      sessionId,
      amountTotal: draft.pricedCart.totalMinor,
      currency: draft.pricedCart.currency
    };
  });
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
      try {
        await writeDraft(env, {
          ...draft,
          status: "expired",
          stripeSessionId: String(session?.id || "").trim(),
          paymentStatus: String(session?.payment_status || "").trim().toLowerCase()
        });
      } catch (error) {
        // The Stripe session is authoritative; draft status is only a local cache.
      }
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
      try {
        await writeDraft(env, {
          ...draft,
          status: "payment_failed",
          stripeSessionId: String(session?.id || "").trim(),
          stripePaymentIntentId: String(session?.payment_intent || "").trim(),
          paymentStatus: String(session?.payment_status || "unpaid").trim().toLowerCase()
        });
      } catch (error) {
        // Stripe remains authoritative for the failed payment status.
      }
    }
    await recordAnalyticsEvent(env, "order_payment_failed", {
      page: "checkout"
    }).catch(() => null);
    return { ok: true, received: true, ignored: false };
  }

  if (eventType === "checkout.session.completed" || eventType === "checkout.session.async_payment_succeeded") {
    if (String(session?.payment_status || "").trim().toLowerCase() === "paid") {
      await finalizePaidSession(env, session);
    }
  }

  return { ok: true, received: true, ignored: false };
}
