"use strict";

const ANALYTICS_PREFIX = "analytics_day:";
const MAX_EVENT_NAME_LENGTH = 64;

function getInMemoryStore() {
  if (!globalThis.__millersCafeAnalyticsStore || typeof globalThis.__millersCafeAnalyticsStore !== "object") {
    globalThis.__millersCafeAnalyticsStore = {};
  }
  return globalThis.__millersCafeAnalyticsStore;
}

function getLockStore() {
  if (!globalThis.__millersCafeAnalyticsLocks || typeof globalThis.__millersCafeAnalyticsLocks !== "object") {
    globalThis.__millersCafeAnalyticsLocks = new Map();
  }
  return globalThis.__millersCafeAnalyticsLocks;
}

function londonTodayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function addDaysISO(isoDate, deltaDays) {
  const [year, month, day] = String(isoDate || "").split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function analyticsKey(dateISO) {
  return `${ANALYTICS_PREFIX}${String(dateISO || "").trim()}`;
}

function normalizeEventName(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  if (!normalized || normalized.length > MAX_EVENT_NAME_LENGTH) return "";
  return normalized;
}

function normalizeDimensionValue(value, maxLength = 120) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
}

function normalizeBucket(rawBucket, dateISO) {
  const source = rawBucket && typeof rawBucket === "object" ? rawBucket : {};
  return {
    date: String(source.date || dateISO || londonTodayISO()),
    total: Math.max(0, Math.round(Number(source.total || 0))),
    events: source.events && typeof source.events === "object" ? { ...source.events } : {},
    routes: source.routes && typeof source.routes === "object" ? { ...source.routes } : {},
    orderTypes: source.orderTypes && typeof source.orderTypes === "object" ? { ...source.orderTypes } : {},
    pages: source.pages && typeof source.pages === "object" ? { ...source.pages } : {},
    updatedAt: String(source.updatedAt || new Date().toISOString())
  };
}

async function readBucket(env, dateISO) {
  const key = analyticsKey(dateISO);
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    const stored = await env.BOOKINGS_KV.get(key, "json");
    return normalizeBucket(stored, dateISO);
  }
  return normalizeBucket(getInMemoryStore()[key], dateISO);
}

async function writeBucket(env, bucket) {
  const normalized = normalizeBucket(bucket, bucket?.date);
  normalized.updatedAt = new Date().toISOString();
  const key = analyticsKey(normalized.date);

  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    await env.BOOKINGS_KV.put(key, JSON.stringify(normalized));
    return normalized;
  }

  getInMemoryStore()[key] = normalized;
  return normalized;
}

function incrementMapCount(mapObject, key, amount = 1) {
  if (!key) return;
  mapObject[key] = Math.max(0, Math.round(Number(mapObject[key] || 0))) + amount;
}

async function withAnalyticsLock(lockKey, work) {
  const locks = getLockStore();
  const previous = locks.get(lockKey) || Promise.resolve();

  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });

  locks.set(lockKey, previous.catch(() => {}).then(() => current));

  try {
    await previous.catch(() => {});
    return await work();
  } finally {
    release();
    if (locks.get(lockKey) === current) {
      locks.delete(lockKey);
    }
  }
}

export async function recordAnalyticsEvent(env, name, details = {}) {
  const eventName = normalizeEventName(name);
  if (!eventName) return null;

  const dateISO = londonTodayISO();
  return withAnalyticsLock(dateISO, async () => {
    const bucket = await readBucket(env, dateISO);
    bucket.total += 1;
    incrementMapCount(bucket.events, eventName);

    const route = normalizeDimensionValue(details.route || details.path, 160);
    const orderType = normalizeDimensionValue(details.orderType, 32).toLowerCase();
    const page = normalizeDimensionValue(details.page, 80);

    if (route) incrementMapCount(bucket.routes, route);
    if (orderType) incrementMapCount(bucket.orderTypes, `${eventName}:${orderType}`);
    if (page) incrementMapCount(bucket.pages, page);

    await writeBucket(env, bucket);
    return bucket;
  });
}

function sortCountEntries(mapObject) {
  return Object.entries(mapObject || {})
    .map(([key, count]) => ({ key, count: Math.max(0, Math.round(Number(count || 0))) }))
    .sort((left, right) => {
      if (left.count === right.count) return left.key.localeCompare(right.key);
      return right.count - left.count;
    });
}

export async function getAnalyticsSummary(env, days = 30) {
  const windowDays = Math.max(1, Math.min(90, Math.round(Number(days || 30))));
  const today = londonTodayISO();
  const buckets = [];

  for (let offset = windowDays - 1; offset >= 0; offset -= 1) {
    const dateISO = addDaysISO(today, -offset);
    buckets.push(await readBucket(env, dateISO));
  }

  const totals = {
    total: 0,
    events: {},
    routes: {},
    orderTypes: {},
    pages: {}
  };

  buckets.forEach((bucket) => {
    totals.total += Math.max(0, Math.round(Number(bucket.total || 0)));
    Object.entries(bucket.events || {}).forEach(([key, count]) => incrementMapCount(totals.events, key, Number(count || 0)));
    Object.entries(bucket.routes || {}).forEach(([key, count]) => incrementMapCount(totals.routes, key, Number(count || 0)));
    Object.entries(bucket.orderTypes || {}).forEach(([key, count]) => incrementMapCount(totals.orderTypes, key, Number(count || 0)));
    Object.entries(bucket.pages || {}).forEach(([key, count]) => incrementMapCount(totals.pages, key, Number(count || 0)));
  });

  return {
    ok: true,
    days: windowDays,
    totals: {
      total: totals.total,
      events: sortCountEntries(totals.events),
      routes: sortCountEntries(totals.routes),
      orderTypes: sortCountEntries(totals.orderTypes),
      pages: sortCountEntries(totals.pages)
    },
    daily: buckets.map((bucket) => ({
      date: bucket.date,
      total: bucket.total,
      topEvents: sortCountEntries(bucket.events).slice(0, 5)
    }))
  };
}
