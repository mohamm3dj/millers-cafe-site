"use strict";

const DIETARY_TAG_KEYS = new Set(["vegan", "vegetarian", "veg"]);

function freezeAllergenDefinition(definition) {
  return Object.freeze({
    ...definition,
    tagKeys: Object.freeze(definition.tagKeys.slice())
  });
}

// These are the 14 allergen categories regulated in the UK. Codes only create
// a public claim when they are explicitly present in an item's `codes` array;
// names, descriptions, tags and ingredients are never used to infer a claim.
// D and N retain the site's existing public labels for backwards compatibility.
export const UK_REGULATED_ALLERGENS = Object.freeze([
  freezeAllergenDefinition({ code: "CE", key: "celery", regulatedName: "Celery", label: "Celery", tagKeys: ["celery"] }),
  freezeAllergenDefinition({ code: "G", key: "cereals-containing-gluten", regulatedName: "Cereals containing gluten", label: "Cereals containing gluten", tagKeys: ["gluten", "cereals containing gluten"] }),
  freezeAllergenDefinition({ code: "CR", key: "crustaceans", regulatedName: "Crustaceans", label: "Crustaceans", tagKeys: ["crustacean", "crustaceans"] }),
  freezeAllergenDefinition({ code: "E", key: "eggs", regulatedName: "Eggs", label: "Eggs", tagKeys: ["egg", "eggs"] }),
  freezeAllergenDefinition({ code: "F", key: "fish", regulatedName: "Fish", label: "Fish", tagKeys: ["fish"] }),
  freezeAllergenDefinition({ code: "L", key: "lupin", regulatedName: "Lupin", label: "Lupin", tagKeys: ["lupin"] }),
  freezeAllergenDefinition({ code: "D", key: "milk", regulatedName: "Milk", label: "Dairy", tagKeys: ["dairy", "milk"] }),
  freezeAllergenDefinition({ code: "MO", key: "molluscs", regulatedName: "Molluscs", label: "Molluscs", tagKeys: ["mollusc", "molluscs"] }),
  freezeAllergenDefinition({ code: "MU", key: "mustard", regulatedName: "Mustard", label: "Mustard", tagKeys: ["mustard"] }),
  freezeAllergenDefinition({ code: "P", key: "peanuts", regulatedName: "Peanuts", label: "Peanuts", tagKeys: ["peanut", "peanuts"] }),
  freezeAllergenDefinition({ code: "SE", key: "sesame", regulatedName: "Sesame", label: "Sesame", tagKeys: ["sesame", "sesame seeds"] }),
  freezeAllergenDefinition({ code: "SO", key: "soybeans", regulatedName: "Soybeans", label: "Soya", tagKeys: ["soy", "soya", "soybean", "soybeans"] }),
  freezeAllergenDefinition({ code: "SU", key: "sulphites", regulatedName: "Sulphur dioxide and sulphites", label: "Sulphur dioxide and sulphites", tagKeys: ["sulphites", "sulfites", "sulphur dioxide", "sulfur dioxide"] }),
  freezeAllergenDefinition({ code: "N", key: "tree-nuts", regulatedName: "Tree nuts", label: "Nuts", tagKeys: ["nut", "nuts", "tree nut", "tree nuts"] })
]);

export const ALLERGEN_CODE_LABELS = Object.freeze(Object.fromEntries(
  UK_REGULATED_ALLERGENS.map(({ code, label }) => [code, label])
));

const ALLERGEN_CODES = new Set(Object.keys(ALLERGEN_CODE_LABELS));
const ALLERGEN_TAG_KEYS = new Set(
  UK_REGULATED_ALLERGENS.flatMap(({ tagKeys }) => tagKeys)
);
const DIETARY_CODE_KINDS = Object.freeze({
  VG: "vegan",
  VE: "vegan",
  V: "vegetarian"
});
const VEGAN_SAFE_OPTION_KEYS = new Set([
  "chapati",
  "sriracha",
  "tamarind",
  "mango chutney",
  "ketchup",
  "standard biryani",
  "vegetables"
]);
const VEGETARIAN_ONLY_OPTION_KEYS = new Set([
  "add cheese",
  "algerian sauce",
  "curry mayo",
  "mayonnaise",
  "mint sauce",
  "naan"
]);
const CAFE_CURRY_CATEGORY_KEYS = new Set([
  "mild curries",
  "medium curries",
  "hot curries",
  "very hot curries"
]);

function normalizedCatalogKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueUpperCodes(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  ));
}

function explicitModifierAllergenCodes(categoryName, groupName, optionName, currySauceAllergenCodesByName) {
  const categoryKey = normalizedCatalogKey(categoryName);
  const groupKey = normalizedCatalogKey(groupName);
  const optionKey = normalizedCatalogKey(optionName);

  if (categoryKey === "curry sauce" && groupKey === "sauce") {
    return currySauceAllergenCodesByName.get(optionKey) || [];
  }
  if (
    CAFE_CURRY_CATEGORY_KEYS.has(categoryKey)
    && groupKey === "protein"
    && (optionKey === "chicken tikka" || optionKey === "lamb tikka")
  ) {
    return ["D"];
  }
  if (groupKey === "upgrade" && optionKey === "parda biryani upgrade") {
    return ["D"];
  }
  if (categoryKey === "desi crust" && groupKey === "base" && optionKey === "masala") {
    return ["N"];
  }
  return [];
}

function dietaryKindFromCodes(codes) {
  for (const code of uniqueUpperCodes(codes)) {
    if (DIETARY_CODE_KINDS[code]) return DIETARY_CODE_KINDS[code];
  }
  return "";
}

function optionDietaryEffect(groupName, optionName) {
  const groupKey = normalizedCatalogKey(groupName);
  const optionKey = normalizedCatalogKey(optionName);

  if (groupKey === "protein") {
    return optionKey === "vegetables" ? "inherit" : "not-suitable";
  }
  if (VEGETARIAN_ONLY_OPTION_KEYS.has(optionKey)) return "vegetarian";
  if (VEGAN_SAFE_OPTION_KEYS.has(optionKey)) return "inherit";
  return "unknown";
}

function dietaryRank(kind) {
  if (kind === "vegan") return 2;
  if (kind === "vegetarian") return 1;
  return 0;
}

function lowerDietaryKind(kind, ceiling) {
  return dietaryRank(ceiling) < dietaryRank(kind) ? ceiling : kind;
}

function displayDietaryKind(kind) {
  if (kind === "vegan") return "Vegan";
  if (kind === "vegetarian") return "Vegetarian";
  return "";
}

function selectionForGroup(selections, group) {
  const groupKey = normalizedCatalogKey(group?.name);
  return (Array.isArray(selections) ? selections : []).filter((selection) =>
    normalizedCatalogKey(selection?.groupName) === groupKey
  );
}

function optionForSelection(group, selection) {
  const optionKey = normalizedCatalogKey(selection?.optionName);
  return (Array.isArray(group?.options) ? group.options : []).find((option) =>
    normalizedCatalogKey(option?.name) === optionKey
  ) || null;
}

export function normalizeMenuItemAllergenCodes(item) {
  return uniqueUpperCodes(item?.codes).filter((code) => ALLERGEN_CODES.has(code));
}

export function getMenuItemAllergenCodes(item, modifierSelections = []) {
  const result = normalizeMenuItemAllergenCodes(item);
  const groups = Array.isArray(item?.modifierGroups) ? item.modifierGroups : [];

  for (const group of groups) {
    for (const selection of selectionForGroup(modifierSelections, group)) {
      const option = optionForSelection(group, selection);
      if (!option) continue;

      const removals = new Set(normalizeMenuItemAllergenCodes({ codes: option.removesAllergenCodes }));
      if (removals.size > 0) {
        for (let index = result.length - 1; index >= 0; index -= 1) {
          if (removals.has(result[index])) result.splice(index, 1);
        }
      }

      for (const code of normalizeMenuItemAllergenCodes({ codes: option.allergenCodes })) {
        if (!result.includes(code)) result.push(code);
      }
    }
  }

  return result;
}

export function getMenuItemAllergenLabels(item, modifierSelections = []) {
  return getMenuItemAllergenCodes(item, modifierSelections)
    .map((code) => ALLERGEN_CODE_LABELS[code]);
}

export function getMenuItemDietaryDisplay(item, modifierSelections = []) {
  const dietaryKind = String(item?.dietarySuitability || dietaryKindFromCodes(item?.codes)).trim().toLowerCase();
  if (!displayDietaryKind(dietaryKind)) return null;

  const groups = Array.isArray(item?.modifierGroups) ? item.modifierGroups : [];
  const affectingGroups = groups.filter((group) => Boolean(group?.affectsDietarySuitability));
  if (affectingGroups.length === 0) {
    return {
      kind: dietaryKind,
      label: displayDietaryKind(dietaryKind),
      confirmed: true
    };
  }

  let finalKind = dietaryKind;
  let allRequiredChoicesMade = true;

  for (const group of affectingGroups) {
    const selected = selectionForGroup(modifierSelections, group);
    if (group.isRequired && selected.length === 0) {
      allRequiredChoicesMade = false;
      continue;
    }

    for (const selection of selected) {
      const option = optionForSelection(group, selection);
      const effect = String(option?.dietaryEffect || "unknown").trim().toLowerCase();
      if (effect === "not-suitable" || effect === "unknown") return null;
      if (effect === "vegetarian") {
        finalKind = lowerDietaryKind(finalKind, "vegetarian");
      }
    }
  }

  if (!allRequiredChoicesMade) {
    return {
      kind: dietaryKind,
      label: `${displayDietaryKind(dietaryKind)} option`,
      confirmed: false
    };
  }

  return {
    kind: finalKind,
    label: displayDietaryKind(finalKind),
    confirmed: true
  };
}

export function getPreferredModifierOptionIndex(item, group) {
  const options = Array.isArray(group?.options) ? group.options : [];
  if (!item?.dietarySuitability || !group?.affectsDietarySuitability) return 0;

  const safeIndex = options.findIndex((option) => String(option?.dietaryEffect || "") === "inherit");
  return safeIndex >= 0 ? safeIndex : -1;
}

function remediateMenuCatalog(catalog) {
  const currySauceAllergenCodesByName = new Map();
  (Array.isArray(catalog) ? catalog : []).forEach((category) => {
    if (!CAFE_CURRY_CATEGORY_KEYS.has(normalizedCatalogKey(category?.name))) return;
    (Array.isArray(category?.items) ? category.items : []).forEach((item) => {
      currySauceAllergenCodesByName.set(
        normalizedCatalogKey(item?.name),
        normalizeMenuItemAllergenCodes(item)
      );
    });
  });

  (Array.isArray(catalog) ? catalog : []).forEach((category) => {
    (Array.isArray(category?.items) ? category.items : []).forEach((item) => {
      item.codes = uniqueUpperCodes(item.codes);
      item.dietarySuitability = dietaryKindFromCodes(item.codes);
      item.allergens = getMenuItemAllergenLabels(item);
      item.tags = Array.from(new Set(
        (Array.isArray(item.tags) ? item.tags : [])
          .map((tag) => String(tag || "").trim().toLowerCase())
          .filter((tag) => tag && !DIETARY_TAG_KEYS.has(tag) && !ALLERGEN_TAG_KEYS.has(tag))
      ));

      (Array.isArray(item.modifierGroups) ? item.modifierGroups : []).forEach((group) => {
        let affectsDietarySuitability = false;
        (Array.isArray(group?.options) ? group.options : []).forEach((option) => {
          option.allergenCodes = normalizeMenuItemAllergenCodes({
            codes: [
              ...(Array.isArray(option.allergenCodes) ? option.allergenCodes : []),
              ...explicitModifierAllergenCodes(
                category.name,
                group.name,
                option.name,
                currySauceAllergenCodesByName
              )
            ]
          });
          option.removesAllergenCodes = normalizeMenuItemAllergenCodes({ codes: option.removesAllergenCodes });
          option.dietaryEffect = optionDietaryEffect(group.name, option.name);
          if (option.dietaryEffect !== "inherit") affectsDietarySuitability = true;
        });
        group.affectsDietarySuitability = Boolean(item.dietarySuitability && affectsDietarySuitability);
      });
    });
  });
  return catalog;
}

export const MILLERS_ORDER_MENU = [
  {
    "name": "Shakes and Chillers",
    "description": "Cold drinks, smoothies, lassis and signature milkshakes.",
    "items": [
      {
        "name": "Iced Caramel Latte",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Add Syrup",
            "selectionType": "single",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Vanilla Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Caramel Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Hazelnut Syrup",
                "priceAdjustment": 1
              }
            ]
          }
        ]
      },
      {
        "name": "Iced Lychee Lemonade",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Strawberry Sunset Smoothie",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Berry Blast Smoothie",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Mango Lassi",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Strawberry Milkshake",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Vanilla Milkshake",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Biscoff Milkshake",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Daim Milkshake",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Oreo Milkshake",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Aero Mint Milkshake",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Malteser Milkshake",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Kinder Bueno White Milkshake",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Skittles Milkshake",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Snickers Milkshake",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "N"
        ],
        "tags": [
          "nuts"
        ],
        "modifierGroups": []
      },
      {
        "name": "Pistachio Milkshake",
        "basePrice": 7,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "N"
        ],
        "tags": [
          "nuts"
        ],
        "modifierGroups": []
      },
      {
        "name": "Red Velvet Milkshake",
        "basePrice": 8,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Brownie Milkshake",
        "basePrice": 8,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Hot Drinks",
    "description": "Add vanilla, caramel or hazelnut syrup to selected drinks for +£1.",
    "items": [
      {
        "name": "Peppermint Tea",
        "basePrice": 3,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Green Tea",
        "basePrice": 3,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Tea",
        "basePrice": 3,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Americano",
        "basePrice": 3,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Add Syrup",
            "selectionType": "single",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Vanilla Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Caramel Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Hazelnut Syrup",
                "priceAdjustment": 1
              }
            ]
          }
        ]
      },
      {
        "name": "Latte",
        "basePrice": 3.5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Add Syrup",
            "selectionType": "single",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Vanilla Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Caramel Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Hazelnut Syrup",
                "priceAdjustment": 1
              }
            ]
          }
        ]
      },
      {
        "name": "Cappuccino",
        "basePrice": 3.5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Add Syrup",
            "selectionType": "single",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Vanilla Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Caramel Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Hazelnut Syrup",
                "priceAdjustment": 1
              }
            ]
          }
        ]
      },
      {
        "name": "Mocha",
        "basePrice": 3.5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Add Syrup",
            "selectionType": "single",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Vanilla Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Caramel Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Hazelnut Syrup",
                "priceAdjustment": 1
              }
            ]
          }
        ]
      },
      {
        "name": "Flat White",
        "basePrice": 3.5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Add Syrup",
            "selectionType": "single",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Vanilla Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Caramel Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Hazelnut Syrup",
                "priceAdjustment": 1
              }
            ]
          }
        ]
      },
      {
        "name": "Hot Chocolate",
        "basePrice": 3.5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Add Syrup",
            "selectionType": "single",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Vanilla Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Caramel Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Hazelnut Syrup",
                "priceAdjustment": 1
              }
            ]
          }
        ]
      },
      {
        "name": "Masala Tea",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Masala Latte",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Add Syrup",
            "selectionType": "single",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Vanilla Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Caramel Syrup",
                "priceAdjustment": 1
              },
              {
                "name": "Hazelnut Syrup",
                "priceAdjustment": 1
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Desserts and Cakes",
    "description": "Cakes, puddings and dessert bites.",
    "items": [
      {
        "name": "Red Velvet Slice",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Carrot Cake Slice",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Lemon Cake Slice",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Matilda Cake Slice",
        "basePrice": 7,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Oreo Cheesecake Slice",
        "basePrice": 7,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Sticky Toffee Pudding",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Brownies",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Cookie Dough",
        "basePrice": 6,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Kulfi Ice Cream",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Strawberry Cheesecake Cubes",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Mango Cake Cubes",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Soft Drinks",
    "items": [
      {
        "name": "Coca-Cola Can",
        "basePrice": 2,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Diet Coke Can",
        "basePrice": 2,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Fanta Can",
        "basePrice": 2,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Sprite Can",
        "basePrice": 2,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Cobra Zero",
        "basePrice": 3,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "J2O Orange",
        "basePrice": 3,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "J2O Apple & Raspberry",
        "basePrice": 3,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Still Water",
        "basePrice": 3,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Sparkling Water",
        "basePrice": 3,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Red Bull",
        "basePrice": 3.5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Starters - Mixed",
    "items": [
      {
        "name": "Hot Mix",
        "basePrice": 6,
        "description": "Chicken and lamb tikka with naga chilli.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [
          "spicy"
        ],
        "modifierGroups": []
      },
      {
        "name": "Tandoori Mixed",
        "basePrice": 6,
        "description": "Chicken, lamb tikka and seekh kebab.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Vegetarian Mix",
        "basePrice": 6,
        "description": "Bhaji, samosa and paneer pakora.",
        "publicPriceLabel": "",
        "codes": [
          "V",
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Starters - Lamb",
    "items": [
      {
        "name": "Lamb Samosa",
        "basePrice": 5,
        "description": "Minced lamb and peas.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Seekh Kebab",
        "basePrice": 5,
        "description": "Spiced minced lamb.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Lamb Tikka Starter",
        "basePrice": 5,
        "description": "Grilled marinated lamb.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Starters - Seafood",
    "items": [
      {
        "name": "Prawn Cocktail",
        "basePrice": 5,
        "description": "Prawns with seafood sauce.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Prawn Puri",
        "basePrice": 5,
        "description": "Spiced prawns on puri.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "King Prawn Puri",
        "basePrice": 8,
        "description": "King prawns on puri.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Fish Masala",
        "basePrice": 8,
        "description": "Spiced crispy fish.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [
          "spicy"
        ],
        "modifierGroups": []
      },
      {
        "name": "Chilli Garlic Scallops",
        "basePrice": 12,
        "description": "Scallops with garlic and chilli.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [
          "spicy"
        ],
        "modifierGroups": []
      },
      {
        "name": "Mussels",
        "basePrice": 7,
        "description": "Creamy garlic sauce.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Starters - Vegetarian",
    "items": [
      {
        "name": "Papadom",
        "basePrice": 1,
        "description": "Light, crispy Indian wafer.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Condiments",
        "basePrice": 4,
        "description": "Selection of chutneys.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Onion Bhaji",
        "basePrice": 5,
        "description": "Lightly spiced onion fritters.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Chilli Paneer",
        "basePrice": 5,
        "description": "Paneer in chilli sauce.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "spicy",
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Garlic Mushroom Chaat",
        "basePrice": 5,
        "description": "Mushrooms with garlic on puri.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Aloo Chaat",
        "basePrice": 5,
        "description": "Spiced potatoes on puri.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Vegetable Samosa",
        "basePrice": 5,
        "description": "Crispy pastry with spiced vegetables.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Starters - Chicken",
    "items": [
      {
        "name": "Chicken Samosa",
        "basePrice": 5,
        "description": "Minced chicken in crispy pastry.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Chicken Tikka Starter",
        "basePrice": 5,
        "description": "Clay oven grilled chicken.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Chicken Tikka Chaat",
        "basePrice": 5,
        "description": "Tikka with chaat spices on puri.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Chicken Satay",
        "basePrice": 5,
        "description": "Chicken in satay sauce.",
        "publicPriceLabel": "",
        "codes": [
          "N"
        ],
        "tags": [
          "nuts"
        ],
        "modifierGroups": []
      },
      {
        "name": "Chicken Pakora",
        "basePrice": 5,
        "description": "Spiced battered chicken.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Salad Bowls",
    "description": "Choose your protein, salad options and dressing.",
    "items": [
      {
        "name": "Build Your Salad Bowl",
        "basePrice": 8,
        "description": "Choose chicken tikka, lamb tikka, mixed tikka, prawn or katsu chicken. Add lettuce, onion, tomato, peppers and cucumber with your choice of dressing.",
        "publicPriceLabel": "From £8",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 0
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 0
              },
              {
                "name": "Mixed Tikka",
                "priceAdjustment": 1
              },
              {
                "name": "Prawn",
                "priceAdjustment": 0
              },
              {
                "name": "Katsu Chicken",
                "priceAdjustment": 3
              }
            ]
          },
          {
            "name": "Salad Options",
            "selectionType": "multiple",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 5,
            "options": [
              {
                "name": "Lettuce",
                "priceAdjustment": 0
              },
              {
                "name": "Onion",
                "priceAdjustment": 0
              },
              {
                "name": "Tomato",
                "priceAdjustment": 0
              },
              {
                "name": "Peppers",
                "priceAdjustment": 0
              },
              {
                "name": "Cucumber",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Dressing",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Lemon Juice",
                "priceAdjustment": 0
              },
              {
                "name": "Mayonnaise",
                "priceAdjustment": 0
              },
              {
                "name": "Olive Oil",
                "priceAdjustment": 0
              },
              {
                "name": "Sweet Chilli",
                "priceAdjustment": 0
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Wraps",
    "description": "Served with chips, salad and your choice of naan or chapati. All wraps contain dairy (D).",
    "items": [
      {
        "name": "Chicken Tikka Wrap",
        "basePrice": 12,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Bread Choice",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Naan",
                "priceAdjustment": 0
              },
              {
                "name": "Chapati",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Sauce",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Curry Mayo",
                "priceAdjustment": 0
              },
              {
                "name": "Mint Sauce",
                "priceAdjustment": 0
              },
              {
                "name": "Sriracha",
                "priceAdjustment": 0
              },
              {
                "name": "Tamarind",
                "priceAdjustment": 0
              },
              {
                "name": "Mayonnaise",
                "priceAdjustment": 0
              },
              {
                "name": "Mango Chutney",
                "priceAdjustment": 0
              },
              {
                "name": "Algerian Sauce",
                "priceAdjustment": 0
              },
              {
                "name": "Ketchup",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Extras",
            "selectionType": "multiple",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Add Cheese",
                "priceAdjustment": 0
              }
            ]
          }
        ]
      },
      {
        "name": "Lamb Tikka Wrap",
        "basePrice": 12,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Bread Choice",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Naan",
                "priceAdjustment": 0
              },
              {
                "name": "Chapati",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Sauce",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Curry Mayo",
                "priceAdjustment": 0
              },
              {
                "name": "Mint Sauce",
                "priceAdjustment": 0
              },
              {
                "name": "Sriracha",
                "priceAdjustment": 0
              },
              {
                "name": "Tamarind",
                "priceAdjustment": 0
              },
              {
                "name": "Mayonnaise",
                "priceAdjustment": 0
              },
              {
                "name": "Mango Chutney",
                "priceAdjustment": 0
              },
              {
                "name": "Algerian Sauce",
                "priceAdjustment": 0
              },
              {
                "name": "Ketchup",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Extras",
            "selectionType": "multiple",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Add Cheese",
                "priceAdjustment": 0
              }
            ]
          }
        ]
      },
      {
        "name": "Mixed Tikka Wrap",
        "basePrice": 12,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Bread Choice",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Naan",
                "priceAdjustment": 0
              },
              {
                "name": "Chapati",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Sauce",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Curry Mayo",
                "priceAdjustment": 0
              },
              {
                "name": "Mint Sauce",
                "priceAdjustment": 0
              },
              {
                "name": "Sriracha",
                "priceAdjustment": 0
              },
              {
                "name": "Tamarind",
                "priceAdjustment": 0
              },
              {
                "name": "Mayonnaise",
                "priceAdjustment": 0
              },
              {
                "name": "Mango Chutney",
                "priceAdjustment": 0
              },
              {
                "name": "Algerian Sauce",
                "priceAdjustment": 0
              },
              {
                "name": "Ketchup",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Extras",
            "selectionType": "multiple",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Add Cheese",
                "priceAdjustment": 0
              }
            ]
          }
        ]
      },
      {
        "name": "Onion Bhaji & Veg Wrap",
        "basePrice": 10,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Bread Choice",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Naan",
                "priceAdjustment": 0
              },
              {
                "name": "Chapati",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Sauce",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Curry Mayo",
                "priceAdjustment": 0
              },
              {
                "name": "Mint Sauce",
                "priceAdjustment": 0
              },
              {
                "name": "Sriracha",
                "priceAdjustment": 0
              },
              {
                "name": "Tamarind",
                "priceAdjustment": 0
              },
              {
                "name": "Mayonnaise",
                "priceAdjustment": 0
              },
              {
                "name": "Mango Chutney",
                "priceAdjustment": 0
              },
              {
                "name": "Algerian Sauce",
                "priceAdjustment": 0
              },
              {
                "name": "Ketchup",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Extras",
            "selectionType": "multiple",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Add Cheese",
                "priceAdjustment": 0
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Jacket Potato",
    "description": "Choose butter or garlic butter, then add toppings for £2 each.",
    "items": [
      {
        "name": "Jacket Potato",
        "basePrice": 5,
        "description": "Add tuna, cheese, beans, chicken, keema, prawns or crispy onions.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Butter Style",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Butter",
                "priceAdjustment": 0
              },
              {
                "name": "Garlic Butter",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Add Toppings (£2 each)",
            "selectionType": "multiple",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 7,
            "options": [
              {
                "name": "Tuna",
                "priceAdjustment": 2
              },
              {
                "name": "Cheese",
                "priceAdjustment": 2
              },
              {
                "name": "Beans",
                "priceAdjustment": 2
              },
              {
                "name": "Chicken",
                "priceAdjustment": 2
              },
              {
                "name": "Keema",
                "priceAdjustment": 2
              },
              {
                "name": "Prawns",
                "priceAdjustment": 2
              },
              {
                "name": "Crispy Onions",
                "priceAdjustment": 2
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Curry Sauce",
    "description": "Choice of any curry sauce on the menu.",
    "items": [
      {
        "name": "Curry Sauce",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Sauce",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Korma",
                "priceAdjustment": 0
              },
              {
                "name": "Masala",
                "priceAdjustment": 0
              },
              {
                "name": "Kerala Special",
                "priceAdjustment": 0
              },
              {
                "name": "Coconut Mango Makhani",
                "priceAdjustment": 0
              },
              {
                "name": "Creamy Garlic",
                "priceAdjustment": 0
              },
              {
                "name": "Dhansak",
                "priceAdjustment": 0
              },
              {
                "name": "Apna Special",
                "priceAdjustment": 0
              },
              {
                "name": "Saagwala",
                "priceAdjustment": 0
              },
              {
                "name": "Achari",
                "priceAdjustment": 0
              },
              {
                "name": "Balti",
                "priceAdjustment": 0
              },
              {
                "name": "Bhuna",
                "priceAdjustment": 0
              },
              {
                "name": "Laknavi",
                "priceAdjustment": 0
              },
              {
                "name": "Rogan Josh",
                "priceAdjustment": 0
              },
              {
                "name": "Miller's Special",
                "priceAdjustment": 0
              },
              {
                "name": "Butter Chicken",
                "priceAdjustment": 0
              },
              {
                "name": "Madras",
                "priceAdjustment": 0
              },
              {
                "name": "Jalfrezi",
                "priceAdjustment": 0
              },
              {
                "name": "Chilli Garlic",
                "priceAdjustment": 0
              },
              {
                "name": "Shezane Murgh",
                "priceAdjustment": 0
              },
              {
                "name": "Nawabh Chettinad",
                "priceAdjustment": 0
              },
              {
                "name": "Coconut Chana",
                "priceAdjustment": 0
              },
              {
                "name": "Pathia",
                "priceAdjustment": 0
              },
              {
                "name": "Shiraz",
                "priceAdjustment": 0
              },
              {
                "name": "Naga Balti",
                "priceAdjustment": 0
              },
              {
                "name": "Naga Butter",
                "priceAdjustment": 0
              },
              {
                "name": "Masala Revenge",
                "priceAdjustment": 0
              },
              {
                "name": "Vindaloo",
                "priceAdjustment": 0
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Omelettes",
    "description": "Served with chips or salad. Choose Normal or Asian-style (+£2), then pick up to 2 fillings.",
    "items": [
      {
        "name": "Build Your Omelette",
        "basePrice": 10,
        "description": "Asian-style includes onions, coriander, light spices and optional chillies.",
        "publicPriceLabel": "From £10",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Style",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Normal",
                "priceAdjustment": 0
              },
              {
                "name": "Asian-style",
                "priceAdjustment": 2
              }
            ]
          },
          {
            "name": "Choose up to 2 Fillings",
            "selectionType": "multiple",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 2,
            "options": [
              {
                "name": "Cheese",
                "priceAdjustment": 0
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 0
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 0
              },
              {
                "name": "Spinach",
                "priceAdjustment": 0
              },
              {
                "name": "Mushrooms",
                "priceAdjustment": 0
              },
              {
                "name": "Peppers",
                "priceAdjustment": 0
              },
              {
                "name": "Onions",
                "priceAdjustment": 0
              },
              {
                "name": "Keema",
                "priceAdjustment": 0
              },
              {
                "name": "Mixed Vegetables",
                "priceAdjustment": 0
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Wings",
    "description": "6 per portion, served with chips.",
    "items": [
      {
        "name": "Lightly Spiced Wings",
        "basePrice": 11,
        "description": "Classic lightly seasoned wings.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Masala Wings",
        "basePrice": 13,
        "description": "Coated in rich masala spices.",
        "publicPriceLabel": "",
        "codes": [
          "N"
        ],
        "tags": [
          "spicy"
        ],
        "modifierGroups": []
      },
      {
        "name": "Tandoori Wings",
        "basePrice": 13,
        "description": "Marinated in traditional tandoori spices.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Curry Wings",
        "basePrice": 13,
        "description": "Finished in a flavourful curry sauce.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Naga Wings",
        "basePrice": 13,
        "description": "Extra hot naga chilli wings.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [
          "spicy"
        ],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Mumbai Sizzle Burgers",
    "description": "Served with chips. All items contain dairy (D).",
    "items": [
      {
        "name": "Simple Indian Burger",
        "basePrice": 10,
        "description": "Double smash patties with cheese and masala sauce.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "The Desi Stack",
        "basePrice": 12,
        "description": "Double patties, cheese, crushed papadom and Algerian sauce.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Naga Fire Burger",
        "basePrice": 13,
        "description": "Double patties with seekh kebab and naga chilli drizzle.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "spicy"
        ],
        "modifierGroups": []
      },
      {
        "name": "Meat Stacked Burger",
        "basePrice": 15,
        "description": "Chicken tikka, seekh kebab and 3 smash patties with curry mayo.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Bombay Veg Crush",
        "basePrice": 10,
        "description": "Onion bhaji, paneer and spinach with tamarind sauce.",
        "publicPriceLabel": "",
        "codes": [
          "V",
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Paneer Smash Double",
        "basePrice": 13,
        "description": "Double paneer with mango chutney and tamarind.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Loaded Fries",
        "basePrice": 12,
        "description": "Chicken tikka, lamb tikka, onions and peppers. Pick your spice level.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Spice Level",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Mild",
                "priceAdjustment": 0
              },
              {
                "name": "Medium",
                "priceAdjustment": 0
              },
              {
                "name": "Hot",
                "priceAdjustment": 0
              },
              {
                "name": "Very Hot",
                "priceAdjustment": 0
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Desi Crust",
    "description": "Choose Pizza (12\") for £13 or Calzone for £17. All contain dairy (D) and are served with your choice of base and any 3 toppings. Extra toppings £2 each.",
    "items": [
      {
        "name": "Build Your Desi Crust",
        "basePrice": 13,
        "description": "Choose Balti, Bhuna, Masala (N), Tomato, Naga or Madras as your base.",
        "publicPriceLabel": "From £13",
        "codes": [
          "D"
        ],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Style",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Pizza (12\")",
                "priceAdjustment": 0
              },
              {
                "name": "Calzone",
                "priceAdjustment": 4
              }
            ]
          },
          {
            "name": "Base",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Balti",
                "priceAdjustment": 0
              },
              {
                "name": "Bhuna",
                "priceAdjustment": 0
              },
              {
                "name": "Masala",
                "priceAdjustment": 0
              },
              {
                "name": "Tomato",
                "priceAdjustment": 0
              },
              {
                "name": "Naga",
                "priceAdjustment": 0
              },
              {
                "name": "Madras",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Choose up to 3 Toppings",
            "selectionType": "multiple",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 3,
            "options": [
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 0
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 0
              },
              {
                "name": "Seekh Kebab",
                "priceAdjustment": 0
              },
              {
                "name": "Onions",
                "priceAdjustment": 0
              },
              {
                "name": "Mixed Vegetables",
                "priceAdjustment": 0
              },
              {
                "name": "Tuna",
                "priceAdjustment": 0
              },
              {
                "name": "Prawns",
                "priceAdjustment": 0
              },
              {
                "name": "Keema",
                "priceAdjustment": 0
              },
              {
                "name": "Pepperoni",
                "priceAdjustment": 0
              },
              {
                "name": "Sweet Corn",
                "priceAdjustment": 0
              },
              {
                "name": "Pineapple",
                "priceAdjustment": 0
              },
              {
                "name": "Olives",
                "priceAdjustment": 0
              },
              {
                "name": "Peppers",
                "priceAdjustment": 0
              }
            ]
          },
          {
            "name": "Extra Toppings (£2 each)",
            "selectionType": "multiple",
            "isRequired": false,
            "isTextInput": false,
            "maxSelections": 13,
            "options": [
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 2
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 2
              },
              {
                "name": "Seekh Kebab",
                "priceAdjustment": 2
              },
              {
                "name": "Onions",
                "priceAdjustment": 2
              },
              {
                "name": "Mixed Vegetables",
                "priceAdjustment": 2
              },
              {
                "name": "Tuna",
                "priceAdjustment": 2
              },
              {
                "name": "Prawns",
                "priceAdjustment": 2
              },
              {
                "name": "Keema",
                "priceAdjustment": 2
              },
              {
                "name": "Pepperoni",
                "priceAdjustment": 2
              },
              {
                "name": "Sweet Corn",
                "priceAdjustment": 2
              },
              {
                "name": "Pineapple",
                "priceAdjustment": 2
              },
              {
                "name": "Olives",
                "priceAdjustment": 2
              },
              {
                "name": "Peppers",
                "priceAdjustment": 2
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Tandoori",
    "description": "All tandoori dishes contain dairy (D) and are served with salad and vegetable curry sauce.",
    "items": [
      {
        "name": "Lamb Chops",
        "basePrice": 15,
        "description": "Tender lamb chops grilled in the tandoor.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Chicken Shashlik",
        "basePrice": 15,
        "description": "Chicken with peppers and onions.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Lamb Shashlik",
        "basePrice": 15,
        "description": "Marinated lamb with peppers and onions.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Tandoori King Prawns",
        "basePrice": 20,
        "description": "King prawns flame-cooked with spices.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Mixed Grill",
        "basePrice": 25,
        "description": "Chicken, lamb, wings, chops, seekh kebab and king prawn.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Monkfish Shashlik",
        "basePrice": 22,
        "description": "Grilled monkfish with peppers and onions.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Paneer Shashlik",
        "basePrice": 13,
        "description": "Paneer with vegetables and tandoori spices.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Biryani",
    "description": "Traditional basmati rice dish cooked with spices and layered with your choice of meat or vegetables. Upgrade any option to Parda Biryani for +£5, wrapped in garlic naan with cheese and special sauce.",
    "items": [
      {
        "name": "Beef Biryani",
        "basePrice": 13,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Upgrade",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Standard Biryani",
                "priceAdjustment": 0
              },
              {
                "name": "Parda Biryani Upgrade",
                "priceAdjustment": 5
              }
            ]
          }
        ]
      },
      {
        "name": "Lamb Biryani",
        "basePrice": 13,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Upgrade",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Standard Biryani",
                "priceAdjustment": 0
              },
              {
                "name": "Parda Biryani Upgrade",
                "priceAdjustment": 5
              }
            ]
          }
        ]
      },
      {
        "name": "Chicken Biryani",
        "basePrice": 13,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Upgrade",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Standard Biryani",
                "priceAdjustment": 0
              },
              {
                "name": "Parda Biryani Upgrade",
                "priceAdjustment": 5
              }
            ]
          }
        ]
      },
      {
        "name": "Prawn Biryani",
        "basePrice": 13,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Upgrade",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Standard Biryani",
                "priceAdjustment": 0
              },
              {
                "name": "Parda Biryani Upgrade",
                "priceAdjustment": 5
              }
            ]
          }
        ]
      },
      {
        "name": "Chicken Tikka Biryani",
        "basePrice": 15,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Upgrade",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Standard Biryani",
                "priceAdjustment": 0
              },
              {
                "name": "Parda Biryani Upgrade",
                "priceAdjustment": 5
              }
            ]
          }
        ]
      },
      {
        "name": "Lamb Tikka Biryani",
        "basePrice": 15,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Upgrade",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Standard Biryani",
                "priceAdjustment": 0
              },
              {
                "name": "Parda Biryani Upgrade",
                "priceAdjustment": 5
              }
            ]
          }
        ]
      },
      {
        "name": "King Prawn Biryani",
        "basePrice": 18,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Upgrade",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Standard Biryani",
                "priceAdjustment": 0
              },
              {
                "name": "Parda Biryani Upgrade",
                "priceAdjustment": 5
              }
            ]
          }
        ]
      },
      {
        "name": "Vegetable Biryani",
        "basePrice": 10,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Upgrade",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Standard Biryani",
                "priceAdjustment": 0
              },
              {
                "name": "Parda Biryani Upgrade",
                "priceAdjustment": 5
              }
            ]
          }
        ]
      },
      {
        "name": "Miller's Biryani",
        "basePrice": 18,
        "description": "Chicken tikka, lamb tikka and king prawn.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": [
          {
            "name": "Upgrade",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Standard Biryani",
                "priceAdjustment": 0
              },
              {
                "name": "Parda Biryani Upgrade",
                "priceAdjustment": 5
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Vegetarian Mains",
    "items": [
      {
        "name": "Chana Bahar",
        "basePrice": 10,
        "description": "Chickpeas and okra in a medium sauce.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Tinda Chomotkar",
        "basePrice": 10,
        "description": "Pumpkin, potatoes and tomato curry.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Palak Paneer",
        "basePrice": 10,
        "description": "Spinach and paneer cooked with spices.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Aloo Mattar",
        "basePrice": 10,
        "description": "Potatoes and green peas in curry sauce.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Dhingri Masala",
        "basePrice": 10,
        "description": "Mushrooms with garlic, tomato and chillies.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Mild Curries",
    "description": "Choose your protein: Chicken £5, Lamb £5, Beef £5, Keema £5, Prawn £5, King Prawn £10, Chicken Tikka £6 (D), Lamb Tikka £7 (D), Pulled Chicken £6, Pulled Lamb £6, Vegetables £4, Monkfish £13, Sea Bass £10.",
    "items": [
      {
        "name": "Korma",
        "basePrice": 5,
        "description": "Rich, creamy and very mild.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Masala",
        "basePrice": 7,
        "description": "Smooth tomato-based curry with cream.",
        "publicPriceLabel": "",
        "codes": [
          "D",
          "N"
        ],
        "tags": [
          "vegetarian",
          "nuts"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Kerala Special",
        "basePrice": 7,
        "description": "Garlic, onions and peppers with melted cheese, with a separate masala sauce.",
        "publicPriceLabel": "",
        "codes": [
          "D",
          "N"
        ],
        "tags": [
          "vegetarian",
          "nuts"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Coconut Mango Makhani",
        "basePrice": 7,
        "description": "Creamy coconut curry with sweet mango.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Creamy Garlic",
        "basePrice": 7,
        "description": "Creamy garlic with a hint of sweetness.",
        "publicPriceLabel": "",
        "codes": [
          "N"
        ],
        "tags": [
          "nuts"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Dhansak",
        "basePrice": 6,
        "description": "Sweet and tangy lentil curry.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Medium Curries",
    "description": "Choose your protein: Chicken £5, Lamb £5, Beef £5, Keema £5, Prawn £5, King Prawn £10, Chicken Tikka £6 (D), Lamb Tikka £7 (D), Pulled Chicken £6, Pulled Lamb £6, Vegetables £4, Monkfish £13, Sea Bass £10.",
    "items": [
      {
        "name": "Apna Special",
        "basePrice": 7,
        "description": "Home-style curry with ginger and garlic.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Saagwala",
        "basePrice": 6,
        "description": "Spinach curry with garlic.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Achari",
        "basePrice": 7,
        "description": "Tangy curry with pickled spices.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Balti",
        "basePrice": 6,
        "description": "Classic curry with onions and peppers.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Bhuna",
        "basePrice": 5,
        "description": "Thick curry with slow-cooked onions.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Laknavi",
        "basePrice": 7,
        "description": "Sweet chilli curry with onions and peppers.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Rogan Josh",
        "basePrice": 5,
        "description": "Traditional tomato-based curry.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Miller's Special",
        "basePrice": 8,
        "description": "Creamy sweet chilli curry with heat.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Butter Chicken",
        "basePrice": 7,
        "description": "Rich, creamy and full of flavour.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Hot Curries",
    "description": "Choose your protein: Chicken £5, Lamb £5, Beef £5, Keema £5, Prawn £5, King Prawn £10, Chicken Tikka £6 (D), Lamb Tikka £7 (D), Pulled Chicken £6, Pulled Lamb £6, Vegetables £4, Monkfish £13, Sea Bass £10.",
    "items": [
      {
        "name": "Madras",
        "basePrice": 5,
        "description": "Classic hot curry.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Jalfrezi",
        "basePrice": 5,
        "description": "Cooked with fresh chillies, peppers and onions.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Chilli Garlic",
        "basePrice": 7,
        "description": "Spicy garlic curry with fresh chillies.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Shezane Murgh",
        "basePrice": 7,
        "description": "Sweet mango and tomato with heat.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Nawabh Chettinad",
        "basePrice": 7,
        "description": "Complex South Indian curry with bold spices.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Coconut Chana",
        "basePrice": 7,
        "description": "Chickpeas with coconut and chillies.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Pathia",
        "basePrice": 5,
        "description": "Hot, sweet and slightly sour curry.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Very Hot Curries",
    "description": "Choose your protein: Chicken £5, Lamb £5, Beef £5, Keema £5, Prawn £5, King Prawn £10, Chicken Tikka £6 (D), Lamb Tikka £7 (D), Pulled Chicken £6, Pulled Lamb £6, Vegetables £4, Monkfish £13, Sea Bass £10.",
    "items": [
      {
        "name": "Shiraz",
        "basePrice": 7,
        "description": "Fresh chillies, garlic and coriander.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Naga Balti",
        "basePrice": 7,
        "description": "Very hot curry with naga pickle.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Naga Butter",
        "basePrice": 7,
        "description": "Creamy butter curry with intense heat.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "spicy",
          "vegetarian"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Masala Revenge",
        "basePrice": 7,
        "description": "Triple chilli masala curry.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      },
      {
        "name": "Vindaloo",
        "basePrice": 5,
        "description": "Very hot curry with potatoes.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "spicy",
          "vegan"
        ],
        "modifierGroups": [
          {
            "name": "Protein",
            "selectionType": "single",
            "isRequired": true,
            "isTextInput": false,
            "maxSelections": 1,
            "options": [
              {
                "name": "Chicken",
                "priceAdjustment": 5
              },
              {
                "name": "Lamb",
                "priceAdjustment": 5
              },
              {
                "name": "Beef",
                "priceAdjustment": 5
              },
              {
                "name": "Keema",
                "priceAdjustment": 5
              },
              {
                "name": "Prawn",
                "priceAdjustment": 5
              },
              {
                "name": "King Prawn",
                "priceAdjustment": 10
              },
              {
                "name": "Chicken Tikka",
                "priceAdjustment": 6
              },
              {
                "name": "Lamb Tikka",
                "priceAdjustment": 7
              },
              {
                "name": "Pulled Chicken",
                "priceAdjustment": 6
              },
              {
                "name": "Pulled Lamb",
                "priceAdjustment": 6
              },
              {
                "name": "Vegetables",
                "priceAdjustment": 4
              },
              {
                "name": "Monkfish",
                "priceAdjustment": 13
              },
              {
                "name": "Sea Bass",
                "priceAdjustment": 10
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "name": "Rice",
    "description": "Flavoured rice options are £4 unless priced separately.",
    "items": [
      {
        "name": "Boiled Rice",
        "basePrice": 3,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Pilau Rice",
        "basePrice": 3.5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Coconut Rice",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Pineapple Rice",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Vegetable Rice",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Garlic Rice",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Onion Rice",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Lemon Rice",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Egg Rice",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Mushroom Rice",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Keema Rice",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Spinach Rice",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Onion Bhaji Rice",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Bread & Snacks",
    "description": "All naans contain dairy.",
    "items": [
      {
        "name": "Plain Naan",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Garlic Naan",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Garlic & Cheese Naan",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Peshwari Naan",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Cheese Naan",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Keema Naan",
        "basePrice": 4,
        "description": "",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Chapati",
        "basePrice": 2,
        "description": "Thin wholemeal flatbread.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Paratha",
        "basePrice": 4,
        "description": "Layered pan-fried flatbread.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      }
    ]
  },
  {
    "name": "Side Dishes",
    "items": [
      {
        "name": "Chana Masala",
        "basePrice": 4,
        "description": "Chickpeas in light spices.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Bombay Potato",
        "basePrice": 4,
        "description": "Spicy potatoes with seasoning.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Bhindi Bhaji",
        "basePrice": 4,
        "description": "Okra cooked with spices.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Saag Bhaji",
        "basePrice": 4,
        "description": "Spinach side dish.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Tarka Daal",
        "basePrice": 4,
        "description": "Lentils cooked with garlic.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Tinda Bhaji",
        "basePrice": 4,
        "description": "Spiced baby pumpkins.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Saag Aloo",
        "basePrice": 4,
        "description": "Spinach with potatoes.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Cauliflower Bhaji",
        "basePrice": 4,
        "description": "Cauliflower cooked in spices.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Mushroom Bhaji",
        "basePrice": 4,
        "description": "Mushrooms cooked in spices.",
        "publicPriceLabel": "",
        "codes": [
          "VG"
        ],
        "tags": [
          "vegan"
        ],
        "modifierGroups": []
      },
      {
        "name": "Saag Paneer",
        "basePrice": 4,
        "description": "Spinach and paneer in a creamy sauce.",
        "publicPriceLabel": "",
        "codes": [
          "D"
        ],
        "tags": [
          "vegetarian"
        ],
        "modifierGroups": []
      },
      {
        "name": "Chips",
        "basePrice": 3,
        "description": "Can add chip spice.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Cheesy Chips",
        "basePrice": 5,
        "description": "",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [],
        "modifierGroups": []
      },
      {
        "name": "Masala Chips",
        "basePrice": 5,
        "description": "Chips tossed in masala sauce.",
        "publicPriceLabel": "",
        "codes": [],
        "tags": [
          "spicy"
        ],
        "modifierGroups": []
      }
    ]
  }
];

remediateMenuCatalog(MILLERS_ORDER_MENU);

if (typeof window !== "undefined") {
  window.MILLERS_ORDER_MENU = MILLERS_ORDER_MENU;
}
