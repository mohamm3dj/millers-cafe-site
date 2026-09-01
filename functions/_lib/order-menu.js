"use strict";

import {
  MILLERS_ORDER_MENU,
  normalizeMenuItemAllergenCodes
} from "../../orders/menu-catalog.js";

const MAX_ITEM_QUANTITY = 20;
const COLLECTION_DISCOUNT_PERCENT = 10;
const GBP_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const HIDDEN_ORDER_CATEGORY_KEYS = new Set([
  "beer",
  "wine by glass",
  "spirits",
  "red wine bottles",
  "white wine bottles",
  "white win bottles",
  "rose wine bottles",
  "rose wine bottle",
  "champagne and sparkling",
  "champagne and sparking"
]);

let cachedDefaultOrderMenuItemMap = null;

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeKey(value) {
  const cleaned = normalizeText(value).toLowerCase().replace(/&/g, " and ");
  let normalized = cleaned;
  try {
    normalized = cleaned.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (error) {
    normalized = cleaned;
  }
  return normalized.replace(/[^a-z0-9]+/g, " ").trim();
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatGBP(value) {
  return GBP_FORMATTER.format(Number(value || 0));
}

function toMinorUnits(value) {
  return Math.round(roundMoney(value) * 100);
}

function fromMinorUnits(value) {
  return roundMoney(Number(value || 0) / 100);
}

function collectionDiscountMinorForSubtotalMinor(orderType, subtotalMinor) {
  return orderType === "collection"
    ? Math.round(
      (Math.max(0, Number(subtotalMinor || 0)) * COLLECTION_DISCOUNT_PERCENT) / 100
    )
    : 0;
}

function normalizedOrderType(value) {
  return String(value || "").trim().toLowerCase() === "delivery" ? "delivery" : "collection";
}

function normalizeModifierGroup(rawGroup) {
  const groupName = normalizeText(rawGroup?.name);
  if (!groupName) return null;
  const groupId = normalizeText(rawGroup?.id || rawGroup?.posModifierGroupId || rawGroup?.groupId);

  const selectionType = normalizeText(rawGroup?.selectionType).toLowerCase() === "multiple"
    ? "multiple"
    : "single";

  const options = Array.isArray(rawGroup?.options)
    ? rawGroup.options
      .map((rawOption) => {
        const optionName = normalizeText(rawOption?.name);
        const priceAdjustment = Number(rawOption?.priceAdjustment || 0);
        if (!optionName || !Number.isFinite(priceAdjustment)) return null;
        const optionId = normalizeText(rawOption?.id || rawOption?.posModifierOptionId || rawOption?.optionId);
        const normalized = {
          key: normalizeKey(optionName),
          name: optionName,
          priceAdjustment: roundMoney(priceAdjustment),
          allergenCodes: normalizeMenuItemAllergenCodes({ codes: rawOption?.allergenCodes }),
          removesAllergenCodes: normalizeMenuItemAllergenCodes({ codes: rawOption?.removesAllergenCodes })
        };
        if (optionId) {
          normalized.id = optionId;
          normalized.posModifierOptionId = normalizeText(rawOption?.posModifierOptionId || optionId);
        }
        return normalized;
      })
      .filter(Boolean)
    : [];

  const maxSelectionsRaw = Number(rawGroup?.maxSelections);
  const maxSelections = selectionType === "multiple"
    ? (Number.isInteger(maxSelectionsRaw) && maxSelectionsRaw > 0 ? maxSelectionsRaw : Math.max(1, options.length))
    : 1;

  const normalized = {
    key: normalizeKey(groupName),
    name: groupName,
    selectionType,
    isRequired: Boolean(rawGroup?.isRequired),
    isTextInput: Boolean(rawGroup?.isTextInput),
    maxSelections,
    options
  };
  if (groupId) {
    normalized.id = groupId;
    normalized.posModifierGroupId = normalizeText(rawGroup?.posModifierGroupId || groupId);
  }
  return normalized;
}

function buildOrderMenuItemMap(menuCatalog = MILLERS_ORDER_MENU) {
  if (menuCatalog === MILLERS_ORDER_MENU && cachedDefaultOrderMenuItemMap) {
    return cachedDefaultOrderMenuItemMap;
  }

  const map = new Map();
  const categories = Array.isArray(menuCatalog) ? menuCatalog : [];

  categories.forEach((category) => {
    const categoryKey = normalizeKey(category?.name);
    if (!categoryKey || HIDDEN_ORDER_CATEGORY_KEYS.has(categoryKey)) return;
    if (!Array.isArray(category?.items)) return;

    category.items.forEach((rawItem) => {
      const itemName = normalizeText(rawItem?.name);
      const itemKey = normalizeKey(itemName);
      const basePrice = Number(rawItem?.basePrice);
      if (!itemName || !itemKey || !Number.isFinite(basePrice) || basePrice < 0) return;

      const modifierGroups = Array.isArray(rawItem?.modifierGroups)
        ? rawItem.modifierGroups.map(normalizeModifierGroup).filter(Boolean)
        : [];
      const itemId = normalizeText(rawItem?.id || rawItem?.posItemId || rawItem?.itemId);
      const posItemId = normalizeText(rawItem?.posItemId || itemId);
      const posCategoryId = normalizeText(rawItem?.posCategoryId || category?.posCategoryId || category?.id);

      const normalizedItem = {
        key: itemKey,
        id: itemId,
        posItemId,
        posCategoryId,
        categoryName: normalizeText(category?.name),
        printRouting: normalizeText(rawItem?.printRouting),
        menuVersion: normalizeText(rawItem?.menuVersion),
        name: itemName,
        basePrice: roundMoney(basePrice),
        discountEligible: rawItem?.discountEligible !== false,
        modifierGroups
      };

      map.set(itemKey, normalizedItem);
      [itemId, posItemId].filter(Boolean).forEach((id) => {
        map.set(`id:${id}`, normalizedItem);
      });
    });
  });

  if (menuCatalog === MILLERS_ORDER_MENU) {
    cachedDefaultOrderMenuItemMap = map;
  }
  return map;
}

export function getOrderMenuItemByName(itemName, menuCatalog = MILLERS_ORDER_MENU) {
  const itemKey = normalizeKey(itemName);
  if (!itemKey) return null;
  return buildOrderMenuItemMap(menuCatalog).get(itemKey) || null;
}

export function getOrderMenuItem(rawItem, menuCatalog = MILLERS_ORDER_MENU) {
  const map = buildOrderMenuItemMap(menuCatalog);
  const itemId = normalizeText(rawItem?.posItemId || rawItem?.itemId || rawItem?.menuItemId || rawItem?.id);
  if (itemId) {
    const match = map.get(`id:${itemId}`);
    if (match) return match;
  }
  return getOrderMenuItemByName(rawItem?.itemName || rawItem?.name, menuCatalog);
}

function modifierSummary(selection) {
  const base = `${selection.groupName}: ${selection.optionName}`;
  const adjustment = Number(selection.priceAdjustment || 0);
  if (selection.isTextInput || adjustment === 0) return base;

  const sign = adjustment > 0 ? "+" : "-";
  return `${base} (${sign}${formatGBP(Math.abs(adjustment))})`;
}

function cartLineSummary(item) {
  const quantityText = `${item.quantity}x`;
  const modifierText = (item.modifierSelections || [])
    .map(modifierSummary)
    .filter(Boolean)
    .join(" | ");
  const base = modifierText ? `${quantityText} ${item.itemName} [${modifierText}]` : `${quantityText} ${item.itemName}`;
  return `${base} = ${formatGBP(item.linePrice)}`;
}

function normalizeModifierSelections(rawSelections, menuItem) {
  if (!Array.isArray(rawSelections) || rawSelections.length === 0) {
    const missingRequired = menuItem.modifierGroups.find((group) => group.isRequired);
    if (missingRequired) {
      return { ok: false, error: `A selection is required for ${menuItem.name} (${missingRequired.name}).` };
    }
    return { ok: true, selections: [] };
  }

  const groupsByKey = new Map();
  menuItem.modifierGroups.forEach((group) => {
    groupsByKey.set(group.key, group);
    [group.id, group.posModifierGroupId].filter(Boolean).forEach((id) => {
      groupsByKey.set(`id:${id}`, group);
    });
  });
  const countsByGroup = new Map();
  const normalizedSelections = [];

  for (const rawSelection of rawSelections) {
    const rawGroupId = normalizeText(rawSelection?.posModifierGroupId || rawSelection?.groupId);
    const groupKey = rawGroupId ? `id:${rawGroupId}` : normalizeKey(rawSelection?.groupName);
    if (!groupKey || !groupsByKey.has(groupKey)) {
      return { ok: false, error: `An invalid modifier was provided for ${menuItem.name}.` };
    }

    const group = groupsByKey.get(groupKey);
    const nextCount = (countsByGroup.get(group.key) || 0) + 1;
    countsByGroup.set(group.key, nextCount);

    if (nextCount > group.maxSelections) {
      return { ok: false, error: `Too many selections were provided for ${menuItem.name} (${group.name}).` };
    }

    if (group.isTextInput) {
      const optionName = normalizeText(rawSelection?.optionName || rawSelection?.value);
      if (!optionName) {
        return { ok: false, error: `A text selection is required for ${menuItem.name} (${group.name}).` };
      }

      normalizedSelections.push({
        posModifierGroupId: group.posModifierGroupId || group.id || "",
        posModifierOptionId: "",
        groupName: group.name,
        optionName,
        priceAdjustment: 0,
        isTextInput: true
      });
      continue;
    }

    const rawOptionId = normalizeText(rawSelection?.posModifierOptionId || rawSelection?.optionId);
    const optionKey = rawOptionId ? `id:${rawOptionId}` : normalizeKey(rawSelection?.optionName);
    const option = group.options.find((entry) =>
      rawOptionId
        ? entry.id === rawOptionId || entry.posModifierOptionId === rawOptionId
        : entry.key === optionKey
    );
    if (!option) {
      return { ok: false, error: `An invalid option was provided for ${menuItem.name} (${group.name}).` };
    }

    normalizedSelections.push({
      posModifierGroupId: group.posModifierGroupId || group.id || "",
      posModifierOptionId: option.posModifierOptionId || option.id || "",
      groupName: group.name,
      optionName: option.name,
      priceAdjustment: option.priceAdjustment,
      allergenCodes: option.allergenCodes.slice(),
      removesAllergenCodes: option.removesAllergenCodes.slice(),
      isTextInput: false
    });
  }

  const missingRequired = menuItem.modifierGroups.find((group) => group.isRequired && !countsByGroup.has(group.key));
  if (missingRequired) {
    return { ok: false, error: `A selection is required for ${menuItem.name} (${missingRequired.name}).` };
  }

  return { ok: true, selections: normalizedSelections };
}

export function resolveDeliveryFeeGBP(env, configuredFeeGBP = null) {
  const explicit = Number(configuredFeeGBP);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return roundMoney(explicit);
  }

  const configured = Number(env?.ORDER_DELIVERY_FEE_GBP);
  if (Number.isFinite(configured) && configured >= 0) {
    return roundMoney(configured);
  }
  return 2;
}

export function priceOrderCart(rawCartItems, options = {}) {
  const orderType = normalizedOrderType(options.orderType);
  const menuCatalog = Array.isArray(options.menuCatalog) ? options.menuCatalog : MILLERS_ORDER_MENU;
  const deliveryFeeGBP = orderType === "delivery"
    ? roundMoney(Math.max(0, Number(options.deliveryFeeGBP || 0)))
    : 0;

  if (!Array.isArray(rawCartItems) || rawCartItems.length === 0) {
    return { ok: false, error: "Please add at least one menu item." };
  }

  const pricedItems = [];

  for (const rawItem of rawCartItems) {
    const menuItem = getOrderMenuItem(rawItem, menuCatalog);
    if (!menuItem) {
      return { ok: false, error: `Menu item is unavailable: ${normalizeText(rawItem?.itemName || rawItem?.name) || "Unknown item"}.` };
    }

    const quantity = Number(rawItem?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
      return { ok: false, error: `Invalid quantity for ${menuItem.name}.` };
    }

    const selectionCheck = normalizeModifierSelections(rawItem?.modifierSelections, menuItem);
    if (!selectionCheck.ok) {
      return selectionCheck;
    }

    const modifierTotal = selectionCheck.selections
      .reduce((sum, selection) => sum + Number(selection.priceAdjustment || 0), 0);

    const unitPrice = roundMoney(menuItem.basePrice + modifierTotal);
    const linePrice = roundMoney(unitPrice * quantity);
    const stripeDescription = selectionCheck.selections.length > 0
      ? selectionCheck.selections.map(modifierSummary).join(" | ")
      : "";

    pricedItems.push({
      posItemId: menuItem.posItemId || menuItem.id || "",
      itemId: menuItem.id || menuItem.posItemId || "",
      posCategoryId: menuItem.posCategoryId || "",
      categoryName: menuItem.categoryName || "",
      printRouting: menuItem.printRouting || "",
      menuVersion: menuItem.menuVersion || "",
      itemName: menuItem.name,
      quantity,
      basePrice: menuItem.basePrice,
      discountEligible: menuItem.discountEligible !== false,
      modifierSelections: selectionCheck.selections,
      unitPrice,
      linePrice,
      stripeName: menuItem.name,
      stripeDescription
    });
  }

  const subtotalMinor = pricedItems.reduce((sum, item) => sum + toMinorUnits(item.linePrice), 0);
  const discountEligibleSubtotalMinor = pricedItems.reduce(
    (sum, item) => item.discountEligible ? sum + toMinorUnits(item.linePrice) : sum,
    0
  );
  const collectionDiscountMinor = collectionDiscountMinorForSubtotalMinor(
    orderType,
    discountEligibleSubtotalMinor
  );
  const deliveryFeeMinor = toMinorUnits(deliveryFeeGBP);
  const totalMinor = Math.max(0, subtotalMinor - collectionDiscountMinor + deliveryFeeMinor);
  const subtotal = fromMinorUnits(subtotalMinor);
  const collectionDiscount = fromMinorUnits(collectionDiscountMinor);
  const total = fromMinorUnits(totalMinor);

  if (collectionDiscountMinor > 0) {
    const eligibleAllocations = pricedItems
      .map((item, index) => {
        if (!item.discountEligible) return null;
        const lineMinor = toMinorUnits(item.linePrice);
        const scaledDiscount = lineMinor * COLLECTION_DISCOUNT_PERCENT;
        const discountMinor = Math.floor(scaledDiscount / 100);
        return {
          index,
          lineMinor,
          discountMinor,
          remainder: scaledDiscount % 100
        };
      })
      .filter(Boolean);
    const rankedAllocations = eligibleAllocations.slice().sort((left, right) =>
      right.remainder - left.remainder || left.index - right.index
    );
    let unallocatedDiscountMinor = collectionDiscountMinor - eligibleAllocations.reduce(
      (sum, allocation) => sum + allocation.discountMinor,
      0
    );

    for (let index = 0; unallocatedDiscountMinor > 0; index += 1) {
      rankedAllocations[index % rankedAllocations.length].discountMinor += 1;
      unallocatedDiscountMinor -= 1;
    }

    const allocationByIndex = new Map(
      eligibleAllocations.map((allocation) => [allocation.index, allocation])
    );

    pricedItems.forEach((item, index) => {
      if (!item.discountEligible) {
        item.checkoutQuantity = item.quantity;
        item.checkoutUnitAmountMinor = toMinorUnits(item.unitPrice);
        return;
      }

      const allocation = allocationByIndex.get(index);
      const discountedLineMinor = Math.max(0, allocation.lineMinor - allocation.discountMinor);
      item.checkoutQuantity = 1;
      item.checkoutUnitAmountMinor = discountedLineMinor;
      item.stripeName = item.quantity > 1 ? `${item.quantity}x ${item.itemName}` : item.itemName;
      if (allocation.discountMinor > 0) {
        item.stripeDescription = [
          item.stripeDescription,
          "10% collection discount applied"
        ].filter(Boolean).join(" | ");
      }
    });
  } else {
    pricedItems.forEach((item) => {
      item.checkoutQuantity = item.quantity;
      item.checkoutUnitAmountMinor = toMinorUnits(item.unitPrice);
    });
  }

  const lines = pricedItems.map(cartLineSummary);

  if (collectionDiscount > 0) {
    lines.push(`Subtotal = ${formatGBP(subtotal)}`);
    lines.push(`Collection discount (10%) = -${formatGBP(collectionDiscount)}`);
  }
  if (deliveryFeeGBP > 0) {
    lines.push(`Delivery fee = ${formatGBP(deliveryFeeGBP)}`);
  }
  lines.push(`Total = ${formatGBP(total)}`);

  return {
    ok: true,
    orderType,
    items: pricedItems,
    itemsSummary: lines.join("\n"),
    subtotal,
    subtotalMinor,
    collectionDiscount,
    collectionDiscountMinor,
    deliveryFee: deliveryFeeGBP,
    deliveryFeeMinor,
    total,
    totalMinor,
    totalQuantity: pricedItems.reduce((sum, item) => sum + item.quantity, 0),
    currency: "gbp"
  };
}
