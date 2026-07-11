"use strict";

import assert from "node:assert/strict";
import { beforeEach, after, test } from "node:test";

import { loadOrders } from "../functions/_orders-core.js";
import { createOrderCheckout, getCheckoutSessionStatus, handleStripeWebhook } from "../functions/_lib/order-checkout-service.js";
import { priceOrderCart } from "../functions/_lib/order-menu.js";
import { saveSiteConfig } from "../functions/_lib/site-config.js";
import {
  makeOrderPayload,
  resetInMemoryStores
} from "./helpers/factories.js";

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

async function signStripePayload(secret, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`)
  );
  const signature = [...new Uint8Array(signatureBytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  return `t=${timestamp},v1=${signature}`;
}

beforeEach(() => {
  resetInMemoryStores();
  globalThis.fetch = originalFetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

test("priceOrderCart rebuilds the basket total and delivery fee from the catalog", () => {
  const priced = priceOrderCart([
    {
      itemName: "Build Your Salad Bowl",
      quantity: 2,
      modifierSelections: [
        { groupName: "Protein", optionName: "Mixed Tikka" },
        { groupName: "Dressing", optionName: "Sweet Chilli" }
      ]
    }
  ], {
    orderType: "delivery",
    deliveryFeeGBP: 2
  });

  assert.equal(priced.ok, true);
  assert.equal(priced.subtotal, 18);
  assert.equal(priced.deliveryFee, 2);
  assert.equal(priced.total, 20);
  assert.match(priced.itemsSummary, /Delivery fee = £2\.00/);
  assert.match(priced.itemsSummary, /Total = £20\.00/);
});

test("priceOrderCart applies a 10 percent collection discount", () => {
  const priced = priceOrderCart([
    {
      itemName: "Papadom",
      quantity: 2,
      modifierSelections: []
    }
  ], {
    orderType: "collection"
  });

  assert.equal(priced.ok, true);
  assert.equal(priced.subtotal, 2);
  assert.equal(priced.collectionDiscount, 0.2);
  assert.equal(priced.total, 1.8);
  assert.equal(priced.totalMinor, 180);
  assert.equal(priced.items[0].checkoutQuantity, 1);
  assert.equal(priced.items[0].checkoutUnitAmountMinor, 180);
  assert.match(priced.itemsSummary, /Collection discount \(10%\) = -£0\.20/);
  assert.match(priced.itemsSummary, /Total = £1\.80/);
});

test("priceOrderCart preserves POS menu ids from the live catalog", () => {
  const menuCatalog = [
    {
      id: "cat-main",
      name: "Mains",
      items: [
        {
          id: "pos-item-korma",
          posItemId: "pos-item-korma",
          posCategoryId: "cat-main",
          name: "Korma",
          basePrice: 11.5,
          printRouting: "kitchen",
          modifierGroups: [
            {
              id: "group-spice",
              posModifierGroupId: "group-spice",
              name: "Spice",
              selectionType: "single",
              isRequired: true,
              options: [
                {
                  id: "option-hot",
                  posModifierOptionId: "option-hot",
                  name: "Hot",
                  priceAdjustment: 0,
                  allergenCodes: ["D", "not-real"],
                  removesAllergenCodes: ["N"]
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const priced = priceOrderCart([
    {
      posItemId: "pos-item-korma",
      itemName: "Renamed locally",
      quantity: 1,
      modifierSelections: [
        {
          posModifierGroupId: "group-spice",
          posModifierOptionId: "option-hot",
          groupName: "Old Spice",
          optionName: "Old Hot"
        }
      ]
    }
  ], { menuCatalog });

  assert.equal(priced.ok, true);
  assert.equal(priced.items[0].itemName, "Korma");
  assert.equal(priced.items[0].posItemId, "pos-item-korma");
  assert.equal(priced.items[0].posCategoryId, "cat-main");
  assert.equal(priced.items[0].modifierSelections[0].posModifierGroupId, "group-spice");
  assert.equal(priced.items[0].modifierSelections[0].posModifierOptionId, "option-hot");
  assert.deepEqual(priced.items[0].modifierSelections[0].allergenCodes, ["D"]);
  assert.deepEqual(priced.items[0].modifierSelections[0].removesAllergenCodes, ["N"]);
});

test("createOrderCheckout prices delivery from the bundled website menu", async () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_123",
    ONLINE_ORDERING_ENABLED: "true",
    POS_MENU_URL: "https://pos.example.test/menu",
    POS_MENU_API_KEY: "pos-api-key",
    ORDER_DELIVERY_FEE_GBP: "2"
  };

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);

    if (requestUrl === "https://pos.example.test/menu") {
      throw new Error("Checkout should not fetch the POS menu for customer-facing website orders.");
    }

    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions" && options.method === "POST") {
      const form = new URLSearchParams(String(options.body || ""));

      assert.equal(form.get("line_items[0][price_data][unit_amount]"), "400");
      assert.equal(form.get("line_items[0][quantity]"), "1");
      assert.equal(form.get("line_items[1][price_data][unit_amount]"), "200");
      assert.equal(form.get("metadata[order_type]"), "delivery");

      return jsonResponse({
        id: "cs_test_pos_menu",
        url: "https://checkout.stripe.com/c/pay/cs_test_pos_menu"
      });
    }

    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  const created = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...makeOrderPayload({
      orderType: "delivery",
      addressLine1: "55 Brigsley Road",
      townCity: "Grimsby",
      postcode: "DN37 0JZ"
    }),
    cartItems: [
      {
        itemName: "Iced Lychee Lemonade",
        quantity: 1,
        modifierSelections: []
      }
    ]
  });

  assert.equal(created.ok, true);
  assert.equal(created.sessionId, "cs_test_pos_menu");
  assert.equal(created.amountTotal, 600);
});

test("production checkout stays paused until online ordering is explicitly enabled", async () => {
  await assert.rejects(
    createOrderCheckout(
      { STRIPE_SECRET_KEY: "sk_test_123" },
      "https://millers.cafe/api/orders/checkout",
      makeOrderPayload()
    ),
    (error) => error?.status === 503 && /temporarily paused/i.test(error.message)
  );
});

test("createOrderCheckout creates a hosted Stripe session and getCheckoutSessionStatus finalizes the paid order", async () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_123",
    ONLINE_ORDERING_ENABLED: "true",
    ORDER_DELIVERY_FEE_GBP: "2"
  };

  let capturedDraftId = "";

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);

    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions" && options.method === "POST") {
      const form = new URLSearchParams(String(options.body || ""));
      capturedDraftId = String(form.get("client_reference_id") || "");

      assert.equal(form.get("line_items[0][price_data][unit_amount]"), "180");
      assert.equal(form.get("line_items[0][quantity]"), "1");
      assert.equal(form.get("customer_email"), "mo@example.com");
      assert.equal(form.has("payment_method_types[0]"), false);
      assert.ok(capturedDraftId.length > 0);
      assert.equal(options.headers["Stripe-Version"], "2026-02-25.clover");
      assert.match(String(options.headers["Idempotency-Key"] || ""), /^order-checkout:/);

      return jsonResponse({
        id: "cs_test_123",
        url: "https://checkout.stripe.com/c/pay/cs_test_123"
      });
    }

    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions/cs_test_123" && options.method === "GET") {
      return jsonResponse({
        id: "cs_test_123",
        object: "checkout.session",
        client_reference_id: capturedDraftId,
        payment_status: "paid",
        status: "complete",
        payment_intent: "pi_test_123",
        amount_total: 180,
        currency: "gbp"
      });
    }

    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  const created = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...makeOrderPayload(),
    cartItems: [
      { itemName: "Papadom", quantity: 2, modifierSelections: [] }
    ]
  });

  assert.equal(created.ok, true);
  assert.equal(created.sessionId, "cs_test_123");
  assert.equal(created.amountTotal, 180);

  await saveSiteConfig(env, {
    orders: {
      openDayIndexes: [1],
      serviceStartMinutes: 16 * 60,
      serviceEndMinutes: 17 * 60,
      collectionEarliestScheduledMinutes: 16 * 60
    }
  });

  const [status, duplicateStatus] = await Promise.all([
    getCheckoutSessionStatus(env, created.sessionId),
    getCheckoutSessionStatus(env, created.sessionId)
  ]);

  assert.equal(status.status, "completed");
  assert.equal(status.reference.startsWith("MCO-"), true);
  assert.equal(status.paymentStatus, "paid");
  assert.equal(duplicateStatus.orderId, status.orderId);

  const stored = await loadOrders(env);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].paymentProvider, "stripe");
  assert.equal(stored[0].paymentStatus, "paid");
  assert.equal(stored[0].paymentSessionId, "cs_test_123");
  assert.equal(stored[0].paymentIntentId, "pi_test_123");
  assert.equal(stored[0].paymentAmountTotal, 180);
  assert.equal(stored[0].paymentCurrency, "gbp");
});

test("createOrderCheckout reuses a checkout draft and Stripe idempotency key for a repeated request", async () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_123", ONLINE_ORDERING_ENABLED: "true" };
  const draftIds = [];
  const stripeKeys = [];

  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api.stripe.com/v1/checkout/sessions");
    const form = new URLSearchParams(String(options.body || ""));
    draftIds.push(String(form.get("client_reference_id") || ""));
    stripeKeys.push(String(options.headers["Idempotency-Key"] || ""));
    return jsonResponse({
      id: "cs_test_idempotent",
      url: "https://checkout.stripe.com/c/pay/cs_test_idempotent"
    });
  };

  const payload = {
    ...makeOrderPayload(),
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };
  const options = { idempotencyKey: "browser-checkout-attempt-1" };
  const first = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, options);
  const second = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, options);

  assert.equal(first.sessionId, second.sessionId);
  assert.equal(draftIds.length, 2);
  assert.equal(draftIds[0], draftIds[1]);
  assert.equal(stripeKeys[0], stripeKeys[1]);
});

test("paid checkout finalization rejects a Stripe amount that differs from the immutable draft", async () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_123", ONLINE_ORDERING_ENABLED: "true" };
  let draftId = "";

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions") {
      const form = new URLSearchParams(String(options.body || ""));
      draftId = String(form.get("client_reference_id") || "");
      return jsonResponse({
        id: "cs_test_wrong_total",
        url: "https://checkout.stripe.com/c/pay/cs_test_wrong_total"
      });
    }
    if (requestUrl.endsWith("/checkout/sessions/cs_test_wrong_total")) {
      return jsonResponse({
        id: "cs_test_wrong_total",
        object: "checkout.session",
        client_reference_id: draftId,
        payment_status: "paid",
        payment_intent: "pi_test_wrong_total",
        amount_total: 91,
        currency: "gbp"
      });
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...makeOrderPayload(),
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  });

  await assert.rejects(
    () => getCheckoutSessionStatus(env, "cs_test_wrong_total"),
    (error) => error?.status === 409 && /amount/i.test(error.message)
  );
  assert.equal((await loadOrders(env)).length, 0);
});

test("handleStripeWebhook verifies the signature and finalizes the order from checkout.session.completed", async () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_123",
    ONLINE_ORDERING_ENABLED: "true",
    STRIPE_WEBHOOK_SECRET: "whsec_test_123"
  };

  let capturedDraftId = "";

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);

    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions" && options.method === "POST") {
      const form = new URLSearchParams(String(options.body || ""));
      capturedDraftId = String(form.get("client_reference_id") || "");

      return jsonResponse({
        id: "cs_test_webhook",
        url: "https://checkout.stripe.com/c/pay/cs_test_webhook"
      });
    }

    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...makeOrderPayload(),
    cartItems: [
      { itemName: "Papadom", quantity: 1, modifierSelections: [] }
    ]
  });

  const eventPayload = JSON.stringify({
    id: "evt_test_123",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_webhook",
        object: "checkout.session",
        client_reference_id: capturedDraftId,
        payment_status: "paid",
        payment_intent: "pi_test_webhook",
        amount_total: 90,
        currency: "gbp"
      }
    }
  });

  const signature = await signStripePayload(env.STRIPE_WEBHOOK_SECRET, eventPayload);
  const result = await handleStripeWebhook(env, eventPayload, signature);

  assert.equal(result.received, true);

  const stored = await loadOrders(env);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].paymentSessionId, "cs_test_webhook");
  assert.equal(stored[0].paymentStatus, "paid");
});
