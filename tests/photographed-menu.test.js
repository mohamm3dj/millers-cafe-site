"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MILLERS_ORDER_MENU,
  getMenuItemDietaryDisplay
} from "../orders/menu-catalog.js";

const CURRY_CATEGORY_NAMES = [
  "Mild Curries",
  "Medium Curries",
  "Hot Curries",
  "Very Hot Curries"
];

function categoryNamed(name) {
  const category = MILLERS_ORDER_MENU.find((candidate) => candidate.name === name);
  assert.ok(category, `${name} category should exist`);
  return category;
}

function itemNamed(categoryName, itemName) {
  const item = categoryNamed(categoryName).items.find((candidate) => candidate.name === itemName);
  assert.ok(item, `${categoryName} / ${itemName} should exist`);
  return item;
}

function groupNamed(item, groupName) {
  const group = (item.modifierGroups || []).find((candidate) => candidate.name === groupName);
  assert.ok(group, `${item.name} / ${groupName} should exist`);
  return group;
}

function optionNamed(group, optionName) {
  const option = (group.options || []).find((candidate) => candidate.name === optionName);
  assert.ok(option, `${group.name} / ${optionName} should exist`);
  return option;
}

function sortedCodes(values) {
  return [...values].map((value) => String(value).toUpperCase()).sort();
}

test("photographed curry prices keep Creamy Garlic and every side sauce at the printed price", () => {
  const creamyGarlicMatches = CURRY_CATEGORY_NAMES.flatMap((categoryName) =>
    categoryNamed(categoryName).items.filter((item) => item.name === "Creamy Garlic")
  );
  assert.equal(creamyGarlicMatches.length, 1, "Creamy Garlic should occur once across the curry menu");
  assert.equal(creamyGarlicMatches[0].basePrice, 7);

  const currySauce = itemNamed("Curry Sauce", "Curry Sauce");
  assert.equal(currySauce.basePrice, 4);
  const sauceGroup = groupNamed(currySauce, "Sauce");
  assert.equal(sauceGroup.isRequired, true);
  assert.equal(sauceGroup.selectionType, "single");
  sauceGroup.options.forEach((option) => {
    assert.equal(option.priceAdjustment, 0, `${option.name} sauce should remain £4`);
  });
});

test("curry sauce choices reproduce the corresponding curry dairy and nut labels", () => {
  const curryItems = CURRY_CATEGORY_NAMES.flatMap((categoryName) => categoryNamed(categoryName).items);
  const curryByName = new Map(curryItems.map((item) => [item.name, item]));
  assert.equal(curryByName.size, curryItems.length, "curry names must be unique for sauce matching");

  const sauceOptions = groupNamed(itemNamed("Curry Sauce", "Curry Sauce"), "Sauce").options;
  assert.deepEqual(
    sauceOptions.map((option) => option.name).sort(),
    [...curryByName.keys()].sort(),
    "the side-sauce selector should contain every printed curry"
  );

  sauceOptions.forEach((option) => {
    const curry = curryByName.get(option.name);
    const printedCodes = (curry.codes || []).filter((code) => code === "D" || code === "N");
    assert.deepEqual(
      sortedCodes(option.allergenCodes || []),
      sortedCodes(printedCodes),
      `${option.name} sauce should carry the same D/N labels as its curry`
    );
  });
});

test("photographed starter and wing dairy and nut labels remain explicit", () => {
  const expectedCodes = new Map([
    ["Starters - Mixed / Tandoori Mixed", ["D"]],
    ["Starters - Lamb / Lamb Samosa", ["D"]],
    ["Starters - Lamb / Seekh Kebab", ["D"]],
    ["Starters - Lamb / Lamb Tikka Starter", ["D"]],
    ["Starters - Seafood / Prawn Cocktail", ["D"]],
    ["Starters - Chicken / Chicken Tikka Starter", ["D"]],
    ["Starters - Chicken / Chicken Tikka Chaat", ["D"]],
    ["Starters - Chicken / Chicken Satay", ["N"]],
    ["Starters - Chicken / Chicken Pakora", ["D"]],
    ["Wings / Masala Wings", ["N"]],
    ["Wings / Tandoori Wings", ["D"]]
  ]);

  expectedCodes.forEach((expected, key) => {
    const [categoryName, itemName] = key.split(" / ");
    assert.deepEqual(sortedCodes(itemNamed(categoryName, itemName).codes || []), expected, key);
  });
});

test("Onion Bhaji and its wrap do not make an unsupported vegan claim", () => {
  const onionBhaji = itemNamed("Starters - Vegetarian", "Onion Bhaji");
  assert.deepEqual(onionBhaji.codes, []);
  assert.equal(onionBhaji.dietarySuitability, "");
  assert.equal(getMenuItemDietaryDisplay(onionBhaji), null);

  const wraps = categoryNamed("Wraps").items;
  assert.equal(wraps.length, 4);
  wraps.forEach((wrap) => {
    assert.equal((wrap.codes || []).includes("D"), true, `${wrap.name} should carry the printed dairy label`);
  });

  const onionWrap = itemNamed("Wraps", "Onion Bhaji & Veg Wrap");
  assert.deepEqual(onionWrap.codes, ["D"]);
  assert.equal(onionWrap.dietarySuitability, "");
  assert.equal(getMenuItemDietaryDisplay(onionWrap), null);
});

test("Mumbai Sizzle and Desi Crust preserve the printed category dairy and nut labels", () => {
  const burgers = categoryNamed("Mumbai Sizzle Burgers").items;
  assert.equal(burgers.length, 7);
  burgers.forEach((item) => {
    assert.equal((item.codes || []).includes("D"), true, `${item.name} should carry the category dairy label`);
  });

  const crust = itemNamed("Desi Crust", "Build Your Desi Crust");
  assert.equal((crust.codes || []).includes("D"), true);
  assert.deepEqual(optionNamed(groupNamed(crust, "Base"), "Masala").allergenCodes, ["N"]);

  const includedToppings = groupNamed(crust, "Choose up to 3 Toppings");
  const extraToppings = groupNamed(crust, "Extra Toppings (£2 each)");
  assert.equal(extraToppings.isRequired, false);
  assert.equal(extraToppings.selectionType, "multiple");
  assert.equal(extraToppings.maxSelections, includedToppings.options.length);
  assert.deepEqual(
    extraToppings.options.map((option) => option.name),
    includedToppings.options.map((option) => option.name)
  );
  extraToppings.options.forEach((option) => {
    assert.equal(option.priceAdjustment, 2, `${option.name} should cost £2 as an extra topping`);
  });
});

test("curry tikka proteins and every Parda upgrade carry their photographed dairy label", () => {
  CURRY_CATEGORY_NAMES.forEach((categoryName) => {
    categoryNamed(categoryName).items.forEach((curry) => {
      const proteins = groupNamed(curry, "Protein");
      ["Chicken Tikka", "Lamb Tikka"].forEach((proteinName) => {
        assert.deepEqual(
          optionNamed(proteins, proteinName).allergenCodes,
          ["D"],
          `${categoryName} / ${curry.name} / ${proteinName}`
        );
      });
    });
  });

  const biryanis = categoryNamed("Biryani").items;
  assert.equal(biryanis.length, 9);
  biryanis.forEach((biryani) => {
    const parda = optionNamed(groupNamed(biryani, "Upgrade"), "Parda Biryani Upgrade");
    assert.equal(parda.priceAdjustment, 5);
    assert.deepEqual(parda.allergenCodes, ["D"], `${biryani.name} Parda upgrade`);
  });
});

test("printed category, bread and side descriptions stay in the canonical catalogue", () => {
  assert.match(categoryNamed("Tandoori").description, /served with salad and vegetable curry sauce/i);
  assert.match(categoryNamed("Tandoori").description, /(?:all|every) tandoori dish(?:es)? (?:contain|contains) dairy/i);
  assert.match(
    categoryNamed("Biryani").description,
    /traditional basmati rice dish(?:es)? cooked with spices and layered with your choice of meat or vegetables/i
  );
  assert.match(categoryNamed("Biryani").description, /Parda Biryani[^.]*\+£5/i);
  assert.match(categoryNamed("Biryani").description, /garlic naan with cheese and special sauce/i);

  assert.equal(itemNamed("Bread & Snacks", "Chapati").description, "Thin wholemeal flatbread.");
  assert.equal(itemNamed("Bread & Snacks", "Paratha").description, "Layered pan-fried flatbread.");

  const expectedSideDescriptions = new Map([
    ["Chana Masala", "Chickpeas in light spices."],
    ["Bombay Potato", "Spicy potatoes with seasoning."],
    ["Bhindi Bhaji", "Okra cooked with spices."],
    ["Saag Bhaji", "Spinach side dish."],
    ["Tarka Daal", "Lentils cooked with garlic."],
    ["Tinda Bhaji", "Spiced baby pumpkins."],
    ["Saag Aloo", "Spinach with potatoes."],
    ["Cauliflower Bhaji", "Cauliflower cooked in spices."],
    ["Mushroom Bhaji", "Mushrooms cooked in spices."],
    ["Saag Paneer", "Spinach and paneer in a creamy sauce."]
  ]);
  expectedSideDescriptions.forEach((description, itemName) => {
    assert.equal(itemNamed("Side Dishes", itemName).description, description, itemName);
  });
});

test("the public menu preserves the photographed fresh-order and vegan-preparation guidance", () => {
  const html = readFileSync(new URL("../menu/index.html", import.meta.url), "utf8")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");

  assert.match(
    html,
    /All food is cooked fresh to order\. Please allow extra time during busy periods\./i
  );
  assert.match(html, /Some of our dishes are enriched with ghee for added flavour\./i);
  assert.match(
    html,
    /If you are vegan, please let us know and we will happily prepare your meal accordingly\./i
  );

  ["collection", "delivery"].forEach((orderType) => {
    const orderHtml = readFileSync(new URL(`../${orderType}/index.html`, import.meta.url), "utf8")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ");
    assert.match(orderHtml, /Some dishes are enriched with ghee/i, orderType);
    assert.match(
      orderHtml,
      /if you are vegan, tell us so we can prepare your meal accordingly/i,
      orderType
    );
  });
});
