"use strict";

const API_BASE = "/api/bookings";
const BUSINESS_TIMEZONE = "Europe/London";
const SERVICE_START_MINUTES = 12 * 60;
const SERVICE_END_MINUTES = 16 * 60;
const SLOT_STEP_MINUTES = 15;
const DEFAULT_DURATION_MINUTES = 90;
const MAX_BOOKING_LOOKAHEAD_DAYS = 120;
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

const form = document.getElementById("bookingForm");
const noticeEl = document.getElementById("bookingsNotice");
const resultEl = document.getElementById("bookingResult");
const errorEl = document.getElementById("bookingError");
const submitBtn = document.getElementById("bookingSubmit");

const nameInput = document.getElementById("bookingName");
const phoneInput = document.getElementById("bookingPhone");
const emailInput = document.getElementById("bookingEmail");
const dateInput = document.getElementById("bookingDate");
const timeSelect = document.getElementById("bookingTime");
const partySizeInput = document.getElementById("bookingPartySize");
const occasionSelect = document.getElementById("bookingOccasion");
const notesInput = document.getElementById("bookingNotes");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function minutesToClock(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${pad2(hours)}:${pad2(mins)}`;
}

function clockToMinutes(clock) {
  const parts = String(clock || "").split(":");
  if (parts.length !== 2) return NaN;
  const hours = Number(parts[0]);
  const mins = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(mins)) return NaN;
  return (hours * 60) + mins;
}

function slotTimes() {
  const slots = [];
  for (let minutes = SERVICE_START_MINUTES; minutes <= SERVICE_END_MINUTES; minutes += SLOT_STEP_MINUTES) {
    slots.push(minutesToClock(minutes));
  }
  return slots;
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

function renderDateOptions() {
  if (!dateInput) return;
  const priorValue = dateInput.value;
  const today = ukTodayISODate();
  const options = buildBookableDateList(today, MAX_BOOKING_LOOKAHEAD_DAYS);

  dateInput.innerHTML = "";
  for (const isoDate of options) {
    const option = document.createElement("option");
    option.value = isoDate;
    option.textContent = `${displayDateLabel(isoDate)} (${isoDate})`;
    dateInput.appendChild(option);
  }

  if (priorValue && options.includes(priorValue)) {
    dateInput.value = priorValue;
  } else if (options.length > 0) {
    dateInput.value = options[0];
  }
}

function renderPartySizeOptions() {
  if (!partySizeInput) return;
  const priorSize = Number(partySizeInput.value || "2");
  partySizeInput.innerHTML = "";
  for (let size = 1; size <= 40; size += 1) {
    const option = document.createElement("option");
    option.value = String(size);
    option.textContent = String(size);
    partySizeInput.appendChild(option);
  }
  const normalized = Number.isInteger(priorSize) && priorSize >= 1 && priorSize <= 40 ? priorSize : 2;
  partySizeInput.value = String(normalized);
}

function normalizePhoneField() {
  if (!phoneInput) return;
  const digits = phoneInput.value.replace(/\D/g, "").slice(0, 11);
  phoneInput.value = digits.length <= 5
    ? digits
    : `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function setNotice(message, warning = false) {
  if (!noticeEl) return;
  noticeEl.textContent = message;
  noticeEl.classList.toggle("isWarning", warning);
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
    const ref = document.createElement("div");
    ref.className = "bookingRef";
    ref.textContent = referenceText;
    resultEl.appendChild(ref);
  }
}

function setSubmitting(submitting) {
  if (!submitBtn) return;
  submitBtn.disabled = submitting;
  submitBtn.textContent = submitting ? "Booking..." : "Book table";
}

function renderTimeOptions(slotRows) {
  if (!timeSelect) return;
  const priorValue = timeSelect.value;
  timeSelect.innerHTML = "";

  const hasRows = Array.isArray(slotRows) && slotRows.length > 0;
  const rows = hasRows ? slotRows : slotTimes().map((time) => ({ time, available: true }));

  let firstAvailable = "";
  for (const row of rows) {
    const option = document.createElement("option");
    option.value = row.time;
    const note = row.available ? "" : " · full";
    option.textContent = `${row.time}${note}`;
    option.disabled = !row.available;
    if (row.available && !firstAvailable) firstAvailable = row.time;
    timeSelect.appendChild(option);
  }

  if (priorValue && rows.some((row) => row.time === priorValue && row.available)) {
    timeSelect.value = priorValue;
  } else if (firstAvailable) {
    timeSelect.value = firstAvailable;
  } else {
    timeSelect.selectedIndex = 0;
  }
}

async function loadAvailability() {
  clearFeedback();
  const date = dateInput?.value || "";
  if (!date || isBookableDay(date)) {
    renderTimeOptions(slotTimes().map((time) => ({ time, available: true })));
    setNotice("Service hours: Tue-Sun, 12:00-16:00. Bookings are in 15-minute intervals.", false);
    return;
  }

  renderTimeOptions(slotTimes().map((time) => ({ time, available: false })));
  setNotice("Bookings are available Tue-Sun only. Please choose another date.", true);
}

function validateClientPayload(payload) {
  if (!payload.customerName || payload.customerName.length < 2) {
    return "Please enter a valid name.";
  }

  if (!/^\d{5}\s\d{6}$/.test(payload.phoneNumber)) {
    return "Phone number must be in format XXXXX XXXXXX.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    return "Please choose a valid date.";
  }

  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return "Please enter a valid email address.";
  }

  if (!isBookableDay(payload.date)) {
    return "Bookings are available Tue-Sun only.";
  }

  if (!/^\d{2}:\d{2}$/.test(payload.time)) {
    return "Please choose a valid time.";
  }
  const minutes = clockToMinutes(payload.time);
  if (!Number.isFinite(minutes)) {
    return "Please choose a valid time.";
  }
  if (minutes < SERVICE_START_MINUTES || minutes > SERVICE_END_MINUTES) {
    return "Bookings must be between 12:00 and 16:00.";
  }
  if (minutes % SLOT_STEP_MINUTES !== 0) {
    return "Bookings must be in 15-minute intervals.";
  }

  if (!Number.isInteger(payload.partySize) || payload.partySize < 1 || payload.partySize > 40) {
    return "Party size must be between 1 and 40.";
  }

  if (!Number.isInteger(payload.durationMinutes) || payload.durationMinutes < 15 || payload.durationMinutes > 240) {
    return "Duration must be between 15 and 240 minutes.";
  }

  if (!VALID_OCCASIONS.has(payload.specialOccasion)) {
    return "Please choose a valid occasion.";
  }

  return null;
}

async function handleSubmit(event) {
  event.preventDefault();
  clearFeedback();

  const payload = {
    customerName: (nameInput?.value || "").trim(),
    phoneNumber: (phoneInput?.value || "").trim(),
    email: (emailInput?.value || "").trim(),
    date: dateInput?.value || "",
    time: timeSelect?.value || "",
    partySize: Number(partySizeInput?.value || "0"),
    specialOccasion: (occasionSelect?.value || "None").trim(),
    durationMinutes: DEFAULT_DURATION_MINUTES,
    notes: (notesInput?.value || "").trim()
  };

  const validationError = validateClientPayload(payload);
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
      showError(body.error || "Booking failed. Please try another slot.");
      return;
    }

    const assignedTables = Array.isArray(body.assignedTables) ? body.assignedTables.join(", ") : "";
    const reference = body.reference ? `Reference: ${body.reference}` : "";
    const emailNote = "Confirmation emails sent to you and Millers Café.";
    const successMessage = assignedTables
      ? `Booking confirmed for ${payload.date} at ${payload.time}. Assigned table(s): ${assignedTables}.`
      : `Booking confirmed for ${payload.date} at ${payload.time}.`;

    showResult(`${successMessage} ${emailNote}`, reference);
    setNotice("Booking confirmed and synced to Millers Cafe POS feed.", false);

    const preservedDate = payload.date;
    form.reset();
    if (dateInput) dateInput.value = preservedDate;
    if (partySizeInput) partySizeInput.value = "2";
    if (occasionSelect) occasionSelect.value = "None";
    await loadAvailability();
  } catch (error) {
    showError("Booking service is currently unavailable. Please try again shortly.");
  } finally {
    setSubmitting(false);
  }
}

function initialize() {
  if (!form) return;

  renderDateOptions();
  renderPartySizeOptions();
  renderTimeOptions(slotTimes().map((time) => ({ time, available: true })));
  loadAvailability();

  form.addEventListener("submit", handleSubmit);
  dateInput?.addEventListener("change", loadAvailability);
  phoneInput?.addEventListener("input", normalizePhoneField);
  phoneInput?.addEventListener("blur", normalizePhoneField);
}

initialize();
