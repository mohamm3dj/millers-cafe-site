"use strict";

const BUSINESS_TIMEZONE = "Europe/London";
const OPEN_DAY_INDEXES = new Set([0, 2, 3, 4, 5, 6]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dayIndexForISODate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function londonTodayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function addDaysISO(isoDate, days) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function nextMatchingDate(predicate, startOffset = 1, maxDays = 366) {
  const today = londonTodayISO();
  for (let offset = startOffset; offset <= maxDays; offset += 1) {
    const candidate = addDaysISO(today, offset);
    if (predicate(candidate)) return candidate;
  }
  throw new Error("Could not find a matching date.");
}

export function nextOpenDate(startOffset = 1) {
  return nextMatchingDate((isoDate) => OPEN_DAY_INDEXES.has(dayIndexForISODate(isoDate)), startOffset);
}

export function nextClosedDate(startOffset = 0) {
  return nextMatchingDate((isoDate) => !OPEN_DAY_INDEXES.has(dayIndexForISODate(isoDate)), startOffset);
}

export function makeBookingPayload(overrides = {}) {
  return {
    customerName: "Mo Khan",
    phoneNumber: "01234 567890",
    email: "mo@example.com",
    date: nextOpenDate(2),
    time: "12:00",
    partySize: 2,
    durationMinutes: 90,
    specialOccasion: "None",
    notes: "",
    ...overrides
  };
}

export function makeOrderPayload(overrides = {}) {
  return {
    orderType: "collection",
    customerName: "Mo Khan",
    phoneNumber: "01234 567890",
    email: "mo@example.com",
    date: nextOpenDate(2),
    time: "13:00",
    specialOccasion: "None",
    itemsSummary: "2 x Miller burgers",
    notes: "",
    addressLine1: "",
    addressLine2: "",
    townCity: "",
    postcode: "",
    ...overrides
  };
}

export function resetInMemoryStores() {
  delete globalThis.__millersCafeBookingsStore;
  delete globalThis.__millersCafeOrdersStore;
  delete globalThis.__millersCafeOrderCheckoutDraftStore;
  delete globalThis.__millersCafeAccountStore;
  delete globalThis.__millersCafeAccountCodeLocks;
  delete globalThis.__millersCafeSiteConfigStore;
  delete globalThis.__millersCafeAccountProfileStore;
  delete globalThis.__millersCafeAnalyticsStore;
  delete globalThis.__millersCafeAnalyticsLocks;
  delete globalThis.__millersCafeBookingMutationLocks;
  delete globalThis.__millersCafeOrderMutationLocks;
  delete globalThis.__millersCafeCheckoutFinalizeLocks;
  delete globalThis.__millersCafeRateLimitStore;
  delete globalThis.__millersCafeRateLimitLocks;
}
