"use strict";

import {
  sendBookingDecisionEmails,
  sendBookingRequestEmails
} from "../_booking-email.js";
import {
  createBookingRecord,
  findBookingIndexByReference,
  feedRows,
  loadBookings,
  makeReference,
  saveBookings,
  suggestTableAssignment,
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
    emailResult = await sendBookingRequestEmails(env, creation.record, creation.reference);
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
    status: creation.record.status,
    assignedTables: creation.record.assignedTables,
    emailStatus: emailsSentAll ? "sent" : "pending",
    emailDelivered: Number(emailResult?.delivered || 0),
    emailTotal: Number(emailResult?.total || 0),
    emailErrors: emailResult?.errors || [],
    emailMessage: emailsSentAll
      ? "Booking request received. We will email again when Millers Café accepts or declines it."
      : "Booking request received. Email confirmation is delayed right now."
  };
}

function normalizedStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function validDecisionStatus(value) {
  const status = normalizedStatus(value);
  if (status === "accepted" || status === "approved" || status === "confirmed") return "accepted";
  if (status === "rejected" || status === "declined" || status === "cancelled" || status === "canceled") return "rejected";
  return "";
}

function normalizeAssignedTables(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((table) => Number(table))
      .filter((table) => Number.isInteger(table) && table > 0)
  )).sort((left, right) => left - right);
}

function bookingFeedRecord(booking) {
  return {
    reference: makeReference(String(booking.id || "")),
    bookingId: String(booking.id || ""),
    customerName: booking.customerName,
    phoneNumber: booking.phoneNumber,
    email: booking.email,
    date: booking.date,
    time: booking.time,
    partySize: booking.partySize,
    durationMinutes: booking.durationMinutes,
    specialOccasion: booking.specialOccasion,
    notes: booking.notes,
    status: normalizedStatus(booking.status || "pending"),
    assignedTables: Array.isArray(booking.assignedTables) ? booking.assignedTables : [],
    source: booking.source,
    createdAt: booking.createdAt,
    statusUpdatedAt: booking.statusUpdatedAt || booking.createdAt,
    decisionReason: booking.decisionReason || ""
  };
}

export async function listBookingReviewFeed(env, options = {}) {
  const bookings = await loadBookings(env);
  const includePast = Boolean(options.includePast);
  const requestedStatus = normalizedStatus(options.status || "pending");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const rows = bookings
    .filter((booking) => includePast || String(booking.date || "") >= today)
    .filter((booking) => requestedStatus === "all" || normalizedStatus(booking.status) === requestedStatus)
    .sort((left, right) => {
      const dateCompare = String(left.date || "").localeCompare(String(right.date || ""));
      if (dateCompare !== 0) return dateCompare;
      const timeCompare = String(left.time || "").localeCompare(String(right.time || ""));
      if (timeCompare !== 0) return timeCompare;
      return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
    })
    .map(bookingFeedRecord);

  return {
    ok: true,
    bookings: rows,
    count: rows.length
  };
}

export async function updateBookingDecision(env, payload = {}) {
  const reference = String(payload.reference || "").trim();
  const bookingId = String(payload.bookingId || "").trim();
  const nextStatus = validDecisionStatus(payload.status);
  if (!reference && !bookingId) throw new ApiError("reference or bookingId is required.", 400);
  if (!nextStatus) throw new ApiError("status must be accepted or rejected.", 400);

  const bookings = await loadBookings(env);
  const index = reference
    ? findBookingIndexByReference(bookings, reference)
    : bookings.findIndex((booking) => String(booking.id || "") === bookingId);
  if (index < 0) {
    throw new ApiError("Booking not found.", 404);
  }

  const existing = bookings[index];
  const previousStatus = normalizedStatus(existing.status || "pending");
  const next = {
    ...existing,
    status: nextStatus,
    statusUpdatedAt: new Date().toISOString(),
    decisionReason: String(payload.reason || "").trim()
  };

  if (nextStatus === "accepted") {
    const explicitTables = normalizeAssignedTables(payload.assignedTables);
    const assignedTables = explicitTables.length > 0
      ? explicitTables
      : suggestTableAssignment(
        bookings.filter((booking, bookingIndex) => bookingIndex !== index),
        existing.date,
        existing.time,
        existing.partySize,
        existing.durationMinutes,
        existing.id
      );

    if (!assignedTables || assignedTables.length === 0) {
      throw new ApiError("No available table assignment for that booking.", 409);
    }
    next.assignedTables = assignedTables;
  } else {
    next.assignedTables = [];
  }

  bookings[index] = next;
  await saveBookings(env, bookings);

  const shouldNotify = payload.notify !== false && previousStatus !== nextStatus;
  let email = null;
  if (shouldNotify) {
    try {
      email = await sendBookingDecisionEmails(env, next, makeReference(next.id), {
        status: nextStatus,
        reason: next.decisionReason
      });
    } catch (error) {
      email = {
        enabled: true,
        sentAll: false,
        delivered: 0,
        total: 2,
        errors: ["Decision email send failed."]
      };
    }
  }

  return {
    ok: true,
    booking: bookingFeedRecord(next),
    previousStatus,
    notifyAttempted: shouldNotify,
    email
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
