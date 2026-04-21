const ADMIN_CONFIG_API = "/api/admin/config";
const ADMIN_MENU_API = "/api/admin/menu";
const ADMIN_ANALYTICS_API = "/api/admin/analytics";
const TOKEN_STORAGE_KEY = "millers-admin-token";

const authForm = document.getElementById("adminAuthForm");
const tokenInput = document.getElementById("adminToken");
const loadBtn = document.getElementById("adminLoadBtn");
const clearBtn = document.getElementById("adminClearBtn");
const adminFeedback = document.getElementById("adminFeedback");

const configForm = document.getElementById("adminConfigForm");
const saveConfigBtn = document.getElementById("adminSaveConfigBtn");
const configFeedback = document.getElementById("adminConfigFeedback");

const menuForm = document.getElementById("adminMenuForm");
const loadMenuBtn = document.getElementById("adminLoadMenuBtn");
const saveMenuBtn = document.getElementById("adminSaveMenuBtn");
const menuTextarea = document.getElementById("adminMenuJson");
const menuFeedback = document.getElementById("adminMenuFeedback");

const analyticsForm = document.getElementById("adminAnalyticsForm");
const analyticsDaysSelect = document.getElementById("adminAnalyticsDays");
const refreshAnalyticsBtn = document.getElementById("adminRefreshAnalyticsBtn");
const analyticsFeedback = document.getElementById("adminAnalyticsFeedback");
const analyticsSummary = document.getElementById("adminAnalyticsSummary");

const businessNameInput = document.getElementById("adminBusinessName");
const businessShortNameInput = document.getElementById("adminBusinessShortName");
const businessAddressInput = document.getElementById("adminBusinessAddress");
const businessPhoneDisplayInput = document.getElementById("adminBusinessPhoneDisplay");
const businessPhoneTelInput = document.getElementById("adminBusinessPhoneTel");
const businessEmailInput = document.getElementById("adminBusinessEmail");

const hoursInputs = Array.from({ length: 7 }, (_, dayIndex) => document.getElementById(`adminHours${dayIndex}`));
const orderOpenDaysRoot = document.getElementById("adminOrderOpenDays");
const bookingOpenDaysRoot = document.getElementById("adminBookingOpenDays");

const ordersStartInput = document.getElementById("adminOrdersStart");
const ordersEndInput = document.getElementById("adminOrdersEnd");
const ordersStepInput = document.getElementById("adminOrdersStep");
const ordersLookaheadInput = document.getElementById("adminOrdersLookahead");
const collectionLeadInput = document.getElementById("adminCollectionLead");
const deliveryLeadInput = document.getElementById("adminDeliveryLead");
const collectionEarliestInput = document.getElementById("adminCollectionEarliest");
const deliveryEarliestInput = document.getElementById("adminDeliveryEarliest");

const bookingsStartInput = document.getElementById("adminBookingsStart");
const bookingsEndInput = document.getElementById("adminBookingsEnd");
const bookingsStepInput = document.getElementById("adminBookingsStep");
const bookingsLookaheadInput = document.getElementById("adminBookingsLookahead");
const bookingDurationInput = document.getElementById("adminBookingDuration");

const deliveryFeeInput = document.getElementById("adminDeliveryFee");
const etaMinInput = document.getElementById("adminEtaMin");
const etaMaxInput = document.getElementById("adminEtaMax");
const outsideAreaModeSelect = document.getElementById("adminOutsideAreaMode");
const deliveryPrefixesInput = document.getElementById("adminDeliveryPrefixes");

let adminConfigState = null;
let menuCatalogState = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setFeedback(target, message, isError = false) {
  if (!(target instanceof HTMLElement)) return;
  target.textContent = String(message || "");
  target.classList.toggle("isError", Boolean(isError && message));
  target.classList.toggle("isSuccess", Boolean(!isError && message));
}

function setButtonBusy(button, busy, busyText) {
  if (!(button instanceof HTMLButtonElement)) return;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent || "";
  button.disabled = Boolean(busy);
  button.textContent = busy ? String(busyText || "Working...") : button.dataset.defaultLabel;
}

function tokenValue() {
  return String(tokenInput?.value || "").trim();
}

function saveToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch (error) {
    // Ignore storage failures.
  }
}

function loadStoredToken() {
  try {
    return String(window.localStorage.getItem(TOKEN_STORAGE_KEY) || "").trim();
  } catch (error) {
    return "";
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

async function fetchAdminJson(url, options = {}) {
  const token = tokenValue();
  if (!token) {
    throw new Error("Enter an admin token first.");
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    },
    ...options
  });

  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(String(body.error || "Request failed."));
  }
  return body;
}

function minutesToClock(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes || 0)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function clockToMinutes(clock) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(clock || "").trim());
  if (!match) return NaN;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function formatWeeklyHoursValue(windows) {
  if (!Array.isArray(windows) || windows.length === 0) return "closed";
  return windows
    .filter((windowValue) => Array.isArray(windowValue) && windowValue.length >= 2)
    .map((windowValue) => `${windowValue[0]}-${windowValue[1]}`)
    .join(", ");
}

function parseWeeklyHoursValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized || /^closed$/i.test(normalized)) return [];

  return normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(part);
      if (!match) {
        throw new Error(`Invalid hours window: ${part}`);
      }
      return [match[1], match[2]];
    });
}

function checkedDayIndexes(root) {
  return [...root.querySelectorAll("input[type='checkbox']")]
    .filter((input) => input.checked)
    .map((input) => Number(input.value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    .sort((left, right) => left - right);
}

function setCheckedDayIndexes(root, dayIndexes) {
  const set = new Set(Array.isArray(dayIndexes) ? dayIndexes.map(Number) : []);
  [...root.querySelectorAll("input[type='checkbox']")].forEach((input) => {
    input.checked = set.has(Number(input.value));
  });
}

function renderConfig(config) {
  adminConfigState = config && typeof config === "object" ? config : null;
  if (!adminConfigState) return;

  businessNameInput.value = String(adminConfigState.business?.name || "").trim();
  businessShortNameInput.value = String(adminConfigState.business?.shortName || "").trim();
  businessAddressInput.value = String(adminConfigState.business?.address || "").trim();
  businessPhoneDisplayInput.value = String(adminConfigState.business?.phoneDisplay || "").trim();
  businessPhoneTelInput.value = String(adminConfigState.business?.phoneTel || "").trim();
  businessEmailInput.value = String(adminConfigState.business?.email || "").trim();

  hoursInputs.forEach((input, dayIndex) => {
    input.value = formatWeeklyHoursValue(adminConfigState.home?.weeklyHours?.[dayIndex]);
  });

  setCheckedDayIndexes(orderOpenDaysRoot, adminConfigState.orders?.openDayIndexes || []);
  ordersStartInput.value = minutesToClock(adminConfigState.orders?.serviceStartMinutes || 0);
  ordersEndInput.value = minutesToClock(adminConfigState.orders?.serviceEndMinutes || 0);
  ordersStepInput.value = String(adminConfigState.orders?.slotStepMinutes || 15);
  ordersLookaheadInput.value = String(adminConfigState.orders?.maxLookaheadDays || 90);
  collectionLeadInput.value = String(adminConfigState.orders?.collectionMinLeadMinutes || 30);
  deliveryLeadInput.value = String(adminConfigState.orders?.deliveryMinLeadMinutes || 60);
  collectionEarliestInput.value = minutesToClock(adminConfigState.orders?.collectionEarliestScheduledMinutes || 0);
  deliveryEarliestInput.value = minutesToClock(adminConfigState.orders?.deliveryEarliestScheduledMinutes || 0);

  setCheckedDayIndexes(bookingOpenDaysRoot, adminConfigState.bookings?.openDayIndexes || []);
  bookingsStartInput.value = minutesToClock(adminConfigState.bookings?.serviceStartMinutes || 0);
  bookingsEndInput.value = minutesToClock(adminConfigState.bookings?.serviceEndMinutes || 0);
  bookingsStepInput.value = String(adminConfigState.bookings?.slotStepMinutes || 15);
  bookingsLookaheadInput.value = String(adminConfigState.bookings?.maxLookaheadDays || 120);
  bookingDurationInput.value = String(adminConfigState.bookings?.defaultDurationMinutes || 90);

  deliveryFeeInput.value = String(adminConfigState.delivery?.baseFeeGBP ?? 0);
  etaMinInput.value = String(adminConfigState.delivery?.etaMinMinutes ?? 0);
  etaMaxInput.value = String(adminConfigState.delivery?.etaMaxMinutes ?? 0);
  outsideAreaModeSelect.value = String(adminConfigState.delivery?.outsideAreaMode || "review").trim().toLowerCase() === "reject"
    ? "reject"
    : "review";
  deliveryPrefixesInput.value = Array.isArray(adminConfigState.delivery?.allowedOutwardPrefixes)
    ? adminConfigState.delivery.allowedOutwardPrefixes.join(", ")
    : "";
}

function collectConfig() {
  const weeklyHours = {};
  hoursInputs.forEach((input, dayIndex) => {
    weeklyHours[dayIndex] = parseWeeklyHoursValue(input.value);
  });

  const config = {
    version: 1,
    business: {
      name: String(businessNameInput.value || "").trim(),
      shortName: String(businessShortNameInput.value || "").trim(),
      address: String(businessAddressInput.value || "").trim(),
      phoneDisplay: String(businessPhoneDisplayInput.value || "").trim(),
      phoneTel: String(businessPhoneTelInput.value || "").trim(),
      email: String(businessEmailInput.value || "").trim(),
      timezone: "Europe/London"
    },
    home: {
      weeklyHours
    },
    orders: {
      openDayIndexes: checkedDayIndexes(orderOpenDaysRoot),
      serviceStartMinutes: clockToMinutes(ordersStartInput.value),
      serviceEndMinutes: clockToMinutes(ordersEndInput.value),
      slotStepMinutes: Number(ordersStepInput.value || 15),
      maxLookaheadDays: Number(ordersLookaheadInput.value || 90),
      collectionMinLeadMinutes: Number(collectionLeadInput.value || 30),
      deliveryMinLeadMinutes: Number(deliveryLeadInput.value || 60),
      collectionEarliestScheduledMinutes: clockToMinutes(collectionEarliestInput.value),
      deliveryEarliestScheduledMinutes: clockToMinutes(deliveryEarliestInput.value)
    },
    bookings: {
      openDayIndexes: checkedDayIndexes(bookingOpenDaysRoot),
      serviceStartMinutes: clockToMinutes(bookingsStartInput.value),
      serviceEndMinutes: clockToMinutes(bookingsEndInput.value),
      slotStepMinutes: Number(bookingsStepInput.value || 15),
      maxLookaheadDays: Number(bookingsLookaheadInput.value || 120),
      defaultDurationMinutes: Number(bookingDurationInput.value || 90)
    },
    delivery: {
      baseFeeGBP: Number(deliveryFeeInput.value || 0),
      etaMinMinutes: Number(etaMinInput.value || 0),
      etaMaxMinutes: Number(etaMaxInput.value || 0),
      outsideAreaMode: String(outsideAreaModeSelect.value || "review").trim().toLowerCase() === "reject" ? "reject" : "review",
      allowedOutwardPrefixes: String(deliveryPrefixesInput.value || "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    }
  };

  if (config.orders.openDayIndexes.length === 0) {
    throw new Error("Choose at least one ordering day.");
  }
  if (config.bookings.openDayIndexes.length === 0) {
    throw new Error("Choose at least one booking day.");
  }

  return config;
}

function renderMenu(menu) {
  menuCatalogState = Array.isArray(menu) ? menu : [];
  if (menuTextarea) {
    menuTextarea.value = JSON.stringify(menuCatalogState, null, 2);
  }
}

function renderAnalytics(summary) {
  if (!analyticsSummary) return;
  const totals = summary?.totals || {};
  const totalEvents = Number(totals.total || 0);

  function renderRows(rows, emptyMessage) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return `<article class="accountEmptyState"><p>${escapeHtml(emptyMessage)}</p></article>`;
    }

    return [
      '<div class="adminListCard">',
      rows.slice(0, 10).map((row) => (
        `<div class="adminListRow"><span>${escapeHtml(row.key)}</span><strong>${escapeHtml(row.count)}</strong></div>`
      )).join(""),
      '</div>'
    ].join("");
  }

  const dailyRows = Array.isArray(summary?.daily) ? summary.daily : [];
  const dailyMarkup = dailyRows.length > 0
    ? [
      '<div class="adminListCard">',
      dailyRows.map((row) => (
        `<div class="adminDailyRow"><span>${escapeHtml(row.date)}</span><strong>${escapeHtml(row.total)}</strong></div>`
      )).join(""),
      '</div>'
    ].join("")
    : '<article class="accountEmptyState"><p>No daily analytics recorded yet.</p></article>';

  analyticsSummary.innerHTML = [
    '<div class="adminAnalyticsGrid">',
    `<article class="accountCard"><p class="accountEyebrow">Total events</p><h2>${escapeHtml(totalEvents)}</h2><p class="accountHelper">Captured over the selected window.</p></article>`,
    `<article class="accountCard"><p class="accountEyebrow">Top events</p><h2>Event mix</h2>${renderRows(totals.events, "No event data recorded yet.")}</article>`,
    `<article class="accountCard"><p class="accountEyebrow">Routes</p><h2>Most active routes</h2>${renderRows(totals.routes, "No route data recorded yet.")}</article>`,
    `<article class="accountCard"><p class="accountEyebrow">Order types</p><h2>Checkout funnel</h2>${renderRows(totals.orderTypes, "No order-type data recorded yet.")}</article>`,
    `<article class="accountCard"><p class="accountEyebrow">Pages</p><h2>Tracked pages</h2>${renderRows(totals.pages, "No page-view data recorded yet.")}</article>`,
    `<article class="accountCard"><p class="accountEyebrow">Daily totals</p><h2>Activity by day</h2>${dailyMarkup}</article>`,
    '</div>'
  ].join("");
}

async function loadConfig() {
  const body = await fetchAdminJson(ADMIN_CONFIG_API);
  renderConfig(body.config || {});
}

async function loadMenu() {
  const body = await fetchAdminJson(ADMIN_MENU_API);
  renderMenu(body.menu || []);
}

async function loadAnalytics() {
  const days = Number(analyticsDaysSelect?.value || 30);
  const body = await fetchAdminJson(`${ADMIN_ANALYTICS_API}?days=${days}`);
  renderAnalytics(body);
}

async function handleAdminLoad(event) {
  event.preventDefault();
  setButtonBusy(loadBtn, true, "Loading...");
  setFeedback(adminFeedback, "");
  saveToken(tokenValue());

  try {
    await Promise.all([loadConfig(), loadMenu(), loadAnalytics()]);
    setFeedback(adminFeedback, "Admin data loaded.", false);
    setFeedback(configFeedback, "", false);
    setFeedback(menuFeedback, "", false);
    setFeedback(analyticsFeedback, "", false);
  } catch (error) {
    setFeedback(adminFeedback, error instanceof Error && error.message ? error.message : "Admin data could not be loaded.", true);
  } finally {
    setButtonBusy(loadBtn, false);
  }
}

async function handleConfigSave(event) {
  event.preventDefault();
  setButtonBusy(saveConfigBtn, true, "Saving...");
  setFeedback(configFeedback, "");

  try {
    const config = collectConfig();
    const body = await fetchAdminJson(ADMIN_CONFIG_API, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ config })
    });

    renderConfig(body.config || config);
    setFeedback(configFeedback, "Site configuration saved.", false);
  } catch (error) {
    setFeedback(configFeedback, error instanceof Error && error.message ? error.message : "Site configuration could not be saved.", true);
  } finally {
    setButtonBusy(saveConfigBtn, false);
  }
}

async function handleMenuSave(event) {
  event.preventDefault();
  setButtonBusy(saveMenuBtn, true, "Saving...");
  setFeedback(menuFeedback, "");

  try {
    const parsed = JSON.parse(String(menuTextarea?.value || "[]"));
    if (!Array.isArray(parsed)) {
      throw new Error("Menu JSON must be an array of menu categories.");
    }

    const body = await fetchAdminJson(ADMIN_MENU_API, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ menu: parsed })
    });

    renderMenu(body.menu || parsed);
    setFeedback(menuFeedback, "Menu catalog saved.", false);
  } catch (error) {
    setFeedback(menuFeedback, error instanceof Error && error.message ? error.message : "Menu catalog could not be saved.", true);
  } finally {
    setButtonBusy(saveMenuBtn, false);
  }
}

async function handleAnalyticsRefresh(event) {
  event.preventDefault();
  setButtonBusy(refreshAnalyticsBtn, true, "Refreshing...");
  setFeedback(analyticsFeedback, "");

  try {
    await loadAnalytics();
    setFeedback(analyticsFeedback, "Analytics summary refreshed.", false);
  } catch (error) {
    setFeedback(analyticsFeedback, error instanceof Error && error.message ? error.message : "Analytics summary could not be loaded.", true);
  } finally {
    setButtonBusy(refreshAnalyticsBtn, false);
  }
}

function clearStoredToken() {
  if (tokenInput) tokenInput.value = "";
  saveToken("");
  setFeedback(adminFeedback, "Token cleared from this browser.", false);
}

function initialize() {
  const storedToken = loadStoredToken();
  if (storedToken && tokenInput) {
    tokenInput.value = storedToken;
  }

  authForm?.addEventListener("submit", handleAdminLoad);
  configForm?.addEventListener("submit", handleConfigSave);
  menuForm?.addEventListener("submit", handleMenuSave);
  analyticsForm?.addEventListener("submit", handleAnalyticsRefresh);
  loadMenuBtn?.addEventListener("click", () => {
    void (async () => {
      setButtonBusy(loadMenuBtn, true, "Loading...");
      setFeedback(menuFeedback, "");
      try {
        await loadMenu();
        setFeedback(menuFeedback, "Menu catalog reloaded.", false);
      } catch (error) {
        setFeedback(menuFeedback, error instanceof Error && error.message ? error.message : "Menu catalog could not be loaded.", true);
      } finally {
        setButtonBusy(loadMenuBtn, false);
      }
    })();
  });
  clearBtn?.addEventListener("click", clearStoredToken);
}

initialize();
