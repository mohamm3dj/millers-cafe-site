"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import {
  isTokenAuthorized,
  resolveFeedTokens,
  resolveOrderAdminTokens
} from "../functions/_lib/auth.js";

test("resolveFeedTokens keeps booking and order feed scopes separate", () => {
  const env = {
    BOOKINGS_FEED_TOKEN: "booking-feed",
    ORDERS_FEED_TOKEN: "orders-feed"
  };

  assert.deepEqual(resolveFeedTokens(env, "bookings"), ["booking-feed"]);
  assert.deepEqual(resolveFeedTokens(env, "orders"), ["orders-feed"]);
});

test("resolveOrderAdminTokens excludes the booking feed token", () => {
  const env = {
    BOOKINGS_FEED_TOKEN: "booking-feed",
    ORDERS_FEED_TOKEN: "orders-feed",
    ORDERS_ADMIN_TOKEN: "orders-admin"
  };

  assert.deepEqual(resolveOrderAdminTokens(env), ["orders-admin", "orders-feed"]);
});

test("isTokenAuthorized accepts tokens from supported request locations", () => {
  const configured = ["orders-admin", "orders-feed"];

  assert.equal(
    isTokenAuthorized(new Request("https://example.com/api/order-status?token=orders-feed"), configured),
    true
  );
  assert.equal(
    isTokenAuthorized(new Request("https://example.com/api/order-status", {
      headers: { "x-orders-admin-token": "orders-admin" }
    }), configured),
    true
  );
  assert.equal(
    isTokenAuthorized(new Request("https://example.com/api/order-status", {
      headers: { authorization: "Bearer orders-feed" }
    }), configured),
    true
  );
  assert.equal(
    isTokenAuthorized(new Request("https://example.com/api/order-status", {
      headers: { "x-api-key": "booking-feed" }
    }), configured),
    false
  );
  assert.equal(
    isTokenAuthorized(new Request("https://example.com/api/order-status"), configured, "orders-admin"),
    true
  );
});

test("isTokenAuthorized allows requests when no tokens are configured", () => {
  assert.equal(
    isTokenAuthorized(new Request("https://example.com/api/bookings"), []),
    true
  );
});
