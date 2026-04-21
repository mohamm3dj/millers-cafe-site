"use strict";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { ApiError } from "../functions/_lib/errors.js";
import { enforceRateLimit } from "../functions/_lib/rate-limit.js";
import { onRequestPost as postAnalytics } from "../functions/api/analytics.js";
import { onRequestGet as getAdminAnalytics } from "../functions/api/admin/analytics.js";
import { onRequestGet as getAdminConfig, onRequestPut as putAdminConfig } from "../functions/api/admin/config.js";
import { onRequestGet as getAdminMenu, onRequestPut as putAdminMenu } from "../functions/api/admin/menu.js";
import { onRequestGet as getPublicMenu } from "../functions/api/menu-catalog.js";
import { onRequestGet as getPublicSiteConfig } from "../functions/api/site-config.js";
import { resetInMemoryStores } from "./helpers/factories.js";

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
