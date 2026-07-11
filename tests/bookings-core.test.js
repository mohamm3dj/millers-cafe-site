"use strict";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  createBookingRecord,
  loadBookings,
  saveBookingEntity,
  saveBookings,
  slotAvailability,
  suggestTableAssignment,
  toCSV,
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

test("booking validation rejects impossible dates, clocks, and fractional party sizes", () => {
  const impossibleDate = validateBookingWindow("2026-02-30", "12:00");
  const impossibleClock = validateBookingWindow(nextOpenDate(2), "12:75");
  const fractionalParty = createBookingRecord([], makeBookingPayload({ partySize: 2.5 }));
  const zeroDuration = createBookingRecord([], makeBookingPayload({ durationMinutes: 0 }));

  assert.equal(impossibleDate.ok, false);
  assert.match(impossibleDate.error, /date/i);
  assert.equal(impossibleClock.ok, false);
  assert.match(impossibleClock.error, /time/i);
  assert.equal(fractionalParty.ok, false);
  assert.match(fractionalParty.error, /party size/i);
  assert.equal(zeroDuration.ok, false);
  assert.match(zeroDuration.error, /duration/i);
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

test("booking notes require and record explicit consent", () => {
  const rejected = createBookingRecord([], makeBookingPayload({ notes: "Allergy information" }));
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /explicit consent/i);

  const accepted = createBookingRecord([], makeBookingPayload({
    notes: "Allergy information",
    sensitiveInfoConsent: true
  }));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.record.sensitiveInfoConsent, true);
  assert.match(accepted.record.sensitiveInfoConsentAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("createBookingRecord accepts common international phone formatting and rejects letters", () => {
  const accepted = createBookingRecord([], makeBookingPayload({
    phoneNumber: "+44 (0)1472-828600"
  }));
  const rejected = createBookingRecord([], makeBookingPayload({
    phoneNumber: "01472 CALL-ME"
  }));

  assert.equal(accepted.ok, true);
  assert.equal(accepted.record.phoneNumber, "+44 (0)1472-828600");
  assert.equal(accepted.record.phoneDigits, "4401472828600");
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /7 and 15 digits/i);
});

test("booking CSV neutralizes spreadsheet formula cells", () => {
  const csv = toCSV([{
    date: "2026-07-12",
    time: "12:00",
    guest_name: "=HYPERLINK(\"https://attacker.invalid\")",
    guest_phone: "+441472828600",
    guest_email: "guest@example.com",
    people: 2,
    duration: 90,
    special_occasion: "None",
    status: "pending",
    payment_amount: "",
    payment_status: "",
    payment_type: "",
    comments: "",
    notes: " @SUM(1+1)",
    source: "Website",
    created_at: "2026-07-11T00:00:00.000Z"
  }]);

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/attacker\.invalid""\)"/);
  assert.match(csv, /,'\+441472828600,/);
  assert.match(csv, /,' @SUM\(1\+1\),/);
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

test("per-booking entities recover a booking missing from the legacy aggregate", async () => {
  const values = new Map();
  const kv = {
    async get(key, type) {
      const value = values.get(String(key));
      if (value === undefined) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      values.set(String(key), String(value));
    },
    async list({ prefix }) {
      return {
        keys: Array.from(values.keys())
          .filter((key) => key.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true
      };
    }
  };
  const env = { BOOKINGS_KV: kv };
  const created = createBookingRecord([], makeBookingPayload());
  assert.equal(created.ok, true);

  await saveBookingEntity(env, created.record);
  await saveBookings(env, []);

  const recovered = await loadBookings(env);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, created.record.id);
  assert.equal(recovered[0].customerName, created.record.customerName);
});
