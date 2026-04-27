"use strict";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  createBookingRecord,
  slotAvailability,
  suggestTableAssignment,
  validateBookingWindow
} from "../functions/_booking-core.js";
import {
  addDaysISO,
  londonTodayISO,
  makeBookingPayload,
  nextClosedDate,
  nextOpenDate,
  resetInMemoryStores
} from "./helpers/factories.js";

beforeEach(() => {
  resetInMemoryStores();
});

test("validateBookingWindow rejects past dates and dates beyond the lookahead window", () => {
  const today = londonTodayISO();
  const past = addDaysISO(today, -1);
  const tooFar = addDaysISO(today, 130);

  const pastCheck = validateBookingWindow(past, "12:00");
  const tooFarCheck = validateBookingWindow(tooFar, "12:00");

  assert.equal(pastCheck.ok, false);
  assert.match(pastCheck.error, /past dates/i);
  assert.equal(tooFarCheck.ok, false);
  assert.match(tooFarCheck.error, /120 days ahead/i);
});

test("createBookingRecord creates a pending request and normalizes the occasion", () => {
  const created = createBookingRecord([], makeBookingPayload({
    specialOccasion: "Something custom",
    partySize: 2
  }));

  assert.equal(created.ok, true);
  assert.equal(created.record.status, "pending");
  assert.deepEqual(created.record.assignedTables, []);
  assert.equal(created.record.specialOccasion, "None");
  assert.match(created.reference, /^MC-/);
});

test("suggestTableAssignment uses a multi-table combination for larger parties", () => {
  const assignment = suggestTableAssignment([], nextOpenDate(2), "12:00", 12, 90);
  assert.deepEqual(assignment, [1, 2, 3]);
});

test("createBookingRecord rejects duplicate bookings for the same guest and slot", () => {
  const original = createBookingRecord([], makeBookingPayload());
  assert.equal(original.ok, true);

  const duplicate = createBookingRecord([original.record], makeBookingPayload());

  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.error, /similar booking already exists/i);
});

test("slotAvailability rejects closed days", () => {
  const result = slotAvailability([], nextClosedDate(0), 2, 90);

  assert.equal(result.open, false);
  assert.match(result.message, /Tuesday to Sunday/i);
  assert.deepEqual(result.slots, []);
});

test("validateBookingWindow honors custom booking rules", () => {
  const check = validateBookingWindow(nextOpenDate(3), "18:00", {
    openDayIndexes: [0, 1, 2, 3, 4, 5, 6],
    serviceStartMinutes: 12 * 60,
    serviceEndMinutes: 18 * 60,
    slotStepMinutes: 15,
    maxLookaheadDays: 180
  });

  assert.equal(check.ok, true);
});
