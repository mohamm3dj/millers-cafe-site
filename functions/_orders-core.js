"use strict";

import { normalizeMenuItemAllergenCodes } from "../orders/menu-catalog.js";

const STORAGE_KEY = "orders_v1";
const ORDER_ENTITY_PREFIX = "order_entity:";
const SERVICE_START_MINUTES = 12 * 60;
const SERVICE_END_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;
const ASAP_VALUE = "ASAP";
const MAX_ORDER_LOOKAHEAD_DAYS = 90;
const COLLECTION_MIN_LEAD_MINUTES = 30;
const DELIVERY_MIN_LEAD_MINUTES = 60;
const COLLECTION_EARLIEST_SCHEDULED_MINUTES = (12 * 60) + 30;
const DELIVERY_EARLIEST_SCHEDULED_MINUTES = 13 * 60;
const MAX_CUSTOMER_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_DISPLAY_LENGTH = 30;
const MAX_ORDER_NOTES_LENGTH = 400;
const MAX_ADDRESS_LINE_LENGTH = 120;
const MAX_TOWN_CITY_LENGTH = 80;
const MAX_POSTCODE_LENGTH = 10;
const MAX_ITEMS_SUMMARY_LENGTH = 20000;
const MAX_CART_LINES = 50;
const MAX_CART_TOTAL_QUANTITY = 100;
const OPEN_DAY_INDEXES = new Set([0, 2, 3, 4, 5, 6]); // Sun, Tue-Sat
const VALID_ORDER_TYPES = new Set(["collection", "delivery"]);
const VALID_OCCASIONS = new Set([
  "None",
  "Birthday",
  "Anniversary",
  "Engagement",
  "Date Night",
  "Business",
  "Celebration"
]);

const DEFAULT_ORDER_RULES = {
  serviceStartMinutes: SERVICE_START_MINUTES,
  serviceEndMinutes: SERVICE_END_MINUTES,
  slotStepMinutes: SLOT_STEP_MINUTES,
  maxLookaheadDays: MAX_ORDER_LOOKAHEAD_DAYS,
  collectionMinLeadMinutes: COLLECTION_MIN_LEAD_MINUTES,
  deliveryMinLeadMinutes: DELIVERY_MIN_LEAD_MINUTES,
  collectionEarliestScheduledMinutes: COLLECTION_EARLIEST_SCHEDULED_MINUTES,
  deliveryEarliestScheduledMinutes: DELIVERY_EARLIEST_SCHEDULED_MINUTES,
  openDayIndexes: [...OPEN_DAY_INDEXES]
};

function getInMemoryStore() {
  if (!Array.isArray(globalThis.__millersCafeOrdersStore)) {
    globalThis.__millersCafeOrdersStore = [];
  }
  return globalThis.__millersCafeOrdersStore;
}

function getMutationLockStore() {
  if (!(globalThis.__millersCafeOrderMutationLocks instanceof Map)) {
    globalThis.__millersCafeOrderMutationLocks = new Map();
  }
  return globalThis.__millersCafeOrderMutationLocks;
}

export async function withOrdersMutationLock(work) {
  if (typeof work !== "function") {
    throw new TypeError("Order mutation work must be a function.");
  }

  const locks = getMutationLockStore();
  const previous = locks.get(STORAGE_KEY) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  locks.set(STORAGE_KEY, current);

  try {
    return await current;
  } finally {
    if (locks.get(STORAGE_KEY) === current) {
      locks.delete(STORAGE_KEY);
    }
  }
}

function nowISO() {
  return new Date().toISOString();
}

function randomId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `mco-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function makeTrackingToken() {
  const seed = randomId().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (seed.length >= 20) return seed.slice(0, 20);
  return `${seed}${Date.now().toString(16)}`.slice(0, 20);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseClockToMinutes(clock) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(clock || ""));
  if (!match) return NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return NaN;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
  return (hours * 60) + minutes;
}

function minutesToClock(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

function roundUpToStep(minutes, stepMinutes) {
  return Math.ceil(minutes / stepMinutes) * stepMinutes;
}

function boundedRuleInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function isISODate(isoDate) {
  const value = String(isoDate || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function parseISODateUTC(isoDate) {
  if (!isISODate(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toISODateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function normalizeOrderType(rawType) {
  const value = String(rawType || "").trim().toLowerCase();
  return VALID_ORDER_TYPES.has(value) ? value : "";
}

function normalizedRules(rawRules = null) {
  const source = rawRules && typeof rawRules === "object" ? rawRules : {};
  const openDayIndexes = Array.isArray(source.openDayIndexes)
    ? source.openDayIndexes
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    : DEFAULT_ORDER_RULES.openDayIndexes;

  const serviceStartMinutes = boundedRuleInteger(
    source.serviceStartMinutes,
    DEFAULT_ORDER_RULES.serviceStartMinutes,
    0,
    (24 * 60) - 1
  );
  const serviceEndMinutes = Math.max(serviceStartMinutes, boundedRuleInteger(
    source.serviceEndMinutes,
    DEFAULT_ORDER_RULES.serviceEndMinutes,
    0,
    (24 * 60) - 1
  ));

  return {
    serviceStartMinutes,
    serviceEndMinutes,
    slotStepMinutes: boundedRuleInteger(source.slotStepMinutes, DEFAULT_ORDER_RULES.slotStepMinutes, 1, 24 * 60),
    maxLookaheadDays: boundedRuleInteger(source.maxLookaheadDays, DEFAULT_ORDER_RULES.maxLookaheadDays, 1, 365),
    collectionMinLeadMinutes: boundedRuleInteger(
      source.collectionMinLeadMinutes,
      DEFAULT_ORDER_RULES.collectionMinLeadMinutes,
      0,
      7 * 24 * 60
    ),
    deliveryMinLeadMinutes: boundedRuleInteger(
      source.deliveryMinLeadMinutes,
      DEFAULT_ORDER_RULES.deliveryMinLeadMinutes,
      0,
      7 * 24 * 60
    ),
    collectionEarliestScheduledMinutes: boundedRuleInteger(
      source.collectionEarliestScheduledMinutes,
      DEFAULT_ORDER_RULES.collectionEarliestScheduledMinutes,
      0,
      (24 * 60) - 1
    ),
    deliveryEarliestScheduledMinutes: boundedRuleInteger(
      source.deliveryEarliestScheduledMinutes,
      DEFAULT_ORDER_RULES.deliveryEarliestScheduledMinutes,
      0,
      (24 * 60) - 1
    ),
    openDayIndexes: openDayIndexes.length > 0 ? openDayIndexes : DEFAULT_ORDER_RULES.openDayIndexes
  };
}

function dayListSummary(dayIndexes) {
  const cleaned = Array.from(new Set(
    (Array.isArray(dayIndexes) ? dayIndexes : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
  )).sort((left, right) => left - right);

  if (cleaned.length === 7) return "every day";
  if (cleaned.length === 6 && !cleaned.includes(1)) return "Tuesday to Sunday";

  const labels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return cleaned.map((dayIndex) => labels[dayIndex]).join(", ");
}

function orderOpenDaysMessage(rules) {
  return `Orders are available on ${dayListSummary(rules.openDayIndexes)} only.`;
}

function orderIntervalLabel(rules) {
  return `${rules.slotStepMinutes}-minute intervals`;
}

function leadMinutesForOrderType(orderType, rawRules = null) {
  const rules = normalizedRules(rawRules);
  return orderType === "delivery" ? rules.deliveryMinLeadMinutes : rules.collectionMinLeadMinutes;
}

function earliestScheduledMinutesForOrderType(orderType, rawRules = null) {
  const rules = normalizedRules(rawRules);
  return orderType === "delivery"
    ? rules.deliveryEarliestScheduledMinutes
    : rules.collectionEarliestScheduledMinutes;
}

function normalizePhoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function isLikelyEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function normalizeSpecialOccasion(rawOccasion) {
  const value = String(rawOccasion || "").trim();
  if (VALID_OCCASIONS.has(value)) return value;
  return "None";
}

function normalizePostcode(postcode) {
  return String(postcode || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeEtaMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 ? rounded : null;
}

function normalizePaymentProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "stripe" ? "stripe" : "";
}

function normalizePaymentStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePaymentAmountTotal(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 ? rounded : null;
}

function normalizePaymentCurrency(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-z]{3}$/.test(normalized) ? normalized : "";
}

function normalizeRefundStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRefundAmountTotal(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 ? rounded : null;
}

function normalizeRefundAttempts(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function normalizeCartItemSelection(rawSelection) {
  const groupName = String(rawSelection?.groupName || "").trim();
  const optionName = String(rawSelection?.optionName || "").trim();
  if (!groupName || !optionName || groupName.length > 120 || optionName.length > 120) return null;

  const selection = {
    groupName,
    optionName,
    isTextInput: Boolean(rawSelection?.isTextInput)
  };
  if (Object.prototype.hasOwnProperty.call(rawSelection || {}, "priceAdjustment")) {
    selection.priceAdjustment = Number.isFinite(Number(rawSelection?.priceAdjustment))
      ? Math.round(Number(rawSelection.priceAdjustment) * 100) / 100
      : 0;
  }
  const posModifierGroupId = String(rawSelection?.posModifierGroupId || rawSelection?.groupId || "").trim();
  const posModifierOptionId = String(rawSelection?.posModifierOptionId || rawSelection?.optionId || "").trim();
  if (posModifierGroupId) selection.posModifierGroupId = posModifierGroupId;
  if (posModifierOptionId) selection.posModifierOptionId = posModifierOptionId;
  const allergenCodes = normalizeMenuItemAllergenCodes({ codes: rawSelection?.allergenCodes });
  const removesAllergenCodes = normalizeMenuItemAllergenCodes({ codes: rawSelection?.removesAllergenCodes });
  if (allergenCodes.length > 0) selection.allergenCodes = allergenCodes;
  if (removesAllergenCodes.length > 0) selection.removesAllergenCodes = removesAllergenCodes;
  return selection;
}

function normalizeCartItem(rawItem) {
  const itemName = String(rawItem?.itemName || rawItem?.name || "").trim();
  const quantity = Number(rawItem?.quantity);
  const rawSelections = Array.isArray(rawItem?.modifierSelections) ? rawItem.modifierSelections : [];
  const modifierSelections = rawSelections.map(normalizeCartItemSelection).filter(Boolean);
  if (!itemName || itemName.length > 160 || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return null;
  if (rawSelections.length > 20 || modifierSelections.length !== rawSelections.length) return null;

  const item = {
    itemName,
    quantity,
    modifierSelections
  };
  const posItemId = String(rawItem?.posItemId || rawItem?.itemId || rawItem?.menuItemId || "").trim();
  const posCategoryId = String(rawItem?.posCategoryId || rawItem?.categoryId || "").trim();
  const categoryName = String(rawItem?.categoryName || "").trim();
  const printRouting = String(rawItem?.printRouting || "").trim();
  const menuVersion = String(rawItem?.menuVersion || "").trim();
  const basePrice = Number(rawItem?.basePrice);
  const unitPrice = Number(rawItem?.unitPrice);
  const linePrice = Number(rawItem?.linePrice);
  if (posItemId) {
    item.posItemId = posItemId;
    item.itemId = posItemId;
  }
  if (posCategoryId) item.posCategoryId = posCategoryId;
  if (categoryName) item.categoryName = categoryName;
  if (printRouting) item.printRouting = printRouting;
  if (menuVersion) item.menuVersion = menuVersion;
  if (Number.isFinite(basePrice) && basePrice >= 0) item.basePrice = Math.round(basePrice * 100) / 100;
  if (Number.isFinite(unitPrice) && unitPrice >= 0) item.unitPrice = Math.round(unitPrice * 100) / 100;
  if (Number.isFinite(linePrice) && linePrice >= 0) item.linePrice = Math.round(linePrice * 100) / 100;
  return item;
}

function normalizeCartItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map(normalizeCartItem).filter(Boolean);
}

function normalizedStatus(status) {
  return String(status || "submitted").trim().toLowerCase().replace(/\s+/g, "_");
}

function statusBlocksDuplicates(status) {
  const current = normalizedStatus(status);
  return current !== "cancelled" && current !== "canceled" && current !== "rejected" && current !== "failed";
}

function dayIndexForISODate(isoDate) {
  if (!isISODate(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function londonNowDateAndMinutes() {
  const dateISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");

  return {
    dateISO,
    minutesNow: (hour * 60) + minute
  };
}

function maxOrderDateISO(rawRules = null) {
  const rules = normalizedRules(rawRules);
  const today = parseISODateUTC(londonNowDateAndMinutes().dateISO);
  if (!today) return "";
  today.setUTCDate(today.getUTCDate() + Math.max(0, rules.maxLookaheadDays - 1));
  return toISODateUTC(today);
}

export function isOrderDayOpen(isoDate, rawRules = null) {
  const rules = normalizedRules(rawRules);
  const day = dayIndexForISODate(isoDate);
  return day !== null && new Set(rules.openDayIndexes).has(day);
}

export function validateOrderWindow(isoDate, clock, orderTypeRaw = "collection", rawRules = null) {
  const rules = normalizedRules(rawRules);
  if (!isISODate(isoDate)) {
    return { ok: false, status: 400, error: "Date must be in yyyy-MM-dd format." };
  }

  const now = londonNowDateAndMinutes();
  if (isoDate < now.dateISO) {
    return { ok: false, status: 400, error: "Orders are no longer available for past dates." };
  }

  const maxDate = maxOrderDateISO(rules);
  if (maxDate && isoDate > maxDate) {
    return {
      ok: false,
      status: 400,
      error: `Orders can only be placed up to ${rules.maxLookaheadDays} days ahead.`
    };
  }

  if (!isOrderDayOpen(isoDate, rules)) {
    return { ok: false, status: 400, error: orderOpenDaysMessage(rules) };
  }

  const orderType = normalizeOrderType(orderTypeRaw) || "collection";
  const timeValue = String(clock || "").trim().toUpperCase();
  const earliestScheduled = earliestScheduledMinutesForOrderType(orderType, rules);
  const isToday = isoDate === now.dateISO;

  if (timeValue === ASAP_VALUE) {
    if (!isToday) {
      return { ok: false, status: 400, error: "ASAP is only available for today's date." };
    }
    if (now.minutesNow > rules.serviceEndMinutes) {
      return { ok: false, status: 400, error: "No slots are left today. Please choose another date." };
    }
    return { ok: true, minutes: null, normalizedTime: ASAP_VALUE, isAsap: true };
  }

  const minutes = parseClockToMinutes(timeValue);
  if (!Number.isFinite(minutes)) {
    return { ok: false, status: 400, error: "Time must be in HH:mm format or ASAP." };
  }

  if (minutes < earliestScheduled || minutes > rules.serviceEndMinutes) {
    const orderLabel = orderType === "delivery" ? "Delivery" : "Collection";
    return {
      ok: false,
      status: 400,
      error: `${orderLabel} scheduled times must be between ${minutesToClock(earliestScheduled)} and ${minutesToClock(rules.serviceEndMinutes)}.`
    };
  }

  if (minutes % rules.slotStepMinutes !== 0) {
    return { ok: false, status: 400, error: `Orders must be in ${orderIntervalLabel(rules)}.` };
  }

  if (isToday) {
    const minimum = Math.max(
      earliestScheduled,
      roundUpToStep(now.minutesNow + leadMinutesForOrderType(orderType, rules), rules.slotStepMinutes)
    );

    if (minimum > rules.serviceEndMinutes) {
      return { ok: false, status: 400, error: "No scheduled slots are left today. Please choose another date." };
    }

    if (minutes < minimum) {
      const lead = leadMinutesForOrderType(orderType, rules);
      return {
        ok: false,
        status: 400,
        error: `Scheduled time must be at least ${lead} minutes from now (${minutesToClock(minimum)} or later).`
      };
    }
  }

  return { ok: true, minutes, normalizedTime: minutesToClock(minutes), isAsap: false };
}

function normalizeOrderRecord(raw) {
  if (!raw || typeof raw !== "object") return null;

  const orderType = normalizeOrderType(raw.orderType);
  const normalizedTime = String(raw.time || "").trim().toUpperCase();
  if (!orderType) return null;
  if (!isISODate(raw.date)) return null;
  if (normalizedTime !== ASAP_VALUE && !Number.isFinite(parseClockToMinutes(normalizedTime))) return null;

  const stableFallbackToken = `trk-${String(raw.id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(-16)}`;

  return {
    id: String(raw.id || randomId()),
    orderType,
    customerName: String(raw.customerName || "").trim(),
    phoneNumber: String(raw.phoneNumber || "").trim(),
    phoneDigits: normalizePhoneDigits(raw.phoneNumber || ""),
    email: String(raw.email || "").trim(),
    date: String(raw.date),
    time: normalizedTime,
    specialOccasion: normalizeSpecialOccasion(raw.specialOccasion),
    itemsSummary: String(raw.itemsSummary || "").trim(),
    notes: String(raw.notes || "").trim(),
    sensitiveInfoConsent: Boolean(raw.sensitiveInfoConsent),
    sensitiveInfoConsentAt: String(raw.sensitiveInfoConsentAt || "").trim(),
    addressLine1: String(raw.addressLine1 || "").trim(),
    addressLine2: String(raw.addressLine2 || "").trim(),
    townCity: String(raw.townCity || "").trim(),
    postcode: normalizePostcode(raw.postcode || ""),
    status: normalizedStatus(raw.status || "submitted"),
    etaMinutes: normalizeEtaMinutes(raw.etaMinutes),
    decisionDate: String(raw.decisionDate || "").trim(),
    decisionTime: String(raw.decisionTime || "").trim().toUpperCase(),
    trackingToken: String(raw.trackingToken || stableFallbackToken).trim().toLowerCase() || stableFallbackToken,
    statusUpdatedAt: String(raw.statusUpdatedAt || raw.createdAt || nowISO()),
    paymentProvider: normalizePaymentProvider(raw.paymentProvider),
    paymentStatus: normalizePaymentStatus(raw.paymentStatus),
    paymentSessionId: String(raw.paymentSessionId || "").trim(),
    paymentIntentId: String(raw.paymentIntentId || "").trim(),
    paymentAmountTotal: normalizePaymentAmountTotal(raw.paymentAmountTotal),
    paymentCurrency: normalizePaymentCurrency(raw.paymentCurrency),
    refundStatus: normalizeRefundStatus(raw.refundStatus),
    refundId: String(raw.refundId || "").trim(),
    refundAmountTotal: normalizeRefundAmountTotal(raw.refundAmountTotal),
    refundCreatedAt: String(raw.refundCreatedAt || "").trim(),
    refundAttempts: normalizeRefundAttempts(raw.refundAttempts),
    refundLastError: String(raw.refundLastError || "").trim(),
    refundUpdatedAt: String(raw.refundUpdatedAt || "").trim(),
    refundIdempotencyKey: String(raw.refundIdempotencyKey || "").trim(),
    cartItems: normalizeCartItems(raw.cartItems),
    source: String(raw.source || "Millers Cafe Website"),
    createdAt: String(raw.createdAt || nowISO())
  };
}

function serializedOrderRecord(order) {
  return {
    id: order.id,
    orderType: order.orderType,
    customerName: order.customerName,
    phoneNumber: order.phoneNumber,
    email: order.email,
    date: order.date,
    time: order.time,
    specialOccasion: normalizeSpecialOccasion(order.specialOccasion),
    itemsSummary: order.itemsSummary,
    notes: order.notes,
    sensitiveInfoConsent: Boolean(order.sensitiveInfoConsent),
    sensitiveInfoConsentAt: String(order.sensitiveInfoConsentAt || "").trim(),
    addressLine1: order.addressLine1,
    addressLine2: order.addressLine2,
    townCity: order.townCity,
    postcode: normalizePostcode(order.postcode),
    status: normalizedStatus(order.status),
    etaMinutes: normalizeEtaMinutes(order.etaMinutes),
    decisionDate: String(order.decisionDate || "").trim(),
    decisionTime: String(order.decisionTime || "").trim().toUpperCase(),
    trackingToken: String(order.trackingToken || "").trim().toLowerCase(),
    statusUpdatedAt: String(order.statusUpdatedAt || order.createdAt || nowISO()),
    paymentProvider: normalizePaymentProvider(order.paymentProvider),
    paymentStatus: normalizePaymentStatus(order.paymentStatus),
    paymentSessionId: String(order.paymentSessionId || "").trim(),
    paymentIntentId: String(order.paymentIntentId || "").trim(),
    paymentAmountTotal: normalizePaymentAmountTotal(order.paymentAmountTotal),
    paymentCurrency: normalizePaymentCurrency(order.paymentCurrency),
    refundStatus: normalizeRefundStatus(order.refundStatus),
    refundId: String(order.refundId || "").trim(),
    refundAmountTotal: normalizeRefundAmountTotal(order.refundAmountTotal),
    refundCreatedAt: String(order.refundCreatedAt || "").trim(),
    refundAttempts: normalizeRefundAttempts(order.refundAttempts),
    refundLastError: String(order.refundLastError || "").trim(),
    refundUpdatedAt: String(order.refundUpdatedAt || "").trim(),
    refundIdempotencyKey: String(order.refundIdempotencyKey || "").trim(),
    cartItems: normalizeCartItems(order.cartItems),
    source: order.source,
    createdAt: order.createdAt
  };
}

function orderFreshnessMillis(order) {
  return Math.max(
    Date.parse(String(order?.statusUpdatedAt || "")) || 0,
    Date.parse(String(order?.refundUpdatedAt || "")) || 0,
    Date.parse(String(order?.createdAt || "")) || 0
  );
}

async function loadOrderEntities(env) {
  if (!env.BOOKINGS_KV || typeof env.BOOKINGS_KV.list !== "function" || typeof env.BOOKINGS_KV.get !== "function") {
    return [];
  }

  const entities = [];
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    const listed = await env.BOOKINGS_KV.list({
      prefix: ORDER_ENTITY_PREFIX,
      ...(cursor ? { cursor } : {})
    });
    const keys = Array.isArray(listed?.keys) ? listed.keys : [];
    for (let offset = 0; offset < keys.length; offset += 50) {
      const names = keys
        .slice(offset, offset + 50)
        .map((key) => String(key?.name || "").trim())
        .filter(Boolean);
      const pageEntities = await Promise.all(
        names.map((keyName) => env.BOOKINGS_KV.get(keyName, "json"))
      );
      for (const rawEntity of pageEntities) {
        const entity = normalizeOrderRecord(rawEntity);
        if (entity) entities.push(entity);
      }
    }

    cursor = String(listed?.cursor || "").trim();
    if (listed?.list_complete === true || !cursor) break;
  }
  return entities;
}

export async function loadOrders(env) {
  let records = [];
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    const stored = await env.BOOKINGS_KV.get(STORAGE_KEY, "json");
    records = Array.isArray(stored) ? stored : [];
  } else {
    records = getInMemoryStore();
  }

  const storedRecords = records.map(normalizeOrderRecord).filter(Boolean);
  const entityRecords = await loadOrderEntities(env);
  if (entityRecords.length === 0) return storedRecords;

  const merged = new Map(entityRecords.map((order) => [order.id, order]));
  for (const order of storedRecords) {
    const entity = merged.get(order.id);
    if (!entity || orderFreshnessMillis(order) >= orderFreshnessMillis(entity)) {
      merged.set(order.id, order);
    }
  }
  return Array.from(merged.values());
}

export async function saveOrders(env, orders) {
  const records = orders.map(serializedOrderRecord);

  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    await env.BOOKINGS_KV.put(STORAGE_KEY, JSON.stringify(records));
    return;
  }

  globalThis.__millersCafeOrdersStore = records;
}

export async function saveOrdersAfterEntity(env, orders) {
  try {
    await saveOrders(env, orders);
    return true;
  } catch (error) {
    if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.list === "function") {
      return false;
    }
    throw error;
  }
}

export async function saveOrderEntity(env, order) {
  if (!env.BOOKINGS_KV || typeof env.BOOKINGS_KV.put !== "function") return;
  const orderId = String(order?.id || "").trim();
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(orderId)) {
    throw new Error("Order entity id is invalid.");
  }
  await env.BOOKINGS_KV.put(`${ORDER_ENTITY_PREFIX}${orderId}`, JSON.stringify(serializedOrderRecord(order)));
}

export function makeReference(orderId) {
  const cleaned = orderId.replace(/-/g, "").toUpperCase();
  return `MCO-${cleaned.slice(0, 8)}`;
}

export function findOrderIndexByReference(orders, reference) {
  const target = String(reference || "").trim().toUpperCase();
  if (!target) return -1;

  return orders.findIndex((order) => makeReference(String(order.id || "")).toUpperCase() === target);
}

export function findOrderIndexByPaymentSessionId(orders, sessionId) {
  const target = String(sessionId || "").trim();
  if (!target) return -1;

  return orders.findIndex((order) => String(order.paymentSessionId || "").trim() === target);
}

function validateStoredOrderWindow(isoDate, clock) {
  if (!isISODate(isoDate)) {
    return { ok: false, status: 400, error: "Date must be a real calendar date in yyyy-MM-dd format." };
  }

  const timeValue = String(clock || "").trim().toUpperCase();
  if (timeValue === ASAP_VALUE) {
    return { ok: true, minutes: null, normalizedTime: ASAP_VALUE, isAsap: true };
  }

  const minutes = parseClockToMinutes(timeValue);
  if (!Number.isFinite(minutes)) {
    return { ok: false, status: 400, error: "Time must be a real 24-hour time in HH:mm format or ASAP." };
  }

  return { ok: true, minutes, normalizedTime: minutesToClock(minutes), isAsap: false };
}

export function validateOrderPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, status: 400, error: "Invalid order payload." };
  }

  const orderType = normalizeOrderType(payload.orderType);
  if (!orderType) {
    return { ok: false, status: 400, error: "Order type must be collection or delivery." };
  }

  const customerName = String(payload.customerName || "").trim();
  if (orderType !== "delivery" && customerName.length < 2) {
    return { ok: false, status: 400, error: "Customer name is required." };
  }
  if (customerName.length > MAX_CUSTOMER_NAME_LENGTH) {
    return { ok: false, status: 400, error: `Customer name must be ${MAX_CUSTOMER_NAME_LENGTH} characters or fewer.` };
  }

  const phoneNumber = String(payload.phoneNumber || "").trim();
  const phoneDigits = normalizePhoneDigits(phoneNumber);
  if (phoneNumber.length > MAX_PHONE_DISPLAY_LENGTH ||
      !/^[+\d][\d ().-]*$/.test(phoneNumber) ||
      phoneDigits.length < 7 ||
      phoneDigits.length > 15) {
    return { ok: false, status: 400, error: "Phone number must contain between 7 and 15 digits." };
  }

  const email = String(payload.email || "").trim();
  if (!isLikelyEmail(email)) {
    return { ok: false, status: 400, error: "A valid email address is required." };
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, status: 400, error: `Email address must be ${MAX_EMAIL_LENGTH} characters or fewer.` };
  }

  const date = String(payload.date || "");
  const time = String(payload.time || "").trim().toUpperCase();
  const windowCheck = options.skipWindowValidation
    ? validateStoredOrderWindow(date, time)
    : validateOrderWindow(date, time, orderType, options.rules);
  if (!windowCheck.ok) {
    return windowCheck;
  }

  const itemsSummary = String(payload.itemsSummary || "").trim();
  if (itemsSummary.length < 3) {
    return { ok: false, status: 400, error: "Order details are required." };
  }
  if (itemsSummary.length > MAX_ITEMS_SUMMARY_LENGTH) {
    return { ok: false, status: 400, error: "Order details are too long." };
  }

  const addressLine1 = String(payload.addressLine1 || "").trim();
  const addressLine2 = String(payload.addressLine2 || "").trim();
  const townCity = String(payload.townCity || "").trim();
  const postcode = normalizePostcode(payload.postcode || "");
  const notes = String(payload.notes || "").trim();

  if (addressLine1.length > MAX_ADDRESS_LINE_LENGTH || addressLine2.length > MAX_ADDRESS_LINE_LENGTH) {
    return { ok: false, status: 400, error: `Address lines must be ${MAX_ADDRESS_LINE_LENGTH} characters or fewer.` };
  }
  if (townCity.length > MAX_TOWN_CITY_LENGTH) {
    return { ok: false, status: 400, error: `Town / City must be ${MAX_TOWN_CITY_LENGTH} characters or fewer.` };
  }
  if (postcode.length > MAX_POSTCODE_LENGTH) {
    return { ok: false, status: 400, error: `Postcode must be ${MAX_POSTCODE_LENGTH} characters or fewer.` };
  }
  if (notes.length > MAX_ORDER_NOTES_LENGTH) {
    return { ok: false, status: 400, error: `Notes must be ${MAX_ORDER_NOTES_LENGTH} characters or fewer.` };
  }
  const sensitiveInfoConsent = Boolean(notes) && payload.sensitiveInfoConsent === true;
  if (notes && !sensitiveInfoConsent) {
    return { ok: false, status: 400, error: "Explicit consent is required when optional notes are provided." };
  }

  if (payload.cartItems !== undefined && !Array.isArray(payload.cartItems)) {
    return { ok: false, status: 400, error: "Order basket must be an array." };
  }
  if (Array.isArray(payload.cartItems) && payload.cartItems.length > MAX_CART_LINES) {
    return { ok: false, status: 400, error: `Order basket cannot contain more than ${MAX_CART_LINES} lines.` };
  }
  const cartItems = normalizeCartItems(payload.cartItems);
  if (Array.isArray(payload.cartItems) && cartItems.length !== payload.cartItems.length) {
    return { ok: false, status: 400, error: "Order basket contains an invalid item." };
  }
  const totalQuantity = cartItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (totalQuantity > MAX_CART_TOTAL_QUANTITY) {
    return { ok: false, status: 400, error: `Order basket cannot contain more than ${MAX_CART_TOTAL_QUANTITY} items.` };
  }

  if (orderType === "delivery") {
    if (!addressLine1) {
      return { ok: false, status: 400, error: "Address line 1 is required for delivery." };
    }
    if (!townCity) {
      return { ok: false, status: 400, error: "Town / City is required for delivery." };
    }
    if (!postcode) {
      return { ok: false, status: 400, error: "Postcode is required for delivery." };
    }
  }

  return {
    ok: true,
    data: {
      orderType,
      customerName,
      phoneNumber,
      phoneDigits,
      email,
      date,
      time: windowCheck.normalizedTime || time,
      specialOccasion: normalizeSpecialOccasion(payload.specialOccasion),
      itemsSummary,
      notes,
      sensitiveInfoConsent,
      addressLine1,
      addressLine2,
      townCity,
      postcode,
      cartItems
    }
  };
}

export function createOrderRecord(orders, payload, options = {}) {
  const shapeCheck = validateOrderPayload(payload, options);
  if (!shapeCheck.ok) {
    return shapeCheck;
  }

  const data = shapeCheck.data;
  if (!options.skipDuplicateCheck) {
    const duplicate = orders.find((order) =>
      order.orderType === data.orderType &&
      order.date === data.date &&
      order.time === data.time &&
      order.phoneDigits.length > 0 &&
      order.phoneDigits === data.phoneDigits &&
      order.itemsSummary.toLowerCase() === data.itemsSummary.toLowerCase() &&
      statusBlocksDuplicates(order.status)
    );

    if (duplicate) {
      return {
        ok: false,
        status: 409,
        error: "A similar order already exists for this customer and time."
      };
    }
  }

  const suppliedOrderId = String(options.recordId || "").trim();
  const orderId = /^[a-zA-Z0-9-]{8,100}$/.test(suppliedOrderId) ? suppliedOrderId : randomId();
  const suppliedTrackingToken = String(options.trackingToken || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const record = {
    id: orderId,
    orderType: data.orderType,
    customerName: data.customerName,
    phoneNumber: data.phoneNumber,
    phoneDigits: data.phoneDigits,
    email: data.email,
    date: data.date,
    time: data.time,
    specialOccasion: data.specialOccasion,
    itemsSummary: data.itemsSummary,
    notes: data.notes,
    sensitiveInfoConsent: data.sensitiveInfoConsent,
    sensitiveInfoConsentAt: data.sensitiveInfoConsent ? nowISO() : "",
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    townCity: data.townCity,
    postcode: data.postcode,
    status: "submitted",
    etaMinutes: null,
    decisionDate: "",
    decisionTime: "",
    trackingToken: suppliedTrackingToken.length >= 16 && suppliedTrackingToken.length <= 64
      ? suppliedTrackingToken
      : makeTrackingToken(),
    statusUpdatedAt: nowISO(),
    paymentProvider: normalizePaymentProvider(options.paymentProvider),
    paymentStatus: normalizePaymentStatus(options.paymentStatus),
    paymentSessionId: String(options.paymentSessionId || "").trim(),
    paymentIntentId: String(options.paymentIntentId || "").trim(),
    paymentAmountTotal: normalizePaymentAmountTotal(options.paymentAmountTotal),
    paymentCurrency: normalizePaymentCurrency(options.paymentCurrency),
    refundStatus: normalizeRefundStatus(options.refundStatus),
    refundId: String(options.refundId || "").trim(),
    refundAmountTotal: normalizeRefundAmountTotal(options.refundAmountTotal),
    refundCreatedAt: String(options.refundCreatedAt || "").trim(),
    refundAttempts: normalizeRefundAttempts(options.refundAttempts),
    refundLastError: String(options.refundLastError || "").trim(),
    refundUpdatedAt: String(options.refundUpdatedAt || "").trim(),
    refundIdempotencyKey: String(options.refundIdempotencyKey || "").trim(),
    cartItems: data.cartItems,
    source: "Millers Cafe Website",
    createdAt: nowISO()
  };

  return {
    ok: true,
    record,
    reference: makeReference(orderId)
  };
}

export function createOrderRecordFromValidatedDraft(orders, payload, options = {}) {
  return createOrderRecord(orders, payload, {
    ...options,
    skipDuplicateCheck: true,
    skipWindowValidation: true
  });
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

function sortTimeValue(time) {
  return String(time || "").toUpperCase() === ASAP_VALUE ? "00:00" : String(time || "");
}

export function feedRows(orders, includePast = false) {
  const today = todayISODateInLondon();

  return orders
    .filter((order) => includePast || order.date >= today)
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return sortTimeValue(a.time).localeCompare(sortTimeValue(b.time));
    })
    .map((order) => ({
      reference: makeReference(order.id),
      type: order.orderType,
      date: order.date,
      time: order.time,
      customer_name: order.customerName,
      customer_phone: order.phoneNumber,
      customer_email: order.email,
      occasion: normalizeSpecialOccasion(order.specialOccasion),
      items: order.itemsSummary,
      address_line_1: order.addressLine1,
      address_line_2: order.addressLine2,
      town_city: order.townCity,
      postcode: order.postcode,
      address_summary: joinedAddress(order),
      notes: order.notes,
      status: order.status,
      eta_minutes: normalizeEtaMinutes(order.etaMinutes),
      decision_date: order.decisionDate || "",
      decision_time: order.decisionTime || "",
      tracking_token: order.trackingToken || "",
      status_updated_at: order.statusUpdatedAt || order.createdAt,
      source: order.source,
      created_at: order.createdAt
    }));
}

function escapeCSVCell(value) {
  const text = String(value ?? "");
  const safeText = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  if (safeText.includes(",") || safeText.includes("\"") || safeText.includes("\n")) {
    return `"${safeText.replace(/\"/g, "\"\"")}"`;
  }
  return safeText;
}

export function toCSV(rows) {
  const header = [
    "reference",
    "type",
    "date",
    "time",
    "customer_name",
    "customer_phone",
    "customer_email",
    "occasion",
    "items",
    "address_line_1",
    "address_line_2",
    "town_city",
    "postcode",
    "address_summary",
    "notes",
    "status",
    "eta_minutes",
    "decision_date",
    "decision_time",
    "tracking_token",
    "status_updated_at",
    "source",
    "created_at"
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((key) => escapeCSVCell(row[key])).join(","));
  }

  return `${lines.join("\n")}\n`;
}
