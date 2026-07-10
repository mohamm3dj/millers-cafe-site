"use strict";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { ApiError } from "../functions/_lib/errors.js";
import { enforceRateLimit } from "../functions/_lib/rate-limit.js";
import { turnstileRequired, verifyTurnstileToken } from "../functions/_lib/turnstile.js";
import { onRequestPost as postAnalytics } from "../functions/api/analytics.js";
import { onRequestGet as getAdminAnalytics } from "../functions/api/admin/analytics.js";
import { onRequestGet as getAdminConfig, onRequestPut as putAdminConfig } from "../functions/api/admin/config.js";
import { onRequestGet as getAdminMenu, onRequestPut as putAdminMenu } from "../functions/api/admin/menu.js";
import { onRequestGet as getBridgeBookings, onRequestPost as postBridgeBookingDecision } from "../functions/api/bridge/bookings.js";
import { onRequestGet as getBridgeMenu, onRequestPut as putBridgeMenu } from "../functions/api/bridge/menu.js";
import { onRequestGet as getBridgeOrders, onRequestPost as postBridgeOrderDecision } from "../functions/api/bridge/orders.js";
import { createBooking } from "../functions/_lib/bookings-service.js";
import { createOrder } from "../functions/_lib/orders-service.js";
import { onRequestGet as getPublicMenu } from "../functions/api/menu-catalog.js";
import { onRequestGet as getOrderStatus, onRequestPost as postOrderStatus } from "../functions/api/order-status.js";
import { onRequestGet as getPublicSiteConfig } from "../functions/api/site-config.js";
import { onRequestPost as postLegacyOrder } from "../functions/api/orders.js";
import { onRequestPost as postStripeWebhook } from "../functions/api/stripe/webhook.js";
import { onRequestGet as getBookingFeedJson } from "../functions/bookings/feed.json.js";
import { onRequestGet as getOrderFeedJson } from "../functions/orders/feed.json.js";
import { makeBookingPayload, makeOrderPayload, resetInMemoryStores } from "./helpers/factories.js";

beforeEach(() => {
  resetInMemoryStores();
});

function adminRequest(url, method = "GET", token = "secret", body = null) {
  return new Request(url, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : null
  });
}

test("protected admin and feed routes fail closed when credentials are missing", async () => {
  const adminResponse = await getAdminConfig({
    env: {},
    request: new Request("https://example.com/api/admin/config")
  });
  assert.equal(adminResponse.status, 401);

  const orderFeedResponse = await getOrderFeedJson({
    env: {},
    request: new Request("https://example.com/orders/feed.json")
  });
  assert.equal(orderFeedResponse.status, 503);

  const bookingFeedResponse = await getBookingFeedJson({
    env: {},
    request: new Request("https://example.com/bookings/feed.json")
  });
  assert.equal(bookingFeedResponse.status, 503);
});

test("feed credentials are accepted in headers and rejected in query strings", async () => {
  const env = {
    BOOKINGS_FEED_TOKEN: "booking-feed-secret",
    ORDERS_FEED_TOKEN: "order-feed-secret"
  };

  const queryResponse = await getOrderFeedJson({
    env,
    request: new Request("https://example.com/orders/feed.json?token=order-feed-secret")
  });
  assert.equal(queryResponse.status, 401);

  const wrongScopeResponse = await getOrderFeedJson({
    env,
    request: adminRequest(
      "https://example.com/orders/feed.json",
      "GET",
      "booking-feed-secret"
    )
  });
  assert.equal(wrongScopeResponse.status, 401);

  const authorizedResponse = await getOrderFeedJson({
    env,
    request: adminRequest(
      "https://example.com/orders/feed.json",
      "GET",
      "order-feed-secret"
    )
  });
  assert.equal(authorizedResponse.status, 200);
  assert.deepEqual(await authorizedResponse.json(), []);
});

test("read-only feed credentials cannot authorize admin, bridge, or order mutations", async () => {
  const env = {
    BOOKINGS_FEED_TOKEN: "booking-feed-secret",
    ORDERS_FEED_TOKEN: "order-feed-secret"
  };

  const adminResponse = await getAdminConfig({
    env,
    request: adminRequest(
      "https://example.com/api/admin/config",
      "GET",
      "booking-feed-secret"
    )
  });
  assert.equal(adminResponse.status, 401);

  const bridgeResponse = await getBridgeBookings({
    env,
    request: adminRequest(
      "https://example.com/api/bridge/bookings",
      "GET",
      "booking-feed-secret"
    )
  });
  assert.equal(bridgeResponse.status, 401);

  const statusResponse = await postOrderStatus({
    env,
    request: adminRequest(
      "https://example.com/api/order-status",
      "POST",
      "order-feed-secret",
      {
        reference: "MCO-DOESNOTEXIST",
        status: "rejected"
      }
    )
  });
  assert.equal(statusResponse.status, 401);
});

test("protected mutations authenticate before parsing bounded request bodies", async () => {
  const unauthorized = await putAdminConfig({
    env: { ADMIN_API_TOKEN: "admin-secret" },
    request: new Request("https://example.com/api/admin/config", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String((1024 * 1024) + 1)
      },
      body: "{}"
    })
  });
  assert.equal(unauthorized.status, 401);

  const oversizedAuthorized = await putAdminConfig({
    env: { ADMIN_API_TOKEN: "admin-secret" },
    request: new Request("https://example.com/api/admin/config", {
      method: "PUT",
      headers: {
        Authorization: "Bearer admin-secret",
        "Content-Type": "application/json",
        "Content-Length": String((1024 * 1024) + 1)
      },
      body: "{}"
    })
  });
  assert.equal(oversizedAuthorized.status, 413);
});

test("Stripe webhook rejects oversized bodies before signature processing", async () => {
  const response = await postStripeWebhook({
    env: { STRIPE_WEBHOOK_SECRET: "whsec_test" },
    request: new Request("https://example.com/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String((1024 * 1024) + 1),
        "Stripe-Signature": "t=1,v1=invalid"
      },
      body: "{}"
    })
  });

  assert.equal(response.status, 413);
});

test("customer order status accepts tracking credentials only in the authorization header", async () => {
  const env = {};
  const created = await createOrder(env, makeOrderPayload());

  const queryCredential = await getOrderStatus({
    env,
    request: new Request(
      `https://example.com/api/order-status?reference=${encodeURIComponent(created.reference)}&tracking=${encodeURIComponent(created.trackingToken)}`
    )
  });
  assert.equal(queryCredential.status, 400);

  const headerCredential = await getOrderStatus({
    env,
    request: new Request(
      `https://example.com/api/order-status?reference=${encodeURIComponent(created.reference)}`,
      { headers: { Authorization: `Bearer ${created.trackingToken}` } }
    )
  });
  assert.equal(headerCredential.status, 200);
  assert.equal((await headerCredential.json()).reference, created.reference);
});

test("legacy direct order creation is disabled", async () => {
  const response = await postLegacyOrder({
    env: {},
    request: new Request("https://example.com/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeOrderPayload())
    })
  });

  assert.equal(response.status, 410);
  assert.match((await response.json()).error, /secure checkout/i);
});

test("Turnstile is optional locally but required when the production flag is enabled", async () => {
  assert.equal(turnstileRequired({}), false);
  assert.deepEqual(
    await verifyTurnstileToken({}, new Request("https://example.com/api/bookings"), ""),
    { enabled: false, success: true }
  );

  await assert.rejects(
    () => verifyTurnstileToken(
      { REQUIRE_TURNSTILE: "true" },
      new Request("https://example.com/api/bookings"),
      ""
    ),
    (error) => error instanceof ApiError && error.status === 503
  );

  await assert.rejects(
    () => verifyTurnstileToken(
      { TURNSTILE_SITE_KEY: "site-only" },
      new Request("https://example.com/api/bookings"),
      "token"
    ),
    (error) => error instanceof ApiError && error.status === 503
  );
});

test("Turnstile verifies configured tokens with Cloudflare", async () => {
  const originalFetch = globalThis.fetch;
  let receivedBody = "";
  globalThis.fetch = async (_url, options = {}) => {
    receivedBody = String(options.body || "");
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const result = await verifyTurnstileToken({
      REQUIRE_TURNSTILE: "true",
      TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_SECRET_KEY: "secret-key"
    }, new Request("https://example.com/api/bookings", {
      headers: { "cf-connecting-ip": "203.0.113.20" }
    }), "browser-token");

    assert.deepEqual(result, { enabled: true, success: true });
    const submitted = new URLSearchParams(receivedBody);
    assert.equal(submitted.get("secret"), "secret-key");
    assert.equal(submitted.get("response"), "browser-token");
    assert.equal(submitted.get("remoteip"), "203.0.113.20");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin config and menu endpoints require a token and persist updates", async () => {
  const env = {
    ADMIN_API_TOKENS: "secret"
  };

  const unauthorizedResponse = await getAdminConfig({
    env,
    request: new Request("https://example.com/api/admin/config")
  });
  assert.equal(unauthorizedResponse.status, 401);

  const configResponse = await putAdminConfig({
    env,
    request: adminRequest("https://example.com/api/admin/config", "PUT", "secret", {
      config: {
        business: {
          name: "Millers Café Waltham",
          shortName: "Millers",
          address: "55 Brigsley Road, Waltham, Grimsby, DN37 0JZ",
          phoneDisplay: "01472 828600",
          phoneTel: "01472828600",
          email: "help@millers.cafe"
        },
        home: {
          weeklyHours: {
            0: [["12:00", "17:00"]],
            1: [],
            2: [["12:00", "17:00"]],
            3: [["12:00", "17:00"]],
            4: [["12:00", "17:00"]],
            5: [["12:00", "17:00"]],
            6: [["12:00", "17:00"]]
          }
        }
      }
    })
  });

  assert.equal(configResponse.status, 200);
  const configBody = await configResponse.json();
  assert.equal(configBody.config.business.name, "Millers Café Waltham");

  const publicConfigResponse = await getPublicSiteConfig({
    env,
    request: new Request("https://example.com/api/site-config")
  });
  assert.equal(publicConfigResponse.status, 200);
  const publicConfigBody = await publicConfigResponse.json();
  assert.equal(publicConfigBody.config.business.name, "Millers Café Waltham");
  assert.match(publicConfigBody.config.home.openingSummary, /12:00-17:00/);

  const menuPayload = [
    {
      name: "Test Category",
      items: [
        {
          name: "Papadom",
          basePrice: 1,
          description: "Crisp starter",
          modifierGroups: []
        }
      ]
    }
  ];

  const menuResponse = await putAdminMenu({
    env,
    request: adminRequest("https://example.com/api/admin/menu", "PUT", "secret", {
      menu: menuPayload
    })
  });

  assert.equal(menuResponse.status, 200);
  const menuBody = await menuResponse.json();
  assert.equal(menuBody.menu[0].name, "Test Category");

  const publicMenuResponse = await getPublicMenu({
    env,
    request: new Request("https://example.com/api/menu-catalog")
  });
  assert.equal(publicMenuResponse.status, 200);
  const publicMenuBody = await publicMenuResponse.json();
  assert.equal(publicMenuBody.menu[0].name, "Test Category");

  const adminMenuResponse = await getAdminMenu({
    env,
    request: adminRequest("https://example.com/api/admin/menu")
  });
  assert.equal(adminMenuResponse.status, 200);
});

test("venue bridge booking endpoint is token protected and updates booking decisions", async () => {
  const env = {
    VENUE_BRIDGE_TOKEN: "bridge-secret"
  };
  const created = await createBooking(env, makeBookingPayload());

  const unauthorizedResponse = await getBridgeBookings({
    env,
    request: new Request("https://example.com/api/bridge/bookings")
  });
  assert.equal(unauthorizedResponse.status, 401);

  const feedResponse = await getBridgeBookings({
    env,
    request: adminRequest("https://example.com/api/bridge/bookings?status=pending", "GET", "bridge-secret")
  });
  assert.equal(feedResponse.status, 200);
  const feedBody = await feedResponse.json();
  assert.equal(feedBody.count, 1);
  assert.equal(feedBody.bookings[0].reference, created.reference);

  const decisionResponse = await postBridgeBookingDecision({
    env,
    request: adminRequest("https://example.com/api/bridge/bookings", "POST", "bridge-secret", {
      reference: created.reference,
      status: "accepted",
      notify: false
    })
  });
  assert.equal(decisionResponse.status, 200);
  const decisionBody = await decisionResponse.json();
  assert.equal(decisionBody.booking.status, "accepted");
  assert.deepEqual(decisionBody.booking.assignedTables, [4]);
});

test("venue bridge menu endpoint imports POS menu ids into the public catalog", async () => {
  const env = {
    VENUE_BRIDGE_TOKEN: "bridge-secret"
  };

  const unauthorizedResponse = await putBridgeMenu({
    env,
    request: new Request("https://example.com/api/bridge/menu", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menu: [] })
    })
  });
  assert.equal(unauthorizedResponse.status, 401);

  const response = await putBridgeMenu({
    env,
    request: adminRequest("https://example.com/api/bridge/menu", "PUT", "bridge-secret", {
      source: "pos",
      menuVersion: "42",
      menu: [
        {
          id: "cat-food",
          posCategoryId: "cat-food",
          name: "Mains",
          categoryType: "food",
          items: [
            {
              id: "item-korma",
              posItemId: "item-korma",
              posCategoryId: "cat-food",
              name: "Korma",
              basePrice: 11.5,
              printRouting: "kitchen",
              tags: ["food"],
              modifierGroups: [
                {
                  id: "group-spice",
                  posModifierGroupId: "group-spice",
                  name: "Spice",
                  selectionType: "single",
                  isRequired: true,
                  options: [
                    {
                      id: "option-mild",
                      posModifierOptionId: "option-mild",
                      name: "Mild",
                      priceAdjustment: 0,
                      allergenCodes: ["D", " e "],
                      removesAllergenCodes: ["N"]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.itemCount, 1);
  assert.equal(body.menu[0].items[0].posItemId, "item-korma");
  assert.equal(body.menu[0].items[0].modifierGroups[0].posModifierGroupId, "group-spice");
  assert.deepEqual(body.menu[0].items[0].modifierGroups[0].options[0].allergenCodes, ["D", "E"]);
  assert.deepEqual(body.menu[0].items[0].modifierGroups[0].options[0].removesAllergenCodes, ["N"]);

  const publicResponse = await getPublicMenu({
    env,
    request: new Request("https://example.com/api/menu-catalog")
  });
  const publicBody = await publicResponse.json();
  assert.equal(publicBody.menu[0].items[0].posItemId, "item-korma");
  assert.deepEqual(publicBody.menu[0].items[0].modifierGroups[0].options[0].allergenCodes, ["D", "E"]);

  const bridgeReadResponse = await getBridgeMenu({
    env,
    request: adminRequest("https://example.com/api/bridge/menu", "GET", "bridge-secret")
  });
  assert.equal(bridgeReadResponse.status, 200);
});

test("menu catalog endpoint pulls a configured POS menu source and falls back to cached catalog", async () => {
  const originalFetch = globalThis.fetch;
  const env = {
    POS_MENU_URL: "https://pos.example.test/menu",
    POS_MENU_BEARER_TOKEN: "pos-secret"
  };

  let fetchCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    fetchCount += 1;
    assert.equal(String(url), "https://pos.example.test/menu");
    assert.equal(options.headers.Authorization, "Bearer pos-secret");

    return new Response(JSON.stringify({
      categories: [
        {
          categoryId: "cat-desserts",
          name: "Desserts",
          products: [
            {
              itemId: "pos-brownie",
              name: "Brownie",
              price: "4.50",
              categoryId: "cat-desserts"
            }
          ]
        }
      ]
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  };

  try {
    const response = await getPublicMenu({
      env,
      request: new Request("https://example.com/api/menu-catalog")
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.menu[0].name, "Desserts");
    assert.equal(body.menu[0].items[0].posItemId, "pos-brownie");
    assert.equal(body.menu[0].items[0].basePrice, 4.5);
    assert.equal(fetchCount, 1);

    globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
    const cachedResponse = await getPublicMenu({
      env,
      request: new Request("https://example.com/api/menu-catalog")
    });
    assert.equal(cachedResponse.status, 200);
    const cachedBody = await cachedResponse.json();
    assert.equal(cachedBody.menu[0].items[0].posItemId, "pos-brownie");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("venue bridge order endpoint is token protected and updates order decisions", async () => {
  const env = {
    VENUE_BRIDGE_TOKEN: "bridge-secret",
    RESEND_API_KEY: "re_test_123",
    ORDERS_EMAIL_FROM: "Millers Cafe <help@millers.cafe>",
    ORDERS_NOTIFICATION_EMAIL: "help@millers.cafe"
  };

  const sentPayloads = [];
  globalThis.fetch = async () => {
    sentPayloads.push(true);
    return new Response(JSON.stringify({ id: `email_${sentPayloads.length}` }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  };

  const created = await createOrder(env, makeOrderPayload({
    cartItems: [
      {
        itemName: "Chicken Balti",
        quantity: 2,
        modifierSelections: [
          { groupName: "Rice", optionName: "Pilau Rice" }
        ]
      }
    ]
  }));

  const unauthorizedResponse = await getBridgeOrders({
    env,
    request: new Request("https://example.com/api/bridge/orders")
  });
  assert.equal(unauthorizedResponse.status, 401);

  const feedResponse = await getBridgeOrders({
    env,
    request: adminRequest("https://example.com/api/bridge/orders?status=submitted", "GET", "bridge-secret")
  });
  assert.equal(feedResponse.status, 200);
  const feedBody = await feedResponse.json();
  assert.equal(feedBody.count, 1);
  assert.equal(feedBody.orders[0].reference, created.reference);
  assert.equal(feedBody.orders[0].cartItems[0].itemName, "Chicken Balti");

  const missingEtaResponse = await postBridgeOrderDecision({
    env,
    request: adminRequest("https://example.com/api/bridge/orders", "POST", "bridge-secret", {
      reference: created.reference,
      status: "accepted",
      notify: false
    })
  });
  assert.equal(missingEtaResponse.status, 400);

  const decisionResponse = await postBridgeOrderDecision({
    env,
    request: adminRequest("https://example.com/api/bridge/orders", "POST", "bridge-secret", {
      reference: created.reference,
      status: "accepted",
      etaMinutes: 35,
      notify: false
    })
  });
  assert.equal(decisionResponse.status, 200);
  const decisionBody = await decisionResponse.json();
  assert.equal(decisionBody.status, "accepted");
  assert.equal(decisionBody.etaMinutes, 35);
});

test("analytics endpoint records allowed events and admin summary aggregates them", async () => {
  const env = {
    ADMIN_API_TOKENS: "secret"
  };

  const responses = await Promise.all([
    postAnalytics({
      env,
      request: new Request("https://example.com/api/analytics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          event: "page_view",
          page: "home",
          route: "/"
        })
      })
    }),
    postAnalytics({
      env,
      request: new Request("https://example.com/api/analytics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          event: "order_checkout_redirect",
          page: "order",
          route: "/collection/",
          orderType: "delivery"
        })
      })
    })
  ]);

  assert.equal(responses[0].status, 200);
  assert.equal(responses[1].status, 200);

  const summaryResponse = await getAdminAnalytics({
    env,
    request: adminRequest("https://example.com/api/admin/analytics?days=30")
  });

  assert.equal(summaryResponse.status, 200);
  const summaryBody = await summaryResponse.json();
  assert.equal(summaryBody.totals.total, 2);
  assert.equal(summaryBody.totals.events.some((entry) => entry.key === "page_view" && entry.count === 1), true);
  assert.equal(summaryBody.totals.events.some((entry) => entry.key === "order_checkout_redirect" && entry.count === 1), true);
  assert.equal(summaryBody.totals.orderTypes.some((entry) => entry.key === "order_checkout_redirect:delivery" && entry.count === 1), true);
});

test("rate limiting rejects requests after the configured threshold", async () => {
  const request = new Request("https://example.com/api/account/request-code", {
    headers: {
      "x-forwarded-for": "203.0.113.10"
    }
  });

  await enforceRateLimit({}, request, {
    prefix: "test_limit",
    limit: 2,
    windowSeconds: 60,
    message: "Too many attempts."
  });

  await enforceRateLimit({}, request, {
    prefix: "test_limit",
    limit: 2,
    windowSeconds: 60,
    message: "Too many attempts."
  });

  await assert.rejects(
    () => enforceRateLimit({}, request, {
      prefix: "test_limit",
      limit: 2,
      windowSeconds: 60,
      message: "Too many attempts."
    }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 429);
      assert.match(error.message, /too many attempts/i);
      return true;
    }
  );
});

test("rate limiting uses Cloudflare KV compatible minimum expiration TTL", async () => {
  let writtenTtl = 0;
  const env = {
    BOOKINGS_KV: {
      async get() {
        return null;
      },
      async put(_key, _value, options = {}) {
        writtenTtl = Number(options.expirationTtl || 0);
        if (writtenTtl < 60) {
          throw new Error(`Invalid expiration_ttl of ${writtenTtl}`);
        }
      }
    }
  };

  await enforceRateLimit(env, new Request("https://example.com/api/orders/checkout"), {
    prefix: "short_window",
    limit: 5,
    windowSeconds: 42
  });

  assert.equal(writtenTtl, 60);
});

test("production rate limiting fails closed without its distributed store", async () => {
  await assert.rejects(
    () => enforceRateLimit(
      { REQUIRE_DISTRIBUTED_RATE_LIMIT: "true" },
      new Request("https://example.com/api/bookings"),
      { prefix: "booking_create", limit: 8, windowSeconds: 600 }
    ),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      return true;
    }
  );
});

test("Cloudflare KV same-key throttling is returned as an abuse-limit response", async () => {
  const env = {
    REQUIRE_DISTRIBUTED_RATE_LIMIT: "true",
    BOOKINGS_KV: {
      async get() {
        return null;
      },
      async put() {
        const error = new Error("KV write rate limit: 429");
        error.status = 429;
        throw error;
      }
    }
  };

  await assert.rejects(
    () => enforceRateLimit(
      env,
      new Request("https://example.com/api/bookings", {
        headers: { "cf-connecting-ip": "203.0.113.30" }
      }),
      { prefix: "booking_create", limit: 8, windowSeconds: 600 }
    ),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 429);
      assert.ok(Number(error.details?.retryAfterSeconds) >= 1);
      return true;
    }
  );
});
