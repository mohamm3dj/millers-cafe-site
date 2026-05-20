"use strict";

import { findBookingIndexByReference, loadBookings, makeReference } from "../../_booking-core.js";
import { updateBookingDecision } from "../../_lib/bookings-service.js";
import { ApiError } from "../../_lib/errors.js";
import {
  actionParamsFromRequest,
  confirmationForm,
  htmlEscape,
  pageResponse,
  verifyEmailAction
} from "../../_lib/email-actions.js";
import { methodNotAllowed } from "../../_lib/json.js";

function normalizedStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

async function findBooking(env, reference) {
  const bookings = await loadBookings(env);
  const index = findBookingIndexByReference(bookings, reference);
  if (index < 0) throw new ApiError("Booking not found.", 404);
  const booking = bookings[index];
  return {
    booking,
    reference: makeReference(booking.id),
    status: normalizedStatus(booking.status || "pending")
  };
}

function hiddenFields(action) {
  return [
    ["reference", action.reference],
    ["status", action.status],
    ["token", action.token]
  ].map(([name, value]) => `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}">`).join("");
}

function confirmationPage(action, current) {
  const accepted = action.status === "accepted";
  const title = accepted ? "Accept Booking" : "Decline Booking";
  const actionLabel = accepted ? "Confirm accept booking" : "Confirm decline booking";
  const actionClass = accepted ? "" : "reject";
  const reasonField = accepted
    ? ""
    : `<label for="reason">Reason for customer email</label>
      <textarea id="reason" name="reason" placeholder="Optional">${htmlEscape("Sorry, we cannot take this booking.")}</textarea>`;

  return pageResponse(title, [
    `<h1>${htmlEscape(title)}</h1>`,
    `<p>Booking <strong>${htmlEscape(current.reference)}</strong> is currently <strong>${htmlEscape(current.status)}</strong>.</p>`,
    "<p>This will update the website/app feed and email the customer.</p>",
    confirmationForm({
      actionLabel,
      actionClass,
      hiddenFields: hiddenFields(action),
      extraFields: reasonField
    }),
    "<p class=\"muted\">If this booking has already been handled, use the app/admin view to make further changes.</p>"
  ].join(""));
}

function alreadyHandledPage(action, current) {
  const desired = action.status;
  if (current.status === desired) {
    return pageResponse("Booking Already Updated", [
      "<h1>Booking already updated</h1>",
      `<p>Booking <strong>${htmlEscape(current.reference)}</strong> is already <strong>${htmlEscape(current.status)}</strong>.</p>`,
      "<p>No further change was made.</p>"
    ].join(""));
  }

  return pageResponse("Booking Already Decided", [
    "<h1>Booking already decided</h1>",
    `<p>Booking <strong>${htmlEscape(current.reference)}</strong> is currently <strong>${htmlEscape(current.status)}</strong>.</p>`,
    "<p>Email links can only handle new pending bookings. Use the app/admin view to change an existing decision.</p>"
  ].join(""), 409);
}

export async function onRequestGet(context) {
  try {
    const params = await actionParamsFromRequest(context.request);
    const action = await verifyEmailAction(context.env, {
      kind: "booking",
      ...params
    });
    const current = await findBooking(context.env, action.reference);
    if (current.status !== "pending") return alreadyHandledPage(action, current);
    return confirmationPage(action, current);
  } catch (error) {
    const normalized = error instanceof ApiError ? error : new ApiError("Email action could not be opened.", 500);
    return pageResponse("Email Action Error", [
      "<h1>Email action could not be opened</h1>",
      `<p>${htmlEscape(normalized.message)}</p>`
    ].join(""), normalized.status);
  }
}

export async function onRequestPost(context) {
  try {
    const params = await actionParamsFromRequest(context.request);
    const action = await verifyEmailAction(context.env, {
      kind: "booking",
      ...params
    });
    const current = await findBooking(context.env, action.reference);
    if (current.status !== "pending") return alreadyHandledPage(action, current);

    const updated = await updateBookingDecision(context.env, {
      reference: action.reference,
      status: action.status,
      reason: params.reason
    });
    const nextStatus = String(updated?.booking?.status || action.status).trim().toLowerCase();
    return pageResponse("Booking Updated", [
      "<h1>Booking updated</h1>",
      `<p>Booking <strong>${htmlEscape(action.reference)}</strong> is now <strong>${htmlEscape(nextStatus)}</strong>.</p>`,
      "<p>The app/feed now shows the updated status, and the customer notification email has been queued.</p>"
    ].join(""));
  } catch (error) {
    const normalized = error instanceof ApiError ? error : new ApiError("Could not update booking from email.", 500);
    return pageResponse("Booking Update Error", [
      "<h1>Booking could not be updated</h1>",
      `<p>${htmlEscape(normalized.message)}</p>`
    ].join(""), normalized.status);
  }
}

export function onRequest() {
  return methodNotAllowed(["GET", "POST"]);
}
