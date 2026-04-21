"use strict";

import { sendBookingEmails } from "../_booking-email.js";
import {
  createBookingRecord,
  feedRows,
  loadBookings,
  saveBookings,
  slotAvailability,
  toCSV
} from "../_booking-core.js";
import { ApiError } from "./errors.js";
import { getSiteConfig } from "./site-config.js";

export async function listBookingFeed(env, includePast = false, format = "csv") {
  const bookings = await loadBookings(env);
  const rows = feedRows(bookings, Boolean(includePast));
  if (format === "json") {
    return { format: "json", body: rows };
  }
  return { format: "csv", body: toCSV(rows) };
}

export async function createBooking(env, payload) {
  const bookings = await loadBookings(env);
  const siteConfig = await getSiteConfig(env);
  const creation = createBookingRecord(bookings, payload, {
    rules: siteConfig.bookings
  });
  if (!creation.ok) {
    throw new ApiError(creation.error || "Invalid booking request.", creation.status || 400);
  }

  bookings.push(creation.record);
  await saveBookings(env, bookings);

  let emailResult = null;
  try {
    emailResult = await sendBookingEmails(env, creation.record, creation.reference);
  } catch (error) {
    emailResult = {
      enabled: true,
      sentAll: false,
      delivered: 0,
      total: 2,
      errors: ["Email service request failed."]
    };
  }

  const emailsSentAll = Boolean(emailResult?.enabled && emailResult?.sentAll);
  return {
    ok: true,
    reference: creation.reference,
    bookingId: creation.record.id,
    assignedTables: creation.record.assignedTables,
    emailStatus: emailsSentAll ? "sent" : "pending",
    emailDelivered: Number(emailResult?.delivered || 0),
    emailTotal: Number(emailResult?.total || 0),
    emailErrors: emailResult?.errors || [],
    emailMessage: emailsSentAll
      ? "Confirmation emails sent to you and Millers Café."
      : "Booking is confirmed. Email confirmation is delayed right now."
  };
}

export async function getBookingAvailability(env, options) {
  const date = String(options?.date || "");
  const partySize = Number(options?.partySize || 2);
  const durationMinutes = Number(options?.durationMinutes || 90);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiError("Date is required in yyyy-MM-dd format.", 400);
  }

  const siteConfig = await getSiteConfig(env);
  const bookings = await loadBookings(env);
  return slotAvailability(bookings, date, partySize, durationMinutes, siteConfig.bookings);
}
