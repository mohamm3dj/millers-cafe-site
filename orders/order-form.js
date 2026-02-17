"use strict";

const API_BASE = "/api/orders";
const BUSINESS_TIMEZONE = "Europe/London";
const SERVICE_START_MINUTES = 12 * 60;
const SERVICE_END_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;
const ASAP_VALUE = "ASAP";
const COLLECTION_MIN_LEAD_MINUTES = 30;
const DELIVERY_MIN_LEAD_MINUTES = 60;
const MAX_ORDER_LOOKAHEAD_DAYS = 90;
const OPEN_DAY_INDEXES = new Set([0, 2, 3, 4, 5, 6]); // Sun, Tue-Sat (Mon closed)
const OCCASION_OPTIONS = [
  "None",
  "Birthday",
  "Anniversary",
  "Engagement",
  "Date Night",
  "Business",
  "Celebration"
];
const VALID_OCCASIONS = new Set(OCCASION_OPTIONS);

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
const occasionSelect = document.getElementById("orderOccasion");
const itemsInput = document.getElementById("orderItems");
const notesInput = document.getElementById("orderNotes");

const address1Input = document.getElementById("orderAddress1");
const address2Input = document.getElementById("orderAddress2");
const townInput = document.getElementById("orderTown");
const postcodeInput = document.getElementById("orderPostcode");
let isSubmitting = false;
let hasSelectableTime = true;

function pad2(value) {
  return String(value).padStart(2, "0");
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
  const digits = phoneInput.value.replace(/\D/g, "").slice(0, 11);
  phoneInput.value = digits.length <= 5
    ? digits
    : `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function renderDateOptions() {
  if (!dateSelect) return;
  const priorValue = dateSelect.value;
  const options = buildBookableDateList(ukTodayISODate(), MAX_ORDER_LOOKAHEAD_DAYS);

  dateSelect.innerHTML = "";
  for (const isoDate of options) {
    const option = document.createElement("option");
    option.value = isoDate;
    option.textContent = `${displayDateLabel(isoDate)} (${isoDate})`;
    dateSelect.appendChild(option);
  }

  if (priorValue && options.includes(priorValue)) {
    dateSelect.value = priorValue;
  } else if (options.length > 0) {
    dateSelect.value = options[0];
  }
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

  timeSelect.innerHTML = "";
  if (asapEnabled) {
    const asapOption = document.createElement("option");
    asapOption.value = ASAP_VALUE;
    asapOption.textContent = ASAP_VALUE;
    timeSelect.appendChild(asapOption);
  }

  for (const slot of slots) {
    const option = document.createElement("option");
    option.value = slot;
    option.textContent = slot;
    timeSelect.appendChild(option);
  }

  hasSelectableTime = asapEnabled || slots.length > 0;
  if (!hasSelectableTime) {
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "No slots available";
    timeSelect.appendChild(noneOption);
    timeSelect.value = "";
  } else if ([...timeSelect.options].some((option) => option.value === priorValue)) {
    timeSelect.value = priorValue;
  } else if (asapEnabled) {
    timeSelect.value = ASAP_VALUE;
  } else if (slots.length > 0) {
    timeSelect.value = slots[0];
  }

  updateSubmitButtonState();
  updateTimeNotice(orderType, selectedDate, slots, asapEnabled);
}

function renderOccasionOptions() {
  if (!occasionSelect) return;
  const priorValue = occasionSelect.value || "None";
  occasionSelect.innerHTML = "";

  for (const occasion of OCCASION_OPTIONS) {
    const option = document.createElement("option");
    option.value = occasion;
    option.textContent = occasion;
    if (occasion === "None") option.defaultSelected = true;
    occasionSelect.appendChild(option);
  }

  if (VALID_OCCASIONS.has(priorValue)) {
    occasionSelect.value = priorValue;
  } else {
    occasionSelect.value = "None";
  }
}

function clearFeedback() {
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

  const text = document.createElement("div");
  text.textContent = message;
  resultEl.appendChild(text);

  if (referenceText) {
    const reference = document.createElement("div");
    reference.className = "bookingRef";
    reference.textContent = referenceText;
    resultEl.appendChild(reference);
  }
}

function setNotice(message, warning = false) {
  if (!noticeEl) return;
  noticeEl.textContent = message;
  noticeEl.classList.toggle("isWarning", warning);
}

function setSubmitting(submitting) {
  if (!submitBtn) return;
  isSubmitting = Boolean(submitting);
  updateSubmitButtonState();
}

function updateSubmitButtonState() {
  if (!submitBtn) return;
  const orderType = String(orderTypeField?.value || "collection").toLowerCase();
  const idleLabel = orderType === "delivery" ? "Place delivery order" : "Place collection order";
  submitBtn.disabled = isSubmitting || !hasSelectableTime;
  submitBtn.textContent = isSubmitting ? "Submitting..." : idleLabel;
}

function minScheduledMinutes(orderType, isoDate) {
  const now = ukNowDateAndMinutes();
  if (isoDate !== now.dateISO) {
    return SERVICE_START_MINUTES;
  }

  const lead = leadMinutesForOrderType(orderType);
  const withLead = now.minutesNow + lead;
  return Math.max(SERVICE_START_MINUTES, roundUpToStep(withLead, SLOT_STEP_MINUTES));
}

function scheduledSlotTimes(orderType, isoDate) {
  const minimum = minScheduledMinutes(orderType, isoDate);
  return slotTimes().filter((clock) => {
    const minutes = clockToMinutes(clock);
    return Number.isFinite(minutes) && minutes >= minimum;
  });
}

function updateTimeNotice(orderType, isoDate, slots, asapEnabled) {
  const label = orderType === "delivery" ? "Delivery" : "Collection";
  const isToday = isoDate === ukTodayISODate();
  if (!isToday) {
    setNotice(`${label} hours: Tue-Sun, 12:00-17:00. ${label} slots are in 15-minute intervals.`, false);
    return;
  }

  if (!asapEnabled && slots.length === 0) {
    setNotice("No slots are left today. Please choose another date.", true);
    return;
  }

  const lead = leadMinutesForOrderType(orderType);
  const earliest = slots[0] ? ` Earliest scheduled slot: ${slots[0]}.` : "";
  setNotice(`${label} defaults to ASAP today. Scheduled times must be at least ${lead} minutes from now.${earliest}`, false);
}

function validatePayload(payload) {
  if (!payload.customerName || payload.customerName.length < 2) {
    return "Please enter a valid name.";
  }

  if (!/^\d{5}\s\d{6}$/.test(payload.phoneNumber)) {
    return "Phone number must be in format XXXXX XXXXXX.";
  }

  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return "Please enter a valid email address.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    return "Please choose a valid date.";
  }

  if (!isBookableDay(payload.date)) {
    return "Orders are available Tuesday to Sunday only.";
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
    if (!Number.isFinite(minutes)) {
      return "Please choose a valid time.";
    }

    if (minutes < SERVICE_START_MINUTES || minutes > SERVICE_END_MINUTES) {
      return "Orders must be between 12:00 and 17:00.";
    }

    if (minutes % SLOT_STEP_MINUTES !== 0) {
      return "Orders must be in 15-minute intervals.";
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

  if (!VALID_OCCASIONS.has(payload.specialOccasion || "None")) {
    return "Please choose a valid occasion.";
  }

  if (!payload.itemsSummary || payload.itemsSummary.length < 3) {
    return "Please enter your order details.";
  }

  if (payload.orderType === "delivery") {
    if (!payload.addressLine1) return "Address line 1 is required for delivery.";
    if (!payload.townCity) return "Town / City is required for delivery.";
    if (!payload.postcode) return "Postcode is required for delivery.";
  }

  return null;
}

async function handleSubmit(event) {
  event.preventDefault();
  clearFeedback();

  const orderType = String(orderTypeField?.value || "collection").toLowerCase();
  const payload = {
    orderType,
    customerName: (nameInput?.value || "").trim(),
    phoneNumber: (phoneInput?.value || "").trim(),
    email: (emailInput?.value || "").trim(),
    date: dateSelect?.value || "",
    time: timeSelect?.value || "",
    specialOccasion: (occasionSelect?.value || "None").trim(),
    itemsSummary: (itemsInput?.value || "").trim(),
    notes: (notesInput?.value || "").trim(),
    addressLine1: (address1Input?.value || "").trim(),
    addressLine2: (address2Input?.value || "").trim(),
    townCity: (townInput?.value || "").trim(),
    postcode: (postcodeInput?.value || "").trim()
  };

  const validationError = validatePayload(payload);
  if (validationError) {
    showError(validationError);
    return;
  }

  setSubmitting(true);

  try {
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    let body = {};
    try {
      body = await response.json();
    } catch (error) {
      body = {};
    }

    if (!response.ok) {
      showError(body.error || "Could not place order right now. Please try again.");
      return;
    }

    const orderLabel = payload.orderType === "delivery" ? "Delivery" : "Collection";
    const whenText = payload.time === ASAP_VALUE
      ? "as soon as possible"
      : `for ${payload.date} at ${payload.time}`;
    const successMessage = `${orderLabel} order confirmed ${whenText}. Confirmation emails sent to you and Millers Café.`;
    const reference = body.reference ? `Reference: ${body.reference}` : "";

    showResult(successMessage, reference);
    setNotice(`${orderLabel} order submitted successfully.`, false);

    const preservedDate = payload.date;
    const preservedTime = payload.time;

    form.reset();
    if (orderTypeField) orderTypeField.value = orderType;
    renderOccasionOptions();

    if (dateSelect) dateSelect.value = preservedDate;
    if (timeSelect) {
      renderTimeOptions();
      if ([...timeSelect.options].some((option) => option.value === preservedTime)) {
        timeSelect.value = preservedTime;
      }
    }
  } catch (error) {
    showError("Order service is currently unavailable. Please try again shortly.");
  } finally {
    setSubmitting(false);
  }
}

function initialize() {
  if (!form) return;

  renderDateOptions();
  renderTimeOptions();
  renderOccasionOptions();

  form.addEventListener("submit", handleSubmit);
  dateSelect?.addEventListener("change", () => {
    clearFeedback();
    renderTimeOptions();
  });
  phoneInput?.addEventListener("input", normalizePhoneField);
  phoneInput?.addEventListener("blur", normalizePhoneField);
  updateSubmitButtonState();
}

initialize();
