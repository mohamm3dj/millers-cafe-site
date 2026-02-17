"use strict";

import { sendBookingEmails } from "../_booking-email.js";
import {
  createBookingRecord,
  csvResponse,
  feedRows,
  isFeedAuthorized,
  jsonResponse,
  loadBookings,
  saveBookings,
  toCSV
} from "../_booking-core.js";

export async function onRequestGet(context) {
  if (!isFeedAuthorized(context.request, context.env)) {
    return jsonResponse({ error: "Unauthorized feed token." }, 401);
  }

  const url = new URL(context.request.url);
  const includePast = url.searchParams.get("includePast") === "1";
  const format = (url.searchParams.get("format") || "").toLowerCase();

  const bookings = await loadBookings(context.env);
  const rows = feedRows(bookings, includePast);

  if (format === "json") {
    return jsonResponse(rows);
  }
  return csvResponse(toCSV(rows));
}

export async function onRequestPost(context) {
  let payload = null;
  try {
    payload = await context.request.json();
  } catch (error) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const bookings = await loadBookings(context.env);
  const creation = createBookingRecord(bookings, payload);
  if (!creation.ok) {
    return jsonResponse({ error: creation.error }, creation.status || 400);
  }

  bookings.push(creation.record);
  await saveBookings(context.env, bookings);

  let emailResult = null;
  try {
    emailResult = await sendBookingEmails(context.env, creation.record, creation.reference);
  } catch (error) {
    emailResult = {
      enabled: true,
      sentAll: false,
      delivered: 0,
      total: 2,
      errors: ["Email service request failed."]
    };
  }

  if (!emailResult.enabled || !emailResult.sentAll) {
    const rolledBack = bookings.filter((booking) => booking.id !== creation.record.id);
    try {
      await saveBookings(context.env, rolledBack);
    } catch (rollbackError) {
      return jsonResponse({
        error: "Booking could not be confirmed because confirmation emails failed and rollback did not complete. Please contact help@millers.cafe.",
        emailErrors: emailResult.errors || []
      }, 500);
    }

    if (!emailResult.enabled) {
      return jsonResponse({
        error: "Booking confirmation email service is not configured yet. Please try again shortly.",
        emailErrors: emailResult.errors || []
      }, 503);
    }

    return jsonResponse({
      error: "Booking could not be confirmed because confirmation emails were not delivered. Please try again.",
      emailErrors: emailResult.errors || []
    }, 502);
  }

  return jsonResponse({
    ok: true,
    reference: creation.reference,
    bookingId: creation.record.id,
    assignedTables: creation.record.assignedTables,
    emailStatus: "sent",
    emailDelivered: emailResult.delivered,
    emailTotal: emailResult.total,
    emailErrors: emailResult.errors
  }, 201);
}
