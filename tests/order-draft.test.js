"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import { reconcileOrderDraftState } from "../orders/order-draft.js";

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
              { name: "Mixed Tikka", priceAdjustment: 1 }
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
