"use strict";

const API_BASE = "/api/bookings";
const BUSINESS_TIMEZONE = "Europe/London";
const SERVICE_START_MINUTES = 12 * 60;
const SERVICE_END_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;
const OPEN_DAY_INDEXES = new Set([0, 2, 3, 4, 5, 6]); // Sun, Tue-Sat (Mon closed)

const form = document.getElementById("bookingForm");
const noticeEl = document.getElementById("bookingsNotice");
const metaEl = document.getElementById("bookingMeta");
const resultEl = document.getElementById("bookingResult");
const errorEl = document.getElementById("bookingError");
const submitBtn = document.getElementById("bookingSubmit");

const nameInput = document.getElementById("bookingName");
const phoneInput = document.getElementById("bookingPhone");
const emailInput = document.getElementById("bookingEmail");
const dateInput = document.getElementById("bookingDate");
const timeSelect = document.getElementById("bookingTime");
const partySizeInput = document.getElementById("bookingPartySize");
const durationSelect = document.getElementById("bookingDuration");
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

function nextBookableISODate(fromISODate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromISODate)) return fromISODate;
  const [year, month, day] = fromISODate.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  for (let i = 0; i < 8; i += 1) {
    const candidate = `${cursor.getUTCFullYear()}-${pad2(cursor.getUTCMonth() + 1)}-${pad2(cursor.getUTCDate())}`;
    if (isBookableDay(candidate)) return candidate;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return fromISODate;
}

function setNotice(message, warning = false) {
  if (!noticeEl) return;
  noticeEl.textContent = message;
  noticeEl.classList.toggle("isWarning", warning);
}

function setMeta(message) {
  if (!metaEl) return;
  metaEl.textContent = message;
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
  const partySize = Number(partySizeInput?.value || "2");
  const durationMinutes = Number(durationSelect?.value || "90");

  if (!date) {
    renderTimeOptions(slotTimes().map((time) => ({ time, available: true })));
    setMeta("Choose a date to load live availability.");
    return;
  }

  if (!isBookableDay(date)) {
    renderTimeOptions(slotTimes().map((time) => ({ time, available: false })));
    setNotice("Bookings are available Tue-Sun only. Please choose another date.", true);
    setMeta("Selected day is closed for table bookings.");
    return;
  }

  const params = new URLSearchParams({
    date,
    partySize: String(Math.max(1, partySize || 1)),
    durationMinutes: String(Math.max(15, durationMinutes || 90))
  });

  try {
    const response = await fetch(`${API_BASE}/slots?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`Availability service returned ${response.status}.`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload.slots) ? payload.slots : [];
    renderTimeOptions(rows);

    const availableCount = rows.filter((row) => row.available).length;
    if (payload.open === false) {
      setNotice(payload.message || "Selected date is closed for bookings.", true);
      setMeta("Selected day is closed.");
      return;
    }

    setNotice("Service hours: Tue-Sun, 12:00-17:00. Bookings are in 15-minute intervals.", false);
    setMeta(availableCount > 0
      ? `Live availability loaded. ${availableCount} time slot${availableCount === 1 ? "" : "s"} available.`
      : "No availability left for this date.");
  } catch (error) {
    renderTimeOptions(slotTimes().map((time) => ({ time, available: true })));
    setNotice("Live availability is temporarily unavailable. Final checks happen when you submit.", true);
    setMeta("Could not load live availability.");
  }
}

function validateClientPayload(payload) {
  if (!payload.customerName || payload.customerName.length < 2) {
    return "Please enter a valid name.";
  }

  const digits = payload.phoneNumber.replace(/\D/g, "");
  if (digits.length < 8) {
    return "Please enter a valid phone number.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    return "Please choose a valid date.";
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
    return "Bookings must be between 12:00 and 17:00.";
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
    durationMinutes: Number(durationSelect?.value || "90"),
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
      await loadAvailability();
      return;
    }

    const assignedTables = Array.isArray(body.assignedTables) ? body.assignedTables.join(", ") : "";
    const reference = body.reference ? `Reference: ${body.reference}` : "";
    const successMessage = assignedTables
      ? `Booking confirmed for ${payload.date} at ${payload.time}. Assigned table(s): ${assignedTables}.`
      : `Booking confirmed for ${payload.date} at ${payload.time}.`;

    showResult(successMessage, reference);
    setNotice("Booking confirmed and synced to Millers Cafe POS feed.", false);

    const preservedDate = payload.date;
    form.reset();
    if (dateInput) dateInput.value = preservedDate;
    if (partySizeInput) partySizeInput.value = "2";
    if (durationSelect) durationSelect.value = "90";
    await loadAvailability();
  } catch (error) {
    showError("Booking service is currently unavailable. Please try again shortly.");
  } finally {
    setSubmitting(false);
  }
}

function initialize() {
  if (!form) return;

  const today = ukTodayISODate();
  if (dateInput) {
    dateInput.min = today;
    dateInput.value = isBookableDay(today) ? today : nextBookableISODate(today);
  }

  renderTimeOptions(slotTimes().map((time) => ({ time, available: true })));
  loadAvailability();

  form.addEventListener("submit", handleSubmit);
  dateInput?.addEventListener("change", loadAvailability);
  partySizeInput?.addEventListener("input", loadAvailability);
  durationSelect?.addEventListener("change", loadAvailability);
}

initialize();
