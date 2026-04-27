"use strict";

const STORAGE_KEY = "orders_v1";
const SERVICE_START_MINUTES = 12 * 60;
const SERVICE_END_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;
const ASAP_VALUE = "ASAP";
const MAX_ORDER_LOOKAHEAD_DAYS = 90;
const COLLECTION_MIN_LEAD_MINUTES = 30;
const DELIVERY_MIN_LEAD_MINUTES = 60;
const COLLECTION_EARLIEST_SCHEDULED_MINUTES = (12 * 60) + 30;
const DELIVERY_EARLIEST_SCHEDULED_MINUTES = 13 * 60;
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

function isISODate(isoDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""));
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

  return {
    serviceStartMinutes: Math.max(0, Math.round(Number(source.serviceStartMinutes ?? DEFAULT_ORDER_RULES.serviceStartMinutes))),
    serviceEndMinutes: Math.max(0, Math.round(Number(source.serviceEndMinutes ?? DEFAULT_ORDER_RULES.serviceEndMinutes))),
    slotStepMinutes: Math.max(1, Math.round(Number(source.slotStepMinutes ?? DEFAULT_ORDER_RULES.slotStepMinutes))),
    maxLookaheadDays: Math.max(1, Math.round(Number(source.maxLookaheadDays ?? DEFAULT_ORDER_RULES.maxLookaheadDays))),
    collectionMinLeadMinutes: Math.max(0, Math.round(Number(
      source.collectionMinLeadMinutes ?? DEFAULT_ORDER_RULES.collectionMinLeadMinutes
    ))),
    deliveryMinLeadMinutes: Math.max(0, Math.round(Number(
      source.deliveryMinLeadMinutes ?? DEFAULT_ORDER_RULES.deliveryMinLeadMinutes
    ))),
    collectionEarliestScheduledMinutes: Math.max(0, Math.round(Number(
      source.collectionEarliestScheduledMinutes ?? DEFAULT_ORDER_RULES.collectionEarliestScheduledMinutes
    ))),
    deliveryEarliestScheduledMinutes: Math.max(0, Math.round(Number(
      source.deliveryEarliestScheduledMinutes ?? DEFAULT_ORDER_RULES.deliveryEarliestScheduledMinutes
    ))),
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
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 ? rounded : null;
}

function normalizeCartItemSelection(rawSelection) {
  const groupName = String(rawSelection?.groupName || "").trim();
  const optionName = String(rawSelection?.optionName || "").trim();
  if (!groupName || !optionName) return null;

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
  return selection;
}

function normalizeCartItem(rawItem) {
  const itemName = String(rawItem?.itemName || rawItem?.name || "").trim();
  const quantity = Number(rawItem?.quantity);
  if (!itemName || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return null;

  const item = {
    itemName,
    quantity,
    modifierSelections: Array.isArray(rawItem?.modifierSelections)
      ? rawItem.modifierSelections.map(normalizeCartItemSelection).filter(Boolean)
      : []
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
  if (normalizedTime !== ASAP_VALUE && !/^\d{2}:\d{2}$/.test(normalizedTime)) return null;

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
    cartItems: normalizeCartItems(raw.cartItems),
    source: String(raw.source || "Millers Cafe Website"),
    createdAt: String(raw.createdAt || nowISO())
  };
}

export async function loadOrders(env) {
  let records = [];
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    const stored = await env.BOOKINGS_KV.get(STORAGE_KEY, "json");
    records = Array.isArray(stored) ? stored : [];
  } else {
    records = getInMemoryStore();
  }

  return records.map(normalizeOrderRecord).filter(Boolean);
}

export async function saveOrders(env, orders) {
  const records = orders.map((order) => ({
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
    cartItems: normalizeCartItems(order.cartItems),
    source: order.source,
    createdAt: order.createdAt
  }));

  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    await env.BOOKINGS_KV.put(STORAGE_KEY, JSON.stringify(records));
    return;
  }

  globalThis.__millersCafeOrdersStore = records;
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

  const phoneNumber = String(payload.phoneNumber || "").trim();
  if (!/^\d{5}\s\d{6}$/.test(phoneNumber)) {
    return { ok: false, status: 400, error: "Phone number must be in format XXXXX XXXXXX." };
  }

  const email = String(payload.email || "").trim();
  if (!isLikelyEmail(email)) {
    return { ok: false, status: 400, error: "A valid email address is required." };
  }

  const date = String(payload.date || "");
  const time = String(payload.time || "").trim().toUpperCase();
  const windowCheck = validateOrderWindow(date, time, orderType, options.rules);
  if (!windowCheck.ok) {
    return windowCheck;
  }

  const itemsSummary = String(payload.itemsSummary || "").trim();
  if (itemsSummary.length < 3) {
    return { ok: false, status: 400, error: "Order details are required." };
  }

  const addressLine1 = String(payload.addressLine1 || "").trim();
  const addressLine2 = String(payload.addressLine2 || "").trim();
  const townCity = String(payload.townCity || "").trim();
  const postcode = normalizePostcode(payload.postcode || "");

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
      phoneDigits: normalizePhoneDigits(phoneNumber),
      email,
      date,
      time: windowCheck.normalizedTime || time,
      specialOccasion: normalizeSpecialOccasion(payload.specialOccasion),
      itemsSummary,
      notes: String(payload.notes || "").trim(),
      addressLine1,
      addressLine2,
      townCity,
      postcode,
      cartItems: normalizeCartItems(payload.cartItems)
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

  const orderId = randomId();
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
    addressLine1: data.addressLine1,
    addressLine2: data.addressLine2,
    townCity: data.townCity,
    postcode: data.postcode,
    status: "submitted",
    etaMinutes: null,
    decisionDate: "",
    decisionTime: "",
    trackingToken: makeTrackingToken(),
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
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/\"/g, "\"\"")}"`;
  }
  return text;
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
