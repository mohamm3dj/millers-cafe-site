"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MILLERS_ORDER_MENU,
  getMenuItemAllergenLabels,
  getMenuItemDietaryDisplay,
  getPreferredModifierOptionIndex
} from "../orders/menu-catalog.js";
import {
  calculateOrderPricing,
  canAdvanceToCheckoutDetails,
  cartQuantityActionLabel,
  scrollBehaviorForPreference
} from "../orders/order-draft.js";

function allMenuItems() {
  return MILLERS_ORDER_MENU.flatMap((category) =>
    (category.items || []).map((item) => ({ category: category.name, item }))
  );
}

test("catalogue keeps dietary suitability and allergens out of generic tags", () => {
  const forbiddenTags = new Set(["vegan", "vegetarian", "veg", "dairy", "nuts", "nut"]);

  allMenuItems().forEach(({ category, item }) => {
    const context = `${category} / ${item.name}`;
    assert.equal(
      (item.tags || []).some((tag) => forbiddenTags.has(String(tag).toLowerCase())),
      false,
      `${context} has a dietary/allergen value in generic tags`
    );

    const codes = new Set((item.codes || []).map((code) => String(code).toUpperCase()));
    const expectedDietary = codes.has("VG") || codes.has("VE")
      ? "vegan"
      : (codes.has("V") ? "vegetarian" : "");
    assert.equal(item.dietarySuitability, expectedDietary, `${context} dietary suitability must come from a dietary code`);
    assert.deepEqual(item.allergens, getMenuItemAllergenLabels(item), `${context} allergen labels must come from allergen codes`);
  });
});

test("dietary curry bases are conditional and default to a suitable option, never meat", () => {
  const madras = allMenuItems().find(({ item }) => item.name === "Madras")?.item;
  assert.ok(madras);

  const protein = madras.modifierGroups.find((group) => group.name === "Protein");
  assert.ok(protein?.affectsDietarySuitability);

  const initial = getMenuItemDietaryDisplay(madras);
  assert.deepEqual(initial, { kind: "vegan", label: "Vegan option", confirmed: false });

  const preferredIndex = getPreferredModifierOptionIndex(madras, protein);
  assert.equal(protein.options[preferredIndex].name, "Vegetables");
  assert.notEqual(protein.options[preferredIndex].dietaryEffect, "not-suitable");

  assert.equal(
    getMenuItemDietaryDisplay(madras, [{ groupName: "Protein", optionName: "Chicken" }]),
    null
  );
  assert.deepEqual(
    getMenuItemDietaryDisplay(madras, [{ groupName: "Protein", optionName: "Vegetables" }]),
    { kind: "vegan", label: "Vegan", confirmed: true }
  );
});

test("paneer dishes are vegetarian with dairy, never labelled vegan", () => {
  ["Vegetarian Mix", "Bombay Veg Crush"].forEach((name) => {
    const item = allMenuItems().find((entry) => entry.item.name === name)?.item;
    assert.ok(item, `${name} should exist`);
    assert.deepEqual(getMenuItemDietaryDisplay(item), {
      kind: "vegetarian",
      label: "Vegetarian",
      confirmed: true
    });
    assert.deepEqual(getMenuItemAllergenLabels(item), ["Dairy"]);
  });
});

test("every required dietary-affecting modifier has a non-meat preferred option", () => {
  allMenuItems().forEach(({ category, item }) => {
    if (!item.dietarySuitability) return;
    (item.modifierGroups || [])
      .filter((group) => group.isRequired && group.affectsDietarySuitability)
      .forEach((group) => {
        const index = getPreferredModifierOptionIndex(item, group);
        assert.ok(index >= 0, `${category} / ${item.name} / ${group.name} needs a suitable default`);
        assert.notEqual(
          group.options[index].dietaryEffect,
          "not-suitable",
          `${category} / ${item.name} / ${group.name} defaults to a non-suitable option`
        );
      });
  });
});

test("unknown dietary modifier effects are not presented as confirmed", () => {
  const biryani = allMenuItems().find(({ item }) => item.name === "Vegetable Biryani")?.item;
  const upgrade = biryani?.modifierGroups.find((group) => group.name === "Upgrade");
  assert.ok(upgrade);
  assert.equal(upgrade.options[getPreferredModifierOptionIndex(biryani, upgrade)].name, "Standard Biryani");
  assert.equal(
    getMenuItemDietaryDisplay(biryani, [{ groupName: "Upgrade", optionName: "Parda Biryani Upgrade" }]),
    null
  );
});

test("pricing shows the same subtotal, adjustment, and total shape before checkout", () => {
  const cart = [
    { quantity: 2, linePrice: 20 },
    { quantity: 1, linePrice: 5 }
  ];

  assert.deepEqual(calculateOrderPricing(cart, {
    orderType: "delivery",
    deliveryFeeGBP: 2
  }), {
    subtotal: 25,
    collectionDiscount: 0,
    deliveryFee: 2,
    total: 27,
    totalQuantity: 3
  });

  assert.deepEqual(calculateOrderPricing(cart, {
    orderType: "collection",
    deliveryFeeGBP: 2
  }), {
    subtotal: 25,
    collectionDiscount: 2.5,
    deliveryFee: 0,
    total: 22.5,
    totalQuantity: 3
  });

  assert.equal(calculateOrderPricing([], { orderType: "delivery", deliveryFeeGBP: 2 }).deliveryFee, 0);
});

test("after-hours customers can reach checkout details to choose a future date", () => {
  assert.equal(canAdvanceToCheckoutDetails(1, false), true);
  assert.equal(canAdvanceToCheckoutDetails(0, false), false);
  assert.equal(canAdvanceToCheckoutDetails(1, true), false);
});

test("cart action labels and scripted scrolling are accessible", () => {
  assert.equal(cartQuantityActionLabel("increase", "Madras", 2), "Increase Madras quantity. Currently 2.");
  assert.equal(cartQuantityActionLabel("decrease", "Madras", 2), "Decrease Madras quantity. Currently 2.");
  assert.equal(cartQuantityActionLabel("remove", "Madras", 2), "Remove Madras from basket.");
  assert.equal(scrollBehaviorForPreference(true), "auto");
  assert.equal(scrollBehaviorForPreference(false), "smooth");
});

test("collection and delivery markup expose a complete price breakdown", () => {
  ["collection/index.html", "delivery/index.html"].forEach((path) => {
    const html = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(html, /id="orderSubtotal"/);
    assert.match(html, /id="orderDiscountRow"/);
    assert.match(html, /id="orderDeliveryFeeRow"/);
    assert.match(html, /Total due at Stripe/);
    assert.doesNotMatch(html, /id="menuItemsList"[^>]*aria-live/);
    assert.match(html, /id="orderMenuStatus"[^>]*role="status"/);
    assert.match(html, /id="orderCartStatus"[^>]*role="status"/);
    assert.match(html, /id="orderSensitiveInfoConsent"/);
    assert.doesNotMatch(html, /<label class="bookingField bookingFieldWide bookingFieldSlots/);
  });
});

test("browser checkout retries reuse an idempotency key for unchanged order details", () => {
  const source = readFileSync(new URL("../orders/order-form.js", import.meta.url), "utf8");
  assert.match(source, /checkoutIdempotencyKey\(payload, cartPayload\)/);
  assert.match(source, /"Idempotency-Key": idempotencyKey/);
  assert.match(source, /checkoutAttemptFingerprint !== fingerprint/);
  assert.match(source, /if \(!redirectStarted\) resetOrderTurnstile\(\)/);
});

test("production ordering can be paused without hiding the browseable menu", () => {
  const source = readFileSync(new URL("../orders/order-form.js", import.meta.url), "utf8");
  assert.match(source, /onlineOrderingEnabled = orders\.onlineOrderingEnabled !== false/);
  assert.match(source, /Online ordering is paused while we verify the full allergen catalogue/);
  assert.match(source, /Online ordering is temporarily paused/);
});

test("browser capability credentials stay out of order-status query strings", () => {
  const source = readFileSync(new URL("../orders/order-form.js", import.meta.url), "utf8");
  assert.match(source, /Authorization:\s*`Bearer \$\{trackingToken\}`/);
  assert.doesNotMatch(source, /tracking:\s*trackingToken/);
});

test("cart rerenders restore action focus and announce reversible removal", () => {
  const source = readFileSync(new URL("../orders/order-form.js", import.meta.url), "utf8");
  assert.match(source, /function focusCartAction\(cartId, action\)/);
  assert.match(source, /announceCartStatus\(`\$\{removedItem\.itemName\} removed from basket\. Undo is available\.`\)/);
  assert.match(source, /undoBtn\.focus\(\)/);
  assert.match(source, /updateCartQuantity\(cartId, 1, "increase"\)/);
  assert.match(source, /updateCartQuantity\(cartId, -1, "decrease"\)/);
});

test("customer forms require a separate optional-notes consent control", () => {
  const bookingHtml = readFileSync(new URL("../bookings/index.html", import.meta.url), "utf8");
  const accountHtml = readFileSync(new URL("../account/index.html", import.meta.url), "utf8");
  const bookingSource = readFileSync(new URL("../bookings/bookings.js", import.meta.url), "utf8");
  const accountSource = readFileSync(new URL("../account/account.js", import.meta.url), "utf8");

  assert.match(bookingHtml, /id="bookingSensitiveInfoConsent"/);
  assert.match(accountHtml, /id="accountSensitiveInfoConsent"/);
  assert.match(bookingSource, /payload\.notes && payload\.sensitiveInfoConsent !== true/);
  assert.match(accountSource, /payload\.notes && !payload\.sensitiveInfoConsent/);
  assert.match(accountSource, /code,\s*turnstileToken:\s*accountTurnstileToken/);
});
