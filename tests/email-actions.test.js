"use strict";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { createBooking, listBookingReviewFeed } from "../functions/_lib/bookings-service.js";
import { createOrder, listOrderReviewFeed } from "../functions/_lib/orders-service.js";
import { onRequestGet as getBookingAction, onRequestPost as postBookingAction } from "../functions/api/email-actions/bookings.js";
import { onRequestGet as getOrderAction, onRequestPost as postOrderAction } from "../functions/api/email-actions/orders.js";
import { makeBookingPayload, makeOrderPayload, resetInMemoryStores } from "./helpers/factories.js";

beforeEach(() => {
  resetInMemoryStores();
});

function installResendMock() {
  const originalFetch = globalThis.fetch;
  const payloads = [];

  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    payloads.push(JSON.parse(String(options.body || "{}")));
    return new Response(JSON.stringify({ id: `email_${payloads.length}` }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  };

  return {
    payloads,
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}

function extractActionUrl(text, labelPattern) {
  const lines = String(text || "").split(/\r?\n/);
  const line = lines.find((value) => labelPattern.test(value));
  assert.ok(line, `Expected action URL matching ${labelPattern}`);
  const match = /(https:\/\/\S+)/.exec(line);
  assert.ok(match, `Expected URL in line: ${line}`);
  return match[1];
}

test("booking staff email action accepts a pending booking after confirmation", async () => {
  const mock = installResendMock();
  try {
    const env = {
      SITE_ORIGIN: "https://millers.cafe",
      VENUE_BRIDGE_TOKEN: "bridge-secret",
      RESEND_API_KEY: "re_test_123",
      BOOKINGS_EMAIL_FROM: "Millers Cafe <help@millers.cafe>",
      BOOKINGS_NOTIFICATION_EMAIL: "help@millers.cafe"
    };

    const created = await createBooking(env, makeBookingPayload());
    const ownerEmail = mock.payloads.find((payload) => payload.subject === `New booking request received (${created.reference})`);
    assert.ok(ownerEmail);
    assert.match(ownerEmail.html, /Accept booking/);
    assert.match(ownerEmail.html, /Decline booking/);

    const acceptUrl = extractActionUrl(ownerEmail.text, /^Accept booking:/);
    const confirmResponse = await getBookingAction({
      env,
      request: new Request(acceptUrl)
    });
    assert.equal(confirmResponse.status, 200);
    assert.match(await confirmResponse.text(), /Confirm accept booking/);

    const pendingBefore = await listBookingReviewFeed(env, { includePast: true, status: "pending" });
    assert.equal(pendingBefore.count, 1);

    const actionResponse = await postBookingAction({
      env,
      request: new Request(acceptUrl, { method: "POST" })
    });
    assert.equal(actionResponse.status, 200);
    assert.match(await actionResponse.text(), /is now <strong>accepted<\/strong>/);

    const accepted = await listBookingReviewFeed(env, { includePast: true, status: "accepted" });
    assert.equal(accepted.count, 1);
    assert.equal(accepted.bookings[0].reference, created.reference);
  } finally {
    mock.restore();
  }
});

test("order staff email action accepts a submitted order and sets ETA", async () => {
  const mock = installResendMock();
  try {
    const env = {
      SITE_ORIGIN: "https://millers.cafe",
      VENUE_BRIDGE_TOKEN: "bridge-secret",
      RESEND_API_KEY: "re_test_123",
      ORDERS_EMAIL_FROM: "Millers Cafe <help@millers.cafe>",
      ORDERS_NOTIFICATION_EMAIL: "help@millers.cafe",
      EMAIL_ACTION_DEFAULT_ETA_MINUTES: "42"
    };

    const created = await createOrder(env, makeOrderPayload());
    const ownerEmail = mock.payloads.find((payload) => payload.subject === `New collection order (${created.reference})`);
    assert.ok(ownerEmail);
    assert.match(ownerEmail.html, /Accept order \(42 min ETA\)/);
    assert.match(ownerEmail.html, /Reject order/);

    const acceptUrl = extractActionUrl(ownerEmail.text, /^Accept order/);
    const confirmResponse = await getOrderAction({
      env,
      request: new Request(acceptUrl)
    });
    assert.equal(confirmResponse.status, 200);
    assert.match(await confirmResponse.text(), /Confirm accept order/);

    const actionResponse = await postOrderAction({
      env,
      request: new Request(acceptUrl, { method: "POST" })
    });
    assert.equal(actionResponse.status, 200);
    assert.match(await actionResponse.text(), /ETA set to <strong>42 minutes<\/strong>/);

    const accepted = await listOrderReviewFeed(env, { includePast: true, status: "accepted" });
    assert.equal(accepted.count, 1);
    assert.equal(accepted.orders[0].reference, created.reference);
    assert.equal(accepted.orders[0].etaMinutes, 42);
  } finally {
    mock.restore();
  }
});
