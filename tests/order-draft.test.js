"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import { reconcileOrderDraftState, resolveOrderMenuView } from "../orders/order-draft.js";

const SAMPLE_MENU = [
  {
    name: "Salad Bowls",
    categoryKey: "salad bowls",
    items: [
      {
        id: "salad-bowls::build-your-salad-bowl::0",
        name: "Build Your Salad Bowl",
        basePrice: 8,
        modifierGroups: [
          {
            name: "Protein",
            selectionType: "single",
            isRequired: true,
            isTextInput: false,
            maxSelections: 1,
            options: [
              { name: "Chicken Tikka", priceAdjustment: 0 },
              { name: "Mixed Tikka", priceAdjustment: 1, allergenCodes: ["D", "unknown"], removesAllergenCodes: ["N"] }
            ]
          },
          {
            name: "Dressing",
            selectionType: "single",
            isRequired: false,
            isTextInput: false,
            maxSelections: 1,
            options: [
              { name: "Sweet Chilli", priceAdjustment: 0 },
              { name: "Olive Oil", priceAdjustment: 0 }
            ]
          }
        ],
        tags: []
      }
    ]
  }
];

test("reconcileOrderDraftState reprices restored items against the live menu and drops unavailable lines", () => {
  const { draft, meta } = reconcileOrderDraftState({
    version: 1,
    cartItems: [
      {
        id: 4,
        itemId: "salad-bowls::build-your-salad-bowl::0",
        itemName: "Build Your Salad Bowl",
        basePrice: 7,
        quantity: 2,
        modifierSelections: [
          { groupName: "Protein", optionName: "Mixed Tikka", priceAdjustment: 0, isTextInput: false },
          { groupName: "Dressing", optionName: "Sweet Chilli", priceAdjustment: 0, isTextInput: false }
        ]
      },
      {
        id: 5,
        itemId: "old::item::0",
        itemName: "Old Item",
        basePrice: 5,
        quantity: 1,
        modifierSelections: []
      }
    ],
    schedules: {
      collection: { date: "2026-04-22", time: "13:00" }
    }
  }, SAMPLE_MENU);

  assert.equal(draft.cartItems.length, 1);
  assert.equal(draft.cartItems[0].itemName, "Build Your Salad Bowl");
  assert.equal(draft.cartItems[0].basePrice, 8);
  assert.equal(draft.cartItems[0].unitPrice, 9);
  assert.equal(draft.cartItems[0].linePrice, 18);
  assert.deepEqual(draft.cartItems[0].modifierSelections[0].allergenCodes, ["D"]);
  assert.deepEqual(draft.cartItems[0].modifierSelections[0].removesAllergenCodes, ["N"]);
  assert.equal(meta.updatedItems, 1);
  assert.equal(meta.removedItems, 1);
  assert.equal(meta.hadChanges, true);
});

test("reconcileOrderDraftState drops lines that no longer satisfy required modifiers", () => {
  const { draft, meta } = reconcileOrderDraftState({
    cartItems: [
      {
        id: 1,
        itemId: "salad-bowls::build-your-salad-bowl::0",
        itemName: "Build Your Salad Bowl",
        basePrice: 8,
        quantity: 1,
        modifierSelections: [
          { groupName: "Protein", optionName: "Lamb Tikka", priceAdjustment: 0, isTextInput: false }
        ]
      }
    ]
  }, SAMPLE_MENU);

  assert.equal(draft.cartItems.length, 0);
  assert.equal(meta.removedItems, 1);
  assert.equal(meta.restoredLineCount, 0);
});

test("reconcileOrderDraftState merges duplicate restored lines after normalization", () => {
  const { draft, meta } = reconcileOrderDraftState({
    cartItems: [
      {
        id: 1,
        itemName: "Build Your Salad Bowl",
        basePrice: 8,
        quantity: 1,
        modifierSelections: [
          { groupName: "Protein", optionName: "Chicken Tikka", priceAdjustment: 0, isTextInput: false }
        ]
      },
      {
        id: 2,
        itemId: "salad-bowls::build-your-salad-bowl::0",
        itemName: "Build Your Salad Bowl",
        basePrice: 8,
        quantity: 2,
        modifierSelections: [
          { groupName: "Protein", optionName: "Chicken Tikka", priceAdjustment: 0, isTextInput: false }
        ]
      }
    ]
  }, SAMPLE_MENU);

  assert.equal(draft.cartItems.length, 1);
  assert.equal(draft.cartItems[0].quantity, 3);
  assert.equal(draft.cartItems[0].linePrice, 24);
  assert.equal(meta.mergedLines, 1);
  assert.equal(meta.hadChanges, true);
});

test("reconcileOrderDraftState restores POS ids for items and modifiers", () => {
  const menu = [
    {
      id: "cat-main",
      name: "Mains",
      items: [
        {
          id: "pos-item-korma",
          posItemId: "pos-item-korma",
          posCategoryId: "cat-main",
          categoryName: "Mains",
          name: "Korma",
          basePrice: 11.5,
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
                  priceAdjustment: 0
                }
              ]
            }
          ]
        }
      ]
    }
  ];

  const { draft } = reconcileOrderDraftState({
    cartItems: [
      {
        posItemId: "pos-item-korma",
        itemName: "Old Korma",
        basePrice: 10,
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
    ]
  }, menu);

  assert.equal(draft.cartItems[0].posItemId, "pos-item-korma");
  assert.equal(draft.cartItems[0].posCategoryId, "cat-main");
  assert.equal(draft.cartItems[0].modifierSelections[0].posModifierGroupId, "group-spice");
  assert.equal(draft.cartItems[0].modifierSelections[0].posModifierOptionId, "option-hot");
});

test("reconcileOrderDraftState restores discount eligibility from the live catalogue", () => {
  const menu = [
    {
      name: "Fresh Lunch Deal",
      items: [
        {
          id: "fresh-lunch-deal::fresh-lunch-deal::0",
          name: "Fresh Lunch Deal",
          basePrice: 5.95,
          discountEligible: false,
          modifierGroups: []
        }
      ]
    }
  ];

  const { draft, meta } = reconcileOrderDraftState({
    cartItems: [
      {
        itemId: "fresh-lunch-deal::fresh-lunch-deal::0",
        itemName: "Fresh Lunch Deal",
        basePrice: 5.95,
        discountEligible: true,
        quantity: 1,
        modifierSelections: []
      }
    ]
  }, menu);

  assert.equal(draft.cartItems.length, 1);
  assert.equal(draft.cartItems[0].discountEligible, false);
  assert.equal(meta.updatedItems, 1);
  assert.equal(meta.hadChanges, true);
});

test("a draft version migration resets the saved menu landing while preserving the order", () => {
  const { draft, meta } = reconcileOrderDraftState({
    version: 2,
    cartItems: [
      {
        id: 1,
        itemId: "salad-bowls::build-your-salad-bowl::0",
        itemName: "Build Your Salad Bowl",
        basePrice: 8,
        quantity: 1,
        modifierSelections: [
          { groupName: "Protein", optionName: "Chicken Tikka", priceAdjustment: 0, isTextInput: false }
        ]
      }
    ],
    nextCartId: 7,
    selectedCategory: "Café Curries",
    searchQuery: "korma",
    schedules: {
      collection: { date: "2026-09-02", time: "13:00" },
      delivery: { date: "2026-09-03", time: "14:00" }
    }
  }, SAMPLE_MENU, { orderDraftVersion: 3 });

  assert.equal(draft.version, 3);
  assert.equal(draft.selectedCategory, "");
  assert.equal(draft.searchQuery, "");
  assert.equal(draft.cartItems.length, 1);
  assert.equal(draft.cartItems[0].modifierSelections[0].optionName, "Chicken Tikka");
  assert.equal(draft.nextCartId, 7);
  assert.deepEqual(draft.schedules.collection, { date: "2026-09-02", time: "13:00" });
  assert.deepEqual(draft.schedules.delivery, { date: "2026-09-03", time: "14:00" });
  assert.equal(meta.hadChanges, true);
});

test("the current draft version preserves a customer's selected category and search", () => {
  const { draft, meta } = reconcileOrderDraftState({
    version: 3,
    selectedCategory: "Drinks",
    searchQuery: "latte"
  }, SAMPLE_MENU, { orderDraftVersion: 3 });

  assert.equal(draft.selectedCategory, "Drinks");
  assert.equal(draft.searchQuery, "latte");
  assert.equal(meta.hadChanges, false);
});

test("a menu category deep link overrides a saved view without changing invalid links", () => {
  const categories = ["Fresh Lunch Deal", "Café Curries", "Drinks"];
  const savedView = { selectedCategory: "Drinks", searchQuery: "latte" };

  assert.deepEqual(
    resolveOrderMenuView(savedView, "#fresh-lunch-deal", categories),
    { selectedCategory: "Fresh Lunch Deal", searchQuery: "", deepLinked: true }
  );
  assert.deepEqual(
    resolveOrderMenuView(savedView, "#Caf%C3%A9%20Curries", categories),
    { selectedCategory: "Café Curries", searchQuery: "", deepLinked: true }
  );
  assert.deepEqual(
    resolveOrderMenuView(savedView, "#not-a-real-category", categories),
    { selectedCategory: "Drinks", searchQuery: "latte", deepLinked: false }
  );
});
