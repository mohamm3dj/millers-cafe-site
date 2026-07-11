"use strict";

import {
  createBookingRecord,
  loadBookings,
  saveBookingEntity,
  saveBookingsAfterEntity,
  withBookingsMutationLock
} from "../_booking-core.js";
import { loadOrders, makeReference as makeOrderReference } from "../_orders-core.js";
import { ApiError } from "./errors.js";
import { requireAccountSession } from "./account-auth.js";
import { getSiteConfig } from "./site-config.js";

const ACCOUNT_PROFILE_PREFIX = "account_profile:";
const MAX_PROFILE_NAME_LENGTH = 80;
const MAX_PROFILE_PHONE_LENGTH = 30;
const MAX_ADDRESS_LABEL_LENGTH = 60;
const MAX_ADDRESS_LINE_LENGTH = 120;
const MAX_TOWN_CITY_LENGTH = 80;
const MAX_POSTCODE_LENGTH = 10;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePhoneNumber(value) {
  return String(value || "").trim();
}

function normalizePreferredOrderType(value) {
  return String(value || "").trim().toLowerCase() === "delivery" ? "delivery" : "collection";
}

function normalizePostcode(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function profileKey(email) {
  return `${ACCOUNT_PROFILE_PREFIX}${normalizeEmail(email)}`;
}

function getInMemoryStore() {
  if (!globalThis.__millersCafeAccountProfileStore || typeof globalThis.__millersCafeAccountProfileStore !== "object") {
    globalThis.__millersCafeAccountProfileStore = {};
  }
  return globalThis.__millersCafeAccountProfileStore;
}

async function readStoreRecord(env, key) {
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    return env.BOOKINGS_KV.get(key, "json");
  }
  return getInMemoryStore()[key] || null;
}

async function writeStoreRecord(env, key, value) {
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    await env.BOOKINGS_KV.put(key, JSON.stringify(value));
    return;
  }
  getInMemoryStore()[key] = value;
}

function normalizeDeliveryAddress(rawAddress) {
  const address = rawAddress && typeof rawAddress === "object" ? rawAddress : {};
  return {
    label: String(address.label || "").trim() || "Default delivery address",
    addressLine1: String(address.addressLine1 || "").trim(),
    addressLine2: String(address.addressLine2 || "").trim(),
    townCity: String(address.townCity || "").trim(),
    postcode: normalizePostcode(address.postcode || "")
  };
}

function normalizeAccountProfile(email, rawProfile) {
  const profile = rawProfile && typeof rawProfile === "object" ? rawProfile : {};
  const address = normalizeDeliveryAddress(profile.defaultDeliveryAddress);
  const hasAddress = Boolean(address.addressLine1 || address.townCity || address.postcode);

  return {
    email: normalizeEmail(email),
    fullName: String(profile.fullName || "").trim(),
    phoneNumber: normalizePhoneNumber(profile.phoneNumber),
    preferredOrderType: normalizePreferredOrderType(profile.preferredOrderType),
    defaultDeliveryAddress: hasAddress ? address : null,
    updatedAt: String(profile.updatedAt || "")
  };
}

function assertAccountProfileBounds(profile) {
  if (profile.fullName.length > MAX_PROFILE_NAME_LENGTH) {
    throw new ApiError(`Full name must be ${MAX_PROFILE_NAME_LENGTH} characters or fewer.`, 400);
  }
  if (profile.phoneNumber.length > MAX_PROFILE_PHONE_LENGTH) {
    throw new ApiError(`Phone number must be ${MAX_PROFILE_PHONE_LENGTH} characters or fewer.`, 400);
  }
  if (profile.phoneNumber) {
    const phoneDigits = profile.phoneNumber.replace(/\D/g, "");
    if (!/^[+\d][\d ().-]*$/.test(profile.phoneNumber) || phoneDigits.length < 7 || phoneDigits.length > 15) {
      throw new ApiError("Phone number must contain between 7 and 15 digits.", 400);
    }
  }

  const address = profile.defaultDeliveryAddress;
  if (!address) return;
  if (address.label.length > MAX_ADDRESS_LABEL_LENGTH) {
    throw new ApiError(`Address label must be ${MAX_ADDRESS_LABEL_LENGTH} characters or fewer.`, 400);
  }
  if (address.addressLine1.length > MAX_ADDRESS_LINE_LENGTH || address.addressLine2.length > MAX_ADDRESS_LINE_LENGTH) {
    throw new ApiError(`Address lines must be ${MAX_ADDRESS_LINE_LENGTH} characters or fewer.`, 400);
  }
  if (address.townCity.length > MAX_TOWN_CITY_LENGTH) {
    throw new ApiError(`Town / City must be ${MAX_TOWN_CITY_LENGTH} characters or fewer.`, 400);
  }
  if (address.postcode.length > MAX_POSTCODE_LENGTH) {
    throw new ApiError(`Postcode must be ${MAX_POSTCODE_LENGTH} characters or fewer.`, 400);
  }
}

function normalizedStatus(status) {
  return String(status || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function isTerminalBookingStatus(status) {
  const normalized = normalizedStatus(status);
  return normalized === "cancelled"
    || normalized === "canceled"
    || normalized === "completed"
    || normalized === "no_show"
    || normalized === "noshow"
    || normalized === "rejected"
    || normalized === "declined";
}

function bookingReference(bookingId) {
  const cleaned = String(bookingId || "").replace(/-/g, "").toUpperCase();
  return `MC-${cleaned.slice(0, 8)}`;
}

function londonNowDateAndTime() {
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

  const hour = String(parts.find((part) => part.type === "hour")?.value || "00");
  const minute = String(parts.find((part) => part.type === "minute")?.value || "00");

  return {
    dateISO,
    time: `${hour}:${minute}`
  };
}

function parseMillis(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function bookingSortValue(booking) {
  return `${String(booking.date || "")}T${String(booking.time || "")}`;
}

function orderSortMillis(order) {
  const createdAtMs = parseMillis(order.createdAt);
  if (createdAtMs > 0) return createdAtMs;

  const combined = `${String(order.date || "")}T${String(order.time || "00:00").replace(/^ASAP$/i, "23:59")}:00`;
  return parseMillis(combined);
}

function statusIsTerminalForBooking(status) {
  const value = normalizedStatus(status);
  return value === "cancelled" ||
    value === "canceled" ||
    value === "completed" ||
    value === "no_show" ||
    value === "noshow" ||
    value === "rejected" ||
    value === "declined";
}

function isUpcomingBooking(booking) {
  if (statusIsTerminalForBooking(booking.status)) return false;

  const now = londonNowDateAndTime();
  if (String(booking.date || "") > now.dateISO) return true;
  if (String(booking.date || "") < now.dateISO) return false;
  return String(booking.time || "") >= now.time;
}

function compareLexAsc(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareLexDesc(left, right) {
  if (left < right) return 1;
  if (left > right) return -1;
  return 0;
}

function compareMillisDesc(left, right) {
  return right - left;
}

function mapBooking(booking) {
  return {
    id: String(booking.id || ""),
    reference: bookingReference(booking.id),
    customerName: String(booking.customerName || "").trim(),
    phoneNumber: String(booking.phoneNumber || "").trim(),
    email: String(booking.email || "").trim(),
    date: String(booking.date || ""),
    time: String(booking.time || ""),
    partySize: Number(booking.partySize || 0),
    durationMinutes: Number(booking.durationMinutes || 0),
    specialOccasion: String(booking.specialOccasion || "").trim(),
    notes: String(booking.notes || "").trim(),
    status: normalizedStatus(booking.status || "approved"),
    source: String(booking.source || "").trim(),
    createdAt: String(booking.createdAt || ""),
    statusUpdatedAt: String(booking.statusUpdatedAt || booking.createdAt || ""),
    decisionReason: String(booking.decisionReason || "").trim(),
    assignedTables: Array.isArray(booking.assignedTables)
      ? booking.assignedTables.map((value) => Number(value)).filter(Number.isInteger)
      : [],
    isUpcoming: isUpcomingBooking(booking)
  };
}

function mapOrder(order) {
  return {
    id: String(order.id || ""),
    reference: makeOrderReference(order.id),
    orderType: String(order.orderType || "collection").trim().toLowerCase(),
    customerName: String(order.customerName || "").trim(),
    phoneNumber: String(order.phoneNumber || "").trim(),
    email: String(order.email || "").trim(),
    date: String(order.date || ""),
    time: String(order.time || ""),
    specialOccasion: String(order.specialOccasion || "").trim(),
    itemsSummary: String(order.itemsSummary || "").trim(),
    notes: String(order.notes || "").trim(),
    addressLine1: String(order.addressLine1 || "").trim(),
    addressLine2: String(order.addressLine2 || "").trim(),
    townCity: String(order.townCity || "").trim(),
    postcode: String(order.postcode || "").trim(),
    status: normalizedStatus(order.status || "submitted"),
    etaMinutes: Number.isFinite(Number(order.etaMinutes)) ? Math.round(Number(order.etaMinutes)) : null,
    decisionDate: String(order.decisionDate || "").trim(),
    decisionTime: String(order.decisionTime || "").trim(),
    paymentProvider: String(order.paymentProvider || "").trim().toLowerCase(),
    paymentStatus: String(order.paymentStatus || "").trim().toLowerCase(),
    paymentAmountTotal: Number.isFinite(Number(order.paymentAmountTotal))
      ? Math.round(Number(order.paymentAmountTotal))
      : null,
    paymentCurrency: String(order.paymentCurrency || "").trim().toLowerCase(),
    refundStatus: String(order.refundStatus || "").trim().toLowerCase(),
    refundAmountTotal: Number.isFinite(Number(order.refundAmountTotal))
      ? Math.round(Number(order.refundAmountTotal))
      : null,
    cartItems: Array.isArray(order.cartItems)
      ? order.cartItems.map((item) => ({
        itemName: String(item.itemName || "").trim(),
        quantity: Number(item.quantity || 0),
        modifierSelections: Array.isArray(item.modifierSelections)
          ? item.modifierSelections.map((selection) => ({
            groupName: String(selection.groupName || "").trim(),
            optionName: String(selection.optionName || "").trim(),
            isTextInput: Boolean(selection.isTextInput)
          }))
          : []
      }))
      : [],
    createdAt: String(order.createdAt || ""),
    statusUpdatedAt: String(order.statusUpdatedAt || "")
  };
}

function sortAccountBookings(bookings) {
  const upcoming = bookings
    .filter((booking) => booking.isUpcoming)
    .sort((left, right) => compareLexAsc(bookingSortValue(left), bookingSortValue(right)));

  const past = bookings
    .filter((booking) => !booking.isUpcoming)
    .sort((left, right) => compareLexDesc(bookingSortValue(left), bookingSortValue(right)));

  return [...upcoming, ...past];
}

function sortAccountOrders(orders) {
  return orders.slice().sort((left, right) => compareMillisDesc(orderSortMillis(left), orderSortMillis(right)));
}

function preferredValue(values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

async function filteredBookingsForEmail(env, email) {
  const normalizedEmail = normalizeEmail(email);
  const bookings = await loadBookings(env);

  return bookings
    .filter((booking) => normalizeEmail(booking.email) === normalizedEmail)
    .map(mapBooking);
}

async function filteredOrdersForEmail(env, email) {
  const normalizedEmail = normalizeEmail(email);
  const orders = await loadOrders(env);

  return orders
    .filter((order) => normalizeEmail(order.email) === normalizedEmail)
    .map(mapOrder);
}

function buildAccountSummary(email, bookings, orders, profile) {
  const sortedOrders = sortAccountOrders(orders);
  const sortedBookings = sortAccountBookings(bookings);
  const recentName = preferredValue([
    profile?.fullName,
    ...sortedOrders.map((order) => order.customerName),
    ...sortedBookings.map((booking) => booking.customerName)
  ]);
  const recentPhone = preferredValue([
    profile?.phoneNumber,
    ...sortedOrders.map((order) => order.phoneNumber),
    ...sortedBookings.map((booking) => booking.phoneNumber)
  ]);
  const lastActivityAt = Math.max(
    0,
    ...sortedOrders.map((order) => orderSortMillis(order)),
    ...sortedBookings.map((booking) => parseMillis(booking.createdAt))
  );

  const upcomingBooking = sortedBookings.find((booking) => booking.isUpcoming) || null;
  const latestOrder = sortedOrders[0] || null;

  return {
    email: normalizeEmail(email),
    fullName: recentName,
    phoneNumber: recentPhone,
    profile: normalizeAccountProfile(email, {
      ...profile,
      fullName: profile?.fullName || recentName,
      phoneNumber: profile?.phoneNumber || recentPhone
    }),
    bookingCount: sortedBookings.length,
    orderCount: sortedOrders.length,
    lastActivityAt: lastActivityAt > 0 ? new Date(lastActivityAt).toISOString() : "",
    upcomingBooking: upcomingBooking
      ? {
        reference: upcomingBooking.reference,
        date: upcomingBooking.date,
        time: upcomingBooking.time,
        partySize: upcomingBooking.partySize,
        status: upcomingBooking.status
      }
      : null,
    latestOrder: latestOrder
      ? {
        reference: latestOrder.reference,
        orderType: latestOrder.orderType,
        date: latestOrder.date,
        time: latestOrder.time,
        status: latestOrder.status,
        paymentStatus: latestOrder.paymentStatus
      }
      : null
  };
}

export async function getAccountProfile(env, email) {
  const normalizedEmail = normalizeEmail(email);
  const stored = await readStoreRecord(env, profileKey(normalizedEmail));
  return normalizeAccountProfile(normalizedEmail, stored);
}

export async function saveAccountProfile(env, email, rawProfile) {
  const normalizedEmail = normalizeEmail(email);
  if (rawProfile && Object.prototype.hasOwnProperty.call(rawProfile, "preferredOrderType")) {
    const requestedOrderType = String(rawProfile.preferredOrderType || "").trim().toLowerCase();
    if (requestedOrderType !== "collection" && requestedOrderType !== "delivery") {
      throw new ApiError("Preferred order type must be collection or delivery.", 400);
    }
  }
  const existing = await getAccountProfile(env, normalizedEmail);
  const next = normalizeAccountProfile(normalizedEmail, {
    ...existing,
    ...(rawProfile && typeof rawProfile === "object" ? rawProfile : {}),
    updatedAt: new Date().toISOString()
  });

  assertAccountProfileBounds(next);
  await writeStoreRecord(env, profileKey(normalizedEmail), next);
  return next;
}

export async function getAccountSummary(env, email) {
  const bookings = await filteredBookingsForEmail(env, email);
  const orders = await filteredOrdersForEmail(env, email);
  const profile = await getAccountProfile(env, email);
  return buildAccountSummary(email, bookings, orders, profile);
}

export async function listAccountBookings(env, email) {
  return sortAccountBookings(await filteredBookingsForEmail(env, email));
}

export async function listAccountOrders(env, email) {
  return sortAccountOrders(await filteredOrdersForEmail(env, email));
}

export async function cancelAccountBooking(env, email, bookingId) {
  const normalizedEmail = normalizeEmail(email);
  const targetId = String(bookingId || "").trim();
  if (!targetId) {
    throw new ApiError("bookingId is required.", 400);
  }
  if (targetId.length > 100) {
    throw new ApiError("bookingId is invalid.", 400);
  }

  const next = await withBookingsMutationLock(async () => {
    const bookings = await loadBookings(env);
    const index = bookings.findIndex((booking) =>
      normalizeEmail(booking.email) === normalizedEmail && String(booking.id || "").trim() === targetId
    );
    if (index < 0) {
      throw new ApiError("Booking not found.", 404);
    }

    const existing = bookings[index];
    if (isTerminalBookingStatus(existing.status)) {
      throw new ApiError("This booking can no longer be cancelled online.", 409);
    }

    const cancelled = {
      ...existing,
      status: "cancelled",
      assignedTables: [],
      statusUpdatedAt: new Date().toISOString(),
      decisionReason: "Cancelled by customer."
    };
    bookings[index] = cancelled;
    await saveBookingEntity(env, cancelled);
    await saveBookingsAfterEntity(env, bookings);
    return cancelled;
  });
  return mapBooking(next);
}

export async function rescheduleAccountBooking(env, email, bookingId, payload = {}) {
  const normalizedEmail = normalizeEmail(email);
  const targetId = String(bookingId || "").trim();
  if (!targetId) {
    throw new ApiError("bookingId is required.", 400);
  }
  if (targetId.length > 100) {
    throw new ApiError("bookingId is invalid.", 400);
  }

  const siteConfig = await getSiteConfig(env);
  const next = await withBookingsMutationLock(async () => {
    const bookings = await loadBookings(env);
    const index = bookings.findIndex((booking) =>
      normalizeEmail(booking.email) === normalizedEmail && String(booking.id || "").trim() === targetId
    );
    if (index < 0) {
      throw new ApiError("Booking not found.", 404);
    }

    const existing = bookings[index];
    if (isTerminalBookingStatus(existing.status)) {
      throw new ApiError("This booking can no longer be rescheduled online.", 409);
    }

    const creation = createBookingRecord(
      bookings.filter((booking) => String(booking.id || "").trim() !== targetId),
      {
        customerName: existing.customerName,
        phoneNumber: existing.phoneNumber,
        email: existing.email,
        date: String(payload.date || existing.date),
        time: String(payload.time || existing.time),
        partySize: Number(payload.partySize || existing.partySize),
        durationMinutes: Number(payload.durationMinutes || existing.durationMinutes),
        specialOccasion: String(payload.specialOccasion || existing.specialOccasion),
        notes: String(payload.notes ?? existing.notes),
        sensitiveInfoConsent: payload.sensitiveInfoConsent === true
      },
      {
        rules: siteConfig.bookings
      }
    );

    if (!creation.ok) {
      throw new ApiError(creation.error || "Booking could not be rescheduled.", creation.status || 400);
    }

    const rescheduled = {
      ...existing,
      ...creation.record,
      id: existing.id,
      createdAt: existing.createdAt,
      source: existing.source || creation.record.source,
      statusUpdatedAt: new Date().toISOString(),
      decisionReason: "Rescheduled by customer."
    };

    bookings[index] = rescheduled;
    await saveBookingEntity(env, rescheduled);
    await saveBookingsAfterEntity(env, bookings);
    return rescheduled;
  });
  return mapBooking(next);
}

export async function requireAuthenticatedAccount(env, request) {
  return requireAccountSession(env, request);
}
