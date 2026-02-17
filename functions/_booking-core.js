"use strict";

const STORAGE_KEY = "bookings_v1";
const SERVICE_START_MINUTES = 12 * 60;
const SERVICE_END_MINUTES = 16 * 60;
const SLOT_STEP_MINUTES = 15;
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

function minutesToClock(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

export function slotTimes() {
  const slots = [];
  for (let minute = SERVICE_START_MINUTES; minute <= SERVICE_END_MINUTES; minute += SLOT_STEP_MINUTES) {
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
  return current !== "cancelled" && current !== "canceled" && current !== "completed" &&
    current !== "no_show" && current !== "noshow";
}

function isISODate(isoDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""));
}

function dayIndexForISODate(isoDate) {
  if (!isISODate(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isBookableDay(isoDate) {
  const day = dayIndexForISODate(isoDate);
  return day !== null && OPEN_DAY_INDEXES.has(day);
}

export function validateBookingWindow(isoDate, clock) {
  if (!isISODate(isoDate)) {
    return { ok: false, status: 400, error: "Date must be in yyyy-MM-dd format." };
  }

  if (!isBookableDay(isoDate)) {
    return { ok: false, status: 400, error: "Bookings are available Tuesday to Sunday only." };
  }

  const minutes = parseClockToMinutes(clock);
  if (!Number.isFinite(minutes)) {
    return { ok: false, status: 400, error: "Time must be in HH:mm format." };
  }
  if (minutes < SERVICE_START_MINUTES || minutes > SERVICE_END_MINUTES) {
    return { ok: false, status: 400, error: "Bookings must be between 12:00 and 16:00." };
  }
  if (minutes % SLOT_STEP_MINUTES !== 0) {
    return { ok: false, status: 400, error: "Bookings must be in 15-minute intervals." };
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
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round(parsed);
}

function normalizeBookingRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!isISODate(raw.date)) return null;
  if (!/^\d{2}:\d{2}$/.test(String(raw.time || ""))) return null;

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
    status: normalizedStatus(raw.status || "approved"),
    source: String(raw.source || "Millers Cafe Website"),
    createdAt: String(raw.createdAt || nowISO()),
    assignedTables: normalizeAssignedTables(raw)
  };
}

export async function loadBookings(env) {
  let records = [];
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    const stored = await env.BOOKINGS_KV.get(STORAGE_KEY, "json");
    records = Array.isArray(stored) ? stored : [];
  } else {
    records = getInMemoryStore();
  }

  return records.map(normalizeBookingRecord).filter(Boolean);
}

export async function saveBookings(env, bookings) {
  const records = bookings.map((booking) => ({
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
    status: booking.status,
    source: booking.source,
    createdAt: booking.createdAt,
    tableNumber: booking.assignedTables[0] || null,
    additionalTableNumbers: booking.assignedTables.slice(1),
    assignedTables: booking.assignedTables
  }));

  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    await env.BOOKINGS_KV.put(STORAGE_KEY, JSON.stringify(records));
    return;
  }

  globalThis.__millersCafeBookingsStore = records;
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

function makeReference(bookingId) {
  const cleaned = bookingId.replace(/-/g, "").toUpperCase();
  return `MC-${cleaned.slice(0, 8)}`;
}

function validatePayloadShape(payload) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, status: 400, error: "Invalid booking payload." };
  }
  if (!String(payload.customerName || "").trim()) {
    return { ok: false, status: 400, error: "Customer name is required." };
  }
  if (!/^\d{5}\s\d{6}$/.test(String(payload.phoneNumber || "").trim())) {
    return { ok: false, status: 400, error: "Phone number must be in format XXXXX XXXXXX." };
  }

  if (!isLikelyEmail(payload.email || "")) {
    return { ok: false, status: 400, error: "A valid email address is required." };
  }

  const partySize = normalizePartySize(payload.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 40) {
    return { ok: false, status: 400, error: "Party size must be between 1 and 40." };
  }

  const durationMinutes = normalizeDuration(payload.durationMinutes);
  if (durationMinutes < 15 || durationMinutes > 240) {
    return { ok: false, status: 400, error: "Duration must be between 15 and 240 minutes." };
  }

  const date = String(payload.date || "");
  const time = String(payload.time || "");
  const specialOccasion = normalizeSpecialOccasion(payload.specialOccasion);
  const windowCheck = validateBookingWindow(date, time);
  if (!windowCheck.ok) {
    return windowCheck;
  }

  return {
    ok: true,
    data: {
      customerName: String(payload.customerName || "").trim(),
      phoneNumber: String(payload.phoneNumber || "").trim(),
      phoneDigits: normalizePhoneDigits(payload.phoneNumber || ""),
      email: String(payload.email || "").trim(),
      date,
      time,
      partySize,
      durationMinutes,
      specialOccasion,
      notes: String(payload.notes || "").trim()
    }
  };
}

export function createBookingRecord(bookings, payload) {
  const shapeCheck = validatePayloadShape(payload);
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
    statusBlocksTables(booking.status)
  );
  if (duplicate) {
    return { ok: false, status: 409, error: "A similar booking already exists for this customer and time." };
  }

  const assignedTables = suggestTableAssignment(
    bookings,
    data.date,
    data.time,
    data.partySize,
    data.durationMinutes
  );

  if (!assignedTables || assignedTables.length === 0) {
    return { ok: false, status: 409, error: "No availability for that slot. Please choose another time." };
  }

  const bookingId = randomId();
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
    status: "approved",
    source: "Millers Cafe Website",
    createdAt: nowISO(),
    assignedTables
  };

  return {
    ok: true,
    record,
    reference: makeReference(bookingId)
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
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
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

export function slotAvailability(bookings, isoDate, partySize, durationMinutes) {
  const dayCheck = isBookableDay(isoDate);
  if (!dayCheck) {
    return { open: false, message: "Bookings are available Tuesday to Sunday only.", slots: [] };
  }

  const slots = slotTimes().map((time) => {
    const assignment = suggestTableAssignment(bookings, isoDate, time, partySize, durationMinutes);
    return {
      time,
      available: Boolean(assignment),
      tables: assignment || []
    };
  });

  return { open: true, slots };
}

export function isFeedAuthorized(request, env) {
  const configuredToken = String(env.BOOKINGS_FEED_TOKEN || "").trim();
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
