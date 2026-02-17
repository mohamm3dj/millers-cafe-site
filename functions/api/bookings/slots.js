"use strict";

import {
  isBookableDay,
  jsonResponse,
  loadBookings,
  slotAvailability
} from "../../_booking-core.js";

function toPositiveInt(raw, fallbackValue) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.max(1, Math.round(parsed));
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const date = url.searchParams.get("date") || "";
  const partySize = Math.min(40, toPositiveInt(url.searchParams.get("partySize"), 2));
  const durationMinutes = Math.min(240, Math.max(15, toPositiveInt(url.searchParams.get("durationMinutes"), 90)));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ error: "Date is required in yyyy-MM-dd format." }, 400);
  }

  if (!isBookableDay(date)) {
    return jsonResponse({
      open: false,
      message: "Bookings are available Tuesday to Sunday only.",
      slots: []
    });
  }

  const bookings = await loadBookings(context.env);
  const availability = slotAvailability(bookings, date, partySize, durationMinutes);
  return jsonResponse(availability);
}
