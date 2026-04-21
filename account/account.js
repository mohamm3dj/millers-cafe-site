import { createEmptyOrderDraftState } from "../orders/order-draft.js";

const ACCOUNT_ME_API = "/api/account/me";
const ACCOUNT_REQUEST_CODE_API = "/api/account/request-code";
const ACCOUNT_VERIFY_CODE_API = "/api/account/verify-code";
const ACCOUNT_LOGOUT_API = "/api/account/logout";
const ACCOUNT_BOOKINGS_API = "/api/account/bookings";
const ACCOUNT_ORDERS_API = "/api/account/orders";
const ACCOUNT_PROFILE_API = "/api/account/profile";
const ACCOUNT_BOOKING_CANCEL_API = "/api/account/bookings/cancel";
const ACCOUNT_BOOKING_RESCHEDULE_API = "/api/account/bookings/reschedule";
const BOOKINGS_SLOTS_API = "/api/bookings/slots";
const SITE_CONFIG_API = "/api/site-config";
const BUSINESS_TIMEZONE = "Europe/London";
const ORDER_DRAFT_STORAGE_KEY = "millers-cafe-order-draft-v2";
const ORDER_DRAFT_VERSION = 2;

const requestForm = document.getElementById("accountRequestForm");
const verifyForm = document.getElementById("accountVerifyForm");
const signedInActions = document.getElementById("accountSignedInActions");
const emailInput = document.getElementById("accountEmail");
const codeInput = document.getElementById("accountCode");
const requestBtn = document.getElementById("accountRequestBtn");
const verifyBtn = document.getElementById("accountVerifyBtn");
const resendBtn = document.getElementById("accountResendBtn");
const changeEmailBtn = document.getElementById("accountChangeEmailBtn");
const logoutBtn = document.getElementById("accountLogoutBtn");
const authTitle = document.getElementById("accountAuthTitle");
const authCopy = document.getElementById("accountAuthCopy");
const verifyEmailEl = document.getElementById("accountVerifyEmail");
const signedInBanner = document.getElementById("accountSignedInBanner");
const preferredOrderLink = document.getElementById("accountPreferredOrderLink");
const feedbackEl = document.getElementById("accountAuthFeedback");
const summaryList = document.getElementById("accountSummaryList");
const summaryHelper = document.getElementById("accountSummaryHelper");
const bookingsList = document.getElementById("accountBookingsList");
const ordersList = document.getElementById("accountOrdersList");
const turnstileContainer = document.getElementById("accountTurnstile");

const profileForm = document.getElementById("accountProfileForm");
const profileEmptyState = document.getElementById("accountProfileEmptyState");
const profileNameInput = document.getElementById("accountProfileName");
const profilePhoneInput = document.getElementById("accountProfilePhone");
const preferredOrderTypeSelect = document.getElementById("accountPreferredOrderType");
const addressLabelInput = document.getElementById("accountAddressLabel");
const address1Input = document.getElementById("accountAddress1");
const address2Input = document.getElementById("accountAddress2");
const townInput = document.getElementById("accountTown");
const postcodeInput = document.getElementById("accountPostcode");
const profileSaveBtn = document.getElementById("accountProfileSaveBtn");
const profileResetBtn = document.getElementById("accountProfileResetBtn");
const profileFeedbackEl = document.getElementById("accountProfileFeedback");

const reschedulePanel = document.getElementById("accountReschedulePanel");
const rescheduleForm = document.getElementById("accountRescheduleForm");
const rescheduleMeta = document.getElementById("accountRescheduleMeta");
const rescheduleDateInput = document.getElementById("accountRescheduleDate");
const rescheduleTimeInput = document.getElementById("accountRescheduleTime");
const reschedulePartySizeInput = document.getElementById("accountReschedulePartySize");
const rescheduleNotesInput = document.getElementById("accountRescheduleNotes");
const rescheduleCloseBtn = document.getElementById("accountRescheduleCloseBtn");
const rescheduleCancelBtn = document.getElementById("accountRescheduleCancelBtn");
const rescheduleSaveBtn = document.getElementById("accountRescheduleSaveBtn");
const rescheduleFeedbackEl = document.getElementById("accountRescheduleFeedback");

let pendingEmail = "";
let authenticatedEmail = "";
let authenticatedAccount = null;
let accountBookings = [];
let accountOrders = [];
let accountProfile = null;
let siteConfigState = null;
let accountTurnstileToken = "";
let accountTurnstileWidget = null;
let activeRescheduleBooking = null;
let activeAvailabilityRequestId = 0;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function normalizePostcode(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeText(value, fallback = "Not available") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function titleCaseWords(value) {
  return String(value || "")
    .trim()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function bookingStatusLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved") return "Confirmed";
  if (normalized === "completed") return "Completed";
  if (normalized === "cancelled" || normalized === "canceled") return "Cancelled";
  if (normalized === "no_show" || normalized === "noshow") return "No show";
  return titleCaseWords(normalized || "pending");
}

function orderStatusLabel(order) {
  const paymentStatus = String(order?.paymentStatus || "").trim().toLowerCase();
  const status = String(order?.status || "").trim().toLowerCase();
  if (status === "accepted" && paymentStatus === "paid") return "Accepted and paid";
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  if (status === "submitted" && paymentStatus === "paid") return "Submitted and paid";
  if (status === "submitted") return "Submitted";
  return titleCaseWords(status || "pending");
}

function parseMillis(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateLabel(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return safeText(isoDate, "Date unavailable");
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatDateTimeLabel(isoDate, time) {
  const dateLabel = formatDateLabel(isoDate);
  const timeLabel = String(time || "").trim();
  if (!timeLabel) return dateLabel;
  return `${dateLabel} at ${timeLabel}`;
}

function formatIsoTimestamp(isoValue) {
  const timestamp = Date.parse(String(isoValue || ""));
  if (!Number.isFinite(timestamp)) return "No recent activity";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function formatCurrencyMinor(amountMinor, currency = "gbp") {
  const amount = Number(amountMinor);
  if (!Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: String(currency || "gbp").trim().toUpperCase() || "GBP"
  }).format(amount / 100);
}

function isTerminalBookingStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "cancelled"
    || normalized === "canceled"
    || normalized === "completed"
    || normalized === "no_show"
    || normalized === "noshow";
}

function isUpcomingBooking(booking) {
  return Boolean(booking?.isUpcoming) && !isTerminalBookingStatus(booking?.status);
}

function setFeedback(target, message, isError = false) {
  if (!(target instanceof HTMLElement)) return;
  target.textContent = String(message || "");
  target.classList.toggle("isError", Boolean(isError && message));
  target.classList.toggle("isSuccess", Boolean(!isError && message));
}

function setButtonBusy(button, busy, busyText) {
  if (!(button instanceof HTMLButtonElement)) return;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent || "";
  }
  button.disabled = Boolean(busy);
  button.textContent = busy ? String(busyText || "Working...") : button.dataset.defaultLabel;
}

function trackClientEvent(eventName, details = {}) {
  if (!window.MillersClient || typeof window.MillersClient.trackEvent !== "function") {
    return Promise.resolve(false);
  }
  return window.MillersClient.trackEvent(eventName, details);
}

function showRequestState() {
  if (requestForm) requestForm.hidden = false;
  if (verifyForm) verifyForm.hidden = true;
  if (signedInActions) signedInActions.hidden = true;
  if (authTitle) authTitle.textContent = "Request a one-time code.";
  if (authCopy) {
    authCopy.textContent = "We will email a secure 6-digit code to the address attached to your Millers Café activity.";
  }
  if (signedInBanner) {
    signedInBanner.textContent = "";
  }
}

function showVerifyState(email) {
  pendingEmail = normalizeEmail(email);
  if (requestForm) requestForm.hidden = true;
  if (verifyForm) verifyForm.hidden = false;
  if (signedInActions) signedInActions.hidden = true;
  if (authTitle) authTitle.textContent = "Enter your sign-in code.";
  if (authCopy) {
    authCopy.textContent = "The code expires after a short time for security.";
  }
  if (verifyEmailEl) {
    verifyEmailEl.textContent = `Code sent to ${pendingEmail}`;
  }
  if (codeInput) {
    codeInput.value = "";
    codeInput.focus();
  }
}

function showSignedInState(account) {
  authenticatedEmail = normalizeEmail(account?.email);
  if (requestForm) requestForm.hidden = true;
  if (verifyForm) verifyForm.hidden = true;
  if (signedInActions) signedInActions.hidden = false;
  if (authTitle) authTitle.textContent = "You are signed in.";
  if (authCopy) {
    authCopy.textContent = "Your saved history and shortcuts are loaded below. Sign out at any time on this device.";
  }
  if (signedInBanner) {
    signedInBanner.textContent = `Signed in as ${authenticatedEmail}`;
  }
}

function resetSummary() {
  if (!summaryList) return;
  summaryList.innerHTML = [
    ["Name", "Sign in to load"],
    ["Email", "Sign in to load"],
    ["Phone", "Sign in to load"],
    ["Bookings", "No account history loaded"],
    ["Orders", "No account history loaded"],
    ["Latest activity", "Sign in to load"]
  ].map(([label, value]) => (`<div><dt>${label}</dt><dd>${value}</dd></div>`)).join("");

  if (summaryHelper) {
    summaryHelper.textContent = "Use the same email address you entered at checkout or booking.";
  }
}

function renderSummary(account) {
  if (!summaryList) return;

  const rows = [
    ["Name", safeText(account?.profile?.fullName || account?.fullName, "Add your name with your next booking or order")],
    ["Email", safeText(account?.email)],
    ["Phone", safeText(account?.profile?.phoneNumber || account?.phoneNumber, "Add your phone number with your next booking or order")],
    ["Bookings", `${Number(account?.bookingCount || 0)} saved`],
    ["Orders", `${Number(account?.orderCount || 0)} saved`],
    ["Latest activity", formatIsoTimestamp(account?.lastActivityAt)]
  ];

  summaryList.innerHTML = rows
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");

  if (!summaryHelper) return;

  if (account?.upcomingBooking) {
    summaryHelper.textContent = `Next booking: ${account.upcomingBooking.reference} on ${formatDateTimeLabel(
      account.upcomingBooking.date,
      account.upcomingBooking.time
    )}.`;
    return;
  }

  if (account?.latestOrder) {
    summaryHelper.textContent = `Latest order: ${account.latestOrder.reference} · ${titleCaseWords(
      account.latestOrder.orderType
    )} · ${orderStatusLabel(account.latestOrder)}.`;
    return;
  }

  summaryHelper.textContent = "Your signed-in history will appear here as you book tables and place orders.";
}

function resetHistory() {
  if (bookingsList) {
    bookingsList.innerHTML = [
      '<article class="accountEmptyState">',
      "<h3>No booking history loaded yet.</h3>",
      "<p>Sign in to see reservations linked to your email address.</p>",
      "</article>"
    ].join("");
  }

  if (ordersList) {
    ordersList.innerHTML = [
      '<article class="accountEmptyState">',
      "<h3>No order history loaded yet.</h3>",
      "<p>Sign in to view previous collection and delivery orders.</p>",
      "</article>"
    ].join("");
  }
}

function renderProfile(account, profile) {
  accountProfile = profile && typeof profile === "object" ? profile : null;

  if (profileForm) profileForm.hidden = !accountProfile;
  if (profileEmptyState) profileEmptyState.hidden = Boolean(accountProfile);

  if (!accountProfile) {
    if (profileForm instanceof HTMLFormElement) profileForm.reset();
    if (preferredOrderLink instanceof HTMLAnchorElement) {
      preferredOrderLink.href = "../collection/";
      preferredOrderLink.textContent = "Start a collection order";
    }
    return;
  }

  if (profileNameInput) profileNameInput.value = String(accountProfile.fullName || account?.fullName || "").trim();
  if (profilePhoneInput) profilePhoneInput.value = normalizePhone(accountProfile.phoneNumber || account?.phoneNumber || "");
  if (preferredOrderTypeSelect) preferredOrderTypeSelect.value = String(accountProfile.preferredOrderType || "collection").trim().toLowerCase() === "delivery" ? "delivery" : "collection";
  syncPreferredOrderLink();

  const address = accountProfile.defaultDeliveryAddress && typeof accountProfile.defaultDeliveryAddress === "object"
    ? accountProfile.defaultDeliveryAddress
    : {};

  if (addressLabelInput) addressLabelInput.value = String(address.label || "").trim();
  if (address1Input) address1Input.value = String(address.addressLine1 || "").trim();
  if (address2Input) address2Input.value = String(address.addressLine2 || "").trim();
  if (townInput) townInput.value = String(address.townCity || "").trim();
  if (postcodeInput) postcodeInput.value = normalizePostcode(address.postcode || "");
}

function renderBookings(bookings) {
  if (!bookingsList) return;
  if (!Array.isArray(bookings) || bookings.length === 0) {
    bookingsList.innerHTML = [
      '<article class="accountEmptyState">',
      "<h3>No bookings found for this email.</h3>",
      "<p>New reservations will appear here after you book using this address.</p>",
      "</article>"
    ].join("");
    return;
  }

  bookingsList.innerHTML = bookings.map((booking) => {
    const occasion = String(booking.specialOccasion || "").trim();
    const assignedTables = Array.isArray(booking.assignedTables) && booking.assignedTables.length > 0
      ? `Table${booking.assignedTables.length === 1 ? "" : "s"} ${booking.assignedTables.join(", ")}`
      : "Table allocation on arrival";
    const canManage = isUpcomingBooking(booking);

    return [
      '<article class="accountHistoryItem">',
      `<div class="accountHistoryHeader"><h3>${escapeHtml(booking.reference)}</h3><span class="accountStatusPill">${escapeHtml(bookingStatusLabel(booking.status))}</span></div>`,
      `<p class="accountHistoryPrimary">${escapeHtml(formatDateTimeLabel(booking.date, booking.time))} · Party of ${escapeHtml(booking.partySize)}</p>`,
      `<p class="accountHistoryMeta">${escapeHtml(assignedTables)}</p>`,
      occasion && occasion !== "None"
        ? `<p class="accountHistoryMeta">Occasion: ${escapeHtml(occasion)}</p>`
        : "",
      booking.notes
        ? `<p class="accountHistoryNote">${escapeHtml(booking.notes)}</p>`
        : "",
      canManage
        ? [
          '<div class="accountActionRow accountHistoryActions">',
          `<button class="accountSecondaryBtn" type="button" data-booking-action="reschedule" data-booking-id="${escapeHtml(booking.id)}">Reschedule</button>`,
          `<button class="accountSecondaryBtn isDanger" type="button" data-booking-action="cancel" data-booking-id="${escapeHtml(booking.id)}">Cancel booking</button>`,
          '</div>'
        ].join("")
        : "",
      '</article>'
    ].join("");
  }).join("");
}

function renderOrders(orders) {
  if (!ordersList) return;
  if (!Array.isArray(orders) || orders.length === 0) {
    ordersList.innerHTML = [
      '<article class="accountEmptyState">',
      "<h3>No orders found for this email.</h3>",
      "<p>Collection and delivery orders placed with this address will appear here.</p>",
      "</article>"
    ].join("");
    return;
  }

  ordersList.innerHTML = orders.map((order) => {
    const paymentAmount = formatCurrencyMinor(order.paymentAmountTotal, order.paymentCurrency);
    const addressLine = order.orderType === "delivery"
      ? [order.addressLine1, order.addressLine2, order.townCity, order.postcode]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(", ")
      : "";
    const canReorder = Array.isArray(order.cartItems) && order.cartItems.length > 0;

    return [
      '<article class="accountHistoryItem">',
      `<div class="accountHistoryHeader"><h3>${escapeHtml(order.reference)}</h3><span class="accountStatusPill">${escapeHtml(orderStatusLabel(order))}</span></div>`,
      `<p class="accountHistoryPrimary">${escapeHtml(titleCaseWords(order.orderType))} · ${escapeHtml(formatDateTimeLabel(order.date, order.time))}</p>`,
      `<p class="accountHistoryMeta">${escapeHtml(safeText(order.itemsSummary, "Order details unavailable"))}</p>`,
      paymentAmount
        ? `<p class="accountHistoryMeta">Paid ${escapeHtml(paymentAmount)}</p>`
        : "",
      addressLine
        ? `<p class="accountHistoryMeta">${escapeHtml(addressLine)}</p>`
        : "",
      order.notes
        ? `<p class="accountHistoryNote">${escapeHtml(order.notes)}</p>`
        : "",
      canReorder
        ? [
          '<div class="accountActionRow accountHistoryActions">',
          `<button class="accountSecondaryBtn" type="button" data-order-action="reorder" data-order-id="${escapeHtml(order.id)}">Reorder this</button>`,
          '</div>'
        ].join("")
        : '<p class="accountHistoryMeta">This order cannot be rebuilt automatically because no structured basket was saved for it.</p>',
      '</article>'
    ].join("");
  }).join("");
}

function resetProfileArea() {
  authenticatedAccount = null;
  accountProfile = null;
  if (profileForm instanceof HTMLFormElement) {
    profileForm.reset();
    profileForm.hidden = true;
  }
  if (profileEmptyState) profileEmptyState.hidden = false;
  setFeedback(profileFeedbackEl, "");
}

function closeReschedulePanel() {
  activeRescheduleBooking = null;
  if (reschedulePanel) {
    reschedulePanel.hidden = true;
    reschedulePanel.setAttribute("aria-hidden", "true");
  }
  setFeedback(rescheduleFeedbackEl, "");
}

function openReschedulePanel() {
  if (!reschedulePanel) return;
  reschedulePanel.hidden = false;
  reschedulePanel.setAttribute("aria-hidden", "false");
}

function readProfilePayload() {
  const address = {
    label: String(addressLabelInput?.value || "").trim() || "Default delivery address",
    addressLine1: String(address1Input?.value || "").trim(),
    addressLine2: String(address2Input?.value || "").trim(),
    townCity: String(townInput?.value || "").trim(),
    postcode: normalizePostcode(postcodeInput?.value || "")
  };

  const hasAddress = Boolean(address.addressLine1 || address.addressLine2 || address.townCity || address.postcode);

  return {
    fullName: String(profileNameInput?.value || "").trim(),
    phoneNumber: normalizePhone(profilePhoneInput?.value || ""),
    preferredOrderType: String(preferredOrderTypeSelect?.value || "collection").trim().toLowerCase() === "delivery"
      ? "delivery"
      : "collection",
    defaultDeliveryAddress: hasAddress ? address : null
  };
}

function updateProfileFormFromCurrentState() {
  renderProfile(authenticatedAccount, accountProfile || authenticatedAccount?.profile || null);
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
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

async function loadSiteConfig() {
  try {
    const payload = await fetchJson(SITE_CONFIG_API);
    siteConfigState = payload?.config || null;
  } catch (error) {
    siteConfigState = null;
  }
}

async function setupAccountTurnstile() {
  const enabled = Boolean(siteConfigState?.security?.turnstileEnabled && siteConfigState?.security?.turnstileSiteKey);
  accountTurnstileToken = "";

  if (!turnstileContainer || !enabled || !window.MillersClient || typeof window.MillersClient.mountTurnstile !== "function") {
    if (turnstileContainer) turnstileContainer.hidden = true;
    return;
  }

  try {
    accountTurnstileWidget = await window.MillersClient.mountTurnstile(
      turnstileContainer,
      String(siteConfigState.security.turnstileSiteKey || ""),
      {
        onToken(token) {
          accountTurnstileToken = String(token || "");
        },
        onExpire() {
          accountTurnstileToken = "";
        },
        onError() {
          accountTurnstileToken = "";
        }
      }
    );
  } catch (error) {
    accountTurnstileWidget = null;
  }
}

function resetAccountTurnstile() {
  accountTurnstileToken = "";
  if (accountTurnstileWidget && typeof accountTurnstileWidget.reset === "function") {
    accountTurnstileWidget.reset();
  }
}

async function loadAuthenticatedHistory() {
  const [bookingsPayload, ordersPayload] = await Promise.all([
    fetchJson(ACCOUNT_BOOKINGS_API),
    fetchJson(ACCOUNT_ORDERS_API)
  ]);

  accountBookings = Array.isArray(bookingsPayload.bookings) ? bookingsPayload.bookings : [];
  accountOrders = Array.isArray(ordersPayload.orders) ? ordersPayload.orders : [];
  renderBookings(accountBookings);
  renderOrders(accountOrders);
}

async function loadAccountState() {
  resetSummary();
  resetHistory();
  resetProfileArea();
  setFeedback(feedbackEl, "");

  try {
    const payload = await fetchJson(ACCOUNT_ME_API);
    if (!payload.authenticated) {
      authenticatedEmail = "";
      authenticatedAccount = null;
      showRequestState();
      return;
    }

    authenticatedAccount = payload.account || null;
    accountProfile = authenticatedAccount?.profile || null;
    renderSummary(authenticatedAccount || {});
    renderProfile(authenticatedAccount || {}, accountProfile);
    showSignedInState(authenticatedAccount || {});
    await loadAuthenticatedHistory();
  } catch (error) {
    authenticatedEmail = "";
    authenticatedAccount = null;
    showRequestState();
    setFeedback(feedbackEl, error instanceof Error && error.message ? error.message : "Account could not be loaded.", true);
  }
}

async function requestCodeForEmail(email) {
  const normalized = normalizeEmail(email);
  const payload = await fetchJson(ACCOUNT_REQUEST_CODE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: normalized,
      turnstileToken: accountTurnstileToken
    })
  });

  showVerifyState(normalized);
  resetAccountTurnstile();
  setFeedback(feedbackEl, `Code sent to ${payload.emailMasked || normalized}.`, false);
}

async function handleRequestSubmit(event) {
  event.preventDefault();
  const email = normalizeEmail(emailInput?.value);
  if (!email) {
    setFeedback(feedbackEl, "Enter the email you used for bookings or orders.", true);
    return;
  }

  setButtonBusy(requestBtn, true, "Sending...");
  try {
    await requestCodeForEmail(email);
  } catch (error) {
    resetAccountTurnstile();
    setFeedback(feedbackEl, error instanceof Error && error.message ? error.message : "Sign-in email could not be sent.", true);
  } finally {
    setButtonBusy(requestBtn, false);
  }
}

async function handleVerifySubmit(event) {
  event.preventDefault();
  const code = String(codeInput?.value || "").replace(/\D/g, "").slice(0, 6);
  if (!pendingEmail) {
    setFeedback(feedbackEl, "Request a new sign-in code first.", true);
    showRequestState();
    return;
  }
  if (code.length !== 6) {
    setFeedback(feedbackEl, "Enter the 6-digit code from your email.", true);
    return;
  }

  setButtonBusy(verifyBtn, true, "Signing in...");
  try {
    await fetchJson(ACCOUNT_VERIFY_CODE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: pendingEmail,
        code
      })
    });

    setFeedback(feedbackEl, "Signed in successfully.", false);
    await loadAccountState();
  } catch (error) {
    setFeedback(feedbackEl, error instanceof Error && error.message ? error.message : "Code could not be verified.", true);
  } finally {
    setButtonBusy(verifyBtn, false);
  }
}

async function handleResend() {
  if (!pendingEmail) {
    showRequestState();
    return;
  }

  setButtonBusy(resendBtn, true, "Sending...");
  try {
    await requestCodeForEmail(pendingEmail);
  } catch (error) {
    resetAccountTurnstile();
    setFeedback(feedbackEl, error instanceof Error && error.message ? error.message : "Code could not be resent.", true);
  } finally {
    setButtonBusy(resendBtn, false);
  }
}

async function handleLogout() {
  setButtonBusy(logoutBtn, true, "Signing out...");
  try {
    await fetchJson(ACCOUNT_LOGOUT_API, { method: "POST" });
    authenticatedEmail = "";
    pendingEmail = "";
    authenticatedAccount = null;
    accountBookings = [];
    accountOrders = [];
    if (emailInput) emailInput.value = "";
    showRequestState();
    resetSummary();
    resetHistory();
    resetProfileArea();
    closeReschedulePanel();
    setFeedback(feedbackEl, "Signed out.", false);
  } catch (error) {
    setFeedback(feedbackEl, error instanceof Error && error.message ? error.message : "Sign-out failed.", true);
  } finally {
    setButtonBusy(logoutBtn, false);
  }
}

function buildReorderDraft(order) {
  const orderType = String(order?.orderType || "collection").trim().toLowerCase() === "delivery" ? "delivery" : "collection";
  const cartItems = Array.isArray(order?.cartItems)
    ? order.cartItems.map((item, index) => ({
      id: index + 1,
      itemName: String(item.itemName || "").trim(),
      quantity: Math.max(1, Math.round(Number(item.quantity || 1))),
      modifierSelections: Array.isArray(item.modifierSelections)
        ? item.modifierSelections.map((selection) => ({
          groupName: String(selection.groupName || "").trim(),
          optionName: String(selection.optionName || "").trim(),
          isTextInput: Boolean(selection.isTextInput)
        })).filter((selection) => selection.groupName && selection.optionName)
        : []
    })).filter((item) => item.itemName)
    : [];

  const draft = createEmptyOrderDraftState({ orderDraftVersion: ORDER_DRAFT_VERSION });
  draft.cartItems = cartItems;
  draft.nextCartId = cartItems.length + 1;
  draft.basketOpen = true;
  draft.schedules[orderType] = {
    date: "",
    time: ""
  };
  return { draft, orderType };
}

function redirectToReorder(order) {
  const { draft, orderType } = buildReorderDraft(order);
  if (!Array.isArray(draft.cartItems) || draft.cartItems.length === 0) {
    setFeedback(feedbackEl, "This order cannot be rebuilt automatically because no structured basket was saved for it.", true);
    return;
  }

  try {
    window.localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch (error) {
    setFeedback(feedbackEl, "Saved basket could not be prepared on this device.", true);
    return;
  }

  window.location.href = orderType === "delivery" ? "../delivery/" : "../collection/";
}

function bookingById(bookingId) {
  return accountBookings.find((booking) => String(booking.id || "") === String(bookingId || "")) || null;
}

function orderById(orderId) {
  return accountOrders.find((order) => String(order.id || "") === String(orderId || "")) || null;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toISODateUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseISODateUTC(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return null;
  const [year, month, day] = String(isoDate).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function londonTodayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function bookingRules() {
  const source = siteConfigState?.bookings || {};
  const openDayIndexes = Array.isArray(source.openDayIndexes)
    ? source.openDayIndexes.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
    : [0, 2, 3, 4, 5, 6];

  return {
    openDayIndexes: openDayIndexes.length > 0 ? openDayIndexes : [0, 2, 3, 4, 5, 6],
    maxLookaheadDays: Math.max(1, Math.round(Number(source.maxLookaheadDays || 120))),
    defaultDurationMinutes: Math.max(15, Math.round(Number(source.defaultDurationMinutes || 90)))
  };
}

function buildBookableDates() {
  const rules = bookingRules();
  const today = parseISODateUTC(londonTodayISO());
  if (!today) return [];

  const openDays = new Set(rules.openDayIndexes);
  const results = [];
  const cursor = new Date(today);

  for (let offset = 0; offset < rules.maxLookaheadDays; offset += 1) {
    const date = new Date(cursor);
    date.setUTCDate(today.getUTCDate() + offset);
    if (openDays.has(date.getUTCDay())) {
      results.push(toISODateUTC(date));
    }
  }

  return results;
}

function renderReschedulePartySizeOptions(selectedValue = 2) {
  if (!(reschedulePartySizeInput instanceof HTMLSelectElement)) return;
  reschedulePartySizeInput.innerHTML = "";
  for (let size = 1; size <= 40; size += 1) {
    const option = document.createElement("option");
    option.value = String(size);
    option.textContent = String(size);
    if (size === selectedValue) option.selected = true;
    reschedulePartySizeInput.appendChild(option);
  }
}

function renderRescheduleDateOptions(selectedDate = "") {
  if (!(rescheduleDateInput instanceof HTMLSelectElement)) return;
  const dates = buildBookableDates();
  rescheduleDateInput.innerHTML = "";
  dates.forEach((isoDate) => {
    const option = document.createElement("option");
    option.value = isoDate;
    option.textContent = formatDateLabel(isoDate);
    if (isoDate === selectedDate) option.selected = true;
    rescheduleDateInput.appendChild(option);
  });

  if (!rescheduleDateInput.value && dates[0]) {
    rescheduleDateInput.value = dates[0];
  }
}

async function loadRescheduleTimeOptions(date, partySize, selectedTime = "") {
  if (!(rescheduleTimeInput instanceof HTMLSelectElement)) return;

  const requestId = activeAvailabilityRequestId + 1;
  activeAvailabilityRequestId = requestId;
  const params = new URLSearchParams({
    date,
    partySize: String(Math.max(1, Math.round(Number(partySize || 2)))),
    durationMinutes: String(activeRescheduleBooking?.durationMinutes || bookingRules().defaultDurationMinutes)
  });

  rescheduleTimeInput.innerHTML = '<option value="">Loading slots...</option>';

  try {
    const payload = await fetchJson(`${BOOKINGS_SLOTS_API}?${params.toString()}`);
    if (requestId !== activeAvailabilityRequestId) return;

    const slots = Array.isArray(payload.slots) ? payload.slots : [];
    rescheduleTimeInput.innerHTML = "";

    slots.forEach((slot) => {
      if (!slot?.available || !slot?.time) return;
      const option = document.createElement("option");
      option.value = String(slot.time);
      option.textContent = String(slot.time);
      if (String(slot.time) === selectedTime) option.selected = true;
      rescheduleTimeInput.appendChild(option);
    });

    if (!rescheduleTimeInput.value && rescheduleTimeInput.options.length > 0) {
      const currentTimeAvailable = slots.some((slot) => String(slot.time) === String(selectedTime) && slot.available);
      if (currentTimeAvailable) {
        rescheduleTimeInput.value = selectedTime;
      } else {
        rescheduleTimeInput.selectedIndex = 0;
      }
    }

    if (rescheduleTimeInput.options.length === 0) {
      rescheduleTimeInput.innerHTML = '<option value="">No slots available</option>';
      setFeedback(rescheduleFeedbackEl, String(payload.message || "No slots available for that date."), true);
      return;
    }

    setFeedback(rescheduleFeedbackEl, "", false);
  } catch (error) {
    if (requestId !== activeAvailabilityRequestId) return;
    rescheduleTimeInput.innerHTML = '<option value="">No slots available</option>';
    setFeedback(
      rescheduleFeedbackEl,
      error instanceof Error && error.message ? error.message : "Availability could not be loaded right now.",
      true
    );
  }
}

async function openBookingReschedule(bookingId) {
  const booking = bookingById(bookingId);
  if (!booking) {
    setFeedback(feedbackEl, "Booking could not be found.", true);
    return;
  }

  activeRescheduleBooking = booking;
  if (rescheduleMeta) {
    rescheduleMeta.textContent = `${booking.reference} · currently ${formatDateTimeLabel(booking.date, booking.time)}.`;
  }

  renderReschedulePartySizeOptions(Number(booking.partySize || 2));
  renderRescheduleDateOptions(String(booking.date || ""));
  if (rescheduleNotesInput) rescheduleNotesInput.value = String(booking.notes || "").trim();
  openReschedulePanel();
  await loadRescheduleTimeOptions(String(booking.date || ""), Number(booking.partySize || 2), String(booking.time || ""));
}

async function handleBookingCancel(bookingId) {
  const booking = bookingById(bookingId);
  if (!booking) {
    setFeedback(feedbackEl, "Booking could not be found.", true);
    return;
  }

  const confirmed = window.confirm(`Cancel booking ${booking.reference} for ${formatDateTimeLabel(booking.date, booking.time)}?`);
  if (!confirmed) return;

  try {
    await fetchJson(ACCOUNT_BOOKING_CANCEL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ bookingId })
    });

    setFeedback(feedbackEl, `Booking ${booking.reference} cancelled.`, false);
    await loadAccountState();
  } catch (error) {
    setFeedback(feedbackEl, error instanceof Error && error.message ? error.message : "Booking could not be cancelled.", true);
  }
}

async function handleRescheduleSubmit(event) {
  event.preventDefault();
  if (!activeRescheduleBooking) {
    closeReschedulePanel();
    return;
  }

  const payload = {
    date: String(rescheduleDateInput?.value || "").trim(),
    time: String(rescheduleTimeInput?.value || "").trim(),
    partySize: Number(reschedulePartySizeInput?.value || activeRescheduleBooking.partySize || 2),
    durationMinutes: Number(activeRescheduleBooking.durationMinutes || bookingRules().defaultDurationMinutes),
    specialOccasion: String(activeRescheduleBooking.specialOccasion || "None").trim() || "None",
    notes: String(rescheduleNotesInput?.value || "").trim()
  };

  if (!payload.date || !payload.time) {
    setFeedback(rescheduleFeedbackEl, "Choose a valid date and time.", true);
    return;
  }

  setButtonBusy(rescheduleSaveBtn, true, "Saving...");
  try {
    const reference = activeRescheduleBooking.reference;
    await fetchJson(ACCOUNT_BOOKING_RESCHEDULE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        bookingId: activeRescheduleBooking.id,
        booking: payload
      })
    });

    closeReschedulePanel();
    setFeedback(feedbackEl, `Booking ${reference} updated.`, false);
    await loadAccountState();
  } catch (error) {
    setFeedback(rescheduleFeedbackEl, error instanceof Error && error.message ? error.message : "Booking could not be rescheduled.", true);
  } finally {
    setButtonBusy(rescheduleSaveBtn, false);
  }
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  if (!authenticatedEmail) {
    setFeedback(profileFeedbackEl, "Sign in first to save your details.", true);
    return;
  }

  const payload = readProfilePayload();
  setButtonBusy(profileSaveBtn, true, "Saving...");
  try {
    const body = await fetchJson(ACCOUNT_PROFILE_API, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ profile: payload })
    });

    accountProfile = body.profile || payload;
    updateProfileFormFromCurrentState();
    setFeedback(profileFeedbackEl, "Saved customer details updated.", false);
    await loadAccountState();
  } catch (error) {
    setFeedback(profileFeedbackEl, error instanceof Error && error.message ? error.message : "Profile could not be saved.", true);
  } finally {
    setButtonBusy(profileSaveBtn, false);
  }
}

function handleProfileReset() {
  updateProfileFormFromCurrentState();
  setFeedback(profileFeedbackEl, "", false);
}

function syncPreferredOrderLink() {
  if (!(preferredOrderLink instanceof HTMLAnchorElement)) return;
  const preferredOrderType = preferredOrderTypeSelect?.value === "delivery" ? "delivery" : "collection";
  preferredOrderLink.href = preferredOrderType === "delivery" ? "../delivery/" : "../collection/";
  preferredOrderLink.textContent = preferredOrderType === "delivery"
    ? "Start a delivery order"
    : "Start a collection order";
}

function handleBookingsListClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("button[data-booking-action]");
  if (!(button instanceof HTMLButtonElement)) return;

  const action = String(button.dataset.bookingAction || "");
  const bookingId = String(button.dataset.bookingId || "");
  if (!bookingId) return;

  if (action === "cancel") {
    void handleBookingCancel(bookingId);
    return;
  }
  if (action === "reschedule") {
    void openBookingReschedule(bookingId);
  }
}

function handleOrdersListClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("button[data-order-action]");
  if (!(button instanceof HTMLButtonElement)) return;

  const action = String(button.dataset.orderAction || "");
  const orderId = String(button.dataset.orderId || "");
  if (action !== "reorder" || !orderId) return;

  const order = orderById(orderId);
  if (!order) {
    setFeedback(feedbackEl, "Order could not be found.", true);
    return;
  }

  redirectToReorder(order);
}

function initialize() {
  requestForm?.addEventListener("submit", handleRequestSubmit);
  verifyForm?.addEventListener("submit", handleVerifySubmit);
  profileForm?.addEventListener("submit", handleProfileSubmit);
  resendBtn?.addEventListener("click", () => {
    void handleResend();
  });
  changeEmailBtn?.addEventListener("click", () => {
    pendingEmail = "";
    setFeedback(feedbackEl, "");
    showRequestState();
    emailInput?.focus();
  });
  logoutBtn?.addEventListener("click", () => {
    void handleLogout();
  });
  codeInput?.addEventListener("input", () => {
    if (!(codeInput instanceof HTMLInputElement)) return;
    codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
  });
  profilePhoneInput?.addEventListener("input", () => {
    if (!(profilePhoneInput instanceof HTMLInputElement)) return;
    profilePhoneInput.value = normalizePhone(profilePhoneInput.value);
  });
  preferredOrderTypeSelect?.addEventListener("change", syncPreferredOrderLink);
  postcodeInput?.addEventListener("input", () => {
    if (!(postcodeInput instanceof HTMLInputElement)) return;
    postcodeInput.value = normalizePostcode(postcodeInput.value);
  });
  profileResetBtn?.addEventListener("click", handleProfileReset);
  bookingsList?.addEventListener("click", handleBookingsListClick);
  ordersList?.addEventListener("click", handleOrdersListClick);
  rescheduleForm?.addEventListener("submit", handleRescheduleSubmit);
  rescheduleCloseBtn?.addEventListener("click", closeReschedulePanel);
  rescheduleCancelBtn?.addEventListener("click", closeReschedulePanel);
  reschedulePanel?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-close-reschedule='true']")) {
      closeReschedulePanel();
    }
  });
  rescheduleDateInput?.addEventListener("change", () => {
    void loadRescheduleTimeOptions(
      String(rescheduleDateInput.value || ""),
      Number(reschedulePartySizeInput?.value || activeRescheduleBooking?.partySize || 2),
      String(activeRescheduleBooking?.time || "")
    );
  });
  reschedulePartySizeInput?.addEventListener("change", () => {
    void loadRescheduleTimeOptions(
      String(rescheduleDateInput?.value || ""),
      Number(reschedulePartySizeInput.value || activeRescheduleBooking?.partySize || 2),
      String(activeRescheduleBooking?.time || "")
    );
  });

  showRequestState();

  void (async () => {
    await loadSiteConfig();
    await setupAccountTurnstile();
    await loadAccountState();
    void trackClientEvent("account_page_view", {
      page: "account",
      route: window.location.pathname
    });
  })();
}

initialize();
