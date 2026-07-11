"use strict";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  createOrderRecord,
  findOrderIndexByReference,
  loadOrders,
  saveOrderEntity,
  saveOrders,
  toCSV,
  validateOrderWindow
} from "../functions/_orders-core.js";
import {
  addDaysISO,
  londonTodayISO,
  makeOrderPayload,
  nextOpenDate,
  resetInMemoryStores
} from "./helpers/factories.js";

beforeEach(() => {
  resetInMemoryStores();
});

test("validateOrderWindow rejects past dates and dates beyond the lookahead window", () => {
  const today = londonTodayISO();
  const past = addDaysISO(today, -1);
  const tooFar = addDaysISO(today, 100);

  const pastCheck = validateOrderWindow(past, "13:00", "collection");
  const tooFarCheck = validateOrderWindow(tooFar, "13:00", "collection");

  assert.equal(pastCheck.ok, false);
  assert.match(pastCheck.error, /past dates/i);
  assert.equal(tooFarCheck.ok, false);
  assert.match(tooFarCheck.error, /90 days ahead/i);
});

test("order validation rejects impossible dates and out-of-range clocks", () => {
  const impossibleDate = validateOrderWindow("2026-02-30", "13:00", "collection");
  const impossibleClock = validateOrderWindow(nextOpenDate(2), "12:75", "collection");

  assert.equal(impossibleDate.ok, false);
  assert.match(impossibleDate.error, /date/i);
  assert.equal(impossibleClock.ok, false);
  assert.match(impossibleClock.error, /time/i);
});

test("createOrderRecord requires delivery address fields for delivery orders", () => {
  const created = createOrderRecord([], makeOrderPayload({
    orderType: "delivery",
    addressLine1: "",
    townCity: "",
    postcode: ""
  }));

  assert.equal(created.ok, false);
  assert.equal(created.status, 400);
  assert.match(created.error, /address line 1 is required/i);
});

test("createOrderRecord creates a submitted order with a tracking token and reference", () => {
  const created = createOrderRecord([], makeOrderPayload());

  assert.equal(created.ok, true);
  assert.equal(created.record.status, "submitted");
  assert.equal(created.record.time, "13:00");
  assert.match(created.reference, /^MCO-/);
  assert.equal(created.record.trackingToken.length, 20);
});

test("order notes require and record explicit consent", () => {
  const rejected = createOrderRecord([], makeOrderPayload({ notes: "Allergy information" }));
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /explicit consent/i);

  const accepted = createOrderRecord([], makeOrderPayload({
    notes: "Allergy information",
    sensitiveInfoConsent: true
  }));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.record.sensitiveInfoConsent, true);
  assert.match(accepted.record.sensitiveInfoConsentAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("createOrderRecord accepts common international phone formatting and rejects letters", () => {
  const accepted = createOrderRecord([], makeOrderPayload({
    phoneNumber: "+44 (0)1472-828600"
  }));
  const rejected = createOrderRecord([], makeOrderPayload({
    phoneNumber: "01472 CALL-ME"
  }));

  assert.equal(accepted.ok, true);
  assert.equal(accepted.record.phoneNumber, "+44 (0)1472-828600");
  assert.equal(accepted.record.phoneDigits, "4401472828600");
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /7 and 15 digits/i);
});

test("order CSV neutralizes spreadsheet formula cells", () => {
  const csv = toCSV([{
    reference: "MCO-12345678",
    type: "delivery",
    date: "2026-07-12",
    time: "13:00",
    customer_name: "-2+3+cmd|' /C calc'!A0",
    customer_phone: "+441472828600",
    customer_email: "guest@example.com",
    occasion: "None",
    items: "1x Curry",
    address_line_1: "=1+1",
    address_line_2: "",
    town_city: "Waltham",
    postcode: "DN37 0JZ",
    address_summary: "=1+1, Waltham",
    notes: "@SUM(1+1)",
    status: "submitted",
    eta_minutes: "",
    decision_date: "",
    decision_time: "",
    tracking_token: "abcdefghijklmnopqrst",
    status_updated_at: "2026-07-11T00:00:00.000Z",
    source: "Website",
    created_at: "2026-07-11T00:00:00.000Z"
  }]);

  assert.match(csv, /,'-2\+3\+cmd\|/);
  assert.match(csv, /,'\+441472828600,/);
  assert.match(csv, /,'=1\+1,/);
  assert.match(csv, /,'@SUM\(1\+1\),/);
});

test("createOrderRecord enforces cart line and quantity bounds", () => {
  const tooManyLines = createOrderRecord([], {
    ...makeOrderPayload(),
    cartItems: Array.from({ length: 51 }, (_, index) => ({
      itemName: `Item ${index + 1}`,
      quantity: 1,
      modifierSelections: []
    }))
  });
  const tooManyItems = createOrderRecord([], {
    ...makeOrderPayload(),
    cartItems: Array.from({ length: 6 }, (_, index) => ({
      itemName: `Item ${index + 1}`,
      quantity: 20,
      modifierSelections: []
    }))
  });

  assert.equal(tooManyLines.ok, false);
  assert.match(tooManyLines.error, /50 lines/i);
  assert.equal(tooManyItems.ok, false);
  assert.match(tooManyItems.error, /100 items/i);
});

test("createOrderRecord stores structured cart items for reorder support", () => {
  const created = createOrderRecord([], {
    ...makeOrderPayload(),
    cartItems: [
      {
        itemName: "Papadom",
        quantity: 2,
        modifierSelections: [
          {
            groupName: "Sauce",
            optionName: "Mint",
            isTextInput: false
          }
        ]
      }
    ]
  });

  assert.equal(created.ok, true);
  assert.deepEqual(created.record.cartItems, [
    {
      itemName: "Papadom",
      quantity: 2,
      modifierSelections: [
        {
          groupName: "Sauce",
          optionName: "Mint",
          isTextInput: false
        }
      ]
    }
  ]);
});

test("validateOrderWindow honors custom service rules", () => {
  const check = validateOrderWindow(nextOpenDate(3), "18:00", "collection", {
    openDayIndexes: [0, 1, 2, 3, 4, 5, 6],
    serviceStartMinutes: 12 * 60,
    serviceEndMinutes: 18 * 60,
    slotStepMinutes: 15,
    maxLookaheadDays: 120,
    collectionMinLeadMinutes: 30,
    deliveryMinLeadMinutes: 60,
    collectionEarliestScheduledMinutes: 12 * 60,
    deliveryEarliestScheduledMinutes: 13 * 60
  });

  assert.equal(check.ok, true);
  assert.equal(check.normalizedTime, "18:00");
});

test("createOrderRecord rejects duplicate orders for the same guest, slot, and items", () => {
  const original = createOrderRecord([], makeOrderPayload());
  assert.equal(original.ok, true);

  const duplicate = createOrderRecord([original.record], makeOrderPayload());

  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.error, /similar order already exists/i);
});

test("findOrderIndexByReference locates an order from its public reference", () => {
  const created = createOrderRecord([], makeOrderPayload());
  assert.equal(created.ok, true);

  const index = findOrderIndexByReference([created.record], created.reference);

  assert.equal(index, 0);
});

test("per-order Stripe entities recover a paid order missing from the legacy aggregate", async () => {
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
  const created = createOrderRecord([], makeOrderPayload(), {
    paymentProvider: "stripe",
    paymentStatus: "paid",
    paymentSessionId: "cs_test_entity",
    paymentIntentId: "pi_test_entity",
    paymentAmountTotal: 1200,
    paymentCurrency: "gbp"
  });
  assert.equal(created.ok, true);

  await saveOrderEntity(env, created.record);
  await saveOrders(env, []);

  const recovered = await loadOrders(env);
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].paymentSessionId, "cs_test_entity");
  assert.equal(recovered[0].paymentAmountTotal, 1200);
});
