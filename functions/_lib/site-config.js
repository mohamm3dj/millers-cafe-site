"use strict";

import { MILLERS_ORDER_MENU } from "../../orders/menu-catalog.js";

const SITE_CONFIG_STORAGE_KEY = "site_config_v1";
const MENU_CATALOG_STORAGE_KEY = "menu_catalog_v1";

const DEFAULT_DELIVERY_PREFIXES = [
  "DN31",
  "DN32",
  "DN33",
  "DN34",
  "DN35",
  "DN36",
  "DN37",
  "DN38",
  "DN40",
  "DN41"
];

const DEFAULT_SITE_CONFIG = {
  version: 1,
  business: {
    name: "Millers Café",
    shortName: "Millers",
    address: "55 Brigsley Road, Waltham, Grimsby, DN37 0JZ",
    phoneDisplay: "01472 828600",
    phoneTel: "01472828600",
    email: "help@millers.cafe",
    timezone: "Europe/London"
  },
  home: {
    weeklyHours: {
      0: [["12:00", "17:00"]],
      1: [],
      2: [["12:00", "17:00"]],
      3: [["12:00", "17:00"]],
      4: [["12:00", "17:00"]],
      5: [["12:00", "17:00"]],
      6: [["12:00", "17:00"]]
    }
  },
  orders: {
    openDayIndexes: [0, 2, 3, 4, 5, 6],
    serviceStartMinutes: 12 * 60,
    serviceEndMinutes: 17 * 60,
    slotStepMinutes: 15,
    maxLookaheadDays: 90,
    collectionMinLeadMinutes: 30,
    deliveryMinLeadMinutes: 60,
    collectionEarliestScheduledMinutes: (12 * 60) + 30,
    deliveryEarliestScheduledMinutes: 13 * 60
  },
  bookings: {
    openDayIndexes: [0, 2, 3, 4, 5, 6],
    serviceStartMinutes: 12 * 60,
    serviceEndMinutes: 16 * 60,
    slotStepMinutes: 15,
    maxLookaheadDays: 120,
    defaultDurationMinutes: 90
  },
  delivery: {
    baseFeeGBP: 2,
    etaMinMinutes: 35,
    etaMaxMinutes: 55,
    allowedOutwardPrefixes: DEFAULT_DELIVERY_PREFIXES,
    outsideAreaMode: "review"
  },
  security: {
    turnstileEnabled: false
  }
};

function getInMemoryStore() {
  if (!globalThis.__millersCafeSiteConfigStore || typeof globalThis.__millersCafeSiteConfigStore !== "object") {
    globalThis.__millersCafeSiteConfigStore = {};
  }
  return globalThis.__millersCafeSiteConfigStore;
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function uniqueStrings(values, transform = (value) => value) {
  if (!Array.isArray(values)) return [];

  const seen = new Set();
  const results = [];
  values.forEach((value) => {
    const normalized = transform(normalizeText(value));
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    results.push(normalized);
  });
  return results;
}

function toFiniteNumber(value, fallback, options = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  const rounded = options.integer === false
    ? Math.round(parsed * 100) / 100
    : Math.round(parsed);

  if (Number.isFinite(options.min) && rounded < options.min) return fallback;
  if (Number.isFinite(options.max) && rounded > options.max) return fallback;
  return rounded;
}

function minutesToClock(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes || 0)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function parseClockToMinutes(clock) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(clock || ""));
  if (!match) return NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return NaN;
  return (hours * 60) + minutes;
}

function normalizeMinuteValue(value, fallback, options = {}) {
  return toFiniteNumber(value, fallback, {
    min: Number.isFinite(options.min) ? options.min : 0,
    max: Number.isFinite(options.max) ? options.max : (24 * 60),
    integer: true
  });
}

function normalizeDayIndexes(values, fallback) {
  const source = Array.isArray(values) ? values : fallback;
  const results = source
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  return Array.from(new Set(results)).sort((left, right) => left - right);
}

function normalizeHourWindow(rawWindow) {
  if (!Array.isArray(rawWindow) || rawWindow.length < 2) return null;
  const start = parseClockToMinutes(rawWindow[0]);
  const end = parseClockToMinutes(rawWindow[1]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return [minutesToClock(start), minutesToClock(end)];
}

function normalizeWeeklyHours(rawWeeklyHours, fallback) {
  const normalized = {};
  for (let dayIndex = 0; dayIndex <= 6; dayIndex += 1) {
    const fallbackWindows = Array.isArray(fallback?.[dayIndex]) ? fallback[dayIndex] : [];
    const source = Array.isArray(rawWeeklyHours?.[dayIndex]) ? rawWeeklyHours[dayIndex] : fallbackWindows;
    normalized[dayIndex] = source.map(normalizeHourWindow).filter(Boolean);
  }
  return normalized;
}

function normalizeModifierOption(rawOption) {
  const name = normalizeText(rawOption?.name);
  if (!name) return null;
  const id = normalizeText(rawOption?.id || rawOption?.posModifierOptionId || rawOption?.optionId);

  const normalized = {
    name,
    priceAdjustment: Math.round(Number(rawOption?.priceAdjustment || 0) * 100) / 100
  };
  if (id) {
    normalized.id = id;
    normalized.posModifierOptionId = normalizeText(rawOption?.posModifierOptionId || id);
  }
  return normalized;
}

function normalizeModifierGroup(rawGroup) {
  const name = normalizeText(rawGroup?.name);
  if (!name) return null;
  const id = normalizeText(rawGroup?.id || rawGroup?.posModifierGroupId || rawGroup?.groupId);

  const selectionType = normalizeText(rawGroup?.selectionType).toLowerCase() === "multiple"
    ? "multiple"
    : "single";
  const options = Array.isArray(rawGroup?.options)
    ? rawGroup.options.map(normalizeModifierOption).filter(Boolean)
    : [];
  const maxSelections = selectionType === "multiple"
    ? Math.max(1, toFiniteNumber(rawGroup?.maxSelections, options.length || 1, { min: 1, max: 50 }))
    : 1;

  const normalized = {
    name,
    selectionType,
    isRequired: Boolean(rawGroup?.isRequired),
    isTextInput: Boolean(rawGroup?.isTextInput),
    maxSelections,
    options
  };
  if (id) {
    normalized.id = id;
    normalized.posModifierGroupId = normalizeText(rawGroup?.posModifierGroupId || id);
  }
  if (normalizeText(rawGroup?.textPlaceholder)) {
    normalized.textPlaceholder = normalizeText(rawGroup.textPlaceholder);
  }
  return normalized;
}

function normalizeMenuItem(rawItem) {
  const name = normalizeText(rawItem?.name);
  const basePrice = Number(rawItem?.basePrice);
  if (!name || !Number.isFinite(basePrice) || basePrice < 0) return null;
  const id = normalizeText(rawItem?.id || rawItem?.posItemId || rawItem?.itemId);

  const normalized = {
    name,
    basePrice: Math.round(basePrice * 100) / 100,
    description: normalizeText(rawItem?.description),
    publicPriceLabel: normalizeText(rawItem?.publicPriceLabel),
    codes: uniqueStrings(rawItem?.codes, (value) => value.toUpperCase()),
    tags: uniqueStrings(rawItem?.tags),
    modifierGroups: Array.isArray(rawItem?.modifierGroups)
      ? rawItem.modifierGroups.map(normalizeModifierGroup).filter(Boolean)
      : []
  };
  if (id) {
    normalized.id = id;
    normalized.posItemId = normalizeText(rawItem?.posItemId || id);
  }
  const posCategoryId = normalizeText(rawItem?.posCategoryId || rawItem?.categoryId);
  if (posCategoryId) normalized.posCategoryId = posCategoryId;
  const categoryName = normalizeText(rawItem?.categoryName);
  if (categoryName) normalized.categoryName = categoryName;
  const printRouting = normalizeText(rawItem?.printRouting);
  if (printRouting) normalized.printRouting = printRouting;
  const menuVersion = normalizeText(rawItem?.menuVersion);
  if (menuVersion) normalized.menuVersion = menuVersion;
  return normalized;
}

function normalizeMenuCategory(rawCategory) {
  const name = normalizeText(rawCategory?.name);
  if (!name) return null;
  const id = normalizeText(rawCategory?.id || rawCategory?.posCategoryId || rawCategory?.categoryId);

  const items = Array.isArray(rawCategory?.items)
    ? rawCategory.items.map(normalizeMenuItem).filter(Boolean)
    : [];
  if (items.length === 0) return null;

  const normalized = {
    name,
    description: normalizeText(rawCategory?.description),
    items
  };
  if (id) {
    normalized.id = id;
    normalized.posCategoryId = normalizeText(rawCategory?.posCategoryId || id);
  }
  const categoryType = normalizeText(rawCategory?.categoryType);
  if (categoryType) normalized.categoryType = categoryType;
  const source = normalizeText(rawCategory?.source);
  if (source) normalized.source = source;
  return normalized;
}

function normalizeMenuCatalog(rawMenu) {
  const source = Array.isArray(rawMenu)
    ? rawMenu
    : (Array.isArray(rawMenu?.menu) ? rawMenu.menu : MILLERS_ORDER_MENU);
  const categories = source.map(normalizeMenuCategory).filter(Boolean);
  return categories.length > 0 ? categories : MILLERS_ORDER_MENU.map(normalizeMenuCategory).filter(Boolean);
}

function normalizeSiteConfig(rawConfig) {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

  const homeWeeklyHours = normalizeWeeklyHours(
    source.home?.weeklyHours,
    DEFAULT_SITE_CONFIG.home.weeklyHours
  );

  const orders = {
    openDayIndexes: normalizeDayIndexes(
      source.orders?.openDayIndexes,
      DEFAULT_SITE_CONFIG.orders.openDayIndexes
    ),
    serviceStartMinutes: normalizeMinuteValue(
      source.orders?.serviceStartMinutes,
      DEFAULT_SITE_CONFIG.orders.serviceStartMinutes,
      { max: 23 * 60 }
    ),
    serviceEndMinutes: normalizeMinuteValue(
      source.orders?.serviceEndMinutes,
      DEFAULT_SITE_CONFIG.orders.serviceEndMinutes,
      { max: 24 * 60 }
    ),
    slotStepMinutes: normalizeMinuteValue(
      source.orders?.slotStepMinutes,
      DEFAULT_SITE_CONFIG.orders.slotStepMinutes,
      { min: 5, max: 60 }
    ),
    maxLookaheadDays: toFiniteNumber(
      source.orders?.maxLookaheadDays,
      DEFAULT_SITE_CONFIG.orders.maxLookaheadDays,
      { min: 1, max: 366 }
    ),
    collectionMinLeadMinutes: normalizeMinuteValue(
      source.orders?.collectionMinLeadMinutes,
      DEFAULT_SITE_CONFIG.orders.collectionMinLeadMinutes,
      { max: 8 * 60 }
    ),
    deliveryMinLeadMinutes: normalizeMinuteValue(
      source.orders?.deliveryMinLeadMinutes,
      DEFAULT_SITE_CONFIG.orders.deliveryMinLeadMinutes,
      { max: 8 * 60 }
    ),
    collectionEarliestScheduledMinutes: normalizeMinuteValue(
      source.orders?.collectionEarliestScheduledMinutes,
      DEFAULT_SITE_CONFIG.orders.collectionEarliestScheduledMinutes,
      { max: 24 * 60 }
    ),
    deliveryEarliestScheduledMinutes: normalizeMinuteValue(
      source.orders?.deliveryEarliestScheduledMinutes,
      DEFAULT_SITE_CONFIG.orders.deliveryEarliestScheduledMinutes,
      { max: 24 * 60 }
    )
  };

  const bookings = {
    openDayIndexes: normalizeDayIndexes(
      source.bookings?.openDayIndexes,
      DEFAULT_SITE_CONFIG.bookings.openDayIndexes
    ),
    serviceStartMinutes: normalizeMinuteValue(
      source.bookings?.serviceStartMinutes,
      DEFAULT_SITE_CONFIG.bookings.serviceStartMinutes,
      { max: 23 * 60 }
    ),
    serviceEndMinutes: normalizeMinuteValue(
      source.bookings?.serviceEndMinutes,
      DEFAULT_SITE_CONFIG.bookings.serviceEndMinutes,
      { max: 24 * 60 }
    ),
    slotStepMinutes: normalizeMinuteValue(
      source.bookings?.slotStepMinutes,
      DEFAULT_SITE_CONFIG.bookings.slotStepMinutes,
      { min: 5, max: 60 }
    ),
    maxLookaheadDays: toFiniteNumber(
      source.bookings?.maxLookaheadDays,
      DEFAULT_SITE_CONFIG.bookings.maxLookaheadDays,
      { min: 1, max: 366 }
    ),
    defaultDurationMinutes: normalizeMinuteValue(
      source.bookings?.defaultDurationMinutes,
      DEFAULT_SITE_CONFIG.bookings.defaultDurationMinutes,
      { min: 15, max: 240 }
    )
  };

  const delivery = {
    baseFeeGBP: toFiniteNumber(
      source.delivery?.baseFeeGBP,
      DEFAULT_SITE_CONFIG.delivery.baseFeeGBP,
      { min: 0, max: 100, integer: false }
    ),
    etaMinMinutes: normalizeMinuteValue(
      source.delivery?.etaMinMinutes,
      DEFAULT_SITE_CONFIG.delivery.etaMinMinutes,
      { min: 0, max: 300 }
    ),
    etaMaxMinutes: normalizeMinuteValue(
      source.delivery?.etaMaxMinutes,
      DEFAULT_SITE_CONFIG.delivery.etaMaxMinutes,
      { min: 0, max: 300 }
    ),
    allowedOutwardPrefixes: uniqueStrings(
      source.delivery?.allowedOutwardPrefixes,
      (value) => value.toUpperCase()
    ),
    outsideAreaMode: normalizeText(source.delivery?.outsideAreaMode).toLowerCase() === "reject"
      ? "reject"
      : "review"
  };

  if (delivery.allowedOutwardPrefixes.length === 0) {
    delivery.allowedOutwardPrefixes = DEFAULT_DELIVERY_PREFIXES.slice();
  }

  return {
    version: 1,
    business: {
      name: normalizeText(source.business?.name) || DEFAULT_SITE_CONFIG.business.name,
      shortName: normalizeText(source.business?.shortName) || DEFAULT_SITE_CONFIG.business.shortName,
      address: normalizeText(source.business?.address) || DEFAULT_SITE_CONFIG.business.address,
      phoneDisplay: normalizeText(source.business?.phoneDisplay) || DEFAULT_SITE_CONFIG.business.phoneDisplay,
      phoneTel: normalizeText(source.business?.phoneTel) || DEFAULT_SITE_CONFIG.business.phoneTel,
      email: normalizeText(source.business?.email) || DEFAULT_SITE_CONFIG.business.email,
      timezone: normalizeText(source.business?.timezone) || DEFAULT_SITE_CONFIG.business.timezone
    },
    home: {
      weeklyHours: homeWeeklyHours
    },
    orders,
    bookings,
    delivery,
    security: {
      turnstileEnabled: Boolean(source.security?.turnstileEnabled)
    }
  };
}

async function readStoredJson(env, key) {
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    return env.BOOKINGS_KV.get(key, "json");
  }
  return getInMemoryStore()[key] || null;
}

async function writeStoredJson(env, key, value) {
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    await env.BOOKINGS_KV.put(key, JSON.stringify(value));
    return;
  }
  getInMemoryStore()[key] = value;
}

export function defaultSiteConfig() {
  return normalizeSiteConfig(DEFAULT_SITE_CONFIG);
}

export function defaultMenuCatalog() {
  return normalizeMenuCatalog(MILLERS_ORDER_MENU);
}

export async function getSiteConfig(env) {
  const stored = await readStoredJson(env, SITE_CONFIG_STORAGE_KEY);
  return normalizeSiteConfig(stored);
}

export async function saveSiteConfig(env, rawConfig) {
  const normalized = normalizeSiteConfig(rawConfig);
  await writeStoredJson(env, SITE_CONFIG_STORAGE_KEY, normalized);
  return normalized;
}

export async function getMenuCatalog(env) {
  const stored = await readStoredJson(env, MENU_CATALOG_STORAGE_KEY);
  return normalizeMenuCatalog(stored);
}

export async function saveMenuCatalog(env, rawMenu) {
  const normalized = normalizeMenuCatalog(rawMenu);
  await writeStoredJson(env, MENU_CATALOG_STORAGE_KEY, normalized);
  return normalized;
}

export function buildOpeningSummary(weeklyHours) {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const openDays = [];

  for (let dayIndex = 0; dayIndex <= 6; dayIndex += 1) {
    const windows = Array.isArray(weeklyHours?.[dayIndex]) ? weeklyHours[dayIndex] : [];
    if (windows.length === 0) continue;
    const first = windows[0];
    const start = first?.[0] || "";
    const end = first?.[1] || "";
    if (start && end) {
      openDays.push({ dayIndex, label: labels[dayIndex], text: `${start}-${end}` });
    }
  }

  if (openDays.length === 0) return "Hours unavailable";
  if (openDays.length === 1) return `${openDays[0].label}: ${openDays[0].text}`;

  const first = openDays[0];
  const last = openDays[openDays.length - 1];
  const allSameText = openDays.every((entry) => entry.text === first.text);
  if (allSameText) {
    return `${first.label}-${last.label}: ${first.text}`;
  }

  return openDays
    .map((entry) => `${entry.label}: ${entry.text}`)
    .join(" • ");
}
