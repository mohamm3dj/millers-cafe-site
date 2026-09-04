import {
  MILLERS_ORDER_MENU,
  getMenuItemAllergenLabels,
  getMenuItemDietaryDisplay,
  getPreferredModifierOptionIndex
} from "./menu-catalog.js?v=20260904a";
import {
  calculateOrderPricing,
  canAdvanceToCheckoutDetails,
  cartQuantityActionLabel,
  createEmptyOrderDraftMeta,
  createEmptyOrderDraftState,
  reconcileOrderDraftState,
  resolveOrderMenuView,
  scrollBehaviorForPreference
} from "./order-draft.js?v=20260901c";
import { getOrderItemDescription } from "./order-media.js?v=20260714a";

const CHECKOUT_API_BASE = "/api/orders/checkout";
const CHECKOUT_SESSION_API_BASE = "/api/orders/checkout-session";
const STATUS_API_BASE = "/api/order-status";
const SITE_CONFIG_API_BASE = "/api/site-config";
const BUSINESS_TIMEZONE = "Europe/London";
let SERVICE_START_MINUTES = 12 * 60;
let SERVICE_END_MINUTES = 17 * 60;
let SLOT_STEP_MINUTES = 15;
const ASAP_VALUE = "ASAP";
const ORDER_DRAFT_STORAGE_KEY = "millers-cafe-order-draft-v2";
const ORDER_DRAFT_VERSION = 3;
let COLLECTION_MIN_LEAD_MINUTES = 30;
let DELIVERY_MIN_LEAD_MINUTES = 60;
let COLLECTION_EARLIEST_SCHEDULED_MINUTES = (12 * 60) + 30;
let DELIVERY_EARLIEST_SCHEDULED_MINUTES = 13 * 60;
let DELIVERY_FEE_GBP = 2;
let MAX_ORDER_LOOKAHEAD_DAYS = 90;
let OPEN_DAY_INDEXES = new Set([0, 2, 3, 4, 5, 6]); // Sun, Tue-Sat (Mon closed)
const MAX_ITEM_QUANTITY = 20;
const COLLECTION_DISCOUNT_RATE = 0.10;
const UK_POSTCODE_REGEX = /^([A-Z]{1,2}\d[A-Z\d]?)\s(\d[A-Z]{2})$/;
let DELIVERY_OUTWARD_PREFIXES = new Set([
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
]);

const HIDDEN_ORDER_CATEGORY_KEYS = new Set([
  "beer",
  "wine by glass",
  "spirits",
  "red wine bottles",
  "white wine bottles",
  "white win bottles",
  "rose wine bottles",
  "rose wine bottle",
  "champagne and sparkling",
  "champagne and sparking"
]);

const FORCE_CUSTOMIZE_CATEGORY_KEYS = new Set([
  "desi crust",
  "wraps",
  "wings",
  "mumbai sizzle",
  "kiddies corner"
]);

const STARTER_CATEGORY_NAMES = Object.freeze([
  "Starters - Vegetarian",
  "Starters - Chicken",
  "Starters - Lamb",
  "Starters - Mixed",
  "Starters - Seafood"
]);
const LUNCH_SPECIAL_CATEGORY_NAMES = Object.freeze([
  "Salad Bowls",
  "Wraps",
  "Jacket Potato",
  "Curry Sauce",
  "Omelettes",
  "Wings"
]);
const STREET_KITCHEN_CATEGORY_NAMES = Object.freeze([
  "Mumbai Sizzle Burgers",
  "Desi Crust"
]);
const CAFE_CURRY_CATEGORY_NAMES = Object.freeze([
  "Mild Curries",
  "Medium Curries",
  "Hot Curries",
  "Very Hot Curries"
]);
const DRINK_CATEGORY_NAMES = Object.freeze([
  "Shakes and Chillers",
  "Hot Drinks",
  "Soft Drinks"
]);
const MENU_CATEGORY_DISPLAY_LABELS = Object.freeze({
  "Starters - Vegetarian": "Vegetarian",
  "Starters - Chicken": "Chicken",
  "Starters - Lamb": "Lamb",
  "Starters - Mixed": "Mixed",
  "Starters - Seafood": "Seafood",
  "Mild Curries": "Mild",
  "Medium Curries": "Medium",
  "Hot Curries": "Hot",
  "Very Hot Curries": "Very Hot",
  "Shakes and Chillers": "Shakes & Chillers",
  "Desserts and Cakes": "Desserts & Cakes"
});

const DESKTOP_ORDER_MENU_GROUPS = Object.freeze([
  {
    label: "Fresh Lunch Deal",
    intro: "Build a £5.95 lunch with a main, filling, sauce, salad, snack and drink.",
    icon: "../assets/icon-bag.svg",
    categories: ["Fresh Lunch Deal"]
  },
  {
    label: "Starters",
    intro: "Vegetarian, chicken, lamb, mixed and seafood starters.",
    icon: "../assets/icon-tools-kitchen.svg",
    categories: STARTER_CATEGORY_NAMES,
    showCategoryHeadings: true
  },
  {
    label: "Lunch Specials",
    intro: "Salad bowls, wraps, jacket potatoes, omelettes and wings.",
    icon: "../assets/icon-bag.svg",
    categories: LUNCH_SPECIAL_CATEGORY_NAMES,
    showCategoryHeadings: true
  },
  {
    label: "Street Kitchen",
    intro: "Mumbai Sizzle burgers and Millers Desi Crust.",
    icon: "../assets/icon-bag.svg",
    categories: STREET_KITCHEN_CATEGORY_NAMES,
    showCategoryHeadings: true
  },
  {
    label: "Tandoori",
    intro: "Flame-cooked grills served with salad and vegetable curry sauce.",
    icon: "../assets/icon-tools-kitchen.svg",
    categories: ["Tandoori"]
  },
  {
    label: "Biryani",
    intro: "Traditional basmati rice dishes with meat, seafood or vegetables.",
    icon: "../assets/icon-tools-kitchen.svg",
    categories: ["Biryani"]
  },
  {
    label: "Vegetarian Mains",
    intro: "Vegetable and paneer mains from the printed menu.",
    icon: "../assets/icon-tools-kitchen.svg",
    categories: ["Vegetarian Mains"]
  },
  {
    label: "Café Curries",
    intro: "Choose your protein, then pick a curry from mild to very hot.",
    icon: "../assets/icon-tools-kitchen.svg",
    categories: CAFE_CURRY_CATEGORY_NAMES,
    showCategoryHeadings: true
  },
  {
    label: "Rice",
    intro: "Boiled, pilau and flavoured rice sides.",
    icon: "../assets/icon-bag.svg",
    categories: ["Rice"]
  },
  {
    label: "Bread & Snacks",
    intro: "Fresh naan, chapati and paratha.",
    icon: "../assets/icon-book.svg",
    categories: ["Bread & Snacks"]
  },
  {
    label: "Side Dishes",
    intro: "Vegetable sides, chips and café extras.",
    icon: "../assets/icon-bag.svg",
    categories: ["Side Dishes"]
  },
  {
    label: "Desserts & Cakes",
    intro: "Cakes, puddings and something sweet to finish.",
    icon: "../assets/icon-cake.svg",
    categories: ["Desserts and Cakes"]
  },
  {
    label: "Drinks",
    intro: "Shakes, chillers, hot drinks and soft drinks.",
    icon: "../assets/icon-bottle.svg",
    categories: DRINK_CATEGORY_NAMES,
    showCategoryHeadings: true
  }
]);

const form = document.getElementById("orderForm");
const noticeEl = document.getElementById("orderNotice");
const resultEl = document.getElementById("orderResult");
const errorEl = document.getElementById("orderError");
const submitBtn = document.getElementById("orderSubmit");

const orderTypeField = document.getElementById("orderType");
const nameInput = document.getElementById("orderName");
const phoneInput = document.getElementById("orderPhone");
const emailInput = document.getElementById("orderEmail");
const dateSelect = document.getElementById("orderDate");
const timeSelect = document.getElementById("orderTime");
const orderSlotCards = document.getElementById("orderSlotCards");
const itemsInput = document.getElementById("orderItems");
const notesInput = document.getElementById("orderNotes");
const sensitiveInfoConsentInput = document.getElementById("orderSensitiveInfoConsent");
const orderDateToggle = document.getElementById("orderDateToggle");
const orderDateSummary = document.getElementById("orderDateSummary");
const orderCalendarWrap = document.getElementById("orderCalendarWrap");
const orderCalendarMonthLabel = document.getElementById("orderCalendarMonthLabel");
const orderCalendarPrevBtn = document.getElementById("orderCalendarPrevBtn");
const orderCalendarNextBtn = document.getElementById("orderCalendarNextBtn");
const orderCalendarGrid = document.getElementById("orderCalendarGrid");

const address1Input = document.getElementById("orderAddress1");
const address2Input = document.getElementById("orderAddress2");
const townInput = document.getElementById("orderTown");
const postcodeInput = document.getElementById("orderPostcode");
const deliveryAreaHint = document.getElementById("deliveryAreaHint");

const menuSearchInput = document.getElementById("menuSearch");
const menuSearchSubmitBtn = document.getElementById("menuSearchSubmit");
const menuCategoryChips = document.getElementById("menuCategoryChips");
const orderActiveCategoryPill = document.getElementById("orderActiveCategoryPill");
const orderActiveCategoryIntro = document.getElementById("orderActiveCategoryIntro");
const menuItemsList = document.getElementById("menuItemsList");
const orderMenuStatus = document.getElementById("orderMenuStatus");
const orderCartStatus = document.getElementById("orderCartStatus");
const orderHub = document.querySelector(".orderHub");

const basketToggleBtn = document.getElementById("orderBasketToggle");
const basketCountEl = document.getElementById("orderBasketCount");
const basketInlineTotalEl = document.getElementById("orderBasketTotalInline");
const basketPanel = document.getElementById("orderBasketPanel");
const basketCloseBtn = document.getElementById("orderBasketClose");
const basketClearBtn = document.getElementById("orderBasketClear");
const basketColumn = document.querySelector(".orderBasketColumn");
const basketCheckoutBtn = document.getElementById("orderBasketCheckout");

const modifierPanel = document.getElementById("orderModifierPanel");
const modifierTitle = document.getElementById("orderModifierTitle");
const modifierFields = document.getElementById("orderModifierFields");
const modifierError = document.getElementById("orderModifierError");
const modifierCancelBtn = document.getElementById("orderModifierCancel");
const modifierConfirmBtn = document.getElementById("orderModifierConfirm");

const cartList = document.getElementById("orderCartList");
const cartEmpty = document.getElementById("orderCartEmpty");
const orderTotalEl = document.getElementById("orderTotal");
const orderSubtotalEl = document.getElementById("orderSubtotal");
const orderDiscountRowEl = document.getElementById("orderDiscountRow");
const orderDiscountEl = document.getElementById("orderDiscount");
const orderDeliveryFeeRowEl = document.getElementById("orderDeliveryFeeRow");
const orderDeliveryFeeEl = document.getElementById("orderDeliveryFee");
const orderSummaryPreview = document.getElementById("orderSummaryPreview");
const stickyCheckoutBar = document.getElementById("stickyCheckoutBar");
const stickyCheckoutDateTime = document.getElementById("stickyCheckoutDateTime");
const stickyCheckoutOrder = document.getElementById("stickyCheckoutOrder");
const stickyCheckoutBtn = document.getElementById("stickyCheckoutBtn");
const turnstileContainer = document.getElementById("orderTurnstile");
const orderStepBadge1 = document.getElementById("orderStepBadge1");
const orderStepBadge2 = document.getElementById("orderStepBadge2");
const orderStepBadge3 = document.getElementById("orderStepBadge3");
const orderCheckoutFields = [...document.querySelectorAll(".orderCheckoutField")];
const orderItemsField = document.querySelector(".orderItemsField");
const orderCheckoutSummaryList = document.getElementById("orderCheckoutSummaryList");
const orderReviewRow = document.getElementById("orderReviewRow");
const orderReviewText = document.getElementById("orderReviewText");
const orderEditItemsBtn = document.getElementById("orderEditItemsBtn");
const orderBackToItemsBtn = document.getElementById("orderBackToItems");
const orderContextDestination = document.getElementById("orderContextDestination");
const orderContextTiming = document.getElementById("orderContextTiming");
const orderContextPricing = document.getElementById("orderContextPricing");

const GBP_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP"
});
const DESKTOP_BASKET_MEDIA = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(min-width: 960px)")
  : null;
const MOBILE_ORDER_MENU_MEDIA = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(max-width: 959px)")
  : null;

let isSubmitting = false;
let hasSelectableTime = true;
let cartItems = [];
let nextCartId = 1;
let activeDraft = null;
let activeDraftAnchor = null;
let selectedCategory = "";
let mobileOpenCategory = "";
let searchQuery = "";
let statusPollTimer = null;
let statusPollKey = "";
let availableOrderDates = [];
let availableOrderDateSet = new Set();
let orderCalendarViewMonthUTC = null;
let isOrderCalendarOpen = false;
let lastRenderedTimeRows = [];
let currentOrderStep = 1;
let menuCardElements = [];
let activeCategorySyncRaf = null;
let menuSearchTimer = null;
let lastActiveCategoryPillText = "";
let pendingRemovedCartLine = null;
let removeUndoTimer = null;
let persistedOrderDraft = createEmptyOrderDraft();
let restoredDraftMeta = createEmptyOrderDraftMeta();
let checkoutAttemptKey = "";
let checkoutAttemptFingerprint = "";

function newCheckoutAttemptKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `order-${globalThis.crypto.randomUUID()}`;
  }
  return `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function checkoutIdempotencyKey(payload, cartPayload) {
  const fingerprint = JSON.stringify({ payload, cartItems: cartPayload });
  if (!checkoutAttemptKey || checkoutAttemptFingerprint !== fingerprint) {
    checkoutAttemptKey = newCheckoutAttemptKey();
    checkoutAttemptFingerprint = fingerprint;
  }
  return checkoutAttemptKey;
}
let restoredDraftHadCart = false;
let checkoutFinalizeTimer = null;
let orderTurnstileToken = "";
let orderTurnstileWidget = null;
let siteConfigState = null;
let onlineOrderingEnabled = true;

let normalizedMenu = normalizeMenuCatalog(MILLERS_ORDER_MENU);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatGBP(value) {
  return GBP_FORMATTER.format(Number(value || 0));
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function summarySafeText(value) {
  return normalizeText(value).replace(/[\n\r,]+/g, " ");
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function cartPricingTotals() {
  return calculateOrderPricing(cartItems, {
    orderType: currentOrderType(),
    collectionDiscountRate: COLLECTION_DISCOUNT_RATE,
    deliveryFeeGBP: DELIVERY_FEE_GBP
  });
}

function preferredScrollBehavior() {
  let reducedMotion = false;
  try {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (error) {
    reducedMotion = false;
  }
  return scrollBehaviorForPreference(reducedMotion);
}

function normalizeKey(value) {
  const cleaned = normalizeText(value).toLowerCase().replace(/&/g, " and ");
  let normalized = cleaned;
  try {
    normalized = cleaned.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (error) {
    normalized = cleaned;
  }
  return normalized.replace(/[^a-z0-9]+/g, " ").trim();
}

function trackClientEvent(eventName, details = {}) {
  if (!window.MillersClient || typeof window.MillersClient.trackEvent !== "function") {
    return Promise.resolve(false);
  }
  return window.MillersClient.trackEvent(eventName, details);
}

function orderOpenDaySummary() {
  const values = Array.from(OPEN_DAY_INDEXES).sort((left, right) => left - right);
  if (values.length === 7) return "every day";
  if (values.length === 6 && !values.includes(1)) return "Tuesday to Sunday";
  const labels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return values.map((value) => labels[value]).join(", ");
}

function orderHoursSummary() {
  return `${minutesToClock(SERVICE_START_MINUTES)}-${minutesToClock(SERVICE_END_MINUTES)}`;
}

function orderIntervalSummary() {
  return `${SLOT_STEP_MINUTES}-minute intervals`;
}

function applyLiveSiteConfig(config) {
  const next = config && typeof config === "object" ? config : {};
  const orders = next.orders && typeof next.orders === "object" ? next.orders : {};
  const delivery = next.delivery && typeof next.delivery === "object" ? next.delivery : {};
  onlineOrderingEnabled = orders.onlineOrderingEnabled !== false;

  SERVICE_START_MINUTES = Math.round(Number(orders.serviceStartMinutes ?? SERVICE_START_MINUTES));
  SERVICE_END_MINUTES = Math.round(Number(orders.serviceEndMinutes ?? SERVICE_END_MINUTES));
  SLOT_STEP_MINUTES = Math.round(Number(orders.slotStepMinutes ?? SLOT_STEP_MINUTES));
  COLLECTION_MIN_LEAD_MINUTES = Math.round(Number(orders.collectionMinLeadMinutes ?? COLLECTION_MIN_LEAD_MINUTES));
  DELIVERY_MIN_LEAD_MINUTES = Math.round(Number(orders.deliveryMinLeadMinutes ?? DELIVERY_MIN_LEAD_MINUTES));
  COLLECTION_EARLIEST_SCHEDULED_MINUTES = Math.round(Number(
    orders.collectionEarliestScheduledMinutes ?? COLLECTION_EARLIEST_SCHEDULED_MINUTES
  ));
  DELIVERY_EARLIEST_SCHEDULED_MINUTES = Math.round(Number(
    orders.deliveryEarliestScheduledMinutes ?? DELIVERY_EARLIEST_SCHEDULED_MINUTES
  ));
  MAX_ORDER_LOOKAHEAD_DAYS = Math.round(Number(orders.maxLookaheadDays ?? MAX_ORDER_LOOKAHEAD_DAYS));
  DELIVERY_FEE_GBP = roundMoney(Math.max(0, Number(delivery.baseFeeGBP ?? DELIVERY_FEE_GBP)));

  if (Array.isArray(orders.openDayIndexes) && orders.openDayIndexes.length > 0) {
    OPEN_DAY_INDEXES = new Set(
      orders.openDayIndexes
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    );
  }

  if (Array.isArray(delivery.allowedOutwardPrefixes) && delivery.allowedOutwardPrefixes.length > 0) {
    DELIVERY_OUTWARD_PREFIXES = new Set(
      delivery.allowedOutwardPrefixes
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean)
    );
  }

  siteConfigState = next;
}

async function loadLiveOrderData() {
  try {
    const configResponse = await fetch(SITE_CONFIG_API_BASE, {
      headers: { Accept: "application/json" }
    });

    if (configResponse.ok) {
      const body = await configResponse.json();
      if (body?.config) {
        applyLiveSiteConfig(body.config);
      }
    }
  } catch (error) {
    // Keep bundled defaults if the live config endpoint is unavailable.
  }
}

async function setupOrderTurnstile() {
  const enabled = Boolean(siteConfigState?.security?.turnstileEnabled && siteConfigState?.security?.turnstileSiteKey);
  orderTurnstileToken = "";

  if (!turnstileContainer || !enabled || !window.MillersClient || typeof window.MillersClient.mountTurnstile !== "function") {
    if (turnstileContainer) turnstileContainer.hidden = true;
    return;
  }

  try {
    orderTurnstileWidget = await window.MillersClient.mountTurnstile(
      turnstileContainer,
      String(siteConfigState.security.turnstileSiteKey || ""),
      {
        onToken(token) {
          orderTurnstileToken = String(token || "");
        },
        onExpire() {
          orderTurnstileToken = "";
        },
        onError() {
          orderTurnstileToken = "";
        }
      }
    );
  } catch (error) {
    orderTurnstileWidget = null;
  }
}

function resetOrderTurnstile() {
  orderTurnstileToken = "";
  if (orderTurnstileWidget && typeof orderTurnstileWidget.reset === "function") {
    orderTurnstileWidget.reset();
  }
}

function currentOrderType() {
  return String(orderTypeField?.value || "collection").toLowerCase() === "delivery"
    ? "delivery"
    : "collection";
}

function createMenuItemId(categoryKey, itemName, itemIndex) {
  const safeCategory = normalizeKey(categoryKey || "menu") || "menu";
  const safeItem = normalizeKey(itemName || "item") || "item";
  return `${safeCategory}::${safeItem}::${itemIndex}`;
}

function minutesToClock(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

function clockToMinutes(clock) {
  const parts = String(clock || "").split(":");
  if (parts.length !== 2) return NaN;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return NaN;
  return (hours * 60) + minutes;
}

function slotTimes() {
  const slots = [];
  for (let minutes = SERVICE_START_MINUTES; minutes <= SERVICE_END_MINUTES; minutes += SLOT_STEP_MINUTES) {
    slots.push(minutesToClock(minutes));
  }
  return slots;
}

function ukNowDateAndMinutes() {
  const dateISO = ukTodayISODate();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
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

function leadMinutesForOrderType(orderType) {
  return orderType === "delivery" ? DELIVERY_MIN_LEAD_MINUTES : COLLECTION_MIN_LEAD_MINUTES;
}

function earliestScheduledMinutesForOrderType(orderType) {
  return orderType === "delivery"
    ? DELIVERY_EARLIEST_SCHEDULED_MINUTES
    : COLLECTION_EARLIEST_SCHEDULED_MINUTES;
}

function roundUpToStep(minutes, stepMinutes) {
  return Math.ceil(minutes / stepMinutes) * stepMinutes;
}

function ukTodayISODate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

function dayIndexForISODate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isBookableDay(isoDate) {
  const dayIndex = dayIndexForISODate(isoDate);
  return dayIndex !== null && OPEN_DAY_INDEXES.has(dayIndex);
}

function displayDateLabel(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(utcDate);
}

function parseISODateUTC(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toISODateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function monthIndexUTC(date) {
  return (date.getUTCFullYear() * 12) + date.getUTCMonth();
}

function updateOrderDateSummary() {
  if (!orderDateSummary || !dateSelect) return;
  const value = String(dateSelect.value || "").trim();
  if (!value) {
    orderDateSummary.textContent = "Select a date";
    updateOrderReviewRow();
    updateStickyCheckoutBar();
    return;
  }

  const today = ukTodayISODate();
  if (value === today) {
    orderDateSummary.textContent = `Today · ${displayDateLabel(value)}`;
    updateOrderReviewRow();
    updateStickyCheckoutBar();
    return;
  }

  orderDateSummary.textContent = displayDateLabel(value);
  updateOrderReviewRow();
  updateStickyCheckoutBar();
}

function setOrderCalendarOpen(open) {
  if (!orderCalendarWrap || !orderDateToggle) return;
  isOrderCalendarOpen = Boolean(open);
  orderCalendarWrap.hidden = !isOrderCalendarOpen;
  orderDateToggle.setAttribute("aria-expanded", isOrderCalendarOpen ? "true" : "false");
  orderDateToggle.textContent = isOrderCalendarOpen ? "Hide calendar" : "Change date";
  if (isOrderCalendarOpen) {
    window.requestAnimationFrame(() => {
      const selected = orderCalendarGrid?.querySelector('button[aria-pressed="true"]');
      const firstAvailable = orderCalendarGrid?.querySelector("button:not(:disabled)");
      (selected || firstAvailable)?.focus({ preventScroll: true });
    });
  }
}

function handleOrderCalendarKeydown(event) {
  const buttons = [...(orderCalendarGrid?.querySelectorAll("button:not(:disabled)") || [])];
  const currentIndex = buttons.indexOf(event.currentTarget);
  if (currentIndex < 0) return;

  let nextIndex = currentIndex;
  if (event.key === "ArrowLeft") nextIndex -= 1;
  else if (event.key === "ArrowRight") nextIndex += 1;
  else if (event.key === "ArrowUp") nextIndex -= 7;
  else if (event.key === "ArrowDown") nextIndex += 7;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = buttons.length - 1;
  else return;

  event.preventDefault();
  buttons[Math.max(0, Math.min(buttons.length - 1, nextIndex))]?.focus();
}

function buildBookableDateList(startISODate, maxDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISODate)) return [];

  const [year, month, day] = startISODate.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  const results = [];

  for (let i = 0; i < maxDays; i += 1) {
    const candidate = `${cursor.getUTCFullYear()}-${pad2(cursor.getUTCMonth() + 1)}-${pad2(cursor.getUTCDate())}`;
    if (isBookableDay(candidate)) {
      results.push(candidate);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return results;
}

function normalizePhoneField() {
  if (!phoneInput) return;
  phoneInput.value = phoneInput.value
    .replace(/[^\d+()\s.\-]/g, "")
    .replace(/(?!^)[+]/g, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 30);
}

function isDeliveryOrder() {
  return String(orderTypeField?.value || "").toLowerCase() === "delivery";
}

function normalizeUkPostcode(value) {
  const cleaned = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= 3) return cleaned;
  return `${cleaned.slice(0, -3)} ${cleaned.slice(-3)}`;
}

function postcodeOutwardCode(value) {
  const normalized = normalizeUkPostcode(value);
  const match = normalized.match(/^([A-Z]{1,2}\d[A-Z\d]?)/);
  return match ? match[1] : "";
}

function isLikelyDeliveryPostcode(value) {
  const outward = postcodeOutwardCode(value);
  if (!outward) return false;
  return [...DELIVERY_OUTWARD_PREFIXES].some((prefix) => outward.startsWith(prefix));
}

function normalizePostcodeField() {
  if (!postcodeInput) return;
  postcodeInput.value = normalizeUkPostcode(postcodeInput.value);
}

function renderDeliveryAreaHint(primaryText, secondaryText = "", state = "") {
  if (!deliveryAreaHint) return;

  deliveryAreaHint.replaceChildren();
  deliveryAreaHint.classList.remove("isWarning", "isOk");

  if (!primaryText) return;

  const primary = document.createElement("span");
  primary.className = "deliveryAreaHintLine";
  primary.textContent = primaryText;
  deliveryAreaHint.appendChild(primary);

  if (secondaryText) {
    const secondary = document.createElement("span");
    secondary.className = "deliveryAreaHintLine isSecondary";
    secondary.textContent = secondaryText;
    deliveryAreaHint.appendChild(secondary);
  }

  if (state === "warning") deliveryAreaHint.classList.add("isWarning");
  if (state === "ok") deliveryAreaHint.classList.add("isOk");
}

function updateDeliveryAreaHint() {
  if (!deliveryAreaHint || !postcodeInput) return;
  const deliveryConfig = siteConfigState?.delivery || {};
  const feeLabel = Number.isFinite(Number(deliveryConfig.baseFeeGBP))
    ? formatGBP(Number(deliveryConfig.baseFeeGBP))
    : "£2.00";
  const etaMin = Number.isFinite(Number(deliveryConfig.etaMinMinutes)) ? Math.round(Number(deliveryConfig.etaMinMinutes)) : 35;
  const etaMax = Number.isFinite(Number(deliveryConfig.etaMaxMinutes)) ? Math.round(Number(deliveryConfig.etaMaxMinutes)) : 55;
  const isDelivery = String(orderTypeField?.value || "").toLowerCase() === "delivery";
  if (!isDelivery) {
    renderDeliveryAreaHint("");
    return;
  }

  const value = normalizeUkPostcode(postcodeInput.value);
  if (!value) {
    renderDeliveryAreaHint("");
    return;
  }

  if (!UK_POSTCODE_REGEX.test(value)) {
    renderDeliveryAreaHint(
      "Use a valid UK postcode format, e.g. DN37 0JZ.",
      "",
      "warning"
    );
    return;
  }

  if (!isLikelyDeliveryPostcode(value)) {
    const outsideAreaMode = String(deliveryConfig.outsideAreaMode || "review").trim().toLowerCase();
    renderDeliveryAreaHint(
      outsideAreaMode === "reject"
        ? "This postcode is outside our online delivery area."
        : "This postcode may be outside our normal delivery area.",
      outsideAreaMode === "reject"
        ? "Please call Millers Café before placing a delivery order."
        : "Estimated fee and ETA will be confirmed after checkout.",
      "warning"
    );
    return;
  }

  renderDeliveryAreaHint(
    "This postcode looks within our usual delivery area.",
    `Typical delivery fee from ${feeLabel}. Typical arrival: ${etaMin}-${etaMax} minutes.`,
    "ok"
  );
}

function ensureInlineErrorElement(input) {
  if (!input) return null;
  const field = input.closest(".bookingField");
  if (!field) return null;

  let errorEl = field.querySelector(`.orderInlineError[data-for="${input.id}"]`);
  if (errorEl) return errorEl;

  errorEl = document.createElement("p");
  errorEl.className = "orderInlineError";
  errorEl.dataset.for = input.id;
  errorEl.id = `${input.id}-error`;
  errorEl.hidden = true;
  field.appendChild(errorEl);
  return errorEl;
}

function visibleValidationProxy(input) {
  if (input === dateSelect) return orderDateToggle;
  if (input === timeSelect) return orderSlotCards;
  return input;
}

function mirrorInlineErrorToVisibleProxy(input, errorEl, hasError) {
  const proxy = visibleValidationProxy(input);
  if (!proxy || proxy === input) return;

  if (proxy === orderSlotCards && !proxy.hasAttribute("tabindex")) {
    proxy.setAttribute("tabindex", "-1");
  }

  proxy.setAttribute("aria-invalid", hasError ? "true" : "false");
  if (!("baseValidationDescribedby" in proxy.dataset)) {
    proxy.dataset.baseValidationDescribedby = String(proxy.getAttribute("aria-describedby") || "").trim();
  }
  const describedBy = [proxy.dataset.baseValidationDescribedby, hasError ? errorEl?.id : ""]
    .filter(Boolean)
    .join(" ");
  if (describedBy) proxy.setAttribute("aria-describedby", describedBy);
  else proxy.removeAttribute("aria-describedby");
}

function setInlineError(input, message) {
  if (!input) return false;
  const field = input.closest(".bookingField");
  const errorEl = ensureInlineErrorElement(input);
  const hasError = Boolean(message);

  input.setAttribute("aria-invalid", hasError ? "true" : "false");
  if (!("baseDescribedby" in input.dataset)) {
    input.dataset.baseDescribedby = String(input.getAttribute("aria-describedby") || "").trim();
  }
  const describedBy = [input.dataset.baseDescribedby, hasError ? errorEl?.id : ""]
    .filter(Boolean)
    .join(" ");
  if (describedBy) input.setAttribute("aria-describedby", describedBy);
  else input.removeAttribute("aria-describedby");
  if (field) field.classList.toggle("hasFieldError", hasError);
  if (errorEl) {
    errorEl.hidden = !hasError;
    errorEl.textContent = hasError ? message : "";
  }
  mirrorInlineErrorToVisibleProxy(input, errorEl, hasError);
  return !hasError;
}

function validateNameField() {
  if (!nameInput) return true;
  if (isDeliveryOrder()) return setInlineError(nameInput, "");
  const value = normalizeText(nameInput?.value || "");
  return setInlineError(nameInput, value.length >= 2 ? "" : "Enter at least 2 characters.");
}

function validatePhoneField() {
  const value = String(phoneInput?.value || "");
  const digitCount = value.replace(/\D/g, "").length;
  return setInlineError(
    phoneInput,
    digitCount >= 7 && digitCount <= 15 ? "" : "Enter a valid UK or international phone number."
  );
}

function validateEmailField() {
  const value = String(emailInput?.value || "").trim();
  return setInlineError(emailInput, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? "" : "Enter a valid email address.");
}

function validateDateField() {
  const value = String(dateSelect?.value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return setInlineError(dateSelect, "Choose a valid date.");
  }
  if (!isBookableDay(value)) {
    return setInlineError(dateSelect, `Available on ${orderOpenDaySummary()} only.`);
  }
  return setInlineError(dateSelect, "");
}

function validateTimeField() {
  const value = String(timeSelect?.value || "");
  if (!value) return setInlineError(timeSelect, "Choose a time.");
  if (value === ASAP_VALUE) return setInlineError(timeSelect, "");
  if (!/^\d{2}:\d{2}$/.test(value)) return setInlineError(timeSelect, "Choose a valid time.");
  return setInlineError(timeSelect, "");
}

function validateAddress1Field() {
  if (!address1Input) return true;
  const isDelivery = isDeliveryOrder();
  if (!isDelivery) return setInlineError(address1Input, "");
  return setInlineError(address1Input, normalizeText(address1Input.value).length > 0 ? "" : "Address line 1 is required.");
}

function validateTownField() {
  if (!townInput) return true;
  const isDelivery = isDeliveryOrder();
  if (!isDelivery) return setInlineError(townInput, "");
  return setInlineError(townInput, normalizeText(townInput.value).length > 0 ? "" : "Town / City is required.");
}

function validatePostcodeField() {
  if (!postcodeInput) return true;
  const isDelivery = isDeliveryOrder();
  if (!isDelivery) return setInlineError(postcodeInput, "");
  const value = normalizeUkPostcode(postcodeInput.value);
  if (!value) return setInlineError(postcodeInput, "Postcode is required.");
  if (!UK_POSTCODE_REGEX.test(value)) return setInlineError(postcodeInput, "Use UK format, e.g. DN37 0JZ.");
  return setInlineError(postcodeInput, "");
}

function validateSensitiveInfoConsentField() {
  if (!sensitiveInfoConsentInput) return true;
  const hasNotes = normalizeText(notesInput?.value || "").length > 0;
  return setInlineError(
    sensitiveInfoConsentInput,
    hasNotes && !sensitiveInfoConsentInput.checked ? "Consent is required when optional notes are provided." : ""
  );
}

function runCheckoutFieldValidation() {
  const checks = [
    validateNameField(),
    validatePhoneField(),
    validateEmailField(),
    validateDateField(),
    validateTimeField(),
    validateAddress1Field(),
    validateTownField(),
    validatePostcodeField(),
    validateSensitiveInfoConsentField()
  ];
  return checks.every(Boolean);
}

function focusFirstInvalidCheckoutField() {
  const field = form?.querySelector(".bookingField.hasFieldError");
  if (!(field instanceof HTMLElement)) return;

  let focusTarget = field.querySelector('[aria-invalid="true"]');
  if (dateSelect && field.contains(dateSelect)) {
    focusTarget = orderDateToggle;
  } else if (timeSelect && field.contains(timeSelect)) {
    focusTarget = orderSlotCards;
  } else {
    focusTarget = visibleValidationProxy(focusTarget);
  }

  field.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  window.requestAnimationFrame(() => {
    if (focusTarget instanceof HTMLElement) {
      focusTarget.focus({ preventScroll: true });
    }
  });
}

function clearInlineValidation() {
  [
    nameInput,
    phoneInput,
    emailInput,
    dateSelect,
    timeSelect,
    address1Input,
    townInput,
    postcodeInput,
    sensitiveInfoConsentInput
  ].forEach((input) => {
    if (!input) return;
    setInlineError(input, "");
  });
}

function updateOrderReviewRow() {
  if (!orderReviewText) return;
  const orderType = String(orderTypeField?.value || "collection").toLowerCase();
  const totals = cartPricingTotals();
  const dishLabel = totals.totalQuantity === 1 ? "dish" : "dishes";
  const dateLabel = dateSelect?.value
    ? (dateSelect.value === ukTodayISODate() ? "Today" : displayDateLabel(dateSelect.value))
    : "No date";
  const timeLabel = timeSelect?.value ? formatOrderSlotTime(timeSelect.value) : "No time";
  const typeLabel = orderType === "delivery" ? "Delivery" : "Collection";
  const priceSummary = orderType === "delivery"
    ? `Subtotal ${formatGBP(totals.subtotal)} + delivery ${formatGBP(totals.deliveryFee)} = total ${formatGBP(totals.total)}`
    : `Subtotal ${formatGBP(totals.subtotal)} − 10% discount on eligible items ${formatGBP(totals.collectionDiscount)} = total ${formatGBP(totals.total)}`;
  orderReviewText.textContent = `${typeLabel} · ${totals.totalQuantity} ${dishLabel} · ${priceSummary} · ${dateLabel} at ${timeLabel}`;
}

function updateOrderFlowStepLabels() {
  const paymentStageActive = currentOrderStep === 2 && isSubmitting;
  const stages = [
    {
      element: orderStepBadge1,
      number: "1",
      text: "Menu",
      label: "Step 1 of 3: Browse menu",
      active: currentOrderStep === 1,
      complete: currentOrderStep === 2
    },
    {
      element: orderStepBadge2,
      number: "2",
      text: "Details",
      label: "Step 2 of 3: Your details",
      active: currentOrderStep === 2 && !paymentStageActive,
      complete: paymentStageActive,
      locked: cartItems.length === 0 && currentOrderStep === 1
    },
    {
      element: orderStepBadge3,
      number: "3",
      text: "Payment",
      label: "Step 3 of 3: Secure payment",
      active: paymentStageActive,
      complete: false,
      locked: !paymentStageActive
    }
  ];

  stages.forEach((stage) => {
    if (!stage.element) return;
    const number = document.createElement("span");
    number.className = "orderFlowStepNumber";
    number.textContent = stage.number;
    number.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "orderFlowStepLabel";
    label.textContent = stage.text;
    stage.element.replaceChildren(number, label);
    stage.element.setAttribute("aria-label", stage.label);
    stage.element.classList.toggle("isActive", Boolean(stage.active));
    stage.element.classList.toggle("isComplete", Boolean(stage.complete));
    stage.element.classList.toggle("isLocked", Boolean(stage.locked));
    if (stage.active) stage.element.setAttribute("aria-current", "step");
    else stage.element.removeAttribute("aria-current");
  });
}

function setOrderStep(step, options = {}) {
  const nextStep = step === 2 ? 2 : 1;
  const hasItems = cartItems.length > 0;
  if (nextStep === 2 && !hasItems) {
    setNotice("Add at least one dish to continue.", true);
    return;
  }

  currentOrderStep = nextStep;
  form?.classList.toggle("isOrderMenuStep", currentOrderStep === 1);
  form?.classList.toggle("isOrderCheckoutStep", currentOrderStep === 2);
  orderCheckoutFields.forEach((el) => {
    el.hidden = currentOrderStep !== 2;
  });

  if (orderItemsField) {
    orderItemsField.hidden = currentOrderStep !== 1;
  }

  updateOrderFlowStepLabels();
  const shouldMoveFocus = options.moveFocus !== false && !options.silent;

  if (currentOrderStep === 2) {
    if (nextStep === 2) {
      void trackClientEvent("order_step_continue", {
        page: "order",
        route: window.location.pathname,
        orderType: currentOrderType()
      });
    }
    setBasketOpen(false);
    hideModifierPanel();
    updateOrderReviewRow();
    if (hasSelectableTime) {
      setNotice("Review your details, then place the order.", false);
    } else {
      updateTimeNotice(currentOrderType(), String(dateSelect?.value || ""), [], false);
    }
    const checkoutScrollTarget = nameInput?.closest(".bookingGrid")
      || emailInput?.closest(".bookingGrid")
      || phoneInput?.closest(".bookingGrid")
      || orderReviewRow;
    checkoutScrollTarget?.scrollIntoView({
      behavior: options.instant ? "auto" : preferredScrollBehavior(),
      block: "start"
    });
    if (shouldMoveFocus) {
      window.requestAnimationFrame(() => {
        const firstCheckoutControl = [
          nameInput,
          emailInput,
          phoneInput,
          address1Input,
          townInput,
          postcodeInput,
          orderDateToggle
        ].find((element) => element instanceof HTMLElement && !element.closest("[hidden]"));
        firstCheckoutControl?.focus({ preventScroll: true });
      });
    }
  } else if (!options.silent) {
    setBasketOpen(isDesktopBasketLayout());
    const orderType = String(orderTypeField?.value || "collection").toLowerCase();
    const label = orderType === "delivery" ? "Delivery" : "Collection";
    setNotice(`${label} hours: ${orderOpenDaySummary()}, ${orderHoursSummary()}. ${label} slots are in ${orderIntervalSummary()}.`, false);
    orderItemsField?.scrollIntoView({ behavior: preferredScrollBehavior(), block: "start" });
    if (shouldMoveFocus) {
      window.requestAnimationFrame(() => menuSearchInput?.focus({ preventScroll: true }));
    }
  }

  updateStickyCheckoutBar();
}

function renderDateOptions() {
  if (!dateSelect) return;
  const priorValue = dateSelect.value;
  const today = ukTodayISODate();
  const options = buildBookableDateList(today, MAX_ORDER_LOOKAHEAD_DAYS);

  dateSelect.innerHTML = "";
  for (const isoDate of options) {
    const option = document.createElement("option");
    option.value = isoDate;
    option.textContent = `${displayDateLabel(isoDate)} (${isoDate})`;
    dateSelect.appendChild(option);
  }

  if (priorValue && options.includes(priorValue)) {
    dateSelect.value = priorValue;
  } else if (options.includes(today)) {
    dateSelect.value = today;
  } else if (options.length > 0) {
    dateSelect.value = options[0];
  }

  availableOrderDates = options.slice();
  availableOrderDateSet = new Set(options);

  const selectedDate = parseISODateUTC(dateSelect.value) || parseISODateUTC(options[0] || "");
  if (selectedDate && !orderCalendarViewMonthUTC) {
    orderCalendarViewMonthUTC = new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1));
  }

  updateOrderDateSummary();
  renderOrderCalendar();
}

function renderOrderCalendar() {
  if (!orderCalendarGrid || !orderCalendarMonthLabel) return;
  if (!orderCalendarViewMonthUTC || availableOrderDates.length === 0) {
    orderCalendarGrid.innerHTML = "";
    orderCalendarMonthLabel.textContent = "No dates available";
    if (orderCalendarPrevBtn) orderCalendarPrevBtn.disabled = true;
    if (orderCalendarNextBtn) orderCalendarNextBtn.disabled = true;
    return;
  }

  const selectedDate = parseISODateUTC(dateSelect?.value || "");
  const todayDate = parseISODateUTC(ukTodayISODate());
  const firstAvailableDate = parseISODateUTC(availableOrderDates[0]);
  const lastAvailableDate = parseISODateUTC(availableOrderDates[availableOrderDates.length - 1]);
  if (!firstAvailableDate || !lastAvailableDate) return;

  const monthStart = new Date(Date.UTC(
    orderCalendarViewMonthUTC.getUTCFullYear(),
    orderCalendarViewMonthUTC.getUTCMonth(),
    1
  ));

  orderCalendarMonthLabel.textContent = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: BUSINESS_TIMEZONE
  }).format(monthStart);

  const monthStartDayIndex = (monthStart.getUTCDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(monthStart.getUTCDate() - monthStartDayIndex);
  const selectedInView = selectedDate
    && selectedDate.getUTCFullYear() === monthStart.getUTCFullYear()
    && selectedDate.getUTCMonth() === monthStart.getUTCMonth();
  let assignedCalendarTabStop = false;

  orderCalendarGrid.innerHTML = "";

  for (let i = 0; i < 42; i += 1) {
    const cellDate = new Date(gridStart);
    cellDate.setUTCDate(gridStart.getUTCDate() + i);
    const iso = toISODateUTC(cellDate);
    const inCurrentMonth = cellDate.getUTCMonth() === monthStart.getUTCMonth();
    const isBookable = availableOrderDateSet.has(iso);
    const isSelected = selectedDate && toISODateUTC(selectedDate) === iso;
    const isToday = todayDate && toISODateUTC(todayDate) === iso;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bookingCalendarDay";
    if (!inCurrentMonth) btn.classList.add("isOutsideMonth");
    if (isBookable) btn.classList.add("isBookable");
    if (isSelected) btn.classList.add("isSelected");
    if (isToday) btn.classList.add("isToday");
    btn.textContent = String(cellDate.getUTCDate());
    btn.disabled = !inCurrentMonth || !isBookable;
    btn.setAttribute("aria-label", displayDateLabel(iso));
    btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
    if (isToday) btn.setAttribute("aria-current", "date");
    const isCalendarTabStop = isSelected || (!selectedInView && !assignedCalendarTabStop && !btn.disabled);
    btn.tabIndex = isCalendarTabStop ? 0 : -1;
    if (isCalendarTabStop) assignedCalendarTabStop = true;

    if (!btn.disabled) {
      btn.addEventListener("keydown", handleOrderCalendarKeydown);
      btn.addEventListener("click", () => {
        if (!dateSelect) return;
        dateSelect.value = iso;
        updateOrderDateSummary();
        renderOrderCalendar();
        setOrderCalendarOpen(false);
        orderDateToggle?.focus({ preventScroll: true });
        clearFeedback();
        renderTimeOptions();
        validateDateField();
      });
    }

    orderCalendarGrid.appendChild(btn);
  }

  if (orderCalendarPrevBtn) {
    const prevMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));
    orderCalendarPrevBtn.disabled = monthIndexUTC(prevMonth) < monthIndexUTC(firstAvailableDate);
  }

  if (orderCalendarNextBtn) {
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    orderCalendarNextBtn.disabled = monthIndexUTC(nextMonth) > monthIndexUTC(lastAvailableDate);
  }
}

function moveOrderCalendarMonth(delta) {
  if (!orderCalendarViewMonthUTC || !availableOrderDates.length) return;
  const targetMonth = new Date(Date.UTC(
    orderCalendarViewMonthUTC.getUTCFullYear(),
    orderCalendarViewMonthUTC.getUTCMonth() + delta,
    1
  ));

  const firstAvailableDate = parseISODateUTC(availableOrderDates[0]);
  const lastAvailableDate = parseISODateUTC(availableOrderDates[availableOrderDates.length - 1]);
  if (!firstAvailableDate || !lastAvailableDate) return;

  if (monthIndexUTC(targetMonth) < monthIndexUTC(firstAvailableDate)) return;
  if (monthIndexUTC(targetMonth) > monthIndexUTC(lastAvailableDate)) return;

  orderCalendarViewMonthUTC = targetMonth;
  renderOrderCalendar();
}

function syncOrderCalendarToSelectedDate() {
  const selectedDate = parseISODateUTC(dateSelect?.value || "");
  if (!selectedDate) return;
  orderCalendarViewMonthUTC = new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1));
  updateOrderDateSummary();
  renderOrderCalendar();
}

function minScheduledMinutes(orderType, isoDate) {
  const earliestScheduled = earliestScheduledMinutesForOrderType(orderType);
  const now = ukNowDateAndMinutes();
  if (isoDate !== now.dateISO) {
    return earliestScheduled;
  }

  const lead = leadMinutesForOrderType(orderType);
  const withLead = now.minutesNow + lead;
  return Math.max(earliestScheduled, roundUpToStep(withLead, SLOT_STEP_MINUTES));
}

function scheduledSlotTimes(orderType, isoDate) {
  const minimum = minScheduledMinutes(orderType, isoDate);
  return slotTimes().filter((clock) => {
    const minutes = clockToMinutes(clock);
    return Number.isFinite(minutes) && minutes >= minimum;
  });
}

function formatOrderSlotTime(value) {
  if (value === ASAP_VALUE) return ASAP_VALUE;
  const minutes = clockToMinutes(value);
  if (!Number.isFinite(minutes)) return value;
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours24 >= 12 ? "pm" : "am";
  const hours12 = ((hours24 + 11) % 12) + 1;
  return `${hours12}:${pad2(mins)} ${suffix}`;
}

function updateOrderContextStrip() {
  if (!orderContextDestination && !orderContextTiming && !orderContextPricing) return;

  const orderType = currentOrderType();
  const isDelivery = orderType === "delivery";
  const selectedDate = String(dateSelect?.value || "");
  const selectedTime = String(timeSelect?.value || "");
  const dateLabel = selectedDate
    ? (selectedDate === ukTodayISODate() ? "Today" : displayDateLabel(selectedDate))
    : "Choose a date";
  const timeLabel = selectedTime ? formatOrderSlotTime(selectedTime) : "Choose a time";
  const businessAddress = normalizeText(
    siteConfigState?.business?.address || "55 Brigsley Road, Waltham, Grimsby, DN37 0JZ"
  );

  if (orderContextDestination) {
    const deliveryAddress = [
      normalizeText(address1Input?.value),
      normalizeText(townInput?.value),
      normalizeText(postcodeInput?.value)
    ].filter(Boolean).join(", ");
    orderContextDestination.textContent = isDelivery
      ? (deliveryAddress || "Add your address at checkout")
      : businessAddress;
  }

  if (orderContextTiming) {
    orderContextTiming.textContent = `${dateLabel} · ${timeLabel}`;
  }

  if (orderContextPricing) {
    const etaMin = Math.round(Number(siteConfigState?.delivery?.etaMinMinutes ?? 35));
    const etaMax = Math.round(Number(siteConfigState?.delivery?.etaMaxMinutes ?? 55));
    orderContextPricing.textContent = isDelivery
      ? `${formatGBP(DELIVERY_FEE_GBP)} fee · ${etaMin}–${etaMax} min typical`
      : "10% off eligible items";
  }
}

function renderOrderSlotCards(rows) {
  if (!orderSlotCards || !timeSelect) return;
  orderSlotCards.innerHTML = "";

  const selectedTime = String(timeSelect.value || "");
  const availableRows = rows.filter((row) => row.available);
  const rovingTime = availableRows.some((row) => row.time === selectedTime)
    ? selectedTime
    : String(availableRows[0]?.time || "");

  const activateSlot = (time, restoreFocus) => {
    timeSelect.value = time;
    renderOrderSlotCards(rows);
    validateTimeField();
    updateOrderReviewRow();
    updateStickyCheckoutBar();
    persistOrderDraft();
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        const nextButton = [...orderSlotCards.querySelectorAll("button[data-time]")]
          .find((button) => button.dataset.time === time);
        nextButton?.focus({ preventScroll: true });
      });
    }
  };

  rows.forEach((row) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "bookingSlotCard orderSlotCard";
    card.dataset.time = row.time;
    if (!row.available) card.classList.add("isUnavailable");
    if (row.available && row.time === selectedTime) card.classList.add("isSelected");
    card.disabled = !row.available;
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", row.available && row.time === selectedTime ? "true" : "false");
    card.tabIndex = row.available && row.time === rovingTime ? 0 : -1;

    const title = document.createElement("span");
    title.className = "bookingSlotTime";
    title.textContent = row.label;
    card.appendChild(title);

    if (row.available) {
      card.addEventListener("click", () => {
        activateSlot(row.time, true);
      });
      card.addEventListener("keydown", (event) => {
        const times = availableRows.map((entry) => entry.time);
        const currentIndex = times.indexOf(row.time);
        let nextIndex = currentIndex;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + times.length) % times.length;
        else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % times.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = times.length - 1;
        else return;
        event.preventDefault();
        activateSlot(times[nextIndex], true);
      });
    }

    orderSlotCards.appendChild(card);
  });
}

function updateStickyCheckoutBar() {
  if (!stickyCheckoutBar) return;

  updateOrderContextStrip();

  const totals = cartPricingTotals();
  const hasItems = totals.totalQuantity > 0;
  const isMobileMenu = isMobileOrderMenuLayout() && currentOrderStep === 1;
  const isMobileCheckout = isMobileOrderMenuLayout() && currentOrderStep === 2;
  const isDesktopMenu = isDesktopBasketLayout() && currentOrderStep === 1;

  const stickyHost = isMobileCheckout ? form?.parentElement : (basketColumn || orderHub);
  if (stickyHost && stickyCheckoutBar.parentElement !== stickyHost) {
    stickyHost.appendChild(stickyCheckoutBar);
  }
  stickyCheckoutBar.classList.toggle("isCheckoutStep", isMobileCheckout);

  const selectedDate = String(dateSelect?.value || "");
  const selectedTime = String(timeSelect?.value || "");
  const dateLabel = selectedDate ? (selectedDate === ukTodayISODate() ? "Today" : displayDateLabel(selectedDate)) : "Pick a date";
  const timeLabel = selectedTime ? formatOrderSlotTime(selectedTime) : "Pick a time";

  if (stickyCheckoutDateTime) {
    stickyCheckoutDateTime.textContent = isMobileMenu
      ? `${totals.totalQuantity} item${totals.totalQuantity === 1 ? "" : "s"} in cart`
      : (isMobileCheckout ? "Secure Stripe checkout" : `${dateLabel} · ${timeLabel}`);
  }
  if (stickyCheckoutOrder) {
    const adjustmentText = currentOrderType() === "delivery" && totals.deliveryFee > 0
      ? ` total · includes ${formatGBP(totals.deliveryFee)} delivery`
      : (totals.collectionDiscount > 0 ? " total · after 10% off eligible items" : " total");
    stickyCheckoutOrder.textContent = isMobileMenu
      ? `${formatGBP(totals.total)} total`
      : (isMobileCheckout
        ? `${formatGBP(totals.total)} due`
        : `${totals.totalQuantity} ${totals.totalQuantity === 1 ? "dish" : "dishes"} · ${formatGBP(totals.total)}${adjustmentText}`);
  }
  if (stickyCheckoutBtn) {
    const totalLabel = formatGBP(totals.total);
    stickyCheckoutBtn.textContent = !onlineOrderingEnabled
      ? "Ordering paused"
      : (isMobileMenu
        ? (hasItems ? "View basket" : "Add dishes")
        : (isMobileCheckout
          ? "Pay securely"
          : (isDesktopMenu
            ? (hasItems ? `Continue to checkout · ${totalLabel}` : "Add dishes to continue")
            : "Continue")));
    stickyCheckoutBtn.setAttribute("aria-label", !onlineOrderingEnabled
      ? "Online ordering is paused"
      : (isMobileMenu
        ? (hasItems ? `View basket, total ${totalLabel}` : "Add dishes to continue")
        : (isMobileCheckout
          ? `Continue to secure payment, total ${totalLabel}`
          : (isDesktopMenu
            ? (hasItems ? `Continue to checkout details, total ${totalLabel}` : "Add dishes to continue")
            : "Continue"))));
    stickyCheckoutBtn.disabled = !onlineOrderingEnabled || (isMobileMenu
      ? isSubmitting || !hasItems
      : (isMobileCheckout
        ? isSubmitting || !hasItems || !hasSelectableTime
        : !canAdvanceToCheckoutDetails(totals.totalQuantity, isSubmitting)));
    if (isMobileMenu) {
      stickyCheckoutBtn.setAttribute("aria-controls", "orderBasketPanel");
      stickyCheckoutBtn.setAttribute("aria-expanded", basketPanel?.hidden ? "false" : "true");
    } else {
      stickyCheckoutBtn.removeAttribute("aria-controls");
      stickyCheckoutBtn.removeAttribute("aria-expanded");
    }
  }
  if (basketCheckoutBtn) {
    basketCheckoutBtn.disabled = !onlineOrderingEnabled || !canAdvanceToCheckoutDetails(totals.totalQuantity, isSubmitting);
    basketCheckoutBtn.textContent = !onlineOrderingEnabled
      ? "Online ordering paused"
      : (isSubmitting
      ? "Redirecting..."
      : (hasSelectableTime ? "Continue to checkout" : "Choose another date"));
  }

  const showBar = (currentOrderStep === 1 && (isMobileMenu || isDesktopMenu || hasItems || isSubmitting))
    || (isMobileCheckout && hasItems);
  stickyCheckoutBar.classList.toggle("isVisible", showBar);
  queueActiveCategoryPillSync();
}

function renderTimeOptions() {
  if (!timeSelect) return;
  const priorValue = timeSelect.value;
  const orderType = String(orderTypeField?.value || "collection").toLowerCase();
  const selectedDate = String(dateSelect?.value || ukTodayISODate());
  const now = ukNowDateAndMinutes();
  const isToday = selectedDate === now.dateISO;
  const asapEnabled = isToday && now.minutesNow <= SERVICE_END_MINUTES;
  const slots = scheduledSlotTimes(orderType, selectedDate);

  const rows = [];
  if (asapEnabled) {
    rows.push({
      time: ASAP_VALUE,
      label: ASAP_VALUE,
      available: true
    });
  }
  slots.forEach((slot) => {
    rows.push({
      time: slot,
      label: formatOrderSlotTime(slot),
      available: true
    });
  });

  if (rows.length === 0) {
    rows.push({
      time: "",
      label: "No slots",
      available: false
    });
  }

  timeSelect.innerHTML = "";
  rows.forEach((row) => {
    const option = document.createElement("option");
    option.value = row.time;
    option.textContent = row.time || "No slots available";
    option.disabled = !row.available;
    timeSelect.appendChild(option);
  });

  hasSelectableTime = rows.some((row) => row.available);
  if (hasSelectableTime && [...timeSelect.options].some((option) => option.value === priorValue && !option.disabled)) {
    timeSelect.value = priorValue;
  } else if (hasSelectableTime && asapEnabled) {
    timeSelect.value = ASAP_VALUE;
  } else if (hasSelectableTime && slots.length > 0) {
    timeSelect.value = slots[0];
  } else {
    timeSelect.value = "";
  }

  lastRenderedTimeRows = rows;
  renderOrderSlotCards(rows);
  updateOrderReviewRow();
  updateSubmitButtonState();
  updateTimeNotice(orderType, selectedDate, slots, asapEnabled);
  updateStickyCheckoutBar();
  persistOrderDraft();
}

function clearFeedback() {
  stopStatusPolling();
  stopCheckoutFinalizePolling();
  if (resultEl) {
    resultEl.hidden = true;
    resultEl.textContent = "";
  }
  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
}

function showError(message) {
  if (!errorEl) return;
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function showResult(message, referenceText) {
  if (!resultEl) return;
  resultEl.hidden = false;
  resultEl.textContent = "";

  const card = document.createElement("section");
  card.className = "orderResultCard";

  const title = document.createElement("h3");
  title.className = "orderResultTitle";
  title.textContent = "Order sent";
  card.appendChild(title);

  const lead = document.createElement("p");
  lead.className = "orderResultLead";
  lead.textContent = message;
  card.appendChild(lead);

  if (referenceText) {
    const reference = document.createElement("p");
    reference.className = "bookingRef orderResultRef";
    reference.textContent = referenceText;
    card.appendChild(reference);
  }

  const actions = document.createElement("div");
  actions.className = "orderResultActions";

  const trackButton = document.createElement("button");
  trackButton.type = "button";
  trackButton.className = "orderResultActionBtn";
  trackButton.dataset.resultAction = "track";
  trackButton.textContent = "Track order";
  actions.appendChild(trackButton);

  const newOrderButton = document.createElement("button");
  newOrderButton.type = "button";
  newOrderButton.className = "orderResultActionBtn";
  newOrderButton.dataset.resultAction = "new";
  newOrderButton.textContent = "New order";
  actions.appendChild(newOrderButton);

  const callLink = document.createElement("a");
  callLink.className = "orderResultActionBtn isLink";
  callLink.href = "tel:01472828600";
  callLink.textContent = "Call us";
  actions.appendChild(callLink);

  card.appendChild(actions);
  resultEl.appendChild(card);
}

function showCheckoutProcessing(message) {
  if (!resultEl) return;
  resultEl.hidden = false;
  resultEl.textContent = "";

  const card = document.createElement("section");
  card.className = "orderResultCard";

  const title = document.createElement("h3");
  title.className = "orderResultTitle";
  title.textContent = "Secure payment received";
  card.appendChild(title);

  const lead = document.createElement("p");
  lead.className = "orderResultLead";
  lead.textContent = message;
  card.appendChild(lead);

  resultEl.appendChild(card);
}

function stopCheckoutFinalizePolling() {
  if (!checkoutFinalizeTimer) return;
  clearTimeout(checkoutFinalizeTimer);
  checkoutFinalizeTimer = null;
}

function clearCheckoutReturnParams() {
  const url = new URL(window.location.href);
  const hadCheckoutParams = url.searchParams.has("checkout") || url.searchParams.has("session_id");
  if (!hadCheckoutParams) return;

  url.searchParams.delete("checkout");
  url.searchParams.delete("session_id");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, next);
}

function checkoutCartPayload() {
  return cartItems.map((item) => ({
    itemName: item.itemName,
    quantity: Number(item.quantity || 0),
    modifierSelections: (item.modifierSelections || []).map((selection) => ({
      groupName: selection.groupName,
      optionName: selection.optionName,
      isTextInput: Boolean(selection.isTextInput)
    }))
  }));
}

function clearSavedOrderDraft() {
  persistedOrderDraft = createEmptyOrderDraft();
  writeOrderDraft(persistedOrderDraft);
}

function resetAfterSuccessfulCheckout(orderType, preservedPostcode = "") {
  const preservedDate = dateSelect?.value || "";
  const preservedTime = timeSelect?.value || "";

  form?.reset();
  if (orderTypeField) orderTypeField.value = orderType;
  if (postcodeInput) postcodeInput.value = preservedPostcode;
  if (dateSelect) dateSelect.value = preservedDate;

  if (timeSelect) {
    renderTimeOptions();
    if ([...timeSelect.options].some((option) => option.value === preservedTime)) {
      timeSelect.value = preservedTime;
    }
  }

  syncOrderCalendarToSelectedDate();
  updateDeliveryAreaHint();
  clearSavedOrderDraft();
  checkoutAttemptKey = "";
  checkoutAttemptFingerprint = "";
  resetOrderBuilder();
  clearInlineValidation();
  setOrderStep(1, { instant: true, silent: true });
}

function finishCheckoutSuccess(body, orderType, preservedPostcode = "") {
  clearFeedback();
  stopCheckoutFinalizePolling();
  clearCheckoutReturnParams();

  const orderLabel = orderType === "delivery" ? "Delivery" : "Collection";
  const successMessage = body.emailStatus === "pending"
    ? `${orderLabel} order paid and placed. Staff approval is still required. Confirmation email is delayed right now.`
    : `${orderLabel} order paid and placed. We are waiting for staff approval.`;
  const reference = body.reference ? `Reference: ${body.reference}` : "";

  showResult(successMessage, reference);
  setNotice(
    body.emailStatus === "pending"
      ? `${orderLabel} order submitted and paid. Confirmation email is delayed right now.`
      : `${orderLabel} order submitted and paid. Waiting for approval from Millers Café.`,
    false
  );

  if (body.reference && body.trackingToken) {
    startOrderStatusTracking(body.reference, body.trackingToken, orderType);
  }

  resetAfterSuccessfulCheckout(orderType, preservedPostcode);
}

async function fetchCheckoutSessionStatus(sessionId) {
  const params = new URLSearchParams({ session_id: sessionId });
  const response = await fetch(`${CHECKOUT_SESSION_API_BASE}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  let body = {};
  try {
    body = await response.json();
  } catch (error) {
    body = {};
  }

  if (!response.ok) {
    throw new Error(body.error || "Could not verify Stripe checkout status.");
  }

  return body;
}

async function finalizeSuccessfulCheckout(sessionId, orderType, preservedPostcode = "", attempt = 0) {
  const maxAttempts = 20;

  try {
    const body = await fetchCheckoutSessionStatus(sessionId);
    if (body.status === "completed") {
      finishCheckoutSuccess(body, orderType, preservedPostcode);
      return;
    }

    if (body.status === "expired") {
      stopCheckoutFinalizePolling();
      clearCheckoutReturnParams();
      showError("This Stripe checkout session has expired. Please try again.");
      setNotice("Your payment session expired before the order was confirmed.", true);
      return;
    }

    showCheckoutProcessing("Stripe payment succeeded. Finalizing your order with Millers Café now.");
    setNotice("Secure payment received. Finalizing your order now.", false);

    if (attempt >= maxAttempts) {
      stopCheckoutFinalizePolling();
      setNotice("Payment was received, but order confirmation is still syncing. Please refresh this page in a moment.", true);
      return;
    }

    checkoutFinalizeTimer = window.setTimeout(() => {
      finalizeSuccessfulCheckout(sessionId, orderType, preservedPostcode, attempt + 1);
    }, 1500);
  } catch (error) {
    stopCheckoutFinalizePolling();
    showError(error.message || "Could not confirm your paid order right now.");
    setNotice("We couldn't confirm the Stripe checkout result right now. If you've been charged, please call Millers Café.", true);
  }
}

function stopStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
  statusPollKey = "";
}

function formatEtaLabel(etaMinutes, orderType, fallbackDate, fallbackTime) {
  const eta = Number(etaMinutes);
  if (Number.isFinite(eta) && eta >= 0) {
    if (eta === 0) {
      return orderType === "delivery" ? "Driver is heading out now." : "Your order should be ready now.";
    }
    return `Estimated ${orderType === "delivery" ? "delivery" : "collection"} time: about ${eta} minute${eta === 1 ? "" : "s"}.`;
  }

  if (fallbackDate && fallbackTime) {
    return `Estimated time: ${fallbackDate} at ${fallbackTime}.`;
  }
  if (fallbackTime) {
    return `Estimated time: ${fallbackTime}.`;
  }
  return `Estimated ${orderType === "delivery" ? "delivery" : "collection"} time will be confirmed shortly.`;
}

function renderOrderStatusTracker(state) {
  if (!resultEl) return;

  let panel = resultEl.querySelector(".orderStatusTracker");
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "orderStatusTracker";
    panel.innerHTML = [
      "<div class=\"orderStatusHead\">",
      "<strong class=\"orderStatusTitle\">Order status</strong>",
      "<span class=\"orderStatusBadge\">Pending</span>",
      "</div>",
      "<div class=\"orderStatusBody\">",
      "<div class=\"orderStatusSpinner\" aria-hidden=\"true\"><span></span><span></span><span></span></div>",
      "<p class=\"orderStatusMessage\"></p>",
      "</div>"
    ].join("");
    resultEl.appendChild(panel);
  }

  const badge = panel.querySelector(".orderStatusBadge");
  const message = panel.querySelector(".orderStatusMessage");
  const spinner = panel.querySelector(".orderStatusSpinner");

  panel.classList.remove("isPending", "isAccepted", "isRejected");

  if (state.type === "accepted") {
    panel.classList.add("isAccepted");
    if (badge) badge.textContent = "Accepted";
    if (message) message.textContent = state.message;
    if (spinner) spinner.hidden = true;
    return;
  }

  if (state.type === "rejected") {
    panel.classList.add("isRejected");
    if (badge) badge.textContent = "Rejected";
    if (message) message.textContent = state.message;
    if (spinner) spinner.hidden = true;
    return;
  }

  panel.classList.add("isPending");
  if (badge) badge.textContent = "Pending";
  if (message) message.textContent = state.message;
  if (spinner) spinner.hidden = false;
}

async function fetchOrderStatus(reference, trackingToken) {
  const params = new URLSearchParams({ reference });

  const response = await fetch(`${STATUS_API_BASE}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${trackingToken}`
    }
  });

  let body = {};
  try {
    body = await response.json();
  } catch (error) {
    body = {};
  }

  if (!response.ok) {
    throw new Error(body.error || "Could not check order status.");
  }

  return body;
}

function startOrderStatusTracking(reference, trackingToken, orderType) {
  if (!reference || !trackingToken) return;

  stopStatusPolling();
  statusPollKey = `${reference}:${trackingToken}`;

  renderOrderStatusTracker({
    type: "pending",
    message: "We are checking with the team now. Keep this page open for live updates."
  });

  const poll = async () => {
    const activeKey = `${reference}:${trackingToken}`;
    if (statusPollKey !== activeKey) return;

    try {
      const statusData = await fetchOrderStatus(reference, trackingToken);
      const status = String(statusData.status || "submitted").toLowerCase();

      if (status === "accepted") {
        const etaMessage = formatEtaLabel(
          statusData.etaMinutes,
          orderType,
          statusData.decisionDate,
          statusData.decisionTime
        );
        renderOrderStatusTracker({
          type: "accepted",
          message: `Order accepted. ${etaMessage}`
        });
        setNotice("Order accepted by Millers Café.", false);
        stopStatusPolling();
        return;
      }

      if (status === "rejected" || status === "declined" || status === "cancelled") {
        renderOrderStatusTracker({
          type: "rejected",
          message: "Order rejected. Please call Millers Café on 01472 828600 if you need help."
        });
        setNotice("Order was rejected by Millers Café.", true);
        stopStatusPolling();
        return;
      }

      renderOrderStatusTracker({
        type: "pending",
        message: "Awaiting approval from the team. We'll update this automatically."
      });
    } catch (error) {
      renderOrderStatusTracker({
        type: "pending",
        message: "Still waiting for approval. Live updates are reconnecting."
      });
    }
  };

  poll();
  statusPollTimer = setInterval(poll, 5000);
}

function setNotice(message, warning = false) {
  if (!noticeEl) return;
  noticeEl.textContent = message;
  noticeEl.classList.toggle("isWarning", warning);
}

async function preloadAccountProfile() {
  try {
    const response = await fetch("/api/account/me", {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) return;

    let body = {};
    try {
      body = await response.json();
    } catch (error) {
      body = {};
    }

    if (!body?.authenticated || !body.account) return;

    if (nameInput && !nameInput.value && body.account.fullName) {
      nameInput.value = String(body.account.fullName).trim();
    }

    if (emailInput && !emailInput.value && body.account.email) {
      emailInput.value = String(body.account.email).trim();
      validateEmailField();
    }

    if (phoneInput && !phoneInput.value && body.account.phoneNumber) {
      phoneInput.value = String(body.account.phoneNumber).trim();
      normalizePhoneField();
      validatePhoneField();
    }

    const savedAddress = body.account?.profile?.defaultDeliveryAddress;
    if (savedAddress && typeof savedAddress === "object") {
      if (address1Input && !address1Input.value && savedAddress.addressLine1) {
        address1Input.value = String(savedAddress.addressLine1).trim();
      }
      if (address2Input && !address2Input.value && savedAddress.addressLine2) {
        address2Input.value = String(savedAddress.addressLine2).trim();
      }
      if (townInput && !townInput.value && savedAddress.townCity) {
        townInput.value = String(savedAddress.townCity).trim();
      }
      if (postcodeInput && !postcodeInput.value && savedAddress.postcode) {
        postcodeInput.value = String(savedAddress.postcode).trim();
        normalizePostcodeField();
        updateDeliveryAreaHint();
        validatePostcodeField();
      }
    }
  } catch (error) {
    // Ignore account prefill failures so checkout still works when auth is unavailable.
  }
}

function setSubmitting(submitting) {
  if (!submitBtn) return;
  isSubmitting = Boolean(submitting);
  updateSubmitButtonState();
  updateOrderFlowStepLabels();
}

function updateSubmitButtonState() {
  if (!submitBtn) return;
  const idleLabel = "Continue to secure payment";
  submitBtn.disabled = !onlineOrderingEnabled || isSubmitting || !hasSelectableTime || cartItems.length === 0;
  submitBtn.textContent = !onlineOrderingEnabled
    ? "Online ordering paused"
    : (isSubmitting ? "Redirecting..." : idleLabel);
  updateStickyCheckoutBar();
}

function updateTimeNotice(orderType, isoDate, slots, asapEnabled) {
  const label = orderType === "delivery" ? "Delivery" : "Collection";
  const isToday = isoDate === ukTodayISODate();
  if (!isToday) {
    setNotice(`${label} hours: ${orderOpenDaySummary()}, ${orderHoursSummary()}. ${label} slots are in ${orderIntervalSummary()}.`, false);
    return;
  }

  if (!asapEnabled && slots.length === 0) {
    setNotice(
      currentOrderStep === 1
        ? "No slots are left today. Continue to choose another date."
        : "No slots are left today. Choose another date above.",
      true
    );
    return;
  }

  const lead = leadMinutesForOrderType(orderType);
  const earliest = slots[0] ? ` Earliest scheduled slot: ${slots[0]}.` : "";
  setNotice(`${label} defaults to ASAP today. Scheduled times must be at least ${lead} minutes from now.${earliest}`, false);
}

function itemHasModifiers(item) {
  return Array.isArray(item?.modifierGroups) && item.modifierGroups.length > 0;
}

function itemHasRequiredModifiers(item) {
  return itemHasModifiers(item) && item.modifierGroups.some((group) => Boolean(group?.isRequired));
}

function normalizeMenuCatalog(rawCatalog) {
  if (!Array.isArray(rawCatalog)) return [];

  return rawCatalog
    .map((category) => {
      const categoryName = normalizeText(category?.name);
      const categoryKey = normalizeKey(categoryName);
      const categoryId = normalizeText(category?.id || category?.posCategoryId || category?.categoryId);
      if (!categoryName || !Array.isArray(category?.items)) return null;
      if (HIDDEN_ORDER_CATEGORY_KEYS.has(categoryKey)) return null;

      const items = category.items
        .map((item, itemIndex) => {
          const itemName = normalizeText(item?.name);
          const basePrice = Number(item?.basePrice);
          if (!itemName || !Number.isFinite(basePrice) || basePrice < 0) return null;

          const modifierGroups = Array.isArray(item?.modifierGroups)
            ? item.modifierGroups
              .map((group) => {
                const groupName = normalizeText(group?.name);
                if (!groupName) return null;
                const groupId = normalizeText(group?.id || group?.posModifierGroupId || group?.groupId);

                const selectionType = normalizeText(group?.selectionType).toLowerCase() === "multiple"
                  ? "multiple"
                  : "single";

                const options = Array.isArray(group?.options)
                  ? group.options
                    .map((option) => {
                      const optionName = normalizeText(option?.name);
                      const priceAdjustment = Number(option?.priceAdjustment || 0);
                      if (!optionName || !Number.isFinite(priceAdjustment)) return null;
                      const optionId = normalizeText(option?.id || option?.posModifierOptionId || option?.optionId);
                      const normalizedOption = {
                        name: optionName,
                        priceAdjustment: roundMoney(priceAdjustment),
                        dietaryEffect: normalizeText(option?.dietaryEffect || "inherit").toLowerCase(),
                        allergenCodes: Array.isArray(option?.allergenCodes)
                          ? option.allergenCodes.map((code) => normalizeText(code).toUpperCase()).filter(Boolean)
                          : [],
                        removesAllergenCodes: Array.isArray(option?.removesAllergenCodes)
                          ? option.removesAllergenCodes.map((code) => normalizeText(code).toUpperCase()).filter(Boolean)
                          : []
                      };
                      if (optionId) {
                        normalizedOption.id = optionId;
                        normalizedOption.posModifierOptionId = normalizeText(option?.posModifierOptionId || optionId);
                      }
                      return normalizedOption;
                    })
                    .filter(Boolean)
                  : [];

                const maxSelectionsRaw = Number(group?.maxSelections);
                const computedMax = selectionType === "multiple"
                  ? (Number.isInteger(maxSelectionsRaw) && maxSelectionsRaw > 0 ? maxSelectionsRaw : Math.max(1, options.length))
                  : 1;

                const normalizedGroup = {
                  name: groupName,
                  selectionType,
                  isRequired: Boolean(group?.isRequired),
                  isTextInput: Boolean(group?.isTextInput),
                  affectsDietarySuitability: Boolean(group?.affectsDietarySuitability),
                  maxSelections: computedMax,
                  options
                };
                if (groupId) {
                  normalizedGroup.id = groupId;
                  normalizedGroup.posModifierGroupId = normalizeText(group?.posModifierGroupId || groupId);
                }
                return normalizedGroup;
              })
              .filter(Boolean)
            : [];

          const tags = Array.isArray(item?.tags)
            ? item.tags.map((tag) => normalizeText(tag)).filter(Boolean)
            : [];
          const codes = Array.isArray(item?.codes)
            ? item.codes.map((code) => normalizeText(code).toUpperCase()).filter(Boolean)
            : [];

          const itemId = normalizeText(item?.id || item?.posItemId || item?.itemId) ||
            createMenuItemId(categoryKey, itemName, itemIndex);
          const allergens = getMenuItemAllergenLabels({ codes });
          const dietarySuitability = normalizeText(item?.dietarySuitability).toLowerCase();
          return {
            id: itemId,
            posItemId: normalizeText(item?.posItemId || itemId),
            posCategoryId: normalizeText(item?.posCategoryId || category?.posCategoryId || categoryId),
            categoryName,
            printRouting: normalizeText(item?.printRouting),
            menuVersion: normalizeText(item?.menuVersion),
            name: itemName,
            description: normalizeText(item?.description),
            basePrice: roundMoney(basePrice),
            discountEligible: item?.discountEligible !== false,
            modifierGroups,
            tags,
            codes,
            allergens,
            dietarySuitability,
            searchText: normalizeText([
              itemName,
              item?.description,
              categoryName,
              dietarySuitability,
              ...allergens,
              ...tags,
              ...codes
            ].join(" ")).toLowerCase()
          };
        })
        .filter(Boolean);

      if (items.length === 0) return null;

      return {
        id: categoryId,
        posCategoryId: normalizeText(category?.posCategoryId || categoryId),
        name: categoryName,
        categoryKey,
        items
      };
    })
    .filter(Boolean);
}

function menuCategoryDisplayName(categoryName) {
  const normalizedName = normalizeText(categoryName);
  return MENU_CATEGORY_DISPLAY_LABELS[normalizedName] || normalizedName;
}

function menuGroupForCategory(categoryName) {
  const categoryKey = normalizeKey(categoryName);
  return DESKTOP_ORDER_MENU_GROUPS.find((group) => (
    Array.isArray(group.categories)
    && group.categories.some((name) => normalizeKey(name) === categoryKey)
  )) || null;
}

function orderedNormalizedMenuCategories() {
  const indexedCategories = normalizedMenu.map((category, categoryIndex) => ({
    category,
    categoryIndex
  }));
  const configuredOrder = new Map(
    DESKTOP_ORDER_MENU_GROUPS
      .flatMap((group) => Array.isArray(group.categories) ? group.categories : [])
      .map((name, index) => [normalizeKey(name), index])
  );

  return indexedCategories.sort((left, right) => {
    const leftRank = configuredOrder.get(normalizeKey(left.category.name));
    const rightRank = configuredOrder.get(normalizeKey(right.category.name));
    if (leftRank === undefined && rightRank === undefined) return left.categoryIndex - right.categoryIndex;
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    return leftRank - rightRank;
  });
}

function allMenuEntries() {
  const entries = [];
  orderedNormalizedMenuCategories().forEach(({ category, categoryIndex }) => {
    category.items.forEach((item, itemIndex) => {
      entries.push({
        categoryName: category.name,
        categoryKey: category.categoryKey,
        categoryIndex,
        itemIndex,
        item
      });
    });
  });
  return entries;
}

function entriesForDesktopMenuGroup(group, entries = allMenuEntries()) {
  const itemNameOrder = (group?.itemNames || []).map((name) => normalizeKey(name));
  const itemNames = new Set(itemNameOrder);
  const categories = new Set((group?.categories || []).map((name) => normalizeKey(name)));
  const matched = entries.filter((entry) => (
    itemNames.has(normalizeKey(entry.item.name))
    || categories.has(normalizeKey(entry.categoryName))
  ));
  if (itemNameOrder.length === 0) return matched;
  return itemNameOrder
    .map((itemName) => matched.find((entry) => normalizeKey(entry.item.name) === itemName))
    .filter(Boolean);
}

function desktopMenuGroups() {
  const entries = allMenuEntries();
  return DESKTOP_ORDER_MENU_GROUPS
    .map((group) => ({
      ...group,
      entries: entriesForDesktopMenuGroup(group, entries)
    }))
    .filter((group) => group.entries.length > 0);
}

function menuNavigationItems() {
  if (isMobileOrderMenuLayout()) {
    return orderedNormalizedMenuCategories().map(({ category }) => ({
      label: category.name,
      intro: "",
      icon: "../assets/icon-tools-kitchen.svg"
    }));
  }
  return desktopMenuGroups();
}

function categoryNames() {
  return menuNavigationItems().map((item) => item.label);
}

function defaultCategoryName() {
  return categoryNames()[0] || "";
}

function applyMenuCategoryDeepLink() {
  const resolvedView = resolveOrderMenuView(
    { selectedCategory, searchQuery },
    window.location.hash,
    categoryNames()
  );
  if (!resolvedView.deepLinked) return false;

  selectedCategory = resolvedView.selectedCategory;
  mobileOpenCategory = resolvedView.selectedCategory;
  searchQuery = resolvedView.searchQuery;
  if (menuSearchInput) menuSearchInput.value = searchQuery;
  return true;
}

function activeDesktopMenuGroup() {
  return desktopMenuGroups().find((group) => group.label === selectedCategory) || null;
}

function menuItemForCartItem(cartItem) {
  const itemId = normalizeText(cartItem?.itemId || cartItem?.posItemId);
  const itemNameKey = normalizeKey(cartItem?.itemName);
  for (const category of normalizedMenu) {
    const matched = category.items.find((item) =>
      (itemId && (item.id === itemId || item.posItemId === itemId)) ||
      (itemNameKey && normalizeKey(item.name) === itemNameKey)
    );
    if (matched) return matched;
  }
  return null;
}

function menuEntryMatchesQuery(entry, query) {
  if (!query) return true;
  return String(entry.item.searchText || "").includes(query);
}

function menuEntriesForView() {
  const entries = allMenuEntries();
  const query = searchQuery.toLowerCase();
  if (query) {
    return entries.filter((entry) => menuEntryMatchesQuery(entry, query));
  }

  const activeCategory = selectedCategory || defaultCategoryName();
  if (isMobileOrderMenuLayout()) {
    return entries.filter((entry) => entry.categoryName === activeCategory);
  }

  const group = desktopMenuGroups().find((entry) => entry.label === activeCategory);
  return group ? group.entries : [];
}

function entryRequiresCustomize(entry) {
  return FORCE_CUSTOMIZE_CATEGORY_KEYS.has(entry.categoryKey) || itemHasRequiredModifiers(entry.item);
}

function itemBadgeDescriptors(entry, modifierSelections = []) {
  const tags = new Set((entry.item.tags || []).map((tag) => normalizeKey(tag)));
  const descriptors = [];

  if (tags.has("popular")) {
    descriptors.push({ label: "Popular", className: "isPopular" });
  }
  if (tags.has("spicy") || tags.has("hot") || tags.has("very hot")) {
    descriptors.push({ label: "Spicy", className: "isSpicy" });
  }
  const dietary = getMenuItemDietaryDisplay(entry.item, modifierSelections);
  if (dietary) {
    descriptors.push({
      label: dietary.label,
      className: dietary.confirmed ? "isVeg" : "isDietaryOption"
    });
  }

  return descriptors.slice(0, 3);
}

function activeCategoryFromViewport() {
  if (menuCardElements.length === 0) return "";

  const viewportOffset = stickyCheckoutBar?.classList.contains("isVisible")
    ? Math.max(stickyCheckoutBar.getBoundingClientRect().height + 32, 120)
    : 120;

  let fallbackCategory = menuCardElements[0]?.dataset.category || "";
  for (const card of menuCardElements) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom <= viewportOffset) continue;
    fallbackCategory = card.dataset.category || fallbackCategory;
    break;
  }

  return fallbackCategory;
}

function updateActiveCategoryPill(force = false) {
  if (!orderActiveCategoryPill) return;

  if (isMobileOrderMenuLayout() && !searchQuery) {
    orderActiveCategoryPill.hidden = true;
    orderActiveCategoryPill.textContent = "";
    if (orderActiveCategoryIntro) {
      orderActiveCategoryIntro.hidden = true;
      orderActiveCategoryIntro.textContent = "";
    }
    lastActiveCategoryPillText = "";
    return;
  }

  let category = "";
  if (searchQuery) {
    category = activeCategoryFromViewport();
  } else {
    category = selectedCategory || defaultCategoryName();
  }

  if (!category) {
    orderActiveCategoryPill.hidden = true;
    orderActiveCategoryPill.textContent = "";
    if (orderActiveCategoryIntro) {
      orderActiveCategoryIntro.hidden = true;
      orderActiveCategoryIntro.textContent = "";
    }
    lastActiveCategoryPillText = "";
    return;
  }

  const text = searchQuery ? `Search results · ${category}` : category;
  if (!force && text === lastActiveCategoryPillText) return;

  lastActiveCategoryPillText = text;
  orderActiveCategoryPill.hidden = false;
  orderActiveCategoryPill.textContent = text;
  if (orderActiveCategoryIntro) {
    const group = activeDesktopMenuGroup();
    orderActiveCategoryIntro.hidden = false;
    orderActiveCategoryIntro.textContent = searchQuery
      ? "Matching dishes from across the Millers menu."
      : (group?.intro || "Choose a dish and make it yours.");
  }
}

function queueActiveCategoryPillSync() {
  if (!searchQuery) return;
  if (activeCategorySyncRaf) cancelAnimationFrame(activeCategorySyncRaf);
  activeCategorySyncRaf = requestAnimationFrame(() => {
    activeCategorySyncRaf = null;
    updateActiveCategoryPill();
  });
}

function renderCategoryChips() {
  if (!menuCategoryChips) return;

  const navigationItems = menuNavigationItems();
  const names = navigationItems.map((item) => item.label);
  if (names.length === 0) {
    selectedCategory = "";
    menuCategoryChips.innerHTML = "";
    return;
  }
  if (!names.includes(selectedCategory)) {
    const parentGroup = menuGroupForCategory(selectedCategory);
    const selectedGroup = DESKTOP_ORDER_MENU_GROUPS.find((group) => group.label === selectedCategory);
    const mappedCategory = selectedGroup?.categories?.find((categoryName) => names.includes(categoryName));
    selectedCategory = names.includes(parentGroup?.label)
      ? parentGroup.label
      : (mappedCategory || names[0]);
  }

  menuCategoryChips.innerHTML = "";
  navigationItems.forEach((item) => {
    const name = item.label;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "orderCategoryChip";
    if (name === selectedCategory) {
      button.classList.add("isActive");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }
    button.tabIndex = name === selectedCategory ? 0 : -1;
    button.dataset.category = name;
    const icon = document.createElement("img");
    icon.className = "orderCategoryChipIcon";
    icon.src = item.icon || "../assets/icon-tools-kitchen.svg";
    icon.alt = "";
    icon.width = 20;
    icon.height = 20;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = name;
    button.append(icon, label);
    menuCategoryChips.appendChild(button);
  });
}

function handleMenuCategoryKeydown(event) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.matches("button[data-category]")) return;

  const buttons = [...menuCategoryChips.querySelectorAll("button[data-category]")];
  const currentIndex = buttons.indexOf(target);
  if (currentIndex < 0 || buttons.length === 0) return;

  const vertical = !isMobileOrderMenuLayout();
  let nextIndex = currentIndex;
  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = buttons.length - 1;
  else if ((vertical && event.key === "ArrowUp") || (!vertical && event.key === "ArrowLeft")) {
    nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
  } else if ((vertical && event.key === "ArrowDown") || (!vertical && event.key === "ArrowRight")) {
    nextIndex = (currentIndex + 1) % buttons.length;
  } else {
    return;
  }

  event.preventDefault();
  buttons[nextIndex]?.click();
}

function createMenuActionButton(label, actionType, entry, secondary = false, single = false, countable = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = secondary ? "orderMenuAdd orderMenuCustomize" : "orderMenuAdd";
  button.classList.add("orderMenuActionBtn");
  if (single) {
    button.classList.add("isSingle");
  }

  button.dataset.actionType = actionType;
  button.dataset.categoryIndex = String(entry.categoryIndex);
  button.dataset.itemIndex = String(entry.itemIndex);
  button.dataset.itemId = entry.item.id;
  button.dataset.baseLabel = label;

  if (actionType === "add") {
    const icon = document.createElement("img");
    icon.className = "orderMenuAddIcon";
    icon.src = "../assets/icon-plus.svg";
    icon.alt = "";
    icon.width = 17;
    icon.height = 17;
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
  }

  const text = document.createElement("span");
  text.className = "orderMenuAddText";
  text.textContent = label;
  button.appendChild(text);

  if (countable) {
    const badge = document.createElement("span");
    badge.className = "orderMenuAddCount";
    badge.dataset.itemCount = entry.item.id;
    badge.hidden = true;
    badge.setAttribute("aria-hidden", "true");
    button.appendChild(badge);
  }

  return button;
}

function buildMenuCard(entry) {
  const article = document.createElement("article");
  article.className = "orderMenuCard";
  article.dataset.category = searchQuery || isMobileOrderMenuLayout()
    ? entry.categoryName
    : (selectedCategory || entry.categoryName);
  article.dataset.itemId = entry.item.id;
  article.dataset.itemName = entry.item.name;

  const main = document.createElement("div");
  main.className = "orderMenuMain";

  const top = document.createElement("div");
  top.className = "orderMenuTop";

  const name = document.createElement("strong");
  name.className = "orderMenuName";
  name.textContent = entry.item.name;

  const price = document.createElement("span");
  price.className = "orderMenuPrice";
  price.textContent = formatGBP(entry.item.basePrice);

  top.appendChild(name);
  top.appendChild(price);

  const badgeDescriptors = itemBadgeDescriptors(entry);
  const badgeWrap = document.createElement("div");
  badgeWrap.className = "orderMenuBadges";
  badgeDescriptors.forEach((descriptor) => {
    const badge = document.createElement("span");
    badge.className = `orderMenuBadge ${descriptor.className}`;
    badge.textContent = descriptor.label;
    badgeWrap.appendChild(badge);
  });

  const selectedBadge = document.createElement("span");
  selectedBadge.className = "orderMenuBadge orderMenuSelectionBadge";
  selectedBadge.dataset.selectedBadge = entry.item.id;
  selectedBadge.hidden = true;
  badgeWrap.appendChild(selectedBadge);

  main.appendChild(top);
  if (badgeDescriptors.length > 0 || selectedBadge) {
    main.appendChild(badgeWrap);
  }

  const descriptionText = getOrderItemDescription(entry.item.name, entry.item.description);
  if (descriptionText) {
    const description = document.createElement("p");
    description.className = "orderMenuDescription";
    description.textContent = descriptionText;
    main.appendChild(description);
  }

  const allergenLabels = getMenuItemAllergenLabels(entry.item);
  if (allergenLabels.length > 0) {
    const allergens = document.createElement("p");
    allergens.className = "orderMenuAllergens";
    allergens.textContent = `Contains: ${allergenLabels.join(", ")}`;
    main.appendChild(allergens);
  }

  const meta = document.createElement("div");
  meta.className = "orderMenuMeta";

  const hasModifiers = itemHasModifiers(entry.item);
  const requiresCustomize = entryRequiresCustomize(entry);
  if (requiresCustomize) {
    meta.textContent = `${entry.categoryName} • Customize required`;
  } else if (hasModifiers) {
    meta.textContent = `${entry.categoryName} • Customize optional`;
  } else {
    meta.textContent = entry.categoryName;
  }

  main.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "orderMenuActions";

  if (hasModifiers && !requiresCustomize) {
    actions.appendChild(createMenuActionButton("Customize", "customize", entry, true));
  }

  const primaryLabel = requiresCustomize ? "Customize" : "Add";
  const primaryAction = requiresCustomize ? "customize" : "add";
  const singleButton = !hasModifiers || requiresCustomize;
  actions.appendChild(createMenuActionButton(primaryLabel, primaryAction, entry, false, singleButton, true));

  article.appendChild(main);
  article.appendChild(actions);
  return article;
}

function updateOrderMenuStatus(itemCount) {
  if (!orderMenuStatus) return;
  const count = Math.max(0, Number(itemCount || 0));
  orderMenuStatus.textContent = searchQuery
    ? `${count} menu item${count === 1 ? "" : "s"} match “${searchQuery}”.`
    : `${count} menu item${count === 1 ? "" : "s"} available.`;
}

function renderMobileMenuSections() {
  if (!menuItemsList) return;

  const query = searchQuery.toLowerCase();
  menuItemsList.innerHTML = "";
  menuCardElements = [];
  const fragment = document.createDocumentFragment();

  let renderedSections = 0;
  let renderedItems = 0;
  const mobileGroupBodies = new Map();

  orderedNormalizedMenuCategories().forEach(({ category, categoryIndex }) => {
    const entries = category.items
      .map((item, itemIndex) => ({
        categoryName: category.name,
        categoryKey: category.categoryKey,
        categoryIndex,
        itemIndex,
        item
      }))
      .filter((entry) => menuEntryMatchesQuery(entry, query));

    if (entries.length === 0) return;
    renderedSections += 1;
    renderedItems += entries.length;

    const section = document.createElement("section");
    section.className = "orderMobileCategorySection";
    section.dataset.category = category.name;

    const isOpen = Boolean(query) || mobileOpenCategory === category.name;
    if (isOpen) {
      section.classList.add("isOpen");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "orderMobileCategoryToggle";
    button.dataset.mobileCategory = category.name;
    button.setAttribute("aria-expanded", isOpen ? "true" : "false");

    const title = document.createElement("span");
    title.className = "orderMobileCategoryName";
    title.textContent = menuCategoryDisplayName(category.name);

    const meta = document.createElement("span");
    meta.className = "orderMobileCategoryCount";
    meta.textContent = `${entries.length} item${entries.length === 1 ? "" : "s"}`;

    button.appendChild(title);
    button.appendChild(meta);
    section.appendChild(button);

    if (isOpen) {
      const items = document.createElement("div");
      items.className = "orderMobileCategoryItems";
      entries.forEach((entry) => {
        const card = buildMenuCard(entry);
        menuCardElements.push(card);
        items.appendChild(card);
      });
      section.appendChild(items);
    }

    const parentGroup = menuGroupForCategory(category.name);
    const shouldGroup = Boolean(parentGroup && parentGroup.categories.length > 1);
    if (shouldGroup) {
      let groupBody = mobileGroupBodies.get(parentGroup.label);
      if (!groupBody) {
        const groupSlug = normalizeKey(parentGroup.label).replace(/\s+/g, "-");
        const groupTitleId = `orderMobileMenuGroup-${groupSlug}`;
        const mobileGroup = document.createElement("section");
        mobileGroup.className = "orderMobileMenuGroup";
        mobileGroup.dataset.menuGroup = parentGroup.label;
        mobileGroup.setAttribute("aria-labelledby", groupTitleId);

        const groupTitle = document.createElement("h2");
        groupTitle.id = groupTitleId;
        groupTitle.className = "orderMobileMenuGroupTitle";
        groupTitle.textContent = parentGroup.label;

        const groupIntro = document.createElement("p");
        groupIntro.className = "orderMobileMenuGroupIntro";
        groupIntro.textContent = parentGroup.intro;

        groupBody = document.createElement("div");
        groupBody.className = "orderMobileMenuGroupBody";
        mobileGroup.append(groupTitle, groupIntro, groupBody);
        mobileGroupBodies.set(parentGroup.label, groupBody);
        fragment.appendChild(mobileGroup);
      }
      groupBody.appendChild(section);
    } else {
      fragment.appendChild(section);
    }
  });

  if (renderedSections === 0) {
    const empty = document.createElement("div");
    empty.className = "orderMenuEmpty";
    empty.textContent = "No menu items match this search.";
    fragment.appendChild(empty);
  }

  menuItemsList.appendChild(fragment);

  syncMenuItemSelectionState();
  updateActiveCategoryPill(true);
  updateOrderMenuStatus(renderedItems);
}

function renderMenuItems() {
  if (!menuItemsList) return;

  hideModifierPanel();

  if (isMobileOrderMenuLayout()) {
    renderMobileMenuSections();
    return;
  }

  const entries = menuEntriesForView();
  menuItemsList.innerHTML = "";
  menuCardElements = [];

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "orderMenuEmpty";
    empty.textContent = "No menu items match this filter.";
    menuItemsList.appendChild(empty);
    updateActiveCategoryPill(true);
    updateOrderMenuStatus(0);
    return;
  }

  const fragment = document.createDocumentFragment();
  const activeGroup = activeDesktopMenuGroup();
  const showCategoryHeadings = Boolean(activeGroup?.showCategoryHeadings && !searchQuery);
  let renderedCategoryName = "";
  entries.forEach((entry) => {
    if (showCategoryHeadings && entry.categoryName !== renderedCategoryName) {
      renderedCategoryName = entry.categoryName;
      const heading = document.createElement("h3");
      heading.className = "orderMenuSubcategoryHeading";
      heading.textContent = menuCategoryDisplayName(entry.categoryName);
      fragment.appendChild(heading);
    }
    const card = buildMenuCard(entry);
    menuCardElements.push(card);
    fragment.appendChild(card);
  });
  menuItemsList.appendChild(fragment);

  syncMenuItemSelectionState();
  updateActiveCategoryPill(true);
  updateOrderMenuStatus(entries.length);
}

function clearModifierError() {
  if (!modifierError) return;
  modifierError.hidden = true;
  modifierError.textContent = "";
}

function showModifierError(message) {
  if (!modifierError) return;
  modifierError.hidden = false;
  modifierError.textContent = message;
}

function hideModifierPanel(options = {}) {
  document.body.classList.remove("isModifierOpen");
  if (!modifierPanel) return;

  const restoreTarget = activeDraftAnchor?.querySelector("button.orderMenuActionBtn")
    || activeDraftAnchor;

  modifierPanel.hidden = true;
  if (modifierFields) modifierFields.innerHTML = "";
  clearModifierError();

  if (orderHub && modifierPanel.parentElement !== orderHub) {
    orderHub.appendChild(modifierPanel);
  }

  activeDraft = null;
  activeDraftAnchor = null;
  if (options.restoreFocus) {
    window.requestAnimationFrame(() => {
      if (restoreTarget instanceof HTMLElement && restoreTarget.isConnected) {
        restoreTarget.focus({ preventScroll: true });
      } else {
        menuSearchInput?.focus({ preventScroll: true });
      }
    });
  }
}

function positionModifierPanel() {
  if (!modifierPanel) return;

  if (modifierPanel.parentElement !== document.body) {
    document.body.appendChild(modifierPanel);
  }
}

function modifierFocusableControls() {
  if (!modifierPanel || modifierPanel.hidden) return [];
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])'
  ].join(",");
  return [...modifierPanel.querySelectorAll(selector)].filter((element) => (
    element instanceof HTMLElement && !element.closest("[hidden]")
  ));
}

function handleModifierPanelKeydown(event) {
  if (!modifierPanel || modifierPanel.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    hideModifierPanel({ restoreFocus: true });
    return;
  }

  if (event.key !== "Tab") return;
  const controls = modifierFocusableControls();
  if (controls.length === 0) {
    event.preventDefault();
    return;
  }

  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function modifierOptionLabel(option) {
  if (!option) return "";
  const adjustment = Number(option.priceAdjustment || 0);
  const priceLabel = adjustment === 0
    ? ""
    : ` (${adjustment > 0 ? "+" : "-"}${formatGBP(Math.abs(adjustment))})`;
  const allergenLabels = getMenuItemAllergenLabels({ codes: option.allergenCodes });
  const allergenLabel = allergenLabels.length > 0
    ? ` · Contains ${allergenLabels.join(", ")}`
    : "";
  return `${option.name}${priceLabel}${allergenLabel}`;
}

function createModifierGroupField(group, groupIndex) {
  const wrapper = document.createElement("fieldset");
  wrapper.className = "orderModifierGroup";
  wrapper.dataset.groupIndex = String(groupIndex);

  const legend = document.createElement("legend");
  legend.className = "orderModifierLegend";
  legend.textContent = group.name;
  wrapper.appendChild(legend);

  const helper = document.createElement("p");
  helper.className = "orderModifierHint";
  const maxText = group.selectionType === "multiple" ? ` (max ${group.maxSelections})` : "";
  const requiredText = group.isRequired ? "Required" : "Optional";
  helper.textContent = `${requiredText}${maxText}`;
  wrapper.appendChild(helper);

  if (group.isTextInput) {
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 120;
    input.className = "orderModifierText";
    input.dataset.groupIndex = String(groupIndex);
    input.placeholder = `Enter ${group.name.toLowerCase()}`;
    if (group.isRequired) input.required = true;
    wrapper.appendChild(input);
    return wrapper;
  }

  if (group.selectionType === "multiple") {
    const optionsWrap = document.createElement("div");
    optionsWrap.className = "orderModifierOptions";

    group.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "orderModifierOption";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.groupIndex = String(groupIndex);
      checkbox.dataset.optionIndex = String(optionIndex);

      const text = document.createElement("span");
      text.className = "orderModifierOptionText";
      text.textContent = modifierOptionLabel(option);

      label.appendChild(checkbox);
      label.appendChild(text);
      optionsWrap.appendChild(label);
    });

    wrapper.appendChild(optionsWrap);
    return wrapper;
  }

  const select = document.createElement("select");
  select.className = "orderModifierSelect";
  select.dataset.groupIndex = String(groupIndex);
  select.setAttribute("aria-label", group.name);

  if (!group.isRequired) {
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "No selection";
    select.appendChild(noneOption);
  }

  group.options.forEach((option, optionIndex) => {
    const optionEl = document.createElement("option");
    optionEl.value = String(optionIndex);
    optionEl.textContent = modifierOptionLabel(option);
    select.appendChild(optionEl);
  });

  if (group.isRequired && group.options.length > 0) {
    const preferredIndex = getPreferredModifierOptionIndex(activeDraft?.item, group);
    if (preferredIndex >= 0) {
      select.value = String(preferredIndex);
    }
  }

  wrapper.appendChild(select);
  return wrapper;
}

function startItemDraft(item, quantity = 1, anchorCard = null) {
  clearFeedback();
  clearModifierError();

  if (!item) {
    showError("Please choose a valid item.");
    return;
  }

  activeDraft = {
    item,
    quantity: Math.max(1, Math.min(MAX_ITEM_QUANTITY, Number(quantity || 1)))
  };
  activeDraftAnchor = anchorCard instanceof HTMLElement ? anchorCard : null;

  const groups = item.modifierGroups || [];
  if (groups.length === 0) {
    addItemToCart(item, [], activeDraft.quantity, false);
    activeDraft = null;
    activeDraftAnchor = null;
    return;
  }

  if (modifierTitle) {
    modifierTitle.textContent = `${item.name} x${activeDraft.quantity}`;
  }

  if (modifierFields) {
    modifierFields.innerHTML = "";
    groups.forEach((group, index) => {
      modifierFields.appendChild(createModifierGroupField(group, index));
    });
  }

  positionModifierPanel();
  if (modifierPanel) {
    modifierPanel.hidden = false;
    document.body.classList.add("isModifierOpen");
    window.requestAnimationFrame(() => {
      const firstControl = modifierPanel.querySelector("input, select, textarea, button:not([disabled])");
      if (firstControl instanceof HTMLElement) firstControl.focus({ preventScroll: true });
    });
  }
}

function selectedModifiersFromDraft() {
  if (!activeDraft || !Array.isArray(activeDraft.item?.modifierGroups)) {
    return { ok: false, error: "No item selected." };
  }

  const selections = [];
  const groups = activeDraft.item.modifierGroups;

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];

    if (group.isTextInput) {
      const input = modifierFields?.querySelector(`input[data-group-index="${groupIndex}"]`);
      const text = normalizeText(input?.value || "");

      if (group.isRequired && text.length === 0) {
        return { ok: false, error: `${group.name} is required.` };
      }

      if (text.length > 0) {
        selections.push({
          posModifierGroupId: group.posModifierGroupId || group.id || "",
          posModifierOptionId: "",
          groupName: group.name,
          optionName: text,
          priceAdjustment: 0,
          isTextInput: true
        });
      }

      continue;
    }

    if (group.selectionType === "multiple") {
      const checked = [...(modifierFields?.querySelectorAll(`input[type="checkbox"][data-group-index="${groupIndex}"]:checked`) || [])];

      if (group.isRequired && checked.length === 0) {
        return { ok: false, error: `Please select at least one option for ${group.name}.` };
      }

      if (checked.length > group.maxSelections) {
        return { ok: false, error: `You can select up to ${group.maxSelections} option(s) for ${group.name}.` };
      }

      checked.forEach((checkbox) => {
        const optionIndex = Number(checkbox.dataset.optionIndex);
        if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= group.options.length) return;

        const option = group.options[optionIndex];
        selections.push({
          posModifierGroupId: group.posModifierGroupId || group.id || "",
          posModifierOptionId: option.posModifierOptionId || option.id || "",
          groupName: group.name,
          optionName: option.name,
          priceAdjustment: Number(option.priceAdjustment || 0),
          allergenCodes: Array.isArray(option.allergenCodes) ? option.allergenCodes.slice() : [],
          removesAllergenCodes: Array.isArray(option.removesAllergenCodes) ? option.removesAllergenCodes.slice() : [],
          isTextInput: false
        });
      });

      continue;
    }

    const select = modifierFields?.querySelector(`select[data-group-index="${groupIndex}"]`);
    const raw = String(select?.value || "");

    if (raw.length === 0) {
      if (group.isRequired) {
        return { ok: false, error: `${group.name} is required.` };
      }
      continue;
    }

    const optionIndex = Number(raw);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= group.options.length) {
      return { ok: false, error: `Please choose a valid option for ${group.name}.` };
    }

    const option = group.options[optionIndex];
    selections.push({
      posModifierGroupId: group.posModifierGroupId || group.id || "",
      posModifierOptionId: option.posModifierOptionId || option.id || "",
      groupName: group.name,
      optionName: option.name,
      priceAdjustment: Number(option.priceAdjustment || 0),
      allergenCodes: Array.isArray(option.allergenCodes) ? option.allergenCodes.slice() : [],
      removesAllergenCodes: Array.isArray(option.removesAllergenCodes) ? option.removesAllergenCodes.slice() : [],
      isTextInput: false
    });
  }

  return {
    ok: true,
    selections
  };
}

function cartLineTotals(basePrice, selections, quantity) {
  const modifierTotal = selections.reduce((sum, entry) => sum + Number(entry.priceAdjustment || 0), 0);
  const unitPrice = roundMoney(basePrice + modifierTotal);
  const linePrice = roundMoney(unitPrice * quantity);
  return { unitPrice, linePrice };
}

function cartLineSignature(itemKey, modifierSelections) {
  const modKey = (modifierSelections || [])
    .map((entry) => `${entry.posModifierGroupId || entry.groupName}::${entry.posModifierOptionId || entry.optionName}::${Number(entry.priceAdjustment || 0).toFixed(2)}::${entry.isTextInput ? 1 : 0}`)
    .sort()
    .join("||");
  return `${String(itemKey || "").trim() || "item"}__${modKey}`;
}

function recalculateCartItem(item) {
  const quantity = Math.max(1, Math.min(MAX_ITEM_QUANTITY, Number(item.quantity || 1)));
  const totals = cartLineTotals(item.basePrice, item.modifierSelections || [], quantity);
  item.quantity = quantity;
  item.unitPrice = totals.unitPrice;
  item.linePrice = totals.linePrice;
}

function createEmptyOrderDraft() {
  return createEmptyOrderDraftState({
    orderDraftVersion: ORDER_DRAFT_VERSION
  });
}

function readOrderDraft() {
  try {
    const rawValue = window.localStorage.getItem(ORDER_DRAFT_STORAGE_KEY);
    if (!rawValue) {
      return {
        draft: createEmptyOrderDraft(),
        meta: createEmptyOrderDraftMeta()
      };
    }

    const parsed = rawValue ? JSON.parse(rawValue) : null;
    const reconciled = reconcileOrderDraftState(parsed, normalizedMenu, {
      maxItemQuantity: MAX_ITEM_QUANTITY,
      orderDraftVersion: ORDER_DRAFT_VERSION,
      asapValue: ASAP_VALUE
    });
    const serialized = JSON.stringify(reconciled.draft);
    if (serialized !== rawValue) {
      window.localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, serialized);
    }
    return reconciled;
  } catch (error) {
    return {
      draft: createEmptyOrderDraft(),
      meta: createEmptyOrderDraftMeta()
    };
  }
}

function writeOrderDraft(draft) {
  const reconciled = reconcileOrderDraftState(draft, normalizedMenu, {
    maxItemQuantity: MAX_ITEM_QUANTITY,
    orderDraftVersion: ORDER_DRAFT_VERSION,
    asapValue: ASAP_VALUE
  });
  persistedOrderDraft = reconciled.draft;
  try {
    window.localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(reconciled.draft));
  } catch (error) {
    // Ignore persistence failures and keep the current in-memory draft.
  }
}

function persistOrderDraft() {
  const orderType = currentOrderType();
  writeOrderDraft({
    ...persistedOrderDraft,
    cartItems: cartItems.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      posItemId: item.posItemId || item.itemId,
      posCategoryId: item.posCategoryId || "",
      categoryName: item.categoryName || "",
      printRouting: item.printRouting || "",
      menuVersion: item.menuVersion || "",
      itemName: item.itemName,
      basePrice: item.basePrice,
      discountEligible: item.discountEligible !== false,
      modifierSelections: (item.modifierSelections || []).map((selection) => ({ ...selection })),
      quantity: item.quantity
    })),
    nextCartId,
    selectedCategory,
    searchQuery,
    basketOpen: false,
    schedules: {
      ...persistedOrderDraft.schedules,
      [orderType]: {
        date: String(dateSelect?.value || ""),
        time: String(timeSelect?.value || "")
      }
    }
  });
}

function restoreOrderDraft() {
  const restored = readOrderDraft();
  persistedOrderDraft = restored.draft;
  restoredDraftMeta = restored.meta;
  cartItems = persistedOrderDraft.cartItems.map((item) => ({
    ...item,
    modifierSelections: (item.modifierSelections || []).map((selection) => ({ ...selection }))
  }));
  nextCartId = persistedOrderDraft.nextCartId;
  selectedCategory = persistedOrderDraft.selectedCategory;
  searchQuery = persistedOrderDraft.searchQuery;
  restoredDraftHadCart = restoredDraftMeta.sourceLineCount > 0;

  if (menuSearchInput) {
    menuSearchInput.value = searchQuery;
  }
}

function applyRestoredScheduleDraft() {
  if (!dateSelect || !timeSelect) return;

  const schedule = persistedOrderDraft.schedules[currentOrderType()] || { date: "", time: "" };
  if (schedule.date && availableOrderDateSet.has(schedule.date)) {
    dateSelect.value = schedule.date;
  }

  syncOrderCalendarToSelectedDate();
  renderTimeOptions();

  if (schedule.time) {
    const canRestoreTime = [...timeSelect.options].some((option) => option.value === schedule.time);
    if (canRestoreTime) {
      timeSelect.value = schedule.time;
      renderOrderSlotCards(lastRenderedTimeRows);
      validateTimeField();
      updateOrderReviewRow();
      updateStickyCheckoutBar();
    }
  }
}

function addItemToCart(item, modifierSelections, quantity, openBasket = false) {
  const cleanQty = Math.max(1, Math.min(MAX_ITEM_QUANTITY, Number(quantity || 1)));
  const signature = cartLineSignature(item.id || item.name, modifierSelections);

  const existing = cartItems.find((entry) => entry.signature === signature);
  if (existing) {
    existing.quantity = Math.min(MAX_ITEM_QUANTITY, existing.quantity + cleanQty);
    recalculateCartItem(existing);
  } else {
    const totals = cartLineTotals(item.basePrice, modifierSelections, cleanQty);
    cartItems.push({
      id: nextCartId,
      itemId: item.id || "",
      posItemId: item.posItemId || item.id || "",
      posCategoryId: item.posCategoryId || "",
      categoryName: item.categoryName || "",
      printRouting: item.printRouting || "",
      menuVersion: item.menuVersion || "",
      signature,
      itemName: item.name,
      basePrice: item.basePrice,
      discountEligible: item.discountEligible !== false,
      modifierSelections,
      quantity: cleanQty,
      unitPrice: totals.unitPrice,
      linePrice: totals.linePrice
    });
    nextCartId += 1;
  }

  renderCart();
  const totals = cartPricingTotals();
  announceCartStatus(`${item.name} added to basket. ${totals.totalQuantity} ${totals.totalQuantity === 1 ? "item" : "items"}, ${formatGBP(totals.total)} total.`);
  if (openBasket) {
    setBasketOpen(true, { focusPanel: true });
  }
}

function modifierSummary(selection) {
  const base = `${selection.groupName}: ${selection.optionName}`;
  const adjustment = Number(selection.priceAdjustment || 0);
  if (selection.isTextInput || adjustment === 0) return base;

  const sign = adjustment > 0 ? "+" : "-";
  return `${base} (${sign}${formatGBP(Math.abs(adjustment))})`;
}

function renderCheckoutSummaryList(totals = cartPricingTotals()) {
  if (!orderCheckoutSummaryList) return;
  orderCheckoutSummaryList.textContent = "";

  if (cartItems.length === 0) {
    const empty = document.createElement("li");
    empty.className = "orderCheckoutSummaryEmpty";
    empty.textContent = "Your selected dishes will appear here.";
    orderCheckoutSummaryList.appendChild(empty);
    return;
  }

  cartItems.forEach((item) => {
    const row = document.createElement("li");
    row.className = "orderCheckoutSummaryItem";

    const details = document.createElement("div");
    details.className = "orderCheckoutSummaryItemDetails";

    const name = document.createElement("strong");
    name.className = "orderCheckoutSummaryItemName";
    name.textContent = `${item.quantity} × ${item.itemName}`;
    details.appendChild(name);

    const modifierText = (item.modifierSelections || [])
      .map(modifierSummary)
      .filter(Boolean)
      .join(" · ");
    if (modifierText) {
      const modifiers = document.createElement("span");
      modifiers.className = "orderCheckoutSummaryItemModifiers";
      modifiers.textContent = modifierText;
      details.appendChild(modifiers);
    }

    const price = document.createElement("strong");
    price.className = "orderCheckoutSummaryItemPrice";
    price.textContent = formatGBP(item.linePrice);

    row.appendChild(details);
    row.appendChild(price);
    orderCheckoutSummaryList.appendChild(row);
  });

  const pricing = document.createElement("li");
  pricing.className = "orderCheckoutSummaryPricing";

  const appendPriceRow = (label, value, className = "") => {
    const row = document.createElement("div");
    row.className = `orderCheckoutSummaryPriceRow${className ? ` ${className}` : ""}`;
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    const valueEl = document.createElement("strong");
    valueEl.textContent = value;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    pricing.appendChild(row);
  };

  appendPriceRow("Subtotal", formatGBP(totals.subtotal));
  if (totals.collectionDiscount > 0) {
    appendPriceRow("Collection discount (10% on eligible items)", `−${formatGBP(totals.collectionDiscount)}`, "isDiscount");
  }
  if (currentOrderType() === "delivery" && totals.deliveryFee > 0) {
    appendPriceRow("Delivery fee", formatGBP(totals.deliveryFee));
  }
  appendPriceRow("Total", formatGBP(totals.total), "isTotal");
  orderCheckoutSummaryList.appendChild(pricing);
}

function lineSummary(item) {
  const name = summarySafeText(item.itemName);
  const quantityText = `${item.quantity}x`;
  const modifierText = (item.modifierSelections || [])
    .map(modifierSummary)
    .map(summarySafeText)
    .filter(Boolean)
    .join(" | ");
  const base = modifierText ? `${quantityText} ${name} [${modifierText}]` : `${quantityText} ${name}`;
  return `${base} = ${formatGBP(item.linePrice)}`;
}

function syncItemsSummary() {
  if (!itemsInput) return;

  if (cartItems.length === 0) {
    itemsInput.value = "";
    if (orderSummaryPreview) orderSummaryPreview.textContent = "Add dishes to begin.";
    return;
  }

  const lines = cartItems.map(lineSummary);
  const totals = cartPricingTotals();
  if (totals.collectionDiscount > 0) {
    lines.push(`Subtotal = ${formatGBP(totals.subtotal)}`);
    lines.push(`Collection discount (10% on eligible items) = -${formatGBP(totals.collectionDiscount)}`);
  }
  if (totals.deliveryFee > 0) {
    lines.push(`Subtotal = ${formatGBP(totals.subtotal)}`);
    lines.push(`Delivery fee = ${formatGBP(totals.deliveryFee)}`);
  }
  lines.push(`Total = ${formatGBP(totals.total)}`);

  itemsInput.value = lines.join("\n");
  if (orderSummaryPreview) {
    const priceText = currentOrderType() === "delivery"
      ? `Subtotal ${formatGBP(totals.subtotal)} + delivery ${formatGBP(totals.deliveryFee)} = total ${formatGBP(totals.total)}`
      : `Subtotal ${formatGBP(totals.subtotal)} − eligible-item discount ${formatGBP(totals.collectionDiscount)} = total ${formatGBP(totals.total)}`;
    orderSummaryPreview.textContent = `${totals.totalQuantity} ${totals.totalQuantity === 1 ? "dish" : "dishes"} · ${priceText}.`;
  }
}

function isDesktopBasketLayout() {
  return Boolean(DESKTOP_BASKET_MEDIA?.matches);
}

function isMobileOrderMenuLayout() {
  return Boolean(MOBILE_ORDER_MENU_MEDIA?.matches);
}

function setMobileBasketBackgroundInert(inert) {
  const shouldInert = Boolean(inert);
  document.body.classList.toggle("isOrderBasketDialogOpen", shouldInert);

  const roots = [
    document.querySelector(".desktopSiteHeader"),
    document.querySelector(".orderHeader"),
    document.querySelector(".orderContextStrip"),
    noticeEl,
    form?.querySelector(".orderFlowHeader"),
    form?.querySelector(".orderTrustStrip"),
    form?.querySelector(".orderMenuLead"),
    document.querySelector(".orderPage > .footer"),
    ...[...(orderHub?.children || [])].filter((element) => (
      element !== basketColumn && element !== modifierPanel
    ))
  ].filter((element) => element instanceof HTMLElement);

  roots.forEach((element) => {
    if (shouldInert) {
      element.dataset.orderBasketInert = "true";
      element.inert = true;
    } else if (element.dataset.orderBasketInert === "true") {
      element.inert = false;
      delete element.dataset.orderBasketInert;
    }
  });
}

function setBasketOpen(open, options = {}) {
  if (!basketPanel || !basketToggleBtn) return;

  const forceOpen = isDesktopBasketLayout() && currentOrderStep === 1;
  const canOpen = forceOpen || cartItems.length > 0 || (isMobileOrderMenuLayout() && currentOrderStep === 1);
  const nextState = canOpen && (forceOpen || Boolean(open));
  basketPanel.hidden = !nextState;
  basketToggleBtn.setAttribute("aria-expanded", nextState ? "true" : "false");
  basketColumn?.classList.toggle("isBasketOpen", nextState);
  const mobileDialog = isMobileOrderMenuLayout() && currentOrderStep === 1 && nextState;
  setMobileBasketBackgroundInert(mobileDialog);
  if (mobileDialog) {
    basketPanel.setAttribute("role", "dialog");
    basketPanel.setAttribute("aria-modal", "true");
  } else {
    basketPanel.setAttribute("role", "region");
    basketPanel.removeAttribute("aria-modal");
  }
  if (stickyCheckoutBtn && isMobileOrderMenuLayout() && currentOrderStep === 1) {
    stickyCheckoutBtn.setAttribute("aria-controls", "orderBasketPanel");
    stickyCheckoutBtn.setAttribute("aria-expanded", nextState ? "true" : "false");
  }
  if (nextState && options.focusPanel && !forceOpen) {
    window.requestAnimationFrame(() => {
      basketPanel.scrollTop = 0;
      basketCloseBtn?.focus({ preventScroll: true });
    });
  } else if (!nextState && options.restoreFocus) {
    window.requestAnimationFrame(() => {
      const returnTarget = isMobileOrderMenuLayout() ? stickyCheckoutBtn : basketToggleBtn;
      returnTarget?.focus({ preventScroll: true });
    });
  }
  persistOrderDraft();
}

function basketFocusableControls() {
  if (!basketPanel || basketPanel.hidden || !isMobileOrderMenuLayout()) return [];
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])'
  ].join(",");
  return [...basketPanel.querySelectorAll(selector)].filter((element) => (
    element instanceof HTMLElement && !element.closest("[hidden]")
  ));
}

function handleBasketPanelKeydown(event) {
  if (!basketPanel || basketPanel.hidden || !isMobileOrderMenuLayout()) return;

  if (event.key === "Escape") {
    event.preventDefault();
    setBasketOpen(false, { restoreFocus: true });
    return;
  }

  if (event.key !== "Tab") return;
  const controls = basketFocusableControls();
  if (controls.length === 0) {
    event.preventDefault();
    return;
  }

  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function updateBasketSummary(totalPrice, totalQuantity) {
  if (basketCountEl) {
    basketCountEl.textContent = `${totalQuantity} item${totalQuantity === 1 ? "" : "s"}`;
  }
  if (basketInlineTotalEl) {
    basketInlineTotalEl.textContent = formatGBP(totalPrice);
  }
  if (basketToggleBtn) {
    const feeText = currentOrderType() === "delivery" && totalQuantity > 0
      ? `, including ${formatGBP(DELIVERY_FEE_GBP)} delivery`
      : "";
    basketToggleBtn.setAttribute(
      "aria-label",
      `Basket: ${totalQuantity} item${totalQuantity === 1 ? "" : "s"}, total ${formatGBP(totalPrice)}${feeText}`
    );
  }
}

function createActionButton(action, text, item, isDanger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = isDanger ? "orderCartBtn orderCartBtnDanger" : "orderCartBtn";
  button.dataset.action = action;
  button.textContent = text;
  button.setAttribute("aria-label", cartQuantityActionLabel(action, item?.itemName, item?.quantity));
  return button;
}

function clearUndoTimer() {
  if (removeUndoTimer) {
    clearTimeout(removeUndoTimer);
    removeUndoTimer = null;
  }
}

function announceCartStatus(message) {
  if (!orderCartStatus) return;
  orderCartStatus.textContent = "";
  window.requestAnimationFrame(() => {
    orderCartStatus.textContent = String(message || "");
  });
}

function focusCartAction(cartId, action) {
  window.requestAnimationFrame(() => {
    const row = cartList?.querySelector(`li[data-cart-id="${cartId}"]`);
    const target = row?.querySelector(`button[data-action="${action}"]`) || row?.querySelector("button");
    if (target instanceof HTMLButtonElement) target.focus({ preventScroll: true });
  });
}

function ensureUndoToast() {
  if (!orderHub) return null;
  let toast = orderHub.querySelector(".orderUndoToast");
  if (toast) return toast;

  toast = document.createElement("div");
  toast.className = "orderUndoToast";
  toast.hidden = true;
  toast.innerHTML = [
    "<p class=\"orderUndoToastText\"></p>",
    "<button type=\"button\" class=\"orderUndoToastBtn\">Undo</button>"
  ].join("");

  const undoBtn = toast.querySelector(".orderUndoToastBtn");
  undoBtn?.addEventListener("click", () => {
    if (!pendingRemovedCartLine) return;

    const restored = {
      ...pendingRemovedCartLine,
      id: nextCartId,
      modifierSelections: (pendingRemovedCartLine.modifierSelections || []).map((selection) => ({ ...selection }))
    };
    nextCartId += 1;

    const existing = cartItems.find((entry) => entry.signature === restored.signature);
    if (existing) {
      existing.quantity = Math.min(MAX_ITEM_QUANTITY, existing.quantity + restored.quantity);
      recalculateCartItem(existing);
    } else {
      cartItems.push(restored);
    }

    pendingRemovedCartLine = null;
    clearUndoTimer();
    toast.hidden = true;
    renderCart();
    announceCartStatus(`${restored.itemName} restored to basket.`);
    focusCartAction(existing?.id || restored.id, "increase");
  });

  orderHub.appendChild(toast);
  return toast;
}

function dismissUndoToast() {
  clearUndoTimer();
  pendingRemovedCartLine = null;
  const toast = orderHub?.querySelector(".orderUndoToast");
  if (toast) toast.hidden = true;
}

function showUndoToast(removedItem) {
  const toast = ensureUndoToast();
  if (!toast) return;

  const text = toast.querySelector(".orderUndoToastText");
  if (text) {
    text.textContent = `${removedItem.itemName} removed from basket.`;
  }

  toast.hidden = false;
  announceCartStatus(`${removedItem.itemName} removed from basket. Undo is available.`);
  clearUndoTimer();
  removeUndoTimer = setTimeout(() => {
    pendingRemovedCartLine = null;
    toast.hidden = true;
    removeUndoTimer = null;
  }, 7000);
}

function buildCartCountsByItemId() {
  return cartItems.reduce((counts, item) => {
    const key = String(item.itemId || "").trim();
    if (!key) return counts;
    counts.set(key, (counts.get(key) || 0) + Number(item.quantity || 0));
    return counts;
  }, new Map());
}

function syncMenuItemSelectionState() {
  if (!menuItemsList) return;

  const counts = buildCartCountsByItemId();
  const cards = menuItemsList.querySelectorAll(".orderMenuCard");

  cards.forEach((card) => {
    if (!(card instanceof HTMLElement)) return;
    const itemId = String(card.dataset.itemId || "");
    const count = counts.get(itemId) || 0;
    card.classList.toggle("isInBasket", count > 0);

    const selectedBadge = card.querySelector("[data-selected-badge]");
    if (selectedBadge instanceof HTMLElement) {
      selectedBadge.hidden = count <= 0;
      selectedBadge.textContent = count === 1 ? "1 in basket" : `${count} in basket`;
    }

    const countBadge = card.querySelector("[data-item-count]");
    if (countBadge instanceof HTMLElement) {
      countBadge.hidden = count <= 0;
      countBadge.textContent = count > 0 ? String(count) : "";
    }

    const primaryAction = card.querySelector("button.orderMenuActionBtn[data-item-count]");
    if (primaryAction instanceof HTMLElement) {
      primaryAction.classList.toggle("hasCount", count > 0);
    }
  });
}

function renderCart() {
  if (!cartList || !cartEmpty || !orderTotalEl) {
    updateSubmitButtonState();
    return;
  }

  cartItems.forEach(recalculateCartItem);

  cartList.innerHTML = "";
  cartItems.forEach((item) => {
    const li = document.createElement("li");
    li.className = "orderCartItem";
    li.dataset.cartId = String(item.id);

    const catalogItem = menuItemForCartItem(item);

    const body = document.createElement("div");
    body.className = "orderCartItemBody";

    const top = document.createElement("div");
    top.className = "orderCartTop";

    const title = document.createElement("strong");
    title.className = "orderCartName";
    title.textContent = item.itemName;

    top.appendChild(title);
    top.appendChild(createActionButton("remove", "×", item, true));

    const unit = document.createElement("div");
    unit.className = "orderCartUnit";
    unit.textContent = `${formatGBP(item.unitPrice)} each`;

    const lines = (item.modifierSelections || []).map(modifierSummary);

    const actions = document.createElement("div");
    actions.className = "orderCartActionsRow";

    const stepper = document.createElement("div");
    stepper.className = "orderCartStepper";
    stepper.appendChild(createActionButton("decrease", "−", item));

    const qtyPill = document.createElement("span");
    qtyPill.className = "orderCartQty";
    qtyPill.textContent = String(item.quantity);
    qtyPill.setAttribute("aria-label", `${item.itemName} quantity: ${item.quantity}`);
    stepper.appendChild(qtyPill);

    stepper.appendChild(createActionButton("increase", "+", item));
    actions.appendChild(stepper);

    const linePrice = document.createElement("span");
    linePrice.className = "orderCartPrice";
    linePrice.textContent = formatGBP(item.linePrice);
    actions.appendChild(linePrice);

    body.appendChild(top);
    body.appendChild(unit);
    if (lines.length > 0) {
      const modifiers = document.createElement("div");
      modifiers.className = "orderCartModifiers";
      modifiers.textContent = lines.join(" | ");
      body.appendChild(modifiers);
    }

    if (catalogItem) {
      const dietary = getMenuItemDietaryDisplay(catalogItem, item.modifierSelections || []);
      const allergens = getMenuItemAllergenLabels(catalogItem, item.modifierSelections || []);
      const details = [];
      if (dietary?.confirmed) details.push(dietary.label);
      if (allergens.length > 0) details.push(`Contains: ${allergens.join(", ")}`);
      if (details.length > 0) {
        const dietaryAndAllergens = document.createElement("p");
        dietaryAndAllergens.className = "orderCartDietaryAllergens";
        dietaryAndAllergens.textContent = details.join(" · ");
        body.appendChild(dietaryAndAllergens);
      }
    }
    body.appendChild(actions);
    li.appendChild(body);

    cartList.appendChild(li);
  });

  const totals = cartPricingTotals();
  const hasItems = cartItems.length > 0;
  renderCheckoutSummaryList(totals);

  cartEmpty.hidden = hasItems;
  cartList.hidden = !hasItems;
  if (basketClearBtn) basketClearBtn.hidden = !hasItems;
  if (orderSubtotalEl) orderSubtotalEl.textContent = formatGBP(totals.subtotal);
  if (orderDiscountRowEl) orderDiscountRowEl.hidden = totals.collectionDiscount <= 0;
  if (orderDiscountEl) orderDiscountEl.textContent = `−${formatGBP(totals.collectionDiscount)}`;
  if (orderDeliveryFeeRowEl) orderDeliveryFeeRowEl.hidden = currentOrderType() !== "delivery" || !hasItems;
  if (orderDeliveryFeeEl) orderDeliveryFeeEl.textContent = formatGBP(totals.deliveryFee);
  orderTotalEl.textContent = formatGBP(totals.total);

  updateBasketSummary(totals.total, totals.totalQuantity);
  if (isDesktopBasketLayout()) {
    setBasketOpen(true);
  } else if (!hasItems) {
    setBasketOpen(false);
  }

  syncItemsSummary();
  syncMenuItemSelectionState();
  updateOrderReviewRow();
  updateOrderFlowStepLabels();
  updateSubmitButtonState();
  persistOrderDraft();
}

function updateCartQuantity(cartId, delta, action) {
  const item = cartItems.find((entry) => entry.id === cartId);
  if (!item) return;

  const next = Math.max(1, Math.min(MAX_ITEM_QUANTITY, item.quantity + delta));
  item.quantity = next;
  recalculateCartItem(item);
  renderCart();
  announceCartStatus(`${item.itemName} quantity is now ${item.quantity}.`);
  focusCartAction(cartId, action);
}

function removeCartLine(cartId) {
  const index = cartItems.findIndex((entry) => entry.id === cartId);
  if (index < 0) return;

  const [removed] = cartItems.splice(index, 1);
  if (removed) {
    pendingRemovedCartLine = {
      ...removed,
      modifierSelections: (removed.modifierSelections || []).map((selection) => ({ ...selection }))
    };
    showUndoToast(removed);
  }

  renderCart();
  window.requestAnimationFrame(() => {
    const undoBtn = orderHub?.querySelector(".orderUndoToastBtn");
    if (undoBtn instanceof HTMLButtonElement) undoBtn.focus();
  });
}

function resetOrderBuilder() {
  dismissUndoToast();
  cartItems = [];
  nextCartId = 1;
  selectedCategory = defaultCategoryName();
  mobileOpenCategory = "";
  searchQuery = "";
  if (menuSearchInput) menuSearchInput.value = "";

  hideModifierPanel();
  setBasketOpen(false);
  renderCategoryChips();
  renderMenuItems();
  renderCart();
}

function validatePayload(payload) {
  if (payload.orderType !== "delivery" && (!payload.customerName || payload.customerName.length < 2)) {
    return "Please enter a valid name.";
  }

  const phoneDigitCount = String(payload.phoneNumber || "").replace(/\D/g, "").length;
  if (phoneDigitCount < 7 || phoneDigitCount > 15) {
    return "Please enter a valid UK or international phone number.";
  }

  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return "Please enter a valid email address.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    return "Please choose a valid date.";
  }

  if (!isBookableDay(payload.date)) {
    return `Orders are available on ${orderOpenDaySummary()} only.`;
  }

  if (payload.time === ASAP_VALUE) {
    const now = ukNowDateAndMinutes();
    if (payload.date !== now.dateISO) {
      return "ASAP is only available for today's date.";
    }
    if (now.minutesNow > SERVICE_END_MINUTES) {
      return "No slots are left today. Please choose another date.";
    }
  } else if (!/^\d{2}:\d{2}$/.test(payload.time)) {
    return "Please choose a valid time or ASAP.";
  }

  if (payload.time !== ASAP_VALUE) {
    const minutes = clockToMinutes(payload.time);
    const earliestScheduled = earliestScheduledMinutesForOrderType(payload.orderType);

    if (!Number.isFinite(minutes)) {
      return "Please choose a valid time.";
    }

    if (minutes < earliestScheduled || minutes > SERVICE_END_MINUTES) {
      const orderLabel = payload.orderType === "delivery" ? "Delivery" : "Collection";
      return `${orderLabel} scheduled times must be between ${minutesToClock(earliestScheduled)} and ${minutesToClock(SERVICE_END_MINUTES)}.`;
    }

    if (minutes % SLOT_STEP_MINUTES !== 0) {
      return `Orders must be in ${orderIntervalSummary()}.`;
    }

    if (payload.date === ukTodayISODate()) {
      const minimum = minScheduledMinutes(payload.orderType, payload.date);
      if (minimum > SERVICE_END_MINUTES) {
        return "No scheduled slots are left today. Please choose another date.";
      }
      if (minutes < minimum) {
        const lead = leadMinutesForOrderType(payload.orderType);
        return `Scheduled time must be at least ${lead} minutes from now (${minutesToClock(minimum)} or later).`;
      }
    }
  }

  if (!payload.itemsSummary || payload.itemsSummary.length < 3) {
    return "Please add at least one menu item.";
  }
  if (payload.notes && payload.sensitiveInfoConsent !== true) {
    return "Consent is required when optional notes are provided.";
  }

  if (payload.orderType === "delivery") {
    if (!payload.addressLine1) return "Address line 1 is required for delivery.";
    if (!payload.townCity) return "Town / City is required for delivery.";
    if (!payload.postcode) return "Postcode is required for delivery.";
    if (!UK_POSTCODE_REGEX.test(payload.postcode)) {
      return "Please enter a valid UK postcode (example: DN37 0JZ).";
    }
  }

  return null;
}

async function handleSubmit(event) {
  event.preventDefault();
  clearFeedback();
  syncItemsSummary();

  if (!onlineOrderingEnabled) {
    showError("Online ordering is temporarily paused. Please contact Millers Café if you need help.");
    return;
  }

  if (currentOrderStep !== 2) {
    setOrderStep(2);
    return;
  }

  if (!runCheckoutFieldValidation()) {
    showError("Please correct the highlighted fields.");
    focusFirstInvalidCheckoutField();
    return;
  }

  const orderType = String(orderTypeField?.value || "collection").toLowerCase();
  const payload = {
    orderType,
    customerName: (nameInput?.value || "").trim(),
    phoneNumber: (phoneInput?.value || "").trim(),
    email: (emailInput?.value || "").trim(),
    date: dateSelect?.value || "",
    time: timeSelect?.value || "",
    specialOccasion: "None",
    itemsSummary: (itemsInput?.value || "").trim(),
    notes: (notesInput?.value || "").trim(),
    sensitiveInfoConsent: Boolean(sensitiveInfoConsentInput?.checked),
    addressLine1: (address1Input?.value || "").trim(),
    addressLine2: (address2Input?.value || "").trim(),
    townCity: (townInput?.value || "").trim(),
    postcode: normalizeUkPostcode((postcodeInput?.value || "").trim())
  };

  const validationError = validatePayload(payload);
  if (validationError) {
    showError(validationError);
    return;
  }

  if (payload.orderType === "delivery" && payload.postcode && !isLikelyDeliveryPostcode(payload.postcode)) {
    const outsideAreaMode = String(siteConfigState?.delivery?.outsideAreaMode || "review").trim().toLowerCase();
    if (outsideAreaMode === "reject") {
      showError("This postcode is outside our online delivery area. Please call Millers Café before placing a delivery order.");
      return;
    }

    setNotice("This postcode may be outside our usual delivery area. We will review it after payment and contact you if there is a problem.", true);
  }

  setSubmitting(true);

  let redirectStarted = false;
  try {
    void trackClientEvent("order_checkout_redirect", {
      page: "order",
      route: window.location.pathname,
      orderType
    });

    const cartPayload = checkoutCartPayload();
    const idempotencyKey = checkoutIdempotencyKey(payload, cartPayload);
    const response = await fetch(CHECKOUT_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        ...payload,
        turnstileToken: orderTurnstileToken,
        cartItems: cartPayload
      })
    });

    let body = {};
    try {
      body = await response.json();
    } catch (error) {
      body = {};
    }

    if (!response.ok) {
      showError(body.error || "Could not start secure checkout right now. Please try again.");
      return;
    }

    if (!body.checkoutUrl) {
      showError("Secure checkout could not be started right now. Please try again.");
      return;
    }

    setNotice("Redirecting you to secure Stripe checkout...", false);
    redirectStarted = true;
    window.location.href = body.checkoutUrl;
  } catch (error) {
    showError("Secure checkout is currently unavailable. Please try again shortly.");
  } finally {
    if (!redirectStarted) resetOrderTurnstile();
    setSubmitting(false);
  }
}

function initializeMenuInteractions() {
  if (!menuItemsList || !menuCategoryChips || !menuSearchInput) return false;

  if (normalizedMenu.length === 0) {
    menuItemsList.innerHTML = "<div class=\"orderMenuEmpty\">Menu is temporarily unavailable.</div>";
    setNotice("Menu is temporarily unavailable. Please try again shortly.", true);
    return false;
  }

  if (!selectedCategory) selectedCategory = defaultCategoryName();
  if (menuSearchInput) {
    menuSearchInput.value = searchQuery;
  }
  renderCategoryChips();
  if (!mobileOpenCategory && isMobileOrderMenuLayout()) {
    mobileOpenCategory = selectedCategory;
  }
  renderMenuItems();
  renderCart();
  setBasketOpen(isDesktopBasketLayout());

  menuCategoryChips.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest("button[data-category]");
    if (!(button instanceof HTMLButtonElement)) return;

    selectedCategory = String(button.dataset.category || "");
    mobileOpenCategory = selectedCategory;
    renderCategoryChips();
    renderMenuItems();
    window.requestAnimationFrame(() => {
      const activeButton = [...menuCategoryChips.querySelectorAll("button[data-category]")]
        .find((candidate) => candidate.dataset.category === selectedCategory);
      activeButton?.focus({ preventScroll: true });
    });
    queueActiveCategoryPillSync();
    persistOrderDraft();
  });
  menuCategoryChips.addEventListener("keydown", handleMenuCategoryKeydown);

  menuSearchInput.addEventListener("input", () => {
    window.clearTimeout(menuSearchTimer);
    menuSearchTimer = window.setTimeout(() => {
      searchQuery = normalizeText(menuSearchInput.value || "");
      renderMenuItems();
      queueActiveCategoryPillSync();
      persistOrderDraft();
    }, 120);
  });

  menuSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    window.clearTimeout(menuSearchTimer);
    searchQuery = normalizeText(menuSearchInput.value || "");
    renderMenuItems();
    queueActiveCategoryPillSync();
    menuSearchInput.focus();
    persistOrderDraft();
  });

  menuSearchSubmitBtn?.addEventListener("click", () => {
    window.clearTimeout(menuSearchTimer);
    searchQuery = normalizeText(menuSearchInput.value || "");
    renderMenuItems();
    queueActiveCategoryPillSync();
    menuSearchInput.focus();
    persistOrderDraft();
  });

  menuItemsList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const categoryToggle = target.closest("button[data-mobile-category]");
    if (categoryToggle instanceof HTMLButtonElement) {
      const categoryName = String(categoryToggle.dataset.mobileCategory || "");
      if (!categoryName) return;

      selectedCategory = categoryName;
      if (!searchQuery) {
        mobileOpenCategory = mobileOpenCategory === categoryName ? "" : categoryName;
      } else {
        mobileOpenCategory = categoryName;
      }
      renderCategoryChips();
      renderMenuItems();
      window.requestAnimationFrame(() => {
        const activeButton = [...menuItemsList.querySelectorAll("button[data-mobile-category]")]
          .find((candidate) => candidate.dataset.mobileCategory === categoryName);
        activeButton?.focus({ preventScroll: true });
      });
      queueActiveCategoryPillSync();
      persistOrderDraft();
      return;
    }

    const button = target.closest("button.orderMenuActionBtn");
    if (!(button instanceof HTMLButtonElement)) return;

    const categoryIndex = Number(button.dataset.categoryIndex);
    const itemIndex = Number(button.dataset.itemIndex);
    const actionType = String(button.dataset.actionType || "add").toLowerCase();

    const category = normalizedMenu[categoryIndex];
    const item = category?.items?.[itemIndex];
    if (!item) return;

    const card = button.closest(".orderMenuCard");

    if (actionType === "add") {
      addItemToCart(item, [], 1, false);
      return;
    }

    startItemDraft(item, 1, card instanceof HTMLElement ? card : null);
  });

  basketToggleBtn?.addEventListener("click", () => {
    const currentlyOpen = basketToggleBtn.getAttribute("aria-expanded") === "true";
    setBasketOpen(!currentlyOpen, {
      focusPanel: !currentlyOpen,
      restoreFocus: currentlyOpen
    });
  });

  basketCloseBtn?.addEventListener("click", () => {
    setBasketOpen(false, { restoreFocus: true });
  });

  basketClearBtn?.addEventListener("click", () => {
    if (cartItems.length === 0) return;
    const removedQuantity = cartItems.reduce((total, item) => total + Number(item.quantity || 0), 0);
    dismissUndoToast();
    cartItems = [];
    nextCartId = 1;
    renderCart();
    announceCartStatus(`${removedQuantity} item${removedQuantity === 1 ? "" : "s"} cleared from basket.`);
    menuSearchInput?.focus({ preventScroll: true });
  });

  basketPanel?.addEventListener("keydown", handleBasketPanelKeydown);

  basketCheckoutBtn?.addEventListener("click", () => {
    if (!form || basketCheckoutBtn.disabled) return;
    setOrderStep(2);
  });

  cartList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest("button[data-action]");
    if (!(button instanceof HTMLButtonElement)) return;

    const row = button.closest("li[data-cart-id]");
    if (!(row instanceof HTMLLIElement)) return;

    const cartId = Number(row.dataset.cartId);
    if (!Number.isInteger(cartId)) return;

    const action = button.dataset.action;
    if (action === "increase") {
      updateCartQuantity(cartId, 1, "increase");
    } else if (action === "decrease") {
      updateCartQuantity(cartId, -1, "decrease");
    } else if (action === "remove") {
      removeCartLine(cartId);
    }
  });

  modifierCancelBtn?.addEventListener("click", () => hideModifierPanel({ restoreFocus: true }));

  modifierPanel?.addEventListener("click", (event) => {
    if (event.target !== modifierPanel) return;
    hideModifierPanel({ restoreFocus: true });
  });
  modifierPanel?.addEventListener("keydown", handleModifierPanelKeydown);

  modifierConfirmBtn?.addEventListener("click", () => {
    clearModifierError();
    const result = selectedModifiersFromDraft();
    if (!result.ok) {
      showModifierError(result.error || "Please check your selections.");
      return;
    }

    if (!activeDraft) return;
    addItemToCart(activeDraft.item, result.selections, activeDraft.quantity, false);
    hideModifierPanel({ restoreFocus: true });
  });

  modifierFields?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "checkbox") return;

    const groupIndex = Number(target.dataset.groupIndex);
    if (!Number.isInteger(groupIndex) || !activeDraft) return;

    const group = activeDraft.item.modifierGroups[groupIndex];
    if (!group || group.selectionType !== "multiple") return;

    const checked = [...modifierFields.querySelectorAll(`input[type="checkbox"][data-group-index="${groupIndex}"]:checked`)];
    if (checked.length > group.maxSelections) {
      target.checked = false;
      showModifierError(`You can select up to ${group.maxSelections} option(s) for ${group.name}.`);
    } else {
      clearModifierError();
    }
  });

  window.addEventListener("scroll", queueActiveCategoryPillSync, { passive: true });
  window.addEventListener("resize", queueActiveCategoryPillSync);

  return true;
}

function handleCheckoutReturnState() {
  const url = new URL(window.location.href);
  const checkoutState = String(url.searchParams.get("checkout") || "").trim().toLowerCase();
  const sessionId = String(url.searchParams.get("session_id") || "").trim();
  if (!checkoutState) return false;

  const orderType = currentOrderType();
  const preservedPostcode = normalizeUkPostcode((postcodeInput?.value || "").trim());

  if (checkoutState === "cancelled") {
    void trackClientEvent("order_checkout_return_cancelled", {
      page: "order",
      route: window.location.pathname,
      orderType
    });
    clearFeedback();
    clearCheckoutReturnParams();
    setNotice("Stripe checkout was cancelled. Your basket is still saved here.", true);
    if (cartItems.length > 0) {
      setOrderStep(2, { instant: true, silent: true });
    }
    return true;
  }

  if (checkoutState === "success" && sessionId) {
    void trackClientEvent("order_checkout_return_success", {
      page: "order",
      route: window.location.pathname,
      orderType
    });
    clearFeedback();
    setOrderStep(2, { instant: true, silent: true });
    showCheckoutProcessing("Stripe payment succeeded. Finalizing your order with Millers Café.");
    setNotice("Secure payment received. Finalizing your order now.", false);
    finalizeSuccessfulCheckout(sessionId, orderType, preservedPostcode);
    return true;
  }

  return false;
}

async function initialize() {
  if (!form) return;

  const liveOrderDataPromise = loadLiveOrderData();
  restoreOrderDraft();
  applyMenuCategoryDeepLink();
  initializeMenuInteractions();
  await liveOrderDataPromise;
  setOrderCalendarOpen(false);
  renderDateOptions();
  applyRestoredScheduleDraft();
  void setupOrderTurnstile();

  if (!onlineOrderingEnabled) {
    setNotice("Online ordering is paused while we verify the full allergen catalogue. You can still browse the menu.", true);
    updateSubmitButtonState();
  }

  form.addEventListener("submit", handleSubmit);
  dateSelect?.addEventListener("change", () => {
    clearFeedback();
    syncOrderCalendarToSelectedDate();
    renderTimeOptions();
    validateDateField();
  });
  orderDateToggle?.addEventListener("click", () => {
    setOrderCalendarOpen(!isOrderCalendarOpen);
  });
  orderCalendarPrevBtn?.addEventListener("click", () => moveOrderCalendarMonth(-1));
  orderCalendarNextBtn?.addEventListener("click", () => moveOrderCalendarMonth(1));
  nameInput?.addEventListener("input", validateNameField);
  nameInput?.addEventListener("blur", validateNameField);
  phoneInput?.addEventListener("input", () => {
    normalizePhoneField();
    validatePhoneField();
  });
  phoneInput?.addEventListener("blur", () => {
    normalizePhoneField();
    validatePhoneField();
  });
  emailInput?.addEventListener("input", validateEmailField);
  emailInput?.addEventListener("blur", validateEmailField);
  address1Input?.addEventListener("input", () => {
    validateAddress1Field();
    updateOrderContextStrip();
  });
  address1Input?.addEventListener("blur", validateAddress1Field);
  townInput?.addEventListener("input", () => {
    validateTownField();
    updateOrderContextStrip();
  });
  townInput?.addEventListener("blur", validateTownField);
  timeSelect?.addEventListener("change", () => {
    renderOrderSlotCards(lastRenderedTimeRows);
    validateTimeField();
    updateOrderReviewRow();
    updateStickyCheckoutBar();
  });
  postcodeInput?.addEventListener("input", () => {
    normalizePostcodeField();
    updateDeliveryAreaHint();
    validatePostcodeField();
    updateOrderContextStrip();
  });
  postcodeInput?.addEventListener("blur", () => {
    normalizePostcodeField();
    updateDeliveryAreaHint();
    validatePostcodeField();
  });
  notesInput?.addEventListener("input", validateSensitiveInfoConsentField);
  sensitiveInfoConsentInput?.addEventListener("change", validateSensitiveInfoConsentField);
  orderEditItemsBtn?.addEventListener("click", () => setOrderStep(1));
  orderBackToItemsBtn?.addEventListener("click", () => setOrderStep(1));
  stickyCheckoutBtn?.addEventListener("click", () => {
    if (!form || stickyCheckoutBtn.disabled) return;
    if (isMobileOrderMenuLayout() && currentOrderStep === 1) {
      setBasketOpen(true, { focusPanel: true });
      return;
    }
    if (isMobileOrderMenuLayout() && currentOrderStep === 2) {
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else submitBtn?.click();
      return;
    }
    setOrderStep(2);
  });
  DESKTOP_BASKET_MEDIA?.addEventListener?.("change", () => {
    const focusWasInBasket = basketColumn?.contains(document.activeElement);
    const focusWasInMenu = menuItemsList?.contains(document.activeElement);
    renderCategoryChips();
    renderMenuItems();
    const desktopLayout = isDesktopBasketLayout();
    setBasketOpen(desktopLayout);
    updateStickyCheckoutBar();
    window.requestAnimationFrame(() => {
      if (focusWasInBasket) {
        const target = desktopLayout
          ? basketPanel?.querySelector("button.orderCartBtn:not([disabled])")
          : stickyCheckoutBtn;
        target?.focus({ preventScroll: true });
      } else if (focusWasInMenu) {
        menuSearchInput?.focus({ preventScroll: true });
      }
    });
  });
  resultEl?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const actionButton = target.closest("button[data-result-action]");
    if (!(actionButton instanceof HTMLButtonElement)) return;

    const action = String(actionButton.dataset.resultAction || "");
    if (action === "track") {
      const tracker = resultEl.querySelector(".orderStatusTracker");
      if (tracker) {
        tracker.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" });
      } else {
        resultEl.scrollIntoView({ behavior: preferredScrollBehavior(), block: "nearest" });
      }
      return;
    }

    if (action === "new") {
      stopStatusPolling();
      clearFeedback();
      setOrderStep(1);
      menuSearchInput?.focus();
    }
  });
  normalizePostcodeField();
  updateDeliveryAreaHint();
  validateDateField();
  validateTimeField();
  updateOrderReviewRow();
  await preloadAccountProfile();
  setOrderStep(1, { instant: true, silent: true });
  updateSubmitButtonState();
  const handledCheckoutReturn = handleCheckoutReturnState();
  if (handledCheckoutReturn) {
    return;
  }

  if (restoredDraftHadCart && restoredDraftMeta.removedItems > 0 && cartItems.length === 0) {
    setNotice("Saved basket could not be restored because those items are no longer on the current menu.", true);
    return;
  }

  if (restoredDraftHadCart && restoredDraftMeta.hadChanges) {
    const warning = restoredDraftMeta.removedItems > 0;
    setNotice("Saved basket restored and refreshed against the current menu. Some items, prices, or selections changed.", warning);
    return;
  }

  if (restoredDraftHadCart) {
    const label = currentOrderType() === "delivery" ? "delivery" : "collection";
    setNotice(`Saved ${label} basket restored. Review your time and continue when ready.`, false);
  }

  void trackClientEvent("page_view", {
    page: "order",
    route: window.location.pathname,
    orderType: currentOrderType()
  });
}

void initialize();
