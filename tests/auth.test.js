"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import {
  isTokenAuthorized,
  resolveAdminTokens,
  resolveFeedTokens,
  resolveOrderAdminTokens,
  resolveVenueBridgeTokens
} from "../functions/_lib/auth.js";

test("resolveFeedTokens keeps booking and order feed scopes separate", () => {
  const env = {
    BOOKINGS_FEED_TOKEN: "booking-feed",
    ORDERS_FEED_TOKEN: "orders-feed"
  };

  assert.deepEqual(resolveFeedTokens(env, "bookings"), ["booking-feed"]);
  assert.deepEqual(resolveFeedTokens(env, "orders"), ["orders-feed"]);
});

test("write-capable token scopes do not inherit read-only or unrelated tokens", () => {
  const env = {
    BOOKINGS_FEED_TOKEN: "booking-feed",
    ORDERS_FEED_TOKEN: "orders-feed",
    ORDERS_ADMIN_TOKEN: "orders-admin",
    VENUE_BRIDGE_TOKEN: "venue-bridge",
    ADMIN_API_TOKEN: "admin-primary",
    ADMIN_API_TOKENS: "admin-secondary, admin-tertiary"
  };

  assert.deepEqual(resolveOrderAdminTokens(env), ["orders-admin"]);
  assert.deepEqual(resolveVenueBridgeTokens(env), ["venue-bridge"]);
  assert.deepEqual(resolveAdminTokens(env), [
    "admin-primary",
    "admin-secondary",
    "admin-tertiary"
  ]);
});

test("isTokenAuthorized accepts scoped headers but ignores query and body tokens", () => {
  const configured = ["orders-admin", "orders-feed"];

  assert.equal(
    isTokenAuthorized(new Request("https://example.com/api/order-status?token=orders-feed"), configured),
    false
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
      headers: { "x-api-key": "orders-feed" }
    }), configured),
    true
  );
  assert.equal(
    isTokenAuthorized(new Request("https://example.com/api/order-status"), configured, "orders-admin"),
    false
  );
});

test("isTokenAuthorized fails closed when no tokens are configured", () => {
  assert.equal(
    isTokenAuthorized(new Request("https://example.com/api/bookings"), []),
    false
  );
});
