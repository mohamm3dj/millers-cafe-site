"use strict";

import { MILLERS_ORDER_MENU } from "../../orders/menu-catalog.js";

const SITE_CONFIG_STORAGE_KEY = "site_config_v1";
const MENU_CATALOG_STORAGE_KEY = "menu_catalog_v1";
const POS_MENU_DEFAULT_TIMEOUT_MS = 5000;

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

function normalizeName(raw, ...fields) {
  for (const field of fields) {
    const value = normalizeText(raw?.[field]);
    if (value) return value;
  }
  return "";
}

function parseMoneyValue(value) {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;

  const cleaned = String(value)
    .trim()
    .replace(/[£$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function normalizeMoneyValue(values, fallback = NaN) {
  for (const value of values) {
    const parsed = parseMoneyValue(value);
    if (Number.isFinite(parsed)) return Math.round(parsed * 100) / 100;
  }
  return fallback;
}

function normalizeMinorMoneyValue(values) {
  for (const value of values) {
    const parsed = parseMoneyValue(value);
    if (Number.isFinite(parsed)) return Math.round(parsed) / 100;
  }
  return NaN;
}

function isExplicitlyUnavailable(raw) {
  return raw?.available === false ||
    raw?.isAvailable === false ||
    raw?.active === false ||
    raw?.isActive === false ||
    raw?.enabled === false ||
    raw?.hidden === true ||
    raw?.isHidden === true ||
    raw?.deleted === true ||
    raw?.isDeleted === true;
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
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
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
  if (isExplicitlyUnavailable(rawOption)) return null;
  const name = normalizeName(rawOption, "name", "displayName", "title", "label");
  if (!name) return null;
  const id = normalizeText(rawOption?.id || rawOption?.posModifierOptionId || rawOption?.optionId || rawOption?.posId || rawOption?.uuid || rawOption?.sku);
  const priceAdjustment = normalizeMoneyValue([
    rawOption?.priceAdjustment,
    rawOption?.price,
    rawOption?.amount,
    rawOption?.deltaPrice
  ], 0);

  const normalized = {
    name,
    priceAdjustment,
    allergenCodes: uniqueStrings(rawOption?.allergenCodes, (value) => value.toUpperCase()),
    removesAllergenCodes: uniqueStrings(rawOption?.removesAllergenCodes, (value) => value.toUpperCase())
  };
  const minorAdjustment = normalizeMinorMoneyValue([
    rawOption?.priceAdjustmentMinor,
    rawOption?.priceAdjustmentPence,
    rawOption?.priceMinor,
    rawOption?.pricePence,
    rawOption?.amountMinor
  ]);
  if (Number.isFinite(minorAdjustment)) normalized.priceAdjustment = minorAdjustment;
  if (id) {
    normalized.id = id;
    normalized.posModifierOptionId = normalizeText(rawOption?.posModifierOptionId || id);
  }
  return normalized;
}

function normalizeModifierGroup(rawGroup) {
  if (isExplicitlyUnavailable(rawGroup)) return null;
  const name = normalizeName(rawGroup, "name", "displayName", "title", "label");
  if (!name) return null;
  const id = normalizeText(rawGroup?.id || rawGroup?.posModifierGroupId || rawGroup?.groupId || rawGroup?.posId || rawGroup?.uuid);

  const rawSelectionType = normalizeText(rawGroup?.selectionType || rawGroup?.type || rawGroup?.mode).toLowerCase();
  const selectionType = rawSelectionType === "multiple" || rawSelectionType === "multi" || rawSelectionType === "checkbox"
    ? "multiple"
    : "single";
  const rawOptions = Array.isArray(rawGroup?.options)
    ? rawGroup.options
    : (Array.isArray(rawGroup?.choices) ? rawGroup.choices : rawGroup?.modifiers);
  const options = Array.isArray(rawOptions)
    ? rawOptions.map(normalizeModifierOption).filter(Boolean)
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
  if (isExplicitlyUnavailable(rawItem)) return null;
  const name = normalizeName(rawItem, "name", "displayName", "title", "label");
  const minorPrice = normalizeMinorMoneyValue([
    rawItem?.basePriceMinor,
    rawItem?.basePricePence,
    rawItem?.priceMinor,
    rawItem?.pricePence,
    rawItem?.amountMinor,
    rawItem?.amountPence
  ]);
  const basePrice = Number.isFinite(minorPrice)
    ? minorPrice
    : normalizeMoneyValue([
      rawItem?.basePrice,
      rawItem?.price,
      rawItem?.unitPrice,
      rawItem?.amount
    ]);
  if (!name || !Number.isFinite(basePrice) || basePrice < 0) return null;
  const id = normalizeText(rawItem?.id || rawItem?.posItemId || rawItem?.itemId || rawItem?.menuItemId || rawItem?.productId || rawItem?.posId || rawItem?.uuid || rawItem?.sku);
  const rawModifierGroups = Array.isArray(rawItem?.modifierGroups)
    ? rawItem.modifierGroups
    : (Array.isArray(rawItem?.modifiers) ? rawItem.modifiers : rawItem?.optionGroups);

  const normalized = {
    name,
    basePrice: Math.round(basePrice * 100) / 100,
    discountEligible: rawItem?.discountEligible !== false,
    description: normalizeText(rawItem?.description || rawItem?.details),
    publicPriceLabel: normalizeText(rawItem?.publicPriceLabel || rawItem?.priceLabel),
    codes: uniqueStrings(rawItem?.codes, (value) => value.toUpperCase()),
    tags: uniqueStrings(rawItem?.tags),
    modifierGroups: Array.isArray(rawModifierGroups)
      ? rawModifierGroups.map(normalizeModifierGroup).filter(Boolean)
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
  if (isExplicitlyUnavailable(rawCategory)) return null;
  const name = normalizeName(rawCategory, "name", "displayName", "title", "label");
  if (!name) return null;
  const id = normalizeText(rawCategory?.id || rawCategory?.posCategoryId || rawCategory?.categoryId || rawCategory?.posId || rawCategory?.uuid);

  const rawItems = Array.isArray(rawCategory?.items)
    ? rawCategory.items
    : (Array.isArray(rawCategory?.products) ? rawCategory.products : rawCategory?.menuItems);
  const items = Array.isArray(rawItems)
    ? rawItems.map(normalizeMenuItem).filter(Boolean)
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

function isFlatMenuItem(rawItem) {
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return false;
  if (Array.isArray(rawItem.items) || Array.isArray(rawItem.products) || Array.isArray(rawItem.menuItems)) return false;
  const name = normalizeName(rawItem, "name", "displayName", "title", "label");
  const price = normalizeMoneyValue([
    rawItem?.basePrice,
    rawItem?.price,
    rawItem?.unitPrice,
    rawItem?.amount
  ]);
  const minorPrice = normalizeMinorMoneyValue([
    rawItem?.basePriceMinor,
    rawItem?.basePricePence,
    rawItem?.priceMinor,
    rawItem?.pricePence,
    rawItem?.amountMinor,
    rawItem?.amountPence
  ]);
  return Boolean(name && (Number.isFinite(price) || Number.isFinite(minorPrice)));
}

function groupFlatMenuItems(rawItems) {
  const grouped = new Map();
  rawItems.forEach((rawItem) => {
    const categoryName = normalizeText(
      rawItem?.categoryName ||
      rawItem?.category ||
      rawItem?.sectionName ||
      rawItem?.section ||
      "Menu"
    ) || "Menu";
    const categoryId = normalizeText(rawItem?.posCategoryId || rawItem?.categoryId || rawItem?.sectionId);
    const key = categoryId || categoryName.toLowerCase();

    if (!grouped.has(key)) {
      grouped.set(key, {
        id: categoryId,
        posCategoryId: categoryId,
        name: categoryName,
        items: []
      });
    }
    grouped.get(key).items.push(rawItem);
  });
  return Array.from(grouped.values());
}

function extractMenuCatalogPayload(rawMenu, fallbackSource = MILLERS_ORDER_MENU) {
  if (Array.isArray(rawMenu)) {
    return rawMenu.some(isFlatMenuItem) ? groupFlatMenuItems(rawMenu) : rawMenu;
  }
  if (!rawMenu || typeof rawMenu !== "object") return fallbackSource;

  const candidates = [
    rawMenu.menu,
    rawMenu.categories,
    rawMenu.sections,
    rawMenu.data?.menu,
    rawMenu.data?.categories,
    rawMenu.data?.sections,
    rawMenu.payload?.menu,
    rawMenu.payload?.categories
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.some(isFlatMenuItem) ? groupFlatMenuItems(candidate) : candidate;
  }

  const itemCandidates = [
    rawMenu.items,
    rawMenu.products,
    rawMenu.menuItems,
    rawMenu.data?.items,
    rawMenu.data?.products,
    rawMenu.payload?.items,
    rawMenu.payload?.products
  ];
  for (const candidate of itemCandidates) {
    if (Array.isArray(candidate)) return groupFlatMenuItems(candidate);
  }

  return fallbackSource;
}

function normalizeMenuCatalog(rawMenu, options = {}) {
  const fallbackSource = options.fallback === false ? [] : MILLERS_ORDER_MENU;
  const source = extractMenuCatalogPayload(rawMenu, fallbackSource);
  const categories = source.map(normalizeMenuCategory).filter(Boolean);
  if (categories.length > 0) return categories;
  return options.fallback === false
    ? []
    : MILLERS_ORDER_MENU.map(normalizeMenuCategory).filter(Boolean);
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

  if (orders.serviceEndMinutes <= orders.serviceStartMinutes) {
    orders.serviceStartMinutes = DEFAULT_SITE_CONFIG.orders.serviceStartMinutes;
    orders.serviceEndMinutes = DEFAULT_SITE_CONFIG.orders.serviceEndMinutes;
  }
  orders.collectionEarliestScheduledMinutes = Math.min(
    orders.serviceEndMinutes,
    Math.max(orders.serviceStartMinutes, orders.collectionEarliestScheduledMinutes)
  );
  orders.deliveryEarliestScheduledMinutes = Math.min(
    orders.serviceEndMinutes,
    Math.max(orders.serviceStartMinutes, orders.deliveryEarliestScheduledMinutes)
  );

  if (bookings.serviceEndMinutes <= bookings.serviceStartMinutes) {
    bookings.serviceStartMinutes = DEFAULT_SITE_CONFIG.bookings.serviceStartMinutes;
    bookings.serviceEndMinutes = DEFAULT_SITE_CONFIG.bookings.serviceEndMinutes;
  }

  if (delivery.etaMaxMinutes < delivery.etaMinMinutes) {
    delivery.etaMaxMinutes = delivery.etaMinMinutes;
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

function resolvePosMenuUrl(env) {
  return normalizeText(env?.POS_MENU_URL || env?.POS_MENU_SOURCE_URL || env?.POS_MENU_ENDPOINT);
}

function posMenuHeaders(env) {
  const bearerToken = normalizeText(env?.POS_MENU_BEARER_TOKEN || env?.POS_MENU_TOKEN);
  const apiKey = normalizeText(env?.POS_MENU_API_KEY);
  const headers = {
    Accept: "application/json"
  };

  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  if (apiKey) headers["X-API-Key"] = apiKey;

  const rawHeaders = normalizeText(env?.POS_MENU_HEADERS_JSON);
  if (rawHeaders) {
    try {
      const parsed = JSON.parse(rawHeaders);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.entries(parsed).forEach(([key, value]) => {
          const headerName = normalizeText(key);
          const headerValue = normalizeText(value);
          if (headerName && headerValue) headers[headerName] = headerValue;
        });
      }
    } catch (error) {
      // Ignore invalid optional header JSON.
    }
  }

  return headers;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = POS_MENU_DEFAULT_TIMEOUT_MS) {
  const timeout = toFiniteNumber(timeoutMs, POS_MENU_DEFAULT_TIMEOUT_MS, { min: 500, max: 30000 });
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeout)
    : null;

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller?.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchAndCachePosMenuCatalog(env) {
  const url = resolvePosMenuUrl(env);
  if (!url || typeof fetch !== "function") return null;

  try {
    const rawMenu = await fetchJsonWithTimeout(url, {
      headers: posMenuHeaders(env)
    }, env?.POS_MENU_TIMEOUT_MS);
    if (!rawMenu) return null;

    const normalized = normalizeMenuCatalog(rawMenu, { fallback: false });
    if (normalized.length === 0) return null;

    await writeStoredJson(env || {}, MENU_CATALOG_STORAGE_KEY, normalized);
    return normalized;
  } catch (error) {
    return null;
  }
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
  const posMenu = await fetchAndCachePosMenuCatalog(env || {});
  if (posMenu) return posMenu;

  const stored = await readStoredJson(env || {}, MENU_CATALOG_STORAGE_KEY);
  return normalizeMenuCatalog(stored);
}

export async function saveMenuCatalog(env, rawMenu) {
  const normalized = normalizeMenuCatalog(rawMenu);
  await writeStoredJson(env, MENU_CATALOG_STORAGE_KEY, normalized);
  return normalized;
}

export function buildOpeningSummary(weeklyHours) {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const entries = [];

  for (let dayIndex = 0; dayIndex <= 6; dayIndex += 1) {
    const windows = Array.isArray(weeklyHours?.[dayIndex]) ? weeklyHours[dayIndex] : [];
    const text = windows
      .filter((windowValue) => Array.isArray(windowValue) && windowValue.length >= 2)
      .map((windowValue) => `${windowValue[0]}-${windowValue[1]}`)
      .join(" / ");
    entries.push({ dayIndex, label: labels[dayIndex], text });
  }

  const openDays = entries.filter((entry) => entry.text);
  if (openDays.length === 0) return "Hours unavailable";

  const groups = [];
  for (const entry of entries) {
    const previous = groups[groups.length - 1];
    if (entry.text && previous && previous.text === entry.text && previous.end === entry.dayIndex - 1) {
      previous.end = entry.dayIndex;
      continue;
    }
    if (entry.text) {
      groups.push({ start: entry.dayIndex, end: entry.dayIndex, text: entry.text });
    }
  }

  // Sunday and the following Tuesday-Saturday are not a continuous range.
  // Keep week-boundary groups separate so a closed Monday is never implied.
  return groups
    .map((group) => {
      const dayLabel = group.start === group.end
        ? labels[group.start]
        : `${labels[group.start]}-${labels[group.end]}`;
      return `${dayLabel}: ${group.text}`;
    })
    .join(" • ");
}
