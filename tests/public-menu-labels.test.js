"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MILLERS_ORDER_MENU,
  UK_REGULATED_ALLERGENS,
  getMenuItemDietaryDisplay
} from "../orders/menu-catalog.js";

const PUBLIC_CLAIM_CODES = new Set([
  "VG",
  "V",
  ...UK_REGULATED_ALLERGENS.map(({ code }) => code)
]);
const VEGAN_CONTRADICTION = /\b(?:paneer|cheese|cream|butter|egg|chicken|lamb|beef|keema|prawns?|fish|monkfish|sea bass|mayo|mayonnaise)\b/i;
const VEGETARIAN_CONTRADICTION = /\b(?:chicken|lamb|beef|keema|prawns?|fish|monkfish|sea bass)\b/i;

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return decodeHtml(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseClaimedName(rawName) {
  const displayedName = decodeHtml(rawName);
  const suffix = /\s*\(([^()]*)\)\s*$/.exec(displayedName);
  if (!suffix) return { name: displayedName, codes: [] };

  const codes = suffix[1]
    .split(/[^A-Za-z]+/)
    .map((value) => value.toUpperCase())
    .filter(Boolean);
  if (codes.length === 0 || !codes.every((code) => PUBLIC_CLAIM_CODES.has(code))) {
    return { name: displayedName, codes: [] };
  }

  return {
    name: displayedName.slice(0, suffix.index).trim(),
    codes
  };
}

function parsePublicMenuItems(html) {
  const items = [];
  for (const match of html.matchAll(/<div class="menuItem">([\s\S]*?)<div class="menuPrice">/g)) {
    const itemHtml = match[1];
    const nameMatch = /<div class="menuName">([\s\S]*?)<\/div>/.exec(itemHtml);
    if (!nameMatch) continue;
    const descriptionMatch = /<div class="menuDesc">([\s\S]*?)<\/div>/.exec(itemHtml);
    const parsed = parseClaimedName(nameMatch[1]);
    items.push({
      ...parsed,
      description: decodeHtml(descriptionMatch?.[1] || "")
    });
  }
  return items;
}

function canonicalItemsByName() {
  const map = new Map();
  MILLERS_ORDER_MENU.forEach((category) => {
    (category.items || []).forEach((item) => {
      const key = normalizeName(item.name);
      const entries = map.get(key) || [];
      entries.push({ category: category.name, item });
      map.set(key, entries);
    });
  });
  return map;
}

const publicMenuHtml = readFileSync(new URL("../menu/index.html", import.meta.url), "utf8");
const publicItems = parsePublicMenuItems(publicMenuHtml);
const publicByName = new Map(publicItems.map((item) => [normalizeName(item.name), item]));
const canonicalByName = canonicalItemsByName();

test("static menu claims are no stronger than the canonical catalogue", () => {
  publicItems.forEach((publicItem) => {
    if (publicItem.codes.length === 0) return;
    const matches = canonicalByName.get(normalizeName(publicItem.name)) || [];
    assert.equal(matches.length, 1, `${publicItem.name} must map to one canonical catalogue item`);

    const canonicalCodes = new Set(
      (matches[0].item.codes || [])
        .map((code) => String(code).toUpperCase())
        .filter((code) => PUBLIC_CLAIM_CODES.has(code))
    );
    publicItem.codes.forEach((code) => {
      assert.equal(canonicalCodes.has(code), true, `${publicItem.name} makes an unsupported ${code} claim`);
    });
  });
});

test("modifier-dependent dietary items use qualified option copy, not absolute V or VG labels", () => {
  canonicalByName.forEach((matches, key) => {
    if (matches.length !== 1) return;
    const display = getMenuItemDietaryDisplay(matches[0].item);
    if (!display || display.confirmed) return;

    const publicItem = publicByName.get(key);
    assert.ok(publicItem, `${matches[0].item.name} should be present on the public menu`);
    assert.equal(
      publicItem.codes.some((code) => code === "VG" || code === "V"),
      false,
      `${publicItem.name} must not claim final dietary suitability before modifiers are chosen`
    );
    assert.match(
      publicItem.description,
      /vegan (?:base )?option/i,
      `${publicItem.name} should explain that vegan suitability is conditional`
    );
  });
});

test("absolute vegan and vegetarian labels do not contradict obvious ingredients", () => {
  publicItems.forEach((item) => {
    const ingredientText = `${item.name} ${item.description}`;
    if (item.codes.includes("VG")) {
      assert.doesNotMatch(ingredientText, VEGAN_CONTRADICTION, `${item.name} has a contradictory vegan claim`);
    }
    if (item.codes.includes("V")) {
      assert.doesNotMatch(ingredientText, VEGETARIAN_CONTRADICTION, `${item.name} has a contradictory vegetarian claim`);
    }
  });
});

test("paneer dishes use vegetarian and dairy labels, never vegan", () => {
  ["Vegetarian Mix", "Bombay Veg Crush"].forEach((name) => {
    const item = publicByName.get(normalizeName(name));
    assert.ok(item);
    assert.deepEqual(item.codes.slice().sort(), ["D", "V"]);
  });
});

test("public menu keeps its allergy guidance and policy footer", () => {
  assert.match(publicMenuHtml, /class="menuAllergenNotice"/);
  assert.match(publicMenuHtml, /currently tags only dairy \(D\) and nuts \(N\)/i);
  assert.match(publicMenuHtml, /no symbol does not mean allergen-free/i);
  assert.match(publicMenuHtml, /shared preparation areas/i);
  assert.match(publicMenuHtml, /<footer class="footer">/);
  assert.match(publicMenuHtml, /href="\.\.\/privacy\/"/);
  assert.match(publicMenuHtml, /href="\.\.\/terms\/"/);
  assert.match(publicMenuHtml, /href="\.\.\/refunds\/"/);
});

test("menu display controls accurately name allergens and never hide the safety notice", () => {
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(publicMenuHtml, /Show dietary, allergen and spice symbols/);
  assert.match(publicMenuHtml, /Show symbol key/);
  assert.doesNotMatch(styles, /\.hide-legend\s+\.menuLegend\s*\{\s*display\s*:\s*none/);
  assert.match(styles, /\.hide-legend \.menuLegend \.legendGrid/);
});
