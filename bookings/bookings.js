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
const calendarMonthLabel = document.getElementById("calendarMonthLabel");
const calendarPrevBtn = document.getElementById("calendarPrevBtn");
const calendarNextBtn = document.getElementById("calendarNextBtn");
const bookingCalendarGrid = document.getElementById("bookingCalendarGrid");
const bookingSlotCards = document.getElementById("bookingSlotCards");
const bookingDateToggle = document.getElementById("bookingDateToggle");
const bookingDateSummary = document.getElementById("bookingDateSummary");
const bookingCalendarWrap = document.getElementById("bookingCalendarWrap");
let bookingSuccessFxStageTimer = null;
let bookingSuccessFxCloseTimer = null;
let bookingSuccessFxResolver = null;
let availableBookingDates = [];
let availableBookingDateSet = new Set();
let calendarViewMonthUTC = null;
let isCalendarOpen = false;

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

function updateDateSummary() {
  if (!bookingDateSummary || !dateInput) return;
  const value = String(dateInput.value || "").trim();
  if (!value) {
    bookingDateSummary.textContent = "Select a date";
    return;
  }

  const today = ukTodayISODate();
  if (value === today) {
    bookingDateSummary.textContent = `Today · ${displayDateLabel(value)}`;
    return;
  }

  bookingDateSummary.textContent = displayDateLabel(value);
}

function setCalendarOpen(open) {
  if (!bookingCalendarWrap || !bookingDateToggle) return;
  isCalendarOpen = Boolean(open);
  bookingCalendarWrap.hidden = !isCalendarOpen;
  bookingDateToggle.setAttribute("aria-expanded", isCalendarOpen ? "true" : "false");
  bookingDateToggle.textContent = isCalendarOpen ? "Hide calendar" : "Change date";
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
  } else if (options.includes(today)) {
    dateInput.value = today;
  } else if (options.length > 0) {
    dateInput.value = options[0];
  }

  availableBookingDates = options.slice();
  availableBookingDateSet = new Set(options);

  const selectedDate = parseISODateUTC(dateInput.value) || parseISODateUTC(options[0] || "");
  if (selectedDate && !calendarViewMonthUTC) {
    calendarViewMonthUTC = new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1));
  }

  updateDateSummary();
  renderCalendar();
}

function renderCalendar() {
  if (!bookingCalendarGrid || !calendarMonthLabel) return;
  if (!calendarViewMonthUTC || availableBookingDates.length === 0) {
    bookingCalendarGrid.innerHTML = "";
    calendarMonthLabel.textContent = "No dates available";
    if (calendarPrevBtn) calendarPrevBtn.disabled = true;
    if (calendarNextBtn) calendarNextBtn.disabled = true;
    return;
  }

  const selectedDate = parseISODateUTC(dateInput?.value || "");
  const todayDate = parseISODateUTC(ukTodayISODate());
  const firstAvailableDate = parseISODateUTC(availableBookingDates[0]);
  const lastAvailableDate = parseISODateUTC(availableBookingDates[availableBookingDates.length - 1]);
  if (!firstAvailableDate || !lastAvailableDate) return;

  const monthStart = new Date(Date.UTC(
    calendarViewMonthUTC.getUTCFullYear(),
    calendarViewMonthUTC.getUTCMonth(),
    1
  ));

  calendarMonthLabel.textContent = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: BUSINESS_TIMEZONE
  }).format(monthStart);

  const monthStartDayIndex = (monthStart.getUTCDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(monthStart.getUTCDate() - monthStartDayIndex);

  bookingCalendarGrid.innerHTML = "";

  for (let i = 0; i < 42; i += 1) {
    const cellDate = new Date(gridStart);
    cellDate.setUTCDate(gridStart.getUTCDate() + i);
    const iso = toISODateUTC(cellDate);
    const inCurrentMonth = cellDate.getUTCMonth() === monthStart.getUTCMonth();
    const isBookable = availableBookingDateSet.has(iso);
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
    btn.setAttribute("role", "gridcell");
    btn.setAttribute("aria-label", displayDateLabel(iso));

    if (!btn.disabled) {
      btn.addEventListener("click", () => {
        if (!dateInput) return;
        dateInput.value = iso;
        updateDateSummary();
        renderCalendar();
        setCalendarOpen(false);
        void loadAvailability();
      });
    }

    bookingCalendarGrid.appendChild(btn);
  }

  if (calendarPrevBtn) {
    const prevMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));
    calendarPrevBtn.disabled = monthIndexUTC(prevMonth) < monthIndexUTC(firstAvailableDate);
  }

  if (calendarNextBtn) {
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    calendarNextBtn.disabled = monthIndexUTC(nextMonth) > monthIndexUTC(lastAvailableDate);
  }
}

function moveCalendarMonth(delta) {
  if (!calendarViewMonthUTC || !availableBookingDates.length) return;
  const targetMonth = new Date(Date.UTC(
    calendarViewMonthUTC.getUTCFullYear(),
    calendarViewMonthUTC.getUTCMonth() + delta,
    1
  ));

  const firstAvailableDate = parseISODateUTC(availableBookingDates[0]);
  const lastAvailableDate = parseISODateUTC(availableBookingDates[availableBookingDates.length - 1]);
  if (!firstAvailableDate || !lastAvailableDate) return;

  if (monthIndexUTC(targetMonth) < monthIndexUTC(firstAvailableDate)) return;
  if (monthIndexUTC(targetMonth) > monthIndexUTC(lastAvailableDate)) return;

  calendarViewMonthUTC = targetMonth;
  renderCalendar();
}

function syncCalendarToSelectedDate() {
  const selectedDate = parseISODateUTC(dateInput?.value || "");
  if (!selectedDate) return;
  calendarViewMonthUTC = new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1));
  updateDateSummary();
  renderCalendar();
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

function ensureBookingSuccessFx() {
  let host = document.getElementById("bookingSuccessFx");
  if (host) return host;

  host = document.createElement("div");
  host.id = "bookingSuccessFx";
  host.className = "bookingSuccessFx";
  host.hidden = true;
  host.setAttribute("aria-hidden", "true");
  host.innerHTML = [
    "<div class=\"bookingSuccessStage\" aria-hidden=\"true\">",
    "  <span class=\"bookingSuccessAura bookingSuccessAuraA\"></span>",
    "  <span class=\"bookingSuccessAura bookingSuccessAuraB\"></span>",
    "  <div class=\"bookingSuccessPulseRing\"></div>",
    "  <div class=\"bookingSuccessCalendar\">",
    "    <div class=\"bookingSuccessCalendarTop\">",
    "      <span></span><span></span><span></span>",
    "    </div>",
    "    <div class=\"bookingSuccessCalendarBody\">",
    "      <div class=\"bookingSuccessCalendarDate\" id=\"bookingSuccessCalendarDate\">--</div>",
    "      <div class=\"bookingSuccessCalendarMonth\" id=\"bookingSuccessCalendarMonth\">---</div>",
    "      <div class=\"bookingSuccessTableGlyph\" aria-hidden=\"true\"></div>",
    "    </div>",
    "  </div>",
    "  <p class=\"bookingSuccessStageTitle\">Checking availability...</p>",
    "</div>",
    "<div class=\"bookingSuccessConfirm\">",
    "  <div class=\"bookingSuccessConfirmCard\">",
    "    <div class=\"bookingSuccessConfirmCheck\" aria-hidden=\"true\">✓</div>",
    "    <p class=\"bookingSuccessConfirmTitle\">Booking Confirmed</p>",
    "    <p class=\"bookingSuccessConfirmRef\" id=\"bookingSuccessConfirmRef\">Reference pending</p>",
    "    <div class=\"bookingSuccessConfirmGrid\">",
    "      <div class=\"bookingSuccessConfirmRow\"><span>Date</span><strong id=\"bookingSuccessConfirmDate\">--</strong></div>",
    "      <div class=\"bookingSuccessConfirmRow\"><span>Time</span><strong id=\"bookingSuccessConfirmTime\">--</strong></div>",
    "      <div class=\"bookingSuccessConfirmRow\"><span>Party</span><strong id=\"bookingSuccessConfirmParty\">--</strong></div>",
    "      <div class=\"bookingSuccessConfirmRow\"><span>Table(s)</span><strong id=\"bookingSuccessConfirmTables\">--</strong></div>",
    "    </div>",
    "    <button type=\"button\" class=\"bookingSuccessDoneBtn\" id=\"bookingSuccessDoneBtn\">Done</button>",
    "  </div>",
    "</div>"
  ].join("");

  document.body.appendChild(host);

  const doneBtn = host.querySelector("#bookingSuccessDoneBtn");
  if (doneBtn) {
    doneBtn.addEventListener("click", () => closeBookingSuccessFx(host));
  }

  host.addEventListener("click", (event) => {
    if (!host.classList.contains("isConfirm")) return;
    if (event.target === host) closeBookingSuccessFx(host);
  });

  return host;
}

function setBookingSuccessText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(value || "--");
}

function populateBookingSuccessFx(details) {
  const reference = String(details?.reference || "").trim();
  const date = String(details?.date || "").trim();
  const time = String(details?.time || "").trim();
  const partySize = Number(details?.partySize);
  const tables = String(details?.tables || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-").map(Number);
    const monthText = new Intl.DateTimeFormat("en-GB", {
      month: "short",
      timeZone: BUSINESS_TIMEZONE
    }).format(new Date(Date.UTC(year, month - 1, 1))).toUpperCase();

    setBookingSuccessText("bookingSuccessCalendarDate", String(day).padStart(2, "0"));
    setBookingSuccessText("bookingSuccessCalendarMonth", monthText);
    setBookingSuccessText("bookingSuccessConfirmDate", displayDateLabel(date));
  } else {
    setBookingSuccessText("bookingSuccessCalendarDate", "--");
    setBookingSuccessText("bookingSuccessCalendarMonth", "---");
    setBookingSuccessText("bookingSuccessConfirmDate", date || "--");
  }

  setBookingSuccessText("bookingSuccessConfirmRef", reference ? `Reference: ${reference}` : "Reference: pending");
  setBookingSuccessText("bookingSuccessConfirmTime", time || "--");
  setBookingSuccessText("bookingSuccessConfirmParty", Number.isInteger(partySize) ? `${partySize}` : "--");
  setBookingSuccessText("bookingSuccessConfirmTables", tables || "Assigned on arrival");
}

function closeBookingSuccessFx(host) {
  const overlay = host || document.getElementById("bookingSuccessFx");
  if (!overlay) return;

  if (bookingSuccessFxStageTimer) {
    clearTimeout(bookingSuccessFxStageTimer);
    bookingSuccessFxStageTimer = null;
  }
  if (bookingSuccessFxCloseTimer) {
    clearTimeout(bookingSuccessFxCloseTimer);
    bookingSuccessFxCloseTimer = null;
  }

  overlay.classList.add("isHiding");
  const fadeMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 100 : 320;
  window.setTimeout(() => {
    overlay.classList.remove("isVisible", "isHiding", "isConfirm");
    overlay.hidden = true;
    if (bookingSuccessFxResolver) {
      const resolve = bookingSuccessFxResolver;
      bookingSuccessFxResolver = null;
      resolve();
    }
  }, fadeMs);
}

function playBookingSuccessAnimation(details) {
  const host = ensureBookingSuccessFx();
  populateBookingSuccessFx(details);

  if (bookingSuccessFxStageTimer) {
    clearTimeout(bookingSuccessFxStageTimer);
    bookingSuccessFxStageTimer = null;
  }
  if (bookingSuccessFxCloseTimer) {
    clearTimeout(bookingSuccessFxCloseTimer);
    bookingSuccessFxCloseTimer = null;
  }
  bookingSuccessFxResolver = null;

  host.hidden = false;
  host.classList.remove("isVisible", "isHiding", "isConfirm");
  void host.offsetWidth;
  host.classList.add("isVisible");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stageMs = reducedMotion ? 280 : 1700;
  const confirmHoldMs = reducedMotion ? 1000 : 3200;

  return new Promise((resolve) => {
    bookingSuccessFxResolver = resolve;
    bookingSuccessFxStageTimer = window.setTimeout(() => {
      host.classList.add("isConfirm");
      bookingSuccessFxCloseTimer = window.setTimeout(() => {
        closeBookingSuccessFx(host);
      }, confirmHoldMs);
    }, stageMs);
  });
}

function formatSlotCardTime(clock) {
  const minutes = clockToMinutes(clock);
  if (!Number.isFinite(minutes)) return clock;
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours24 >= 12 ? "pm" : "am";
  const hours12 = ((hours24 + 11) % 12) + 1;
  return `${hours12}:${pad2(mins)} ${suffix}`;
}

function renderSlotCards(rows) {
  if (!bookingSlotCards || !timeSelect) return;

  bookingSlotCards.innerHTML = "";
  const selectedTime = timeSelect.value;

  rows.forEach((row) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "bookingSlotCard";
    card.dataset.time = row.time;
    if (!row.available) card.classList.add("isUnavailable");
    if (row.time === selectedTime && row.available) card.classList.add("isSelected");
    card.disabled = !row.available;
    card.setAttribute("role", "radio");
    card.setAttribute("aria-checked", row.time === selectedTime && row.available ? "true" : "false");

    const title = document.createElement("span");
    title.className = "bookingSlotTime";
    title.textContent = formatSlotCardTime(row.time);
    card.setAttribute(
      "aria-label",
      row.available ? `${title.textContent}` : `${title.textContent} unavailable`
    );
    card.appendChild(title);

    if (row.available) {
      card.addEventListener("click", () => {
        timeSelect.value = row.time;
        renderSlotCards(rows);
      });
    }

    bookingSlotCards.appendChild(card);
  });
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

  renderSlotCards(rows);
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
    const referenceValue = String(body.reference || "").trim();
    const reference = referenceValue ? `Reference: ${referenceValue}` : "";
    const emailStatus = String(body.emailStatus || "").toLowerCase();
    const emailNote = String(body.emailMessage || "").trim() || (
      emailStatus === "sent"
        ? "Confirmation emails sent to you and Millers Café."
        : "Booking is confirmed. Email confirmation is delayed right now."
    );
    const successMessage = assignedTables
      ? `Booking confirmed for ${payload.date} at ${payload.time}. Assigned table(s): ${assignedTables}.`
      : `Booking confirmed for ${payload.date} at ${payload.time}.`;

    showResult(`${successMessage} ${emailNote}`, reference);
    setNotice(
      emailStatus === "sent"
        ? "Booking confirmed and synced to Millers Cafe POS feed."
        : "Booking confirmed and synced to Millers Cafe POS feed. Email is delayed.",
      emailStatus !== "sent"
    );

    await playBookingSuccessAnimation({
      reference: referenceValue,
      date: payload.date,
      time: payload.time,
      partySize: payload.partySize,
      tables: assignedTables
    });

    const preservedDate = payload.date;
    form.reset();
    if (dateInput) dateInput.value = preservedDate;
    if (partySizeInput) partySizeInput.value = "2";
    if (occasionSelect) occasionSelect.value = "None";
    syncCalendarToSelectedDate();
    await loadAvailability();
  } catch (error) {
    showError("Booking service is currently unavailable. Please try again shortly.");
  } finally {
    setSubmitting(false);
  }
}

function initialize() {
  if (!form) return;

  setCalendarOpen(false);
  renderDateOptions();
  renderPartySizeOptions();
  renderTimeOptions(slotTimes().map((time) => ({ time, available: true })));
  syncCalendarToSelectedDate();
  void loadAvailability();

  form.addEventListener("submit", handleSubmit);
  dateInput?.addEventListener("change", () => {
    syncCalendarToSelectedDate();
    void loadAvailability();
  });
  bookingDateToggle?.addEventListener("click", () => {
    setCalendarOpen(!isCalendarOpen);
  });
  calendarPrevBtn?.addEventListener("click", () => moveCalendarMonth(-1));
  calendarNextBtn?.addEventListener("click", () => moveCalendarMonth(1));
  phoneInput?.addEventListener("input", normalizePhoneField);
  phoneInput?.addEventListener("blur", normalizePhoneField);

}

initialize();
