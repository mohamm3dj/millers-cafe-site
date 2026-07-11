"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ALLERGEN_CODE_LABELS,
  UK_REGULATED_ALLERGENS,
  getMenuItemAllergenLabels,
  normalizeMenuItemAllergenCodes
} from "../orders/menu-catalog.js";

const EXPECTED_REGULATED_NAMES = [
  "Celery",
  "Cereals containing gluten",
  "Crustaceans",
  "Eggs",
  "Fish",
  "Lupin",
  "Milk",
  "Molluscs",
  "Mustard",
  "Peanuts",
  "Sesame",
  "Soybeans",
  "Sulphur dioxide and sulphites",
  "Tree nuts"
];

test("all 14 UK regulated allergen categories have unique explicit codes", () => {
  assert.equal(UK_REGULATED_ALLERGENS.length, 14);
  assert.deepEqual(
    UK_REGULATED_ALLERGENS.map(({ regulatedName }) => regulatedName),
    EXPECTED_REGULATED_NAMES
  );

  const codes = UK_REGULATED_ALLERGENS.map(({ code }) => code);
  assert.equal(new Set(codes).size, 14);
  assert.equal(Object.keys(ALLERGEN_CODE_LABELS).length, 14);
});

test("allergen codes normalize case and duplicates without accepting unknown values", () => {
  const codes = UK_REGULATED_ALLERGENS.map(({ code }) => code);
  assert.deepEqual(
    normalizeMenuItemAllergenCodes({ codes: [" unknown ", ...codes.map((code) => code.toLowerCase()), "d", "N"] }),
    codes
  );
});

test("all 14 explicit codes produce customer-facing contains labels", () => {
  const item = { codes: UK_REGULATED_ALLERGENS.map(({ code }) => code) };
  assert.deepEqual(
    getMenuItemAllergenLabels(item),
    UK_REGULATED_ALLERGENS.map(({ label }) => label)
  );
});

test("legacy dairy and nut labels remain unchanged", () => {
  assert.deepEqual(getMenuItemAllergenLabels({ codes: ["D", "N"] }), ["Dairy", "Nuts"]);
});

test("selected modifier options add and remove only explicit allergen codes", () => {
  const item = {
    codes: ["D"],
    modifierGroups: [{
      name: "Preparation",
      options: [
        { name: "Standard", allergenCodes: [" e ", "UNKNOWN"] },
        { name: "Dairy-free", removesAllergenCodes: ["d"], allergenCodes: ["SO"] }
      ]
    }]
  };

  assert.deepEqual(
    getMenuItemAllergenLabels(item, [{ groupName: "Preparation", optionName: "Standard" }]),
    ["Dairy", "Eggs"]
  );
  assert.deepEqual(
    getMenuItemAllergenLabels(item, [{ groupName: "Preparation", optionName: "Dairy-free" }]),
    ["Soya"]
  );
  assert.deepEqual(getMenuItemAllergenLabels(item, [{ groupName: "Other", optionName: "Dairy-free" }]), ["Dairy"]);
});

test("allergen claims are never inferred from an item name, description, tags or supplied labels", () => {
  assert.deepEqual(getMenuItemAllergenLabels({
    name: "Unverified descriptive item",
    description: "Words here are not evidence",
    tags: ["dairy", "nuts", "gluten"],
    allergens: ["Milk", "Tree nuts"],
    codes: []
  }), []);
});

test("the static menu decorator recognizes every regulated allergen code", () => {
  const source = readFileSync(new URL("../menu/menu.js", import.meta.url), "utf8");
  const knownCodesLiteral = /const knownCodes = new Set\(\[([\s\S]*?)\]\);/.exec(source)?.[1] || "";
  UK_REGULATED_ALLERGENS.forEach(({ code }) => {
    assert.match(knownCodesLiteral, new RegExp(`\\"${code}\\"`), `${code} must render as a static-menu chip`);
  });
});
