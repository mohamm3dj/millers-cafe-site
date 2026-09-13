"use strict";

import assert from "node:assert/strict";
import { beforeEach, after, test } from "node:test";

import { loadOrders } from "../functions/_orders-core.js";
import { createOrderCheckout, getCheckoutSessionStatus, handleStripeWebhook } from "../functions/_lib/order-checkout-service.js";
import { priceOrderCart } from "../functions/_lib/order-menu.js";
import { updateOrderStatus } from "../functions/_lib/order-status-service.js";
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

function createTestKV(options = {}) {
  const values = new Map();
  let remainingAggregateFailures = Math.max(0, Number(options.failOrderAggregateWrites || 0));
  const kv = {
    async get(key, type) {
      const value = values.get(String(key));
      if (value === undefined) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      const normalizedKey = String(key);
      if (normalizedKey === "orders_v1" && remainingAggregateFailures > 0) {
        remainingAggregateFailures -= 1;
        throw new Error("Injected aggregate order write failure.");
      }
      values.set(normalizedKey, String(value));
    },
    async list({ prefix = "" } = {}) {
      return {
        keys: Array.from(values.keys())
          .filter((key) => key.startsWith(String(prefix)))
          .map((name) => ({ name })),
        list_complete: true
      };
    }
  };
  return { kv, values };
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

function freshLunchDealSelections(drink = "Coca-Cola Can") {
  return [
    { groupName: "Main", optionName: "Fresh Homemade Bread Sandwich" },
    { groupName: "Filling", optionName: "Chicken" },
    { groupName: "Sauce", optionName: "Mayo" },
    { groupName: "Crisp or snack", optionName: "Quavers - Cheese" },
    { groupName: "Drink", optionName: drink }
  ];
}

function freshLunchDealCartItem(drink = "Coca-Cola Can", overrides = {}) {
  return {
    itemName: "Fresh Lunch Deal",
    quantity: 1,
    modifierSelections: freshLunchDealSelections(drink),
    ...overrides
  };
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

test("priceOrderCart uses approved standalone soft drink prices", () => {
  const approvedPrices = [
    { name: "Coca-Cola Can", subtotal: 1.5, discount: 0.15, total: 1.35, totalMinor: 135 },
    { name: "Diet Coke Can", subtotal: 1.5, discount: 0.15, total: 1.35, totalMinor: 135 },
    { name: "Fanta Can", subtotal: 1.5, discount: 0.15, total: 1.35, totalMinor: 135 },
    { name: "Fanta Fruit Twist", subtotal: 1.5, discount: 0.15, total: 1.35, totalMinor: 135 },
    { name: "Sprite Can", subtotal: 1.5, discount: 0.15, total: 1.35, totalMinor: 135 },
    { name: "Dr Pepper", subtotal: 1.5, discount: 0.15, total: 1.35, totalMinor: 135 },
    { name: "Smart Water", subtotal: 1.5, discount: 0.15, total: 1.35, totalMinor: 135 },
    { name: "Red Bull", subtotal: 2, discount: 0.2, total: 1.8, totalMinor: 180 }
  ];

  approvedPrices.forEach(({ name, subtotal, discount, total, totalMinor }) => {
    const priced = priceOrderCart([
      {
        itemName: name,
        quantity: 1,
        basePrice: 99,
        discountEligible: false,
        modifierSelections: []
      }
    ], {
      orderType: "collection"
    });

    assert.equal(priced.ok, true, `${name} should be orderable`);
    assert.equal(priced.subtotal, subtotal, `${name} should use the website price`);
    assert.equal(priced.collectionDiscount, discount, `${name} should receive the collection discount`);
    assert.equal(priced.total, total, `${name} should use the discounted collection total`);
    assert.equal(priced.totalMinor, totalMinor, `${name} should use the server-priced Stripe amount`);
    assert.equal(priced.items[0].discountEligible, true, `${name} should ignore a forged discount flag`);
  });
});

test("priceOrderCart excludes the fresh lunch deal and its drink upgrades from collection discounts", () => {
  [
    { drink: "Coca-Cola Can", subtotal: 5.95, totalMinor: 595 },
    { drink: "Fanta Fruit Twist", subtotal: 5.95, totalMinor: 595 },
    { drink: "Dr Pepper", subtotal: 5.95, totalMinor: 595 },
    { drink: "Smart Water", subtotal: 5.95, totalMinor: 595 },
    { drink: "Red Bull", subtotal: 6.95, totalMinor: 695 },
    { drink: "Latte (hot drink upgrade)", subtotal: 6.95, totalMinor: 695 }
  ].forEach(({ drink, subtotal, totalMinor }) => {
    const priced = priceOrderCart([
      freshLunchDealCartItem(drink)
    ], {
      orderType: "collection"
    });

    assert.equal(priced.ok, true);
    assert.equal(priced.subtotal, subtotal);
    assert.equal(priced.collectionDiscount, 0);
    assert.equal(priced.total, subtotal);
    assert.equal(priced.totalMinor, totalMinor);
    assert.equal(priced.items[0].discountEligible, false);
    assert.equal(priced.items[0].checkoutQuantity, 1);
    assert.equal(priced.items[0].checkoutUnitAmountMinor, totalMinor);
    assert.doesNotMatch(priced.items[0].stripeDescription, /collection discount applied/i);
    assert.doesNotMatch(priced.itemsSummary, /Collection discount/);
  });
});

test("priceOrderCart discounts only eligible lines and ignores browser-provided eligibility flags", () => {
  const priced = priceOrderCart([
    freshLunchDealCartItem("Coca-Cola Can", {
      basePrice: 0.01,
      discountEligible: true
    }),
    {
      itemName: "Papadom",
      quantity: 1,
      modifierSelections: [],
      basePrice: 999,
      discountEligible: false
    }
  ], {
    orderType: "collection"
  });

  assert.equal(priced.ok, true);
  assert.equal(priced.subtotal, 6.95);
  assert.equal(priced.collectionDiscount, 0.1);
  assert.equal(priced.collectionDiscountMinor, 10);
  assert.equal(priced.total, 6.85);
  assert.equal(priced.totalMinor, 685);
  assert.equal(priced.items[0].discountEligible, false);
  assert.equal(priced.items[0].checkoutQuantity, 1);
  assert.equal(priced.items[0].checkoutUnitAmountMinor, 595);
  assert.doesNotMatch(priced.items[0].stripeDescription, /collection discount applied/i);
  assert.equal(priced.items[1].discountEligible, true);
  assert.equal(priced.items[1].checkoutQuantity, 1);
  assert.equal(priced.items[1].checkoutUnitAmountMinor, 90);
  assert.match(priced.items[1].stripeDescription, /10% collection discount applied/);
  assert.match(priced.itemsSummary, /Collection discount \(10%\) = -£0\.10/);
  assert.match(priced.itemsSummary, /Total = £6\.85/);
});

test("priceOrderCart allocates rounding only across eligible lines without surcharging the final line", () => {
  const menuCatalog = [
    {
      name: "Rounding",
      items: [
        ...["Eligible A", "Eligible B", "Eligible C", "Eligible D"].map((name) => ({
          name,
          basePrice: 0.05,
          modifierGroups: []
        })),
        {
          name: "Eligible Penny",
          basePrice: 0.01,
          modifierGroups: []
        },
        {
          name: "Excluded Five",
          basePrice: 0.05,
          discountEligible: false,
          modifierGroups: []
        }
      ]
    }
  ];
  const priced = priceOrderCart(
    menuCatalog[0].items.map((item) => ({
      itemName: item.name,
      quantity: 1,
      modifierSelections: []
    })),
    { orderType: "collection", menuCatalog }
  );

  assert.equal(priced.ok, true);
  assert.equal(priced.subtotalMinor, 26);
  assert.equal(priced.collectionDiscountMinor, 2);
  assert.equal(priced.totalMinor, 24);
  assert.deepEqual(
    priced.items.map((item) => item.checkoutUnitAmountMinor),
    [4, 4, 5, 5, 1, 5]
  );
  assert.equal(priced.items.at(-1).discountEligible, false);
  assert.equal(priced.items.at(-1).checkoutUnitAmountMinor, 5);
  priced.items.forEach((item) => {
    assert.ok(item.checkoutUnitAmountMinor >= 0, `${item.itemName} must not receive a negative Stripe amount`);
    assert.ok(
      item.checkoutUnitAmountMinor <= Math.round(item.linePrice * 100),
      `${item.itemName} must not be surcharged during discount allocation`
    );
  });
});

test("priceOrderCart keeps the fresh lunch deal full-price for delivery despite a forged browser flag", () => {
  const priced = priceOrderCart([
    freshLunchDealCartItem("Coca-Cola Can", {
      discountEligible: true
    })
  ], {
    orderType: "delivery",
    deliveryFeeGBP: 2
  });

  assert.equal(priced.ok, true);
  assert.equal(priced.subtotal, 5.95);
  assert.equal(priced.collectionDiscount, 0);
  assert.equal(priced.deliveryFee, 2);
  assert.equal(priced.total, 7.95);
  assert.equal(priced.totalMinor, 795);
  assert.equal(priced.items[0].discountEligible, false);
  assert.equal(priced.items[0].checkoutUnitAmountMinor, 595);
  assert.doesNotMatch(priced.items[0].stripeDescription, /collection discount applied/i);
});

test("priceOrderCart accepts No Sauce for the fresh lunch deal without changing its price", () => {
  const modifierSelections = freshLunchDealSelections().map((selection) => (
    selection.groupName === "Sauce"
      ? { groupName: "Sauce", optionName: "No Sauce" }
      : selection
  ));
  const priced = priceOrderCart([
    freshLunchDealCartItem("Coca-Cola Can", { modifierSelections })
  ], {
    orderType: "collection"
  });

  assert.equal(priced.ok, true);
  assert.equal(priced.subtotalMinor, 595);
  assert.equal(priced.collectionDiscountMinor, 0);
  assert.equal(priced.totalMinor, 595);
  assert.ok(priced.items[0].modifierSelections.some((selection) => (
    selection.groupName === "Sauce" && selection.optionName === "No Sauce"
  )));
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

test("createOrderCheckout preserves the bundled deal exclusion in mixed collection Stripe lines", async () => {
  const env = {
    STRIPE_SECRET_KEY: "sk_test_123",
    ONLINE_ORDERING_ENABLED: "true"
  };

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions" && options.method === "POST") {
      const form = new URLSearchParams(String(options.body || ""));
      const dealDescription = String(form.get("line_items[0][price_data][product_data][description]") || "");
      const eligibleDescription = String(form.get("line_items[1][price_data][product_data][description]") || "");

      assert.equal(form.get("line_items[0][price_data][unit_amount]"), "595");
      assert.equal(form.get("line_items[0][quantity]"), "1");
      assert.doesNotMatch(dealDescription, /collection discount applied/i);
      assert.equal(form.get("line_items[1][price_data][unit_amount]"), "90");
      assert.equal(form.get("line_items[1][quantity]"), "1");
      assert.match(eligibleDescription, /10% collection discount applied/);
      assert.equal(form.get("line_items[2][price_data][unit_amount]"), null);
      assert.equal(form.get("metadata[order_type]"), "collection");

      return jsonResponse({
        id: "cs_test_mixed_discount",
        url: "https://checkout.stripe.com/c/pay/cs_test_mixed_discount"
      });
    }

    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  const created = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...makeOrderPayload(),
    cartItems: [
      freshLunchDealCartItem("Coca-Cola Can", {
        basePrice: 0.01,
        discountEligible: true
      }),
      {
        itemName: "Papadom",
        quantity: 1,
        modifierSelections: [],
        basePrice: 999,
        discountEligible: false
      }
    ]
  });

  assert.equal(created.ok, true);
  assert.equal(created.sessionId, "cs_test_mixed_discount");
  assert.equal(created.amountTotal, 685);
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

test("cash checkout stays disabled until the dedicated rollout flag is enabled", async () => {
  const env = { ONLINE_ORDERING_ENABLED: "true" };
  const payload = {
    ...makeOrderPayload(),
    paymentMethod: "cash",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };

  await assert.rejects(
    () => createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, {
      idempotencyKey: "cash-disabled-attempt"
    }),
    (error) => error?.status === 503 && /cash ordering is temporarily unavailable/i.test(error.message)
  );
  assert.equal((await loadOrders(env)).length, 0);
});

test("cash collection checkout is server-priced, completes without Stripe, and is idempotent", async () => {
  const env = { ONLINE_ORDERING_ENABLED: "true", CASH_ORDERING_ENABLED: "true" };
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Cash checkout must not call Stripe or another remote service when email is not configured.");
  };

  const payload = {
    ...makeOrderPayload(),
    paymentMethod: "cash",
    cartItems: [
      {
        itemName: "Papadom",
        quantity: 2,
        basePrice: 999,
        modifierSelections: []
      }
    ]
  };
  const options = { idempotencyKey: "cash-collection-attempt-1" };
  const [first, repeated] = await Promise.all([
    createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, options),
    createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, options)
  ]);

  assert.equal(first.ok, true);
  assert.equal(first.status, "completed");
  assert.equal(first.paymentMethod, "cash");
  assert.equal(first.paymentProvider, "cash");
  assert.equal(first.paymentStatus, "unpaid");
  assert.equal(first.amountTotal, 180);
  assert.equal(first.currency, "gbp");
  assert.match(first.reference, /^MCO-/);
  assert.ok(first.trackingToken);
  assert.equal(first.orderId, repeated.orderId);
  assert.equal(first.reference, repeated.reference);
  assert.equal("checkoutUrl" in first, false);
  assert.equal("sessionId" in first, false);
  assert.equal(fetchCalls, 0);

  const stored = await loadOrders(env);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].paymentProvider, "cash");
  assert.equal(stored[0].paymentStatus, "unpaid");
  assert.equal(stored[0].paymentSessionId, "");
  assert.equal(stored[0].paymentIntentId, "");
  assert.equal(stored[0].paymentAmountTotal, 180);
  assert.equal(stored[0].paymentCurrency, "gbp");
});

test("cash checkout fails closed before email/completion and recovers after an aggregate write failure", async () => {
  const { kv, values } = createTestKV({ failOrderAggregateWrites: 1 });
  const env = {
    BOOKINGS_KV: kv,
    ONLINE_ORDERING_ENABLED: "true",
    CASH_ORDERING_ENABLED: "true",
    RESEND_API_KEY: "re_test_123",
    ORDERS_EMAIL_FROM: "Millers Cafe <help@millers.cafe>"
  };
  let emailCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    assert.match(String(options.headers["Idempotency-Key"] || ""), /^cash-order-email:[a-f0-9-]+:(customer|owner)$/);
    emailCalls += 1;
    return jsonResponse({ id: `email-${emailCalls}` });
  };

  const payload = {
    ...makeOrderPayload(),
    paymentMethod: "cash",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };
  const options = { idempotencyKey: "cash-aggregate-recovery-attempt" };

  await assert.rejects(
    () => createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, options),
    (error) => error?.status === 503 && /storage is still syncing/i.test(error.message)
  );
  assert.equal(emailCalls, 0);
  assert.equal(values.has("orders_v1"), false);
  assert.equal(Array.from(values.keys()).filter((key) => key.startsWith("order_entity:")).length, 1);
  assert.equal(Array.from(values.keys()).filter((key) => key.startsWith("order_checkout_completion:cash:")).length, 0);

  const recovered = await createOrderCheckout(
    env,
    "https://millers.cafe/api/orders/checkout",
    payload,
    options
  );
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.paymentProvider, "cash");
  assert.equal(emailCalls, 2);
  assert.equal(JSON.parse(values.get("orders_v1")).length, 1);
  assert.equal(Array.from(values.keys()).filter((key) => key.startsWith("order_entity:")).length, 1);
  assert.equal(Array.from(values.keys()).filter((key) => key.startsWith("order_checkout_completion:cash:")).length, 1);

  const replayed = await createOrderCheckout(
    { ...env, ONLINE_ORDERING_ENABLED: "false" },
    "https://millers.cafe/api/orders/checkout",
    payload,
    options
  );
  assert.equal(replayed.orderId, recovered.orderId);
  assert.equal(emailCalls, 2);
});

test("a completed cash retry uses its immutable draft despite current ordering rules and rejects changed details", async () => {
  const env = { ONLINE_ORDERING_ENABLED: "true", CASH_ORDERING_ENABLED: "true" };
  const payload = {
    ...makeOrderPayload(),
    paymentMethod: "cash",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };
  const options = { idempotencyKey: "cash-immutable-retry-attempt" };
  const created = await createOrderCheckout(
    env,
    "https://millers.cafe/api/orders/checkout",
    payload,
    options
  );

  await saveSiteConfig(env, {
    orders: {
      openDayIndexes: [1],
      serviceStartMinutes: 16 * 60,
      serviceEndMinutes: 17 * 60,
      collectionEarliestScheduledMinutes: 16 * 60
    }
  });
  env.ONLINE_ORDERING_ENABLED = "false";

  const replayed = await createOrderCheckout(
    env,
    "https://millers.cafe/api/orders/checkout",
    payload,
    options
  );
  assert.equal(replayed.orderId, created.orderId);
  assert.equal(replayed.reference, created.reference);

  await assert.rejects(
    () => createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
      ...payload,
      customerName: "A different customer"
    }, options),
    (error) => error?.status === 409 && /different order details/i.test(error.message)
  );
});

test("cash delivery checkout includes the server delivery fee without requiring Stripe", async () => {
  const env = {
    ONLINE_ORDERING_ENABLED: "true",
    CASH_ORDERING_ENABLED: "true",
    ORDER_DELIVERY_FEE_GBP: "2"
  };
  globalThis.fetch = async () => {
    throw new Error("Cash delivery checkout must not call Stripe.");
  };

  const created = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...makeOrderPayload({
      orderType: "delivery",
      addressLine1: "55 Brigsley Road",
      townCity: "Grimsby",
      postcode: "DN37 0JZ"
    }),
    paymentMethod: "cash",
    cartItems: [
      { itemName: "Iced Lychee Lemonade", quantity: 1, modifierSelections: [] }
    ]
  }, {
    idempotencyKey: "cash-delivery-attempt-1"
  });

  assert.equal(created.status, "completed");
  assert.equal(created.orderType, "delivery");
  assert.equal(created.paymentStatus, "unpaid");
  assert.equal(created.amountTotal, 600);
  const stored = await loadOrders(env);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].orderType, "delivery");
  assert.equal(stored[0].paymentAmountTotal, 600);
});

test("rejecting a cash order preserves its payment details and never attempts a Stripe refund", async () => {
  const env = { ONLINE_ORDERING_ENABLED: "true", CASH_ORDERING_ENABLED: "true" };
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("A cash rejection must not call Stripe.");
  };

  const created = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...makeOrderPayload(),
    paymentMethod: "cash",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  }, {
    idempotencyKey: "cash-rejection-attempt-1"
  });
  const rejected = await updateOrderStatus(env, {
    reference: created.reference,
    status: "rejected",
    notify: false
  });

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.paymentMethod, "cash");
  assert.equal(rejected.paymentProvider, "cash");
  assert.equal(rejected.paymentStatus, "unpaid");
  assert.equal(rejected.paymentAmountTotal, 90);
  assert.equal(rejected.paymentCurrency, "gbp");
  assert.equal(rejected.refund.attempted, false);
  assert.equal(rejected.refund.attempts, 0);
  assert.equal(fetchCalls, 0);
});

test("cash checkout rejects missing retry protection, invalid methods, and duplicate attempts with a new key", async () => {
  const env = { ONLINE_ORDERING_ENABLED: "true", CASH_ORDERING_ENABLED: "true" };
  const basePayload = {
    ...makeOrderPayload(),
    paymentMethod: "cash",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };

  await assert.rejects(
    () => createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", basePayload),
    (error) => error?.status === 400 && /idempotency key/i.test(error.message)
  );
  await assert.rejects(
    () => createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
      ...basePayload,
      paymentMethod: "invoice"
    }, { idempotencyKey: "invalid-method-attempt" }),
    (error) => error?.status === 400 && /card or cash/i.test(error.message)
  );

  await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", basePayload, {
    idempotencyKey: "cash-duplicate-attempt-1"
  });
  await assert.rejects(
    () => createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", basePayload, {
      idempotencyKey: "cash-duplicate-attempt-2"
    }),
    (error) => error?.status === 409 && /similar order already exists/i.test(error.message)
  );
  assert.equal((await loadOrders(env)).length, 1);
});

test("a completed cash attempt remains authoritative if the browser later selects card", async () => {
  const env = {
    ONLINE_ORDERING_ENABLED: "true",
    CASH_ORDERING_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_123"
  };
  const payload = {
    ...makeOrderPayload(),
    paymentMethod: "cash",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };
  const options = { idempotencyKey: "fixed-payment-method-attempt" };

  const cash = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, options);
  const replayed = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...payload,
    paymentMethod: "card"
  }, options);

  assert.equal(replayed.orderId, cash.orderId);
  assert.equal(replayed.paymentMethod, "cash");
  assert.equal(replayed.paymentStatus, "unpaid");
  assert.equal((await loadOrders(env)).length, 1);
});

test("switching an open card attempt to cash expires Stripe before creating one cash order", async () => {
  const { kv, values } = createTestKV();
  const env = {
    BOOKINGS_KV: kv,
    ONLINE_ORDERING_ENABLED: "true",
    CASH_ORDERING_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_123"
  };
  const payload = {
    ...makeOrderPayload(),
    paymentMethod: "card",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };
  const options = { idempotencyKey: "card-to-cash-open-attempt" };
  let draftId = "";
  let retrieveCalls = 0;
  let expireCalls = 0;

  globalThis.fetch = async (url, requestOptions = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions") {
      const form = new URLSearchParams(String(requestOptions.body || ""));
      draftId = String(form.get("client_reference_id") || "");
      return jsonResponse({
        id: "cs_test_card_to_cash_open",
        url: "https://checkout.stripe.com/c/pay/cs_test_card_to_cash_open"
      });
    }
    if (requestUrl.endsWith("/checkout/sessions/cs_test_card_to_cash_open") && requestOptions.method === "GET") {
      retrieveCalls += 1;
      return jsonResponse({
        id: "cs_test_card_to_cash_open",
        object: "checkout.session",
        client_reference_id: draftId,
        payment_status: "unpaid",
        status: "open",
        amount_total: 90,
        currency: "gbp"
      });
    }
    if (requestUrl.endsWith("/checkout/sessions/cs_test_card_to_cash_open/expire") && requestOptions.method === "POST") {
      expireCalls += 1;
      assert.match(
        String(requestOptions.headers["Idempotency-Key"] || ""),
        /^order-checkout-expire:mco-draft-/
      );
      return jsonResponse({
        id: "cs_test_card_to_cash_open",
        object: "checkout.session",
        client_reference_id: draftId,
        payment_status: "unpaid",
        status: "expired",
        amount_total: 90,
        currency: "gbp"
      });
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  const card = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, options);
  assert.equal(card.status, "redirect_required");
  const persistedCardDraft = JSON.parse(values.get(`order_checkout_draft:${draftId}`));
  assert.equal(persistedCardDraft.stripeSessionId, card.sessionId);

  const cash = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...payload,
    paymentMethod: "cash"
  }, options);
  assert.equal(cash.status, "completed");
  assert.equal(cash.paymentMethod, "cash");
  assert.equal(cash.paymentStatus, "unpaid");
  assert.equal(retrieveCalls, 1);
  assert.equal(expireCalls, 1);

  const [stored] = await loadOrders(env);
  assert.equal(stored.paymentProvider, "cash");
  assert.equal(stored.paymentSessionId, "");
  assert.equal((await loadOrders(env)).length, 1);

  const transitionedDraft = JSON.parse(values.get(`order_checkout_draft:${draftId}`));
  assert.equal(transitionedDraft.paymentMethod, "cash");
  assert.equal(transitionedDraft.stripeSessionId, card.sessionId);

  const replayed = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...payload,
    paymentMethod: "cash"
  }, options);
  assert.equal(replayed.orderId, cash.orderId);
  assert.equal(retrieveCalls, 1);
  assert.equal(expireCalls, 1);
});

test("an already-paid card session wins a same-attempt switch to cash", async () => {
  const { kv } = createTestKV();
  const env = {
    BOOKINGS_KV: kv,
    ONLINE_ORDERING_ENABLED: "true",
    CASH_ORDERING_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_123"
  };
  const payload = {
    ...makeOrderPayload(),
    paymentMethod: "card",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };
  const options = { idempotencyKey: "card-to-cash-paid-attempt" };
  let draftId = "";
  let expireCalls = 0;

  globalThis.fetch = async (url, requestOptions = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions") {
      draftId = String(new URLSearchParams(String(requestOptions.body || "")).get("client_reference_id") || "");
      return jsonResponse({
        id: "cs_test_card_to_cash_paid",
        url: "https://checkout.stripe.com/c/pay/cs_test_card_to_cash_paid"
      });
    }
    if (requestUrl.endsWith("/checkout/sessions/cs_test_card_to_cash_paid") && requestOptions.method === "GET") {
      return jsonResponse({
        id: "cs_test_card_to_cash_paid",
        object: "checkout.session",
        client_reference_id: draftId,
        payment_status: "paid",
        status: "complete",
        payment_intent: "pi_test_card_to_cash_paid",
        amount_total: 90,
        currency: "gbp"
      });
    }
    if (requestUrl.endsWith("/expire")) {
      expireCalls += 1;
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, options);
  const completed = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...payload,
    paymentMethod: "cash"
  }, options);

  assert.equal(completed.status, "completed");
  assert.equal(completed.paymentMethod, "card");
  assert.equal(completed.paymentProvider, "stripe");
  assert.equal(completed.paymentStatus, "paid");
  assert.equal(expireCalls, 0);
  const stored = await loadOrders(env);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].paymentProvider, "stripe");
  assert.equal(stored[0].paymentSessionId, "cs_test_card_to_cash_paid");
});

test("a complete but unpaid card session blocks a switch to cash", async () => {
  const env = {
    ONLINE_ORDERING_ENABLED: "true",
    CASH_ORDERING_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_123"
  };
  const payload = {
    ...makeOrderPayload(),
    paymentMethod: "card",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };
  const options = { idempotencyKey: "card-to-cash-processing-attempt" };
  let draftId = "";
  let expireCalls = 0;

  globalThis.fetch = async (url, requestOptions = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions") {
      draftId = String(new URLSearchParams(String(requestOptions.body || "")).get("client_reference_id") || "");
      return jsonResponse({
        id: "cs_test_card_to_cash_processing",
        url: "https://checkout.stripe.com/c/pay/cs_test_card_to_cash_processing"
      });
    }
    if (requestUrl.endsWith("/checkout/sessions/cs_test_card_to_cash_processing") && requestOptions.method === "GET") {
      return jsonResponse({
        id: "cs_test_card_to_cash_processing",
        object: "checkout.session",
        client_reference_id: draftId,
        payment_status: "unpaid",
        status: "complete",
        amount_total: 90,
        currency: "gbp"
      });
    }
    if (requestUrl.endsWith("/expire")) expireCalls += 1;
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, options);
  await assert.rejects(
    () => createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
      ...payload,
      paymentMethod: "cash"
    }, options),
    (error) => error?.status === 409 && /still processing/i.test(error.message)
  );
  assert.equal(expireCalls, 0);
  assert.equal((await loadOrders(env)).length, 0);
});

test("card payment wins when it completes during the attempt to expire its session", async () => {
  const env = {
    ONLINE_ORDERING_ENABLED: "true",
    CASH_ORDERING_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_123"
  };
  const payload = {
    ...makeOrderPayload(),
    paymentMethod: "card",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };
  const options = { idempotencyKey: "card-to-cash-expire-race" };
  let draftId = "";
  let retrieveCalls = 0;
  let expireCalls = 0;

  globalThis.fetch = async (url, requestOptions = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions") {
      draftId = String(new URLSearchParams(String(requestOptions.body || "")).get("client_reference_id") || "");
      return jsonResponse({
        id: "cs_test_card_to_cash_race",
        url: "https://checkout.stripe.com/c/pay/cs_test_card_to_cash_race"
      });
    }
    if (requestUrl.endsWith("/checkout/sessions/cs_test_card_to_cash_race") && requestOptions.method === "GET") {
      retrieveCalls += 1;
      return jsonResponse({
        id: "cs_test_card_to_cash_race",
        object: "checkout.session",
        client_reference_id: draftId,
        payment_status: retrieveCalls === 1 ? "unpaid" : "paid",
        status: retrieveCalls === 1 ? "open" : "complete",
        payment_intent: retrieveCalls === 1 ? null : "pi_test_card_to_cash_race",
        amount_total: 90,
        currency: "gbp"
      });
    }
    if (requestUrl.endsWith("/checkout/sessions/cs_test_card_to_cash_race/expire") && requestOptions.method === "POST") {
      expireCalls += 1;
      return jsonResponse({
        error: {
          type: "invalid_request_error",
          message: "Only open Checkout Sessions can be expired."
        }
      }, 400);
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, options);
  const completed = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...payload,
    paymentMethod: "cash"
  }, options);

  assert.equal(retrieveCalls, 2);
  assert.equal(expireCalls, 1);
  assert.equal(completed.paymentMethod, "card");
  assert.equal(completed.paymentStatus, "paid");
  const stored = await loadOrders(env);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].paymentProvider, "stripe");
});

test("Stripe finalization rejects a paid session linked to a cash draft", async () => {
  const { kv, values } = createTestKV();
  const env = {
    BOOKINGS_KV: kv,
    ONLINE_ORDERING_ENABLED: "true",
    CASH_ORDERING_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_123"
  };
  const payload = {
    ...makeOrderPayload(),
    paymentMethod: "cash",
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  };
  await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", payload, {
    idempotencyKey: "cash-draft-stripe-guard-attempt"
  });
  const draftEntry = Array.from(values.entries()).find(([key]) => key.startsWith("order_checkout_draft:"));
  const cashDraft = JSON.parse(draftEntry[1]);

  globalThis.fetch = async (url, requestOptions = {}) => {
    assert.equal(requestOptions.method, "GET");
    return jsonResponse({
      id: "cs_test_illegal_cash_draft",
      object: "checkout.session",
      client_reference_id: cashDraft.id,
      payment_status: "paid",
      status: "complete",
      payment_intent: "pi_test_illegal_cash_draft",
      amount_total: 90,
      currency: "gbp"
    });
  };

  await assert.rejects(
    () => getCheckoutSessionStatus(env, "cs_test_illegal_cash_draft"),
    (error) => error?.status === 409 && /not created for card payment/i.test(error.message)
  );
  const stored = await loadOrders(env);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].paymentProvider, "cash");
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
  assert.equal(created.status, "redirect_required");
  assert.equal(created.paymentMethod, "card");
  assert.equal(created.paymentProvider, "stripe");
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

test("paid card finalization also waits for aggregate persistence before email or completion", async () => {
  const { kv, values } = createTestKV({ failOrderAggregateWrites: 1 });
  const env = {
    BOOKINGS_KV: kv,
    STRIPE_SECRET_KEY: "sk_test_123",
    ONLINE_ORDERING_ENABLED: "true",
    RESEND_API_KEY: "re_test_123",
    ORDERS_EMAIL_FROM: "Millers Cafe <help@millers.cafe>"
  };
  let draftId = "";
  let emailCalls = 0;

  globalThis.fetch = async (url, requestOptions = {}) => {
    const requestUrl = String(url);
    if (requestUrl === "https://api.stripe.com/v1/checkout/sessions") {
      draftId = String(new URLSearchParams(String(requestOptions.body || "")).get("client_reference_id") || "");
      return jsonResponse({
        id: "cs_test_card_aggregate_recovery",
        url: "https://checkout.stripe.com/c/pay/cs_test_card_aggregate_recovery"
      });
    }
    if (requestUrl.endsWith("/checkout/sessions/cs_test_card_aggregate_recovery")) {
      return jsonResponse({
        id: "cs_test_card_aggregate_recovery",
        object: "checkout.session",
        client_reference_id: draftId,
        payment_status: "paid",
        status: "complete",
        payment_intent: "pi_test_card_aggregate_recovery",
        amount_total: 90,
        currency: "gbp"
      });
    }
    if (requestUrl === "https://api.resend.com/emails") {
      assert.match(
        String(requestOptions.headers["Idempotency-Key"] || ""),
        /^stripe-order-email:cs_test_card_aggregate_recovery:(customer|owner)$/
      );
      emailCalls += 1;
      return jsonResponse({ id: `email-${emailCalls}` });
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  };

  const checkout = await createOrderCheckout(env, "https://millers.cafe/api/orders/checkout", {
    ...makeOrderPayload(),
    cartItems: [{ itemName: "Papadom", quantity: 1, modifierSelections: [] }]
  });

  await assert.rejects(
    () => getCheckoutSessionStatus(env, checkout.sessionId),
    (error) => error?.status === 503 && /storage is still syncing/i.test(error.message)
  );
  assert.equal(emailCalls, 0);
  assert.equal(values.has("orders_v1"), false);
  assert.equal(Array.from(values.keys()).filter((key) => key.startsWith("order_checkout_completion:")).length, 0);

  const recovered = await getCheckoutSessionStatus(env, checkout.sessionId);
  assert.equal(recovered.status, "completed");
  assert.equal(emailCalls, 2);
  assert.equal(JSON.parse(values.get("orders_v1")).length, 1);
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
