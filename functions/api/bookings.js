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

  const emailDelivered = Number(emailResult?.delivered || 0);
  const emailTotal = Number(emailResult?.total || 0);
  const emailsSentAll = Boolean(emailResult?.enabled && emailResult?.sentAll);
  const emailStatus = emailsSentAll ? "sent" : "pending";
  const emailMessage = emailsSentAll
    ? "Confirmation emails sent to you and Millers Café."
    : "Booking is confirmed. Email confirmation is delayed right now.";

  return jsonResponse({
    ok: true,
    reference: creation.reference,
    bookingId: creation.record.id,
    assignedTables: creation.record.assignedTables,
    emailStatus,
    emailDelivered,
    emailTotal,
    emailErrors: emailResult?.errors || [],
    emailMessage
  }, 201);
}
