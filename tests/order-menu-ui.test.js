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
import { POPULAR_ITEM_NAMES } from "../orders/order-media.js";

const ORDER_PAGE_PATHS = ["collection/index.html", "delivery/index.html"];
const EXPECTED_FAVOURITES = [
  "Chilli Paneer",
  "Chicken Tikka Starter",
  "Chicken Biryani",
  "Garlic Naan",
  "Mango Lassi"
];
const PRINTED_STARTER_CATEGORY_ORDER = Object.freeze([
  "Starters - Vegetarian",
  "Starters - Chicken",
  "Starters - Lamb",
  "Starters - Mixed",
  "Starters - Seafood"
]);

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = "";
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function objectLiteralContaining(source, pattern, context) {
  const match = pattern.exec(source);
  assert.ok(match, `missing ${context}`);
  const open = source.lastIndexOf("{", match.index);
  assert.ok(open >= 0, `${context} must be an object literal`);
  const close = findMatchingBrace(source, open);
  assert.ok(close > open, `${context} must have balanced braces`);
  return source.slice(open, close + 1);
}

function stringArrayConstant(source, constantName) {
  const escapedName = constantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `\\bconst\\s+${escapedName}\\s*=\\s*Object\\.freeze\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)\\s*;`
  ).exec(source);
  assert.ok(match, `${constantName} must be a frozen string array`);
  return [...match[1].matchAll(/(["'])(.*?)\1/g)].map((entry) => entry[2]);
}

function allMenuItems() {
  return MILLERS_ORDER_MENU.flatMap((category) =>
    (category.items || []).map((item) => ({ category: category.name, item }))
  );
}

test("the five Millers favourites are real catalogue dishes", () => {
  assert.deepEqual(POPULAR_ITEM_NAMES, EXPECTED_FAVOURITES);

  const catalogueNames = new Set(allMenuItems().map(({ item }) => item.name));
  EXPECTED_FAVOURITES.forEach((name) => {
    assert.equal(catalogueNames.has(name), true, `${name} must be a real catalogue item`);
  });
});

test("collection and delivery render image-free menu and basket rows", () => {
  const source = read("orders/order-form.js");
  assert.doesNotMatch(source, /getOrderItemImage|orderMenuMedia|orderCartMedia|classList\.add\("hasMedia"\)/);

  const css = read("styles.css");
  assert.doesNotMatch(css, /\.order(?:Menu|Cart)Media/);
  const quickOrderLayer = css.lastIndexOf("Millers quick-order workspace — option 2");
  const activeCss = css.slice(quickOrderLayer);
  assert.doesNotMatch(activeCss, /orderMenuCard\.hasMedia|orderCartItem\.hasMedia/);
  assert.match(activeCss, /body\.publicBody\.orderBody \.orderMenuMain\{\s*grid-column: 1;/);
  assert.match(activeCss, /body\.publicBody\.orderBody \.orderMenuActions\{\s*grid-column: 2;/);
});

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
  ORDER_PAGE_PATHS.forEach((path) => {
    const html = read(path);
    assert.match(html, /id="orderSubtotal"/);
    assert.match(html, /id="orderDiscountRow"/);
    assert.match(html, /id="orderDeliveryFeeRow"/);
    assert.match(html, /class="orderCartTotal">\s*<span>Total<\/span>/);
    assert.doesNotMatch(html, /Total due at Stripe/);
    assert.doesNotMatch(html, /id="menuItemsList"[^>]*aria-live/);
    assert.match(html, /id="orderMenuStatus"[^>]*role="status"/);
    assert.match(html, /id="orderCartStatus"[^>]*role="status"/);
    assert.match(html, /id="orderSensitiveInfoConsent"/);
    assert.doesNotMatch(html, /<label class="bookingField bookingFieldWide bookingFieldSlots/);
  });
});

test("collection and delivery expose the polished three-stage checkout structure", () => {
  ORDER_PAGE_PATHS.forEach((path) => {
    const html = read(path);

    assert.match(
      html,
      /id="orderStepBadge3"[^>]*>[\s\S]*?class="orderFlowStepNumber">3<\/span>[\s\S]*?class="orderFlowStepLabel">Payment<\/span><\/li>/
    );
    assert.match(html, /<aside[^>]*id="orderCheckoutSidebar"[^>]*aria-label="Order review"/);
    assert.match(html, /<ul[^>]*id="orderCheckoutSummaryList"[^>]*><\/ul>/);
    assert.match(
      html,
      /class="orderMenuLead"[\s\S]*?class="orderMenuLeadEyebrow">Order online<\/p>[\s\S]*?<h2 class="orderMenuLeadTitle">Choose your favourites<span aria-hidden="true">\.<\/span><\/h2>/
    );

    const modifierTag = html.match(/<div[^>]*id="orderModifierPanel"[^>]*>/)?.[0] || "";
    assert.match(modifierTag, /role="dialog"/);
    assert.match(modifierTag, /aria-modal="true"/);
    assert.match(modifierTag, /aria-labelledby="orderModifierTitle"/);
  });
});

test("collection and delivery expose truthful semantic context strips", () => {
  const expectations = {
    "collection/index.html": ["Collection details", "Collect from", "Ready", "Collection saving"],
    "delivery/index.html": ["Delivery details", "Deliver to", "Delivery time", "Delivery"]
  };

  ORDER_PAGE_PATHS.forEach((path) => {
    const html = read(path);
    const context = extractBetween(
      html,
      '<section class="orderContextStrip"',
      '<section class="tile simplePanel bookingsPanel">'
    );
    const [ariaLabel, ...labels] = expectations[path];

    assert.match(context, new RegExp(`aria-label="${ariaLabel}"`));
    assert.equal((context.match(/class="orderContextItem"/g) || []).length, 3);
    assert.match(context, /id="orderContextDestination"/);
    assert.match(context, /id="orderContextTiming"/);
    assert.match(context, /id="orderContextPricing"/);
    assert.equal((context.match(/<img[^>]+alt=""/g) || []).length, 3);
    labels.forEach((label) => assert.match(context, new RegExp(`<small>${label}<\\/small>`)));
    assert.doesNotMatch(context, /minimum order|£15/i, `${path} must not invent an ordering rule`);
  });
});

test("collection and delivery share an identical ordering workspace", () => {
  const start = '<div class="bookingField bookingFieldWide orderItemsField">';
  const end = '<div class="bookingField bookingFieldWide orderCheckoutField">';
  const collection = read("collection/index.html");
  const delivery = read("delivery/index.html");

  assert.equal(extractBetween(collection, start, end), extractBetween(delivery, start, end));

  ["orderAddress1", "orderAddress2", "orderTown", "orderPostcode", "deliveryAreaHint"].forEach((id) => {
    assert.doesNotMatch(collection, new RegExp(`id="${id}"`), `${id} is delivery-only`);
    assert.match(delivery, new RegExp(`id="${id}"`), `${id} must remain available for delivery`);
  });
});

test("ordering groups starters once and preserves the printed subsection hierarchy", () => {
  const source = read("orders/order-form.js");
  const styles = read("styles.css");
  const groupDefinitions = extractBetween(
    source,
    "const DESKTOP_ORDER_MENU_GROUPS = Object.freeze([",
    "]);\n\nconst form"
  );
  const starterGroup = objectLiteralContaining(
    groupDefinitions,
    /\blabel\s*:\s*["']Starters["']/,
    "the desktop Starters group"
  );

  assert.deepEqual(
    stringArrayConstant(source, "STARTER_CATEGORY_NAMES"),
    PRINTED_STARTER_CATEGORY_ORDER,
    "starter subsections must follow the printed menu"
  );
  assert.match(starterGroup, /\bcategories\s*:\s*STARTER_CATEGORY_NAMES\b/);
  assert.match(starterGroup, /\bshowCategoryHeadings\s*:\s*true\b/);
  assert.equal((groupDefinitions.match(/\blabel\s*:\s*["']Starters["']/g) || []).length, 1);
  assert.doesNotMatch(groupDefinitions, /Starters\s*[·•]\s*(?:Veg|Non-Veg)/i);

  const displayOrder = extractBetween(
    source,
    "function orderedNormalizedMenuCategories()",
    "function allMenuEntries()"
  );
  assert.match(displayOrder, /starterCategoryIndex/);
  assert.match(
    extractBetween(source, "function starterCategoryIndex(categoryName)", "function starterCategoryDisplayName"),
    /STARTER_CATEGORY_NAMES/,
    "the category rank must come from the exact printed starter order"
  );
  assert.match(displayOrder, /\.sort\(/, "normalized starter categories must apply the printed display order");
  assert.match(
    extractBetween(source, "function allMenuEntries()", "function entriesForDesktopMenuGroup"),
    /orderedNormalizedMenuCategories\(\)/,
    "the normalized display order must feed desktop menu entries"
  );

  const desktopRenderer = extractBetween(source, "function renderMenuItems()", "function clearModifierError()");
  assert.match(desktopRenderer, /showCategoryHeadings/);
  assert.match(desktopRenderer, /orderMenuSubcategoryHeading/);

  const mobileRenderer = extractBetween(
    source,
    "function renderMobileMenuSections()",
    "function renderMenuItems()"
  );
  assert.match(mobileRenderer, /orderMobileStarterGroup/);
  assert.match(mobileRenderer, /textContent\s*=\s*["']Starters["']/);
  const mobileStarterLabel = extractBetween(
    source,
    "function starterCategoryDisplayName(categoryName)",
    "function orderedNormalizedMenuCategories()"
  );
  assert.match(mobileStarterLabel, /STARTER_CATEGORY_NAMES/);
  assert.match(
    mobileStarterLabel,
    /\.replace\([^\n]*Starters/,
    "mobile starter subsection labels must remove the repeated ‘Starters -’ prefix"
  );

  assert.match(styles, /\.orderMenuSubcategoryHeading\b/);
  assert.match(styles, /\.orderMobileStarterGroup\b/);
});

test("the desktop category rail has icons and roving keyboard navigation", () => {
  const collection = read("collection/index.html");
  const source = read("orders/order-form.js");
  const groupDefinitions = extractBetween(
    source,
    "const DESKTOP_ORDER_MENU_GROUPS = Object.freeze([",
    "]);\n\nconst form"
  );

  assert.match(collection, /id="menuCategoryChips"[^>]*role="group"[^>]*aria-label="Menu categories"/);
  assert.ok((groupDefinitions.match(/icon: "\.\.\/assets\//g) || []).length >= 10);
  assert.match(source, /icon\.className = "orderCategoryChipIcon";/);
  assert.match(source, /icon\.setAttribute\("aria-hidden", "true"\);/);
  assert.match(source, /button\.tabIndex = name === selectedCategory \? 0 : -1;/);
  assert.match(source, /function handleMenuCategoryKeydown\(event\)/);
  ["Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].forEach((key) => {
    assert.match(source, new RegExp(`event\\.key === "${key}"`), `${key} should move through categories`);
  });
  assert.match(source, /event\.preventDefault\(\);\s*buttons\[nextIndex\]\?\.click\(\);/);
  assert.match(source, /menuCategoryChips\.addEventListener\("keydown", handleMenuCategoryKeydown\);/);
});

test("direct add actions use the real plus icon without replacing their accessible text", () => {
  const source = readFileSync(new URL("../orders/order-form.js", import.meta.url), "utf8");

  assert.match(source, /if \(actionType === "add"\) \{[\s\S]*?icon\.src = "\.\.\/assets\/icon-plus\.svg";/);
  assert.match(source, /text\.className = "orderMenuAddText";[\s\S]*?text\.textContent = label;/);
});

test("the streamlined basket flow stays explicit across desktop and mobile", () => {
  const source = read("orders/order-form.js");

  assert.match(source, /const isDesktopMenu = isDesktopBasketLayout\(\) && currentOrderStep === 1;/);
  assert.match(source, /Continue to checkout · \$\{totalLabel\}/);
  assert.doesNotMatch(source, /Checkout details · \$\{totalLabel\}/);
  assert.match(source, /hasItems \? "View basket" : "Add dishes"/);
  assert.match(source, /\? isSubmitting \|\| !hasItems/);
  assert.match(source, /setBasketOpen\(isDesktopBasketLayout\(\)\);/);
  assert.match(source, /basketOpen: false/);
  assert.match(source, /basketColumn\?\.classList\.toggle\("isBasketOpen", nextState\);/);
  assert.match(source, /basketPanel\.scrollTop = 0;/);
  assert.match(source, /basketPanel\.setAttribute\("role", "dialog"\)/);
  assert.match(source, /basketPanel\.setAttribute\("aria-modal", "true"\)/);
  assert.match(source, /stickyCheckoutBtn\.setAttribute\("aria-controls", "orderBasketPanel"\)/);
  assert.match(source, /function handleBasketPanelKeydown\(event\)/);
  assert.match(source, /announceCartStatus\(`\$\{item\.name\} added to basket\./);
  assert.match(source, /const focusWasInBasket = basketColumn\?\.contains\(document\.activeElement\)/);
  assert.match(source, /addItemToCart\(item, \[\], 1, false\);/);
  assert.match(source, /addItemToCart\(activeDraft\.item, result\.selections, activeDraft\.quantity, false\);/);
});

test("basket copy uses a simple Total and Continue hierarchy", () => {
  const source = read("orders/order-form.js");

  ORDER_PAGE_PATHS.forEach((path) => {
    const html = read(path);
    assert.match(html, /<strong>Your basket<\/strong>/);
    assert.match(html, /id="orderBasketClear"[^>]*>Clear all<\/button>/);
    assert.match(html, /id="orderBasketCheckout"[^>]*>Continue to checkout<\/button>/);
    assert.match(html, /id="stickyCheckoutBtn"[^>]*>Continue<\/button>/);
    assert.match(
      html,
      /class="orderBasketProgress"[^>]*>[\s\S]*?>Basket<\/li>[\s\S]*?>Details<\/li>[\s\S]*?>Payment<\/li>/
    );
  });

  assert.match(source, /appendPriceRow\("Total", formatGBP\(totals\.total\), "isTotal"\);/);
  assert.doesNotMatch(source, /Total due at Stripe/);
  assert.doesNotMatch(source, /Checkout details ·/);
});

test("mobile basket dialogs lock page scroll and make the background inert", () => {
  const source = read("orders/order-form.js");
  const css = read("styles.css");

  assert.match(source, /function setMobileBasketBackgroundInert\(inert\)/);
  assert.match(source, /document\.body\.classList\.toggle\("isOrderBasketDialogOpen", shouldInert\);/);
  assert.match(source, /document\.querySelector\("\.desktopSiteHeader"\)/);
  assert.match(source, /document\.querySelector\("\.orderContextStrip"\)/);
  assert.match(source, /element !== basketColumn && element !== modifierPanel/);
  assert.match(source, /element\.dataset\.orderBasketInert = "true";\s*element\.inert = true;/);
  assert.match(source, /element\.inert = false;\s*delete element\.dataset\.orderBasketInert;/);
  assert.match(source, /const mobileDialog = isMobileOrderMenuLayout\(\) && currentOrderStep === 1 && nextState;/);
  assert.match(source, /setMobileBasketBackgroundInert\(mobileDialog\);/);
  assert.match(source, /basketPanel\.setAttribute\("role", "dialog"\);/);
  assert.match(source, /basketPanel\.setAttribute\("aria-modal", "true"\);/);
  assert.match(css, /body\.isOrderBasketDialogOpen\{\s*overflow: hidden;/);
});

test("pressing Enter in menu search filters instead of submitting checkout", () => {
  const source = readFileSync(new URL("../orders/order-form.js", import.meta.url), "utf8");

  assert.match(
    source,
    /menuSearchInput\.addEventListener\("keydown", \(event\) => \{[\s\S]*?if \(event\.key !== "Enter"\) return;[\s\S]*?event\.preventDefault\(\);[\s\S]*?renderMenuItems\(\);/
  );
});

test("the final quick-order layer owns the responsive three-column workspace", () => {
  const css = read("styles.css");
  const quickOrderLayer = css.lastIndexOf("Millers quick-order workspace — option 2");
  const unifiedLayer = css.lastIndexOf("Unified homepage design language");
  assert.ok(quickOrderLayer > unifiedLayer, "the selected option must be the active final cascade layer");

  const activeCss = css.slice(quickOrderLayer);
  assert.match(activeCss, /@media \(min-width: 960px\)[\s\S]*?body\.publicBody\.orderBody \.bookingForm\.isOrderMenuStep \.orderHub\{[\s\S]*?grid-template-columns: clamp\(190px, 15vw, 228px\) minmax\(360px, 1fr\) clamp\(300px, 25vw, 360px\);/);
  assert.match(activeCss, /grid-template-areas:\s*"rail search basket"\s*"rail heading basket"\s*"rail intro basket"\s*"rail menu basket";/);
  assert.match(activeCss, /body\.publicBody\.orderBody \.orderMenuCard\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(activeCss, /@media \(max-width: 959px\)[\s\S]*?\.orderPage \.orderHub\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(activeCss, /body\.publicBody\.orderBody \.orderMenuMain\{\s*grid-column: 1;/);
  assert.match(activeCss, /body\.publicBody\.orderBody \.orderMenuActions\{\s*grid-column: 2;/);
  assert.match(activeCss, /body\.publicBody\.orderBody \.orderCartItem\{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(activeCss, /linear-gradient\(135deg, #0f766e 0%, #0d9488 100%\)/);
});

test("checkout validation moves customers to the first invalid field", () => {
  const source = readFileSync(new URL("../orders/order-form.js", import.meta.url), "utf8");

  assert.match(source, /function focusFirstInvalidCheckoutField\s*\(/);
  assert.match(
    source,
    /if \(!runCheckoutFieldValidation\(\)\) \{[\s\S]*?focusFirstInvalidCheckoutField\(\);[\s\S]*?return;/
  );
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
