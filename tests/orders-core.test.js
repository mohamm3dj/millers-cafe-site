"use strict";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  createOrderRecord,
  findOrderIndexByReference,
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
