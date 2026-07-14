import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PUBLIC_PAGES = [
  "../index.html",
  "../menu/index.html",
  "../collection/index.html",
  "../delivery/index.html",
  "../bookings/index.html",
  "../account/index.html",
  "../privacy/index.html",
  "../terms/index.html",
  "../refunds/index.html",
  "../404.html",
  "../offline.html"
];

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("every customer-facing page uses the shared homepage shell", () => {
  PUBLIC_PAGES.forEach((relativePath) => {
    const html = read(relativePath);
    assert.match(html, /<body class="[^"]*publicBody[^"]*">/, relativePath);
    assert.match(html, /class="skipLink" href="#mainContent"/, relativePath);
    assert.match(html, /<header class="desktopSiteHeader">/, relativePath);
    assert.match(html, /<nav class="desktopNav" aria-label="Primary navigation">/, relativePath);
    assert.match(html, /<main[^>]*id="mainContent"[^>]*tabindex="-1"/, relativePath);
  });
});

test("public pages share one stylesheet cache version", () => {
  PUBLIC_PAGES.forEach((relativePath) => {
    const html = read(relativePath);
    assert.match(html, /styles\.css\?v=20260714b/, relativePath);
  });
});

test("the final public layer keeps homepage tokens and removes repeated blur passes", () => {
  const css = read("../styles.css");
  const unifiedLayer = css.lastIndexOf("Unified homepage design language");
  assert.ok(unifiedLayer > css.lastIndexOf("Millers Aurora Glass order workspace"));
  assert.match(css, /--font-body: "Manrope Desktop"/);
  assert.match(css, /--font-display: "Urbanist Desktop"/);
  assert.match(css.slice(unifiedLayer), /body\.publicBody \*\{[\s\S]*?backdrop-filter: none !important;/);
  assert.match(css.slice(unifiedLayer), /body\.publicBody \.desktopNav\{[\s\S]*?backdrop-filter: blur\(14px\)/);
});

test("the selected order redesign remains the final scoped cascade layer", () => {
  const css = read("../styles.css");
  const unifiedLayer = css.lastIndexOf("Unified homepage design language");
  const quickOrderLayer = css.lastIndexOf("Millers quick-order workspace — option 2");
  const activeCss = css.slice(quickOrderLayer);

  assert.ok(quickOrderLayer > unifiedLayer, "legacy public rules must not override the selected order workspace");
  assert.match(activeCss, /body\.publicBody\.orderBody \.bookingForm\.isOrderMenuStep \.orderHub\{/);
  assert.match(activeCss, /body\.publicBody\.orderBody \.orderCategoryChips\{/);
  assert.match(activeCss, /body\.publicBody\.orderBody \.orderBasketColumn\{/);
  assert.match(activeCss, /body\.publicBody\.orderBody\.isOrderBasketDialogOpen\{\s*overflow: hidden;/);
});

test("menu-heavy interactions are debounced and account avoids the full order catalogue", () => {
  const menuSource = read("../menu/menu.js");
  const orderSource = read("../orders/order-form.js");
  const accountSource = read("../account/account.js");

  assert.match(menuSource, /window\.setTimeout\(applySearch, 120\)/);
  assert.match(menuSource, /if \(activeJumpChipId === id\) return;/);
  assert.match(orderSource, /menuSearchTimer = window\.setTimeout\(\(\) => \{[\s\S]*?renderMenuItems\(\);[\s\S]*?\}, 120\);/);
  assert.match(accountSource, /from "\.\.\/orders\/order-draft-state\.js"/);
  assert.doesNotMatch(accountSource, /from "\.\.\/orders\/order-draft\.js"/);
});
