import assert from "node:assert/strict";
import test from "node:test";

import { isOnlineOrderingEnabled } from "../functions/_lib/feature-flags.js";
import { buildOpeningSummary, defaultSiteConfig, saveSiteConfig } from "../functions/_lib/site-config.js";

test("online ordering fails closed on the production domain until explicitly enabled", () => {
  assert.equal(isOnlineOrderingEnabled({}, "https://millers.cafe/collection/"), false);
  assert.equal(isOnlineOrderingEnabled({}, "https://preview.pages.dev/collection/"), true);
  assert.equal(
    isOnlineOrderingEnabled({ ONLINE_ORDERING_ENABLED: "true" }, "https://millers.cafe/collection/"),
    true
  );
  assert.equal(
    isOnlineOrderingEnabled({ ONLINE_ORDERING_ENABLED: "false" }, "https://preview.pages.dev/collection/"),
    false
  );
  assert.equal(isOnlineOrderingEnabled({}, "not a URL"), false);
});

test("opening summary does not imply a closed Monday is open", () => {
  const config = defaultSiteConfig();
  assert.equal(
    buildOpeningSummary(config.home.weeklyHours),
    "Sun: 12:00-17:00 • Tue-Sat: 12:00-17:00"
  );
});

test("site config normalizes contradictory ranges into safe values", async () => {
  const saved = await saveSiteConfig({}, {
    orders: {
      serviceStartMinutes: 1000,
      serviceEndMinutes: 900,
      collectionEarliestScheduledMinutes: 100,
      deliveryEarliestScheduledMinutes: 2000
    },
    bookings: {
      serviceStartMinutes: 900,
      serviceEndMinutes: 800
    },
    delivery: {
      etaMinMinutes: 60,
      etaMaxMinutes: 20
    }
  });

  assert.ok(saved.orders.serviceEndMinutes > saved.orders.serviceStartMinutes);
  assert.ok(saved.orders.collectionEarliestScheduledMinutes >= saved.orders.serviceStartMinutes);
  assert.ok(saved.orders.deliveryEarliestScheduledMinutes <= saved.orders.serviceEndMinutes);
  assert.ok(saved.bookings.serviceEndMinutes > saved.bookings.serviceStartMinutes);
  assert.equal(saved.delivery.etaMaxMinutes, saved.delivery.etaMinMinutes);
});
