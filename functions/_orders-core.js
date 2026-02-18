"use strict";

const STORAGE_KEY = "orders_v1";
const SERVICE_START_MINUTES = 12 * 60;
const SERVICE_END_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;
const ASAP_VALUE = "ASAP";
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

function normalizeOrderType(rawType) {
  const value = String(rawType || "").trim().toLowerCase();
  return VALID_ORDER_TYPES.has(value) ? value : "";
}

function leadMinutesForOrderType(orderType) {
  return orderType === "delivery" ? DELIVERY_MIN_LEAD_MINUTES : COLLECTION_MIN_LEAD_MINUTES;
}

function earliestScheduledMinutesForOrderType(orderType) {
  return orderType === "delivery"
    ? DELIVERY_EARLIEST_SCHEDULED_MINUTES
    : COLLECTION_EARLIEST_SCHEDULED_MINUTES;
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

export function isOrderDayOpen(isoDate) {
  const day = dayIndexForISODate(isoDate);
  return day !== null && OPEN_DAY_INDEXES.has(day);
}

export function validateOrderWindow(isoDate, clock, orderTypeRaw = "collection") {
  if (!isISODate(isoDate)) {
    return { ok: false, status: 400, error: "Date must be in yyyy-MM-dd format." };
  }

  if (!isOrderDayOpen(isoDate)) {
    return { ok: false, status: 400, error: "Orders are available Tuesday to Sunday only." };
  }

  const orderType = normalizeOrderType(orderTypeRaw) || "collection";
  const timeValue = String(clock || "").trim().toUpperCase();
  const earliestScheduled = earliestScheduledMinutesForOrderType(orderType);
  const now = londonNowDateAndMinutes();
  const isToday = isoDate === now.dateISO;

  if (timeValue === ASAP_VALUE) {
    if (!isToday) {
      return { ok: false, status: 400, error: "ASAP is only available for today's date." };
    }
    if (now.minutesNow > SERVICE_END_MINUTES) {
      return { ok: false, status: 400, error: "No slots are left today. Please choose another date." };
    }
    return { ok: true, minutes: null, normalizedTime: ASAP_VALUE, isAsap: true };
  }

  const minutes = parseClockToMinutes(timeValue);
  if (!Number.isFinite(minutes)) {
    return { ok: false, status: 400, error: "Time must be in HH:mm format or ASAP." };
  }

  if (minutes < earliestScheduled || minutes > SERVICE_END_MINUTES) {
    const orderLabel = orderType === "delivery" ? "Delivery" : "Collection";
    return {
      ok: false,
      status: 400,
      error: `${orderLabel} scheduled times must be between ${minutesToClock(earliestScheduled)} and 17:00.`
    };
  }

  if (minutes % SLOT_STEP_MINUTES !== 0) {
    return { ok: false, status: 400, error: "Orders must be in 15-minute intervals." };
  }

  if (isToday) {
    const minimum = Math.max(
      earliestScheduled,
      roundUpToStep(now.minutesNow + leadMinutesForOrderType(orderType), SLOT_STEP_MINUTES)
    );

    if (minimum > SERVICE_END_MINUTES) {
      return { ok: false, status: 400, error: "No scheduled slots are left today. Please choose another date." };
    }

    if (minutes < minimum) {
      const lead = leadMinutesForOrderType(orderType);
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

function validatePayloadShape(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, status: 400, error: "Invalid order payload." };
  }

  const orderType = normalizeOrderType(payload.orderType);
  if (!orderType) {
    return { ok: false, status: 400, error: "Order type must be collection or delivery." };
  }

  const customerName = String(payload.customerName || "").trim();
  if (customerName.length < 2) {
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
  const windowCheck = validateOrderWindow(date, time, orderType);
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
      postcode
    }
  };
}

export function createOrderRecord(orders, payload) {
  const shapeCheck = validatePayloadShape(payload);
  if (!shapeCheck.ok) {
    return shapeCheck;
  }

  const data = shapeCheck.data;
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

export function isFeedAuthorized(request, env) {
  const configuredToken = String(env.ORDERS_FEED_TOKEN || env.BOOKINGS_FEED_TOKEN || "").trim();
  if (!configuredToken) return true;
  const provided = new URL(request.url).searchParams.get("token") || "";
  return provided === configuredToken;
}

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function csvResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
