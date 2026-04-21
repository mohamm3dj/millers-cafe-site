"use strict";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { loadBookings } from "../functions/_booking-core.js";
import { createOrderRecord, loadOrders, saveOrders } from "../functions/_orders-core.js";
import { ApiError } from "../functions/_lib/errors.js";
import { createBooking } from "../functions/_lib/bookings-service.js";
import { updateOrderStatus, readOrderStatus } from "../functions/_lib/order-status-service.js";
import { createOrder } from "../functions/_lib/orders-service.js";
import {
  makeBookingPayload,
  makeOrderPayload,
  resetInMemoryStores
} from "./helpers/factories.js";

beforeEach(() => {
  resetInMemoryStores();
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;

test("createBooking persists the booking even when email is not configured", async () => {
  const result = await createBooking({}, makeBookingPayload());

  assert.equal(result.ok, true);
  assert.equal(result.emailStatus, "pending");

  const stored = await loadBookings({});
  assert.equal(stored.length, 1);
  assert.equal(stored[0].customerName, "Mo Khan");
});

test("createOrder rolls back when confirmation emails are unavailable", async () => {
  await assert.rejects(
    () => createOrder({}, makeOrderPayload()),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.match(error.message, /not configured yet/i);
      return true;
    }
  );

  const stored = await loadOrders({});
  assert.deepEqual(stored, []);
});

test("readOrderStatus requires the correct tracking token and updateOrderStatus persists decisions", async () => {
  const created = createOrderRecord([], makeOrderPayload());
  assert.equal(created.ok, true);
  await saveOrders({}, [created.record]);

  const initial = await readOrderStatus({}, {
    reference: created.reference,
    tracking: created.record.trackingToken
  });
  assert.equal(initial.status, "submitted");

  await assert.rejects(
    () => readOrderStatus({}, {
      reference: created.reference,
      tracking: "wrong-token"
    }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 404);
      return true;
    }
  );

  const updated = await updateOrderStatus({}, {
    reference: created.reference,
    status: "accepted",
    etaMinutes: 27.4,
    scheduledDate: created.record.date,
    scheduledTime: "13:30"
  });

  assert.equal(updated.status, "accepted");
  assert.equal(updated.etaMinutes, 27);
  assert.equal(updated.decisionDate, created.record.date);
  assert.equal(updated.decisionTime, "13:30");
  assert.equal(updated.notifyAttempted, true);
  assert.equal(updated.email.enabled, false);

  const refreshed = await readOrderStatus({}, {
    reference: created.reference,
    tracking: created.record.trackingToken
  });
  assert.equal(refreshed.status, "accepted");
  assert.equal(refreshed.etaMinutes, 27);
});

test("updateOrderStatus refunds rejected Stripe-paid orders", async () => {
  const created = createOrderRecord([], makeOrderPayload(), {
    paymentProvider: "stripe",
    paymentStatus: "paid",
    paymentSessionId: "cs_test_refund",
    paymentIntentId: "pi_test_refund",
    paymentAmountTotal: 2500,
    paymentCurrency: "gbp",
    skipDuplicateCheck: true
  });
  assert.equal(created.ok, true);
  await saveOrders({}, [created.record]);

  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api.stripe.com/v1/refunds");
    assert.equal(options.method, "POST");
    const body = new URLSearchParams(String(options.body || ""));
    assert.equal(body.get("payment_intent"), "pi_test_refund");

    return new Response(JSON.stringify({
      id: "re_test_refund",
      object: "refund",
      status: "succeeded",
      amount: 2500,
      created: 1_716_000_000
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  };

  const updated = await updateOrderStatus({
    STRIPE_SECRET_KEY: "sk_test_123"
  }, {
    reference: created.reference,
    status: "rejected"
  });

  assert.equal(updated.status, "rejected");
  assert.equal(updated.refund.attempted, true);
  assert.equal(updated.refund.status, "succeeded");
  assert.equal(updated.refund.refundId, "re_test_refund");

  const stored = await loadOrders({});
  assert.equal(stored[0].refundStatus, "succeeded");
  assert.equal(stored[0].refundId, "re_test_refund");
  assert.equal(stored[0].refundAmountTotal, 2500);
});
