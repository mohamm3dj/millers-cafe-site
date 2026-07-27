"use strict";

const STORAGE_KEY = "bookings_v1";
const BOOKING_ENTITY_PREFIX = "booking_entity:";
const SERVICE_START_MINUTES = 12 * 60;
const SERVICE_END_MINUTES = 16 * 60;
const SLOT_STEP_MINUTES = 15;
const MAX_BOOKING_LOOKAHEAD_DAYS = 120;
const MAX_CUSTOMER_NAME_LENGTH = 80;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_DISPLAY_LENGTH = 30;
const MAX_BOOKING_NOTES_LENGTH = 400;
const OPEN_DAY_INDEXES = new Set([0, 2, 3, 4, 5, 6]); // Sun, Tue-Sat
const VALID_OCCASIONS = new Set([
  "None",
  "Birthday",
  "Anniversary",
  "Engagement",
  "Date Night",
  "Business",
  "Celebration"
]);

const DEFAULT_BOOKING_RULES = {
  serviceStartMinutes: SERVICE_START_MINUTES,
  serviceEndMinutes: SERVICE_END_MINUTES,
  slotStepMinutes: SLOT_STEP_MINUTES,
  maxLookaheadDays: MAX_BOOKING_LOOKAHEAD_DAYS,
  openDayIndexes: [...OPEN_DAY_INDEXES]
};

const TABLE_CAPACITIES = {
  1: 4, 2: 4, 3: 4, 4: 2, 5: 6, 6: 4, 7: 4, 8: 4, 9: 4, 10: 4,
  11: 4, 12: 4, 13: 4, 14: 6, 15: 4, 16: 4, 17: 10, 18: 10, 19: 6
};

const MULTI_TABLE_COMBINATIONS = [
  [1, 2], [2, 3], [1, 2, 3],
  [6, 7], [7, 8], [6, 7, 8],
  [9, 10], [10, 11], [9, 10, 11],
  [15, 16],
  [6, 7, 8, 9],
  [6, 7, 8, 9, 10],
  [6, 7, 8, 9, 10, 11],
  [6, 7, 8, 9, 10, 11, 12],
  [6, 7, 8, 9, 10, 11, 12, 13],
  [6, 7, 8, 9, 10, 11, 12, 13, 14]
];

const MULTI_TABLE_CAPACITY_OVERRIDES = {
  "1+2": 10,
  "2+3": 10,
  "1+2+3": 14,
  "6+7": 10,
  "7+8": 10,
  "6+7+8": 14,
  "9+10": 10,
  "10+11": 10,
  "9+10+11": 14,
  "15+16": 10,
  "6+7+8+9": 20,
  "6+7+8+9+10": 24,
  "6+7+8+9+10+11": 28,
  "6+7+8+9+10+11+12": 32,
  "6+7+8+9+10+11+12+13": 34,
  "6+7+8+9+10+11+12+13+14": 40
};

function getInMemoryStore() {
  if (!Array.isArray(globalThis.__millersCafeBookingsStore)) {
    globalThis.__millersCafeBookingsStore = [];
  }
  return globalThis.__millersCafeBookingsStore;
}

function getMutationLockStore() {
  if (!(globalThis.__millersCafeBookingMutationLocks instanceof Map)) {
    globalThis.__millersCafeBookingMutationLocks = new Map();
  }
  return globalThis.__millersCafeBookingMutationLocks;
}

export async function withBookingsMutationLock(work) {
  if (typeof work !== "function") {
    throw new TypeError("Booking mutation work must be a function.");
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
  return `mc-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseISODateUTC(isoDate) {
  if (!isISODate(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toISODateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
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

function normalizedBookingRules(rawRules = null) {
  const source = rawRules && typeof rawRules === "object" ? rawRules : {};
  const openDayIndexes = Array.isArray(source.openDayIndexes)
    ? source.openDayIndexes
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    : DEFAULT_BOOKING_RULES.openDayIndexes;

  const serviceStartMinutes = boundedRuleInteger(
    source.serviceStartMinutes,
    DEFAULT_BOOKING_RULES.serviceStartMinutes,
    0,
    (24 * 60) - 1
  );
  const serviceEndMinutes = Math.max(serviceStartMinutes, boundedRuleInteger(
    source.serviceEndMinutes,
    DEFAULT_BOOKING_RULES.serviceEndMinutes,
    0,
    (24 * 60) - 1
  ));

  return {
    serviceStartMinutes,
    serviceEndMinutes,
    slotStepMinutes: boundedRuleInteger(source.slotStepMinutes, DEFAULT_BOOKING_RULES.slotStepMinutes, 1, 24 * 60),
    maxLookaheadDays: boundedRuleInteger(source.maxLookaheadDays, DEFAULT_BOOKING_RULES.maxLookaheadDays, 1, 365),
    openDayIndexes: openDayIndexes.length > 0 ? openDayIndexes : DEFAULT_BOOKING_RULES.openDayIndexes
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

function bookingOpenDaysMessage(rules) {
  return `Bookings are available on ${dayListSummary(rules.openDayIndexes)} only.`;
}

function bookingRangeLabel(rules) {
  return `${minutesToClock(rules.serviceStartMinutes)} and ${minutesToClock(rules.serviceEndMinutes)}`;
}

function bookingIntervalLabel(rules) {
  return `${rules.slotStepMinutes}-minute intervals`;
}

export function slotTimes(rawRules = null) {
  const rules = normalizedBookingRules(rawRules);
  const slots = [];
  for (let minute = rules.serviceStartMinutes; minute <= rules.serviceEndMinutes; minute += rules.slotStepMinutes) {
    slots.push(minutesToClock(minute));
  }
  return slots;
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

function normalizePhoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function isLikelyEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function normalizeSpecialOccasion(rawOccasion) {
  const value = String(rawOccasion || "").trim();
  if (VALID_OCCASIONS.has(value)) {
    return value;
  }
  return "None";
}

function normalizedStatus(status) {
  return String(status || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function statusBlocksTables(status) {
  const current = normalizedStatus(status);
  return current === "accepted" || current === "approved" || current === "confirmed";
}

function statusPreventsDuplicates(status) {
  const current = normalizedStatus(status);
  return current !== "cancelled" && current !== "canceled" && current !== "completed" &&
    current !== "no_show" && current !== "noshow" && current !== "rejected" && current !== "declined";
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

function todayISODateInLondon() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function londonNowDateAndMinutes() {
  const dateISO = todayISODateInLondon();
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

function maxBookableISODate(rawRules = null) {
  const rules = normalizedBookingRules(rawRules);
  const today = parseISODateUTC(todayISODateInLondon());
  if (!today) return "";
  today.setUTCDate(today.getUTCDate() + Math.max(0, rules.maxLookaheadDays - 1));
  return toISODateUTC(today);
}

function dayIndexForISODate(isoDate) {
  if (!isISODate(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isBookableDay(isoDate, rawRules = null) {
  const rules = normalizedBookingRules(rawRules);
  const day = dayIndexForISODate(isoDate);
  return day !== null && new Set(rules.openDayIndexes).has(day);
}

export function validateBookingWindow(isoDate, clock, rawRules = null) {
  const rules = normalizedBookingRules(rawRules);
  if (!isISODate(isoDate)) {
    return { ok: false, status: 400, error: "Date must be in yyyy-MM-dd format." };
  }

  const today = todayISODateInLondon();
  if (isoDate < today) {
    return { ok: false, status: 400, error: "Bookings are no longer available for past dates." };
  }

  const maxDate = maxBookableISODate(rules);
  if (maxDate && isoDate > maxDate) {
    return {
      ok: false,
      status: 400,
      error: `Bookings can only be made up to ${rules.maxLookaheadDays} days ahead.`
    };
  }

  if (!isBookableDay(isoDate, rules)) {
    return { ok: false, status: 400, error: bookingOpenDaysMessage(rules) };
  }

  const minutes = parseClockToMinutes(clock);
  if (!Number.isFinite(minutes)) {
    return { ok: false, status: 400, error: "Time must be in HH:mm format." };
  }
  if (minutes < rules.serviceStartMinutes || minutes > rules.serviceEndMinutes) {
    return { ok: false, status: 400, error: `Bookings must be between ${bookingRangeLabel(rules)}.` };
  }
  if (minutes % rules.slotStepMinutes !== 0) {
    return { ok: false, status: 400, error: `Bookings must be in ${bookingIntervalLabel(rules)}.` };
  }

  const now = londonNowDateAndMinutes();
  if (isoDate === now.dateISO) {
    const earliestAvailable = roundUpToStep(now.minutesNow, rules.slotStepMinutes);
    if (earliestAvailable > rules.serviceEndMinutes) {
      return { ok: false, status: 400, error: "No slots are left today. Please choose another date." };
    }
    if (minutes < earliestAvailable) {
      return {
        ok: false,
        status: 400,
        error: `Today's bookings must be from ${minutesToClock(earliestAvailable)} onwards.`
      };
    }
  }

  return { ok: true, minutes };
}

function normalizeAssignedTables(raw) {
  const list = [];
  if (Array.isArray(raw.assignedTables)) {
    for (const table of raw.assignedTables) {
      const number = Number(table);
      if (Number.isInteger(number) && number > 0) list.push(number);
    }
  }

  const tableNumber = Number(raw.tableNumber);
  if (Number.isInteger(tableNumber) && tableNumber > 0) {
    list.push(tableNumber);
  }

  if (Array.isArray(raw.additionalTableNumbers)) {
    for (const table of raw.additionalTableNumbers) {
      const number = Number(table);
      if (Number.isInteger(number) && number > 0) list.push(number);
    }
  }

  return Array.from(new Set(list)).sort((a, b) => a - b);
}

function normalizeDuration(rawDuration) {
  const parsed = Number(rawDuration);
  if (!Number.isFinite(parsed)) return 90;
  const rounded = Math.round(parsed);
  return Math.max(15, Math.min(240, rounded));
}

function normalizePartySize(rawPartySize) {
  const parsed = Number(rawPartySize);
  if (!Number.isInteger(parsed)) return NaN;
  return parsed;
}

function normalizeBookingRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!isISODate(raw.date)) return null;
  if (!Number.isFinite(parseClockToMinutes(raw.time))) return null;

  const partySize = normalizePartySize(raw.partySize);
  if (!Number.isInteger(partySize) || partySize < 1) return null;

  return {
    id: String(raw.id || randomId()),
    customerName: String(raw.customerName || "").trim(),
    phoneNumber: String(raw.phoneNumber || "").trim(),
    phoneDigits: normalizePhoneDigits(raw.phoneNumber || ""),
    email: String(raw.email || "").trim(),
    date: String(raw.date),
    time: String(raw.time),
    partySize,
    durationMinutes: normalizeDuration(raw.durationMinutes),
    specialOccasion: normalizeSpecialOccasion(raw.specialOccasion),
    notes: String(raw.notes || "").trim(),
    sensitiveInfoConsent: Boolean(raw.sensitiveInfoConsent),
    sensitiveInfoConsentAt: String(raw.sensitiveInfoConsentAt || "").trim(),
    status: normalizedStatus(raw.status || "approved"),
    source: String(raw.source || "Millers Cafe Website"),
    createdAt: String(raw.createdAt || nowISO()),
    statusUpdatedAt: String(raw.statusUpdatedAt || raw.createdAt || nowISO()),
    decisionReason: String(raw.decisionReason || "").trim(),
    assignedTables: normalizeAssignedTables(raw)
  };
}

function serializedBookingRecord(booking) {
  return {
    id: booking.id,
    customerName: booking.customerName,
    phoneNumber: booking.phoneNumber,
    email: booking.email,
    date: booking.date,
    time: booking.time,
    partySize: booking.partySize,
    durationMinutes: booking.durationMinutes,
    specialOccasion: normalizeSpecialOccasion(booking.specialOccasion),
    notes: booking.notes,
    sensitiveInfoConsent: Boolean(booking.sensitiveInfoConsent),
    sensitiveInfoConsentAt: String(booking.sensitiveInfoConsentAt || "").trim(),
    status: booking.status,
    source: booking.source,
    createdAt: booking.createdAt,
    statusUpdatedAt: booking.statusUpdatedAt || booking.createdAt,
    decisionReason: String(booking.decisionReason || "").trim(),
    tableNumber: booking.assignedTables[0] || null,
    additionalTableNumbers: booking.assignedTables.slice(1),
    assignedTables: booking.assignedTables
  };
}

function bookingFreshnessMillis(booking) {
  return Math.max(
    Date.parse(String(booking?.statusUpdatedAt || "")) || 0,
    Date.parse(String(booking?.createdAt || "")) || 0
  );
}

async function loadBookingEntities(env) {
  if (!env.BOOKINGS_KV || typeof env.BOOKINGS_KV.list !== "function" || typeof env.BOOKINGS_KV.get !== "function") {
    return [];
  }

  try {
    const entities = [];
    let cursor = "";
    for (let page = 0; page < 100; page += 1) {
      const listed = await env.BOOKINGS_KV.list({
        prefix: BOOKING_ENTITY_PREFIX,
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
          const entity = normalizeBookingRecord(rawEntity);
          if (entity) entities.push(entity);
        }
      }

      cursor = String(listed?.cursor || "").trim();
      if (listed?.list_complete === true || !cursor) break;
    }
    return entities;
  } catch (error) {
    // Entity recovery is best-effort; the aggregate remains the hot-path source.
    return [];
  }
}

export async function loadBookings(env, options = {}) {
  let records = [];
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    const stored = await env.BOOKINGS_KV.get(STORAGE_KEY, "json");
    records = Array.isArray(stored) ? stored : [];
  } else {
    records = getInMemoryStore();
  }

  const storedRecords = records.map(normalizeBookingRecord).filter(Boolean);
  if (options?.includeEntities !== true) return storedRecords;

  const entityRecords = await loadBookingEntities(env);
  if (entityRecords.length === 0) return storedRecords;

  const merged = new Map(entityRecords.map((booking) => [booking.id, booking]));
  for (const booking of storedRecords) {
    const entity = merged.get(booking.id);
    if (!entity || bookingFreshnessMillis(booking) >= bookingFreshnessMillis(entity)) {
      merged.set(booking.id, booking);
    }
  }
  return Array.from(merged.values());
}

export async function saveBookings(env, bookings) {
  const records = bookings.map(serializedBookingRecord);

  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    await env.BOOKINGS_KV.put(STORAGE_KEY, JSON.stringify(records));
    return;
  }

  globalThis.__millersCafeBookingsStore = records;
}

export async function saveBookingsAfterEntity(env, bookings) {
  try {
    await saveBookings(env, bookings);
    return true;
  } catch (error) {
    if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.list === "function") {
      return false;
    }
    throw error;
  }
}

export async function saveBookingEntity(env, booking) {
  if (!env.BOOKINGS_KV || typeof env.BOOKINGS_KV.put !== "function") return;
  const bookingId = String(booking?.id || "").trim();
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(bookingId)) {
    throw new Error("Booking entity id is invalid.");
  }
  await env.BOOKINGS_KV.put(`${BOOKING_ENTITY_PREFIX}${bookingId}`, JSON.stringify(serializedBookingRecord(booking)));
}

function tableCapacityForTables(tables) {
  const key = tables.join("+");
  if (MULTI_TABLE_CAPACITY_OVERRIDES[key]) {
    return MULTI_TABLE_CAPACITY_OVERRIDES[key];
  }
  return tables.reduce((sum, table) => sum + (TABLE_CAPACITIES[table] || 0), 0);
}

function bookingInterval(booking) {
  const start = parseClockToMinutes(booking.time);
  const end = start + booking.durationMinutes;
  return { start, end };
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function busyTablesForRange(bookings, isoDate, startMinutes, endMinutes, excludeBookingId = null) {
  const busy = new Set();

  for (const booking of bookings) {
    if (booking.date !== isoDate) continue;
    if (excludeBookingId && booking.id === excludeBookingId) continue;
    if (!statusBlocksTables(booking.status)) continue;

    const { start, end } = bookingInterval(booking);
    if (!overlaps(startMinutes, endMinutes, start, end)) continue;

    for (const table of booking.assignedTables) {
      busy.add(table);
    }
  }

  return busy;
}

function availableTablesForRange(bookings, isoDate, startMinutes, endMinutes, excludeBookingId = null) {
  const busy = busyTablesForRange(bookings, isoDate, startMinutes, endMinutes, excludeBookingId);
  return Object.keys(TABLE_CAPACITIES)
    .map(Number)
    .filter((table) => !busy.has(table))
    .sort((a, b) => a - b);
}

export function validateTableAssignment(bookings, booking, rawTables) {
  const tables = Array.from(new Set(
    (Array.isArray(rawTables) ? rawTables : [])
      .map((table) => Number(table))
      .filter(Number.isInteger)
  )).sort((left, right) => left - right);

  if (tables.length === 0) {
    return { ok: false, status: 400, error: "At least one table must be assigned." };
  }
  if (tables.some((table) => !Object.prototype.hasOwnProperty.call(TABLE_CAPACITIES, table))) {
    return { ok: false, status: 400, error: "Table assignment contains an unknown table." };
  }
  if (tableCapacityForTables(tables) < Number(booking?.partySize || 0)) {
    return { ok: false, status: 409, error: "The selected tables do not have enough capacity for this booking." };
  }

  const startMinutes = parseClockToMinutes(booking?.time);
  const durationMinutes = Number(booking?.durationMinutes);
  if (!Number.isFinite(startMinutes) || !Number.isInteger(durationMinutes) || durationMinutes < 1) {
    return { ok: false, status: 400, error: "Booking time or duration is invalid." };
  }

  const available = new Set(availableTablesForRange(
    bookings,
    booking.date,
    startMinutes,
    startMinutes + durationMinutes,
    booking.id
  ));
  if (tables.some((table) => !available.has(table))) {
    return { ok: false, status: 409, error: "One or more selected tables are already in use at that time." };
  }

  return { ok: true, tables };
}

export function suggestTableAssignment(bookings, isoDate, clock, partySize, durationMinutes, excludeBookingId = null) {
  const startMinutes = parseClockToMinutes(clock);
  const endMinutes = startMinutes + durationMinutes;
  const availableTables = availableTablesForRange(bookings, isoDate, startMinutes, endMinutes, excludeBookingId);

  const singles = availableTables
    .filter((table) => (TABLE_CAPACITIES[table] || 0) >= partySize)
    .sort((a, b) => {
      const capacityA = TABLE_CAPACITIES[a] || 0;
      const capacityB = TABLE_CAPACITIES[b] || 0;
      if (capacityA === capacityB) return a - b;
      return capacityA - capacityB;
    });

  if (singles.length > 0) {
    return [singles[0]];
  }

  if (partySize >= 7) {
    const availableSet = new Set(availableTables);
    const matchingCombinations = MULTI_TABLE_COMBINATIONS
      .map((combo) => Array.from(new Set(combo)).sort((a, b) => a - b))
      .filter((combo) => combo.every((table) => availableSet.has(table)))
      .filter((combo) => tableCapacityForTables(combo) >= partySize)
      .sort((a, b) => {
        const capacityA = tableCapacityForTables(a);
        const capacityB = tableCapacityForTables(b);
        if (capacityA === capacityB) return a.length - b.length;
        return capacityA - capacityB;
      });

    if (matchingCombinations.length > 0) {
      return matchingCombinations[0];
    }
  }

  return null;
}

export function makeReference(bookingId) {
  const cleaned = bookingId.replace(/-/g, "").toUpperCase();
  return `MC-${cleaned.slice(0, 8)}`;
}

export function findBookingIndexByReference(bookings, reference) {
  const target = String(reference || "").trim().toUpperCase();
  if (!target) return -1;

  return bookings.findIndex((booking) => makeReference(String(booking.id || "")).toUpperCase() === target);
}

function validatePayloadShape(payload, rawRules = null) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, status: 400, error: "Invalid booking payload." };
  }
  const customerName = String(payload.customerName || "").trim();
  if (!customerName) {
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

  const partySize = normalizePartySize(payload.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 40) {
    return { ok: false, status: 400, error: "Party size must be between 1 and 40." };
  }

  const rawDuration = payload.durationMinutes === undefined || payload.durationMinutes === null || payload.durationMinutes === ""
    ? 90
    : Number(payload.durationMinutes);
  if (!Number.isInteger(rawDuration) || rawDuration < 15 || rawDuration > 240) {
    return { ok: false, status: 400, error: "Duration must be between 15 and 240 minutes." };
  }
  const durationMinutes = rawDuration;

  const notes = String(payload.notes || "").trim();
  if (notes.length > MAX_BOOKING_NOTES_LENGTH) {
    return { ok: false, status: 400, error: `Notes must be ${MAX_BOOKING_NOTES_LENGTH} characters or fewer.` };
  }
  const sensitiveInfoConsent = Boolean(notes) && payload.sensitiveInfoConsent === true;
  if (notes && !sensitiveInfoConsent) {
    return { ok: false, status: 400, error: "Explicit consent is required when optional notes are provided." };
  }

  const date = String(payload.date || "");
  const time = String(payload.time || "");
  const specialOccasion = normalizeSpecialOccasion(payload.specialOccasion);
  const windowCheck = validateBookingWindow(date, time, rawRules);
  if (!windowCheck.ok) {
    return windowCheck;
  }

  return {
    ok: true,
    data: {
      customerName,
      phoneNumber,
      phoneDigits,
      email,
      date,
      time,
      partySize,
      durationMinutes,
      specialOccasion,
      notes,
      sensitiveInfoConsent
    }
  };
}

export function createBookingRecord(bookings, payload, options = {}) {
  const shapeCheck = validatePayloadShape(payload, options.rules);
  if (!shapeCheck.ok) {
    return shapeCheck;
  }

  const data = shapeCheck.data;
  const duplicate = bookings.find((booking) =>
    booking.date === data.date &&
    booking.time === data.time &&
    booking.partySize === data.partySize &&
    booking.phoneDigits.length > 0 &&
    booking.phoneDigits === data.phoneDigits &&
    statusPreventsDuplicates(booking.status)
  );
  if (duplicate) {
    return { ok: false, status: 409, error: "A similar booking already exists for this customer and time." };
  }

  const bookingId = randomId();
  const createdAt = nowISO();
  const record = {
    id: bookingId,
    customerName: data.customerName,
    phoneNumber: data.phoneNumber,
    phoneDigits: data.phoneDigits,
    email: data.email,
    date: data.date,
    time: data.time,
    partySize: data.partySize,
    durationMinutes: data.durationMinutes,
    specialOccasion: data.specialOccasion,
    notes: data.notes,
    sensitiveInfoConsent: data.sensitiveInfoConsent,
    sensitiveInfoConsentAt: data.sensitiveInfoConsent ? createdAt : "",
    status: "pending",
    source: "Millers Cafe Website",
    createdAt,
    statusUpdatedAt: createdAt,
    decisionReason: "",
    assignedTables: []
  };

  return {
    ok: true,
    record,
    reference: makeReference(bookingId)
  };
}

export function feedRows(bookings, includePast = false) {
  const today = todayISODateInLondon();
  return bookings
    .filter((booking) => statusBlocksTables(booking.status))
    .filter((booking) => includePast || booking.date >= today)
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.time.localeCompare(b.time);
    })
    .map((booking) => ({
      date: booking.date,
      time: booking.time,
      guest_name: booking.customerName,
      guest_phone: booking.phoneNumber,
      guest_email: booking.email,
      people: booking.partySize,
      duration: booking.durationMinutes,
      special_occasion: normalizeSpecialOccasion(booking.specialOccasion),
      status: booking.status,
      payment_amount: "",
      payment_status: "",
      payment_type: "",
      comments: booking.specialOccasion && booking.specialOccasion !== "None"
        ? `Occasion: ${booking.specialOccasion}`
        : "",
      notes: booking.notes,
      source: booking.source,
      created_at: booking.createdAt
    }));
}

function escapeCSVCell(value) {
  const text = String(value ?? "");
  const safeText = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  if (safeText.includes(",") || safeText.includes("\"") || safeText.includes("\n")) {
    return `"${safeText.replace(/"/g, "\"\"")}"`;
  }
  return safeText;
}

export function toCSV(rows) {
  const header = [
    "date",
    "time",
    "guest_name",
    "guest_phone",
    "guest_email",
    "people",
    "duration",
    "special_occasion",
    "status",
    "payment_amount",
    "payment_status",
    "payment_type",
    "comments",
    "notes",
    "source",
    "created_at"
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((key) => escapeCSVCell(row[key])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function slotAvailability(bookings, isoDate, partySize, durationMinutes, rawRules = null) {
  const rules = normalizedBookingRules(rawRules);
  const dayCheck = isBookableDay(isoDate, rules);
  if (!dayCheck) {
    return { open: false, message: bookingOpenDaysMessage(rules), slots: [] };
  }

  const today = todayISODateInLondon();
  if (isoDate < today) {
    return { open: false, message: "Bookings are no longer available for past dates.", slots: [] };
  }

  const maxDate = maxBookableISODate(rules);
  if (maxDate && isoDate > maxDate) {
    return {
      open: false,
      message: `Bookings can only be made up to ${rules.maxLookaheadDays} days ahead.`,
      slots: []
    };
  }

  const now = londonNowDateAndMinutes();
  const minimumMinutes = isoDate === now.dateISO
    ? roundUpToStep(now.minutesNow, rules.slotStepMinutes)
    : rules.serviceStartMinutes;

  const slots = slotTimes(rules).map((time) => {
    const minutes = parseClockToMinutes(time);
    if (!Number.isFinite(minutes) || minutes < minimumMinutes) {
      return {
        time,
        available: false,
        tables: []
      };
    }

    const assignment = suggestTableAssignment(bookings, isoDate, time, partySize, durationMinutes);
    return {
      time,
      available: Boolean(assignment),
      tables: assignment || []
    };
  });

  let message = "";
  if (isoDate === now.dateISO && minimumMinutes > rules.serviceEndMinutes) {
    message = "No slots are left today. Please choose another date.";
  } else if (!slots.some((slot) => slot.available)) {
    message = "No availability remains for that date and party size.";
  }

  return { open: true, message, slots };
}
