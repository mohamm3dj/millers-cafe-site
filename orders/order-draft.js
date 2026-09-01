"use strict";

import { normalizeMenuItemAllergenCodes } from "./menu-catalog.js";
import { createEmptyOrderDraftState } from "./order-draft-state.js?v=20260901b";

export { createEmptyOrderDraftState };

const DEFAULT_MAX_ITEM_QUANTITY = 20;
const DEFAULT_ORDER_DRAFT_VERSION = 3;
const DEFAULT_ASAP_VALUE = "ASAP";

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

function toMinorUnits(value) {
  return Math.round(roundMoney(value) * 100);
}

function fromMinorUnits(value) {
  return roundMoney(Number(value || 0) / 100);
}

export function calculateOrderPricing(cartItems, options = {}) {
  const orderType = String(options.orderType || "collection").trim().toLowerCase() === "delivery"
    ? "delivery"
    : "collection";
  const collectionDiscountRate = Math.max(0, Math.min(1, Number(options.collectionDiscountRate ?? 0.10)));
  const normalizedCartItems = Array.isArray(cartItems) ? cartItems : [];
  const subtotalMinor = normalizedCartItems.reduce(
    (sum, item) => sum + toMinorUnits(item?.linePrice),
    0
  );
  const discountEligibleSubtotalMinor = normalizedCartItems.reduce(
    (sum, item) => (
      item?.discountEligible === false ? sum : sum + toMinorUnits(item?.linePrice)
    ),
    0
  );
  const totalQuantity = normalizedCartItems
    .reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0)), 0);
  const collectionDiscountMinor = orderType === "collection"
    ? Math.round(discountEligibleSubtotalMinor * collectionDiscountRate)
    : 0;
  const deliveryFeeMinor = orderType === "delivery" && totalQuantity > 0
    ? toMinorUnits(Math.max(0, Number(options.deliveryFeeGBP || 0)))
    : 0;
  const totalMinor = Math.max(0, subtotalMinor - collectionDiscountMinor + deliveryFeeMinor);

  return {
    subtotal: fromMinorUnits(subtotalMinor),
    collectionDiscount: fromMinorUnits(collectionDiscountMinor),
    deliveryFee: fromMinorUnits(deliveryFeeMinor),
    total: fromMinorUnits(totalMinor),
    totalQuantity
  };
}

export function canAdvanceToCheckoutDetails(totalQuantity, isSubmitting = false) {
  return !isSubmitting && Number(totalQuantity || 0) > 0;
}

export function cartQuantityActionLabel(action, itemName, quantity) {
  const name = normalizeText(itemName) || "item";
  const count = Math.max(1, Math.round(Number(quantity || 1)));
  if (action === "increase") return `Increase ${name} quantity. Currently ${count}.`;
  if (action === "decrease") return `Decrease ${name} quantity. Currently ${count}.`;
  if (action === "remove") return `Remove ${name} from basket.`;
  return `${name} basket action.`;
}

export function scrollBehaviorForPreference(prefersReducedMotion) {
  return prefersReducedMotion ? "auto" : "smooth";
}

function cartLineTotals(basePrice, selections, quantity) {
  const modifierTotal = (selections || []).reduce((sum, entry) => sum + Number(entry.priceAdjustment || 0), 0);
  const unitPrice = roundMoney(basePrice + modifierTotal);
  const linePrice = roundMoney(unitPrice * quantity);
  return { unitPrice, linePrice };
}

function cartLineSignature(itemKey, modifierSelections) {
  const modKey = (modifierSelections || [])
    .map((entry) => `${entry.posModifierGroupId || entry.groupName}::${entry.posModifierOptionId || entry.optionName}::${Number(entry.priceAdjustment || 0).toFixed(2)}::${entry.isTextInput ? 1 : 0}`)
    .sort()
    .join("||");
  return `${String(itemKey || "").trim() || "item"}__${modKey}`;
}

export function createEmptyOrderDraftMeta() {
  return {
    hadChanges: false,
    sourceLineCount: 0,
    restoredLineCount: 0,
    removedItems: 0,
    updatedItems: 0,
    mergedLines: 0
  };
}

function normalizeStoredSchedule(raw, asapValue) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.date || ""))
    ? String(raw.date)
    : "";
  const time = String(raw?.time || "").trim().toUpperCase();

  return {
    date,
    time: time === asapValue || /^\d{2}:\d{2}$/.test(time) ? time : ""
  };
}

function buildMenuLookup(normalizedMenu) {
  const byId = new Map();
  const byName = new Map();

  if (!Array.isArray(normalizedMenu)) {
    return { byId, byName };
  }

  normalizedMenu.forEach((category) => {
    if (!Array.isArray(category?.items)) return;
    category.items.forEach((item) => {
      const itemId = normalizeText(item?.id || item?.posItemId || item?.itemId);
      const posItemId = normalizeText(item?.posItemId || itemId);
      const itemName = normalizeText(item?.name);
      const itemKey = normalizeKey(itemName);
      if (itemId) byId.set(itemId, item);
      if (posItemId) byId.set(posItemId, item);
      if (itemKey) byName.set(itemKey, item);
    });
  });

  return { byId, byName };
}

function buildGroupLookup(modifierGroups) {
  const groupsByKey = new Map();

  (modifierGroups || []).forEach((group) => {
    const groupKey = normalizeKey(group?.name);
    const groupId = normalizeText(group?.id || group?.posModifierGroupId || group?.groupId);
    if (!groupKey && !groupId) return;

    const optionsByKey = new Map();
    (group.options || []).forEach((option) => {
      const optionKey = normalizeKey(option?.name);
      const optionId = normalizeText(option?.id || option?.posModifierOptionId || option?.optionId);
      if (!optionKey && !optionId) return;
      if (optionId) optionsByKey.set(`id:${optionId}`, option);
      if (optionKey) optionsByKey.set(optionKey, option);
    });

    const entry = {
      group,
      optionsByKey
    };
    if (groupKey) groupsByKey.set(groupKey, entry);
    if (groupId) groupsByKey.set(`id:${groupId}`, entry);
  });

  return groupsByKey;
}

function modifierGroupCountKey(group) {
  const groupId = normalizeText(group?.posModifierGroupId || group?.id || group?.groupId);
  return groupId ? `id:${groupId}` : normalizeKey(group?.name);
}

function reconcileStoredModifierSelections(rawSelections, liveItem) {
  const rawList = Array.isArray(rawSelections) ? rawSelections : [];
  if (rawList.length === 0) {
    const missingRequired = (liveItem.modifierGroups || []).find((group) => group.isRequired);
    if (missingRequired) {
      return { ok: false };
    }

    return {
      ok: true,
      selections: [],
      wasAdjusted: false
    };
  }

  const groupsByKey = buildGroupLookup(liveItem.modifierGroups || []);
  const countsByGroup = new Map();
  const selections = [];
  let wasAdjusted = false;

  rawList.forEach((rawSelection) => {
    const rawGroupId = normalizeText(rawSelection?.posModifierGroupId || rawSelection?.groupId);
    const groupKey = rawGroupId ? `id:${rawGroupId}` : normalizeKey(rawSelection?.groupName);
    const rawOptionName = normalizeText(rawSelection?.optionName || rawSelection?.value);
    if (!groupKey || !rawOptionName || !groupsByKey.has(groupKey)) {
      wasAdjusted = true;
      return;
    }

    const { group, optionsByKey } = groupsByKey.get(groupKey);
    const countKey = modifierGroupCountKey(group);
    const nextCount = (countsByGroup.get(countKey) || 0) + 1;
    if (nextCount > Number(group?.maxSelections || 1)) {
      wasAdjusted = true;
      return;
    }

    countsByGroup.set(countKey, nextCount);

    if (group.isTextInput) {
      selections.push({
        posModifierGroupId: group.posModifierGroupId || group.id || "",
        posModifierOptionId: "",
        groupName: group.name,
        optionName: rawOptionName,
        priceAdjustment: 0,
        isTextInput: true
      });

      if (normalizeText(rawSelection?.groupName) !== group.name || Boolean(rawSelection?.isTextInput) !== true) {
        wasAdjusted = true;
      }
      return;
    }

    const rawOptionId = normalizeText(rawSelection?.posModifierOptionId || rawSelection?.optionId);
    const optionKey = rawOptionId ? `id:${rawOptionId}` : normalizeKey(rawOptionName);
    const option = optionsByKey.get(optionKey);
    if (!option) {
      wasAdjusted = true;
      countsByGroup.set(countKey, nextCount - 1);
      if ((countsByGroup.get(countKey) || 0) <= 0) {
        countsByGroup.delete(countKey);
      }
      return;
    }

    selections.push({
      posModifierGroupId: group.posModifierGroupId || group.id || "",
      posModifierOptionId: option.posModifierOptionId || option.id || "",
      groupName: group.name,
      optionName: option.name,
      priceAdjustment: roundMoney(option.priceAdjustment),
      allergenCodes: normalizeMenuItemAllergenCodes({ codes: option.allergenCodes }),
      removesAllergenCodes: normalizeMenuItemAllergenCodes({ codes: option.removesAllergenCodes }),
      isTextInput: false
    });

    if (
      normalizeText(rawSelection?.groupName) !== group.name ||
      normalizeText(rawSelection?.optionName) !== option.name ||
      roundMoney(rawSelection?.priceAdjustment) !== roundMoney(option.priceAdjustment) ||
      Boolean(rawSelection?.isTextInput)
    ) {
      wasAdjusted = true;
    }
  });

  const missingRequired = (liveItem.modifierGroups || []).find((group) => group.isRequired && !countsByGroup.has(modifierGroupCountKey(group)));
  if (missingRequired) {
    return { ok: false };
  }

  return {
    ok: true,
    selections,
    wasAdjusted
  };
}

function reconcileStoredCartItem(raw, fallbackId, lookup, maxItemQuantity) {
  const rawItemId = normalizeText(raw?.posItemId || raw?.itemId || raw?.menuItemId);
  const rawItemName = normalizeText(raw?.itemName || raw?.name);

  const liveItem = (rawItemId && lookup.byId.get(rawItemId))
    || (rawItemName && lookup.byName.get(normalizeKey(rawItemName)))
    || null;

  if (!liveItem) {
    return { item: null, wasUpdated: false, wasRemoved: true };
  }

  const modifierResult = reconcileStoredModifierSelections(raw?.modifierSelections, liveItem);
  if (!modifierResult.ok) {
    return { item: null, wasUpdated: false, wasRemoved: true };
  }

  const rawQuantity = Number(raw?.quantity || 1);
  const quantity = Math.max(1, Math.min(maxItemQuantity, rawQuantity));
  const basePrice = roundMoney(liveItem.basePrice);
  const discountEligible = liveItem.discountEligible !== false;
  const totals = cartLineTotals(basePrice, modifierResult.selections, quantity);
  const rawId = Number(raw?.id);
  const id = Number.isInteger(rawId) && rawId > 0 ? rawId : fallbackId;

  const wasUpdated = modifierResult.wasAdjusted
    || rawItemId !== normalizeText(liveItem.id)
    || rawItemName !== liveItem.name
    || roundMoney(raw?.basePrice) !== basePrice
    || raw?.discountEligible !== discountEligible
    || !Number.isInteger(rawQuantity)
    || rawQuantity !== quantity;

  return {
    item: {
      id,
      itemId: normalizeText(liveItem.id || liveItem.posItemId),
      posItemId: normalizeText(liveItem.posItemId || liveItem.id),
      posCategoryId: normalizeText(liveItem.posCategoryId),
      categoryName: normalizeText(liveItem.categoryName),
      printRouting: normalizeText(liveItem.printRouting),
      menuVersion: normalizeText(liveItem.menuVersion),
      signature: cartLineSignature(liveItem.posItemId || liveItem.id || liveItem.name, modifierResult.selections),
      itemName: liveItem.name,
      basePrice,
      discountEligible,
      modifierSelections: modifierResult.selections,
      quantity,
      unitPrice: totals.unitPrice,
      linePrice: totals.linePrice
    },
    wasUpdated,
    wasRemoved: false
  };
}

function mergeCartItems(items, maxItemQuantity) {
  const mergedBySignature = new Map();
  let mergedLines = 0;

  items.forEach((item) => {
    const existing = mergedBySignature.get(item.signature);
    if (!existing) {
      mergedBySignature.set(item.signature, {
        ...item,
        modifierSelections: (item.modifierSelections || []).map((selection) => ({ ...selection }))
      });
      return;
    }

    existing.quantity = Math.max(1, Math.min(maxItemQuantity, existing.quantity + item.quantity));
    const totals = cartLineTotals(existing.basePrice, existing.modifierSelections, existing.quantity);
    existing.unitPrice = totals.unitPrice;
    existing.linePrice = totals.linePrice;
    mergedLines += 1;
  });

  const mergedItems = [...mergedBySignature.values()]
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))
    .map((item, index) => ({
      ...item,
      id: index + 1
    }));

  return { items: mergedItems, mergedLines };
}

export function reconcileOrderDraftState(raw, normalizedMenu, options = {}) {
  const maxItemQuantity = Number.isInteger(options.maxItemQuantity)
    ? options.maxItemQuantity
    : DEFAULT_MAX_ITEM_QUANTITY;
  const orderDraftVersion = Number.isInteger(options.orderDraftVersion)
    ? options.orderDraftVersion
    : DEFAULT_ORDER_DRAFT_VERSION;
  const asapValue = normalizeText(options.asapValue || DEFAULT_ASAP_VALUE).toUpperCase() || DEFAULT_ASAP_VALUE;
  const empty = createEmptyOrderDraftState({ orderDraftVersion });
  const meta = createEmptyOrderDraftMeta();
  const lookup = buildMenuLookup(normalizedMenu);

  if (!raw || typeof raw !== "object") {
    return {
      draft: empty,
      meta
    };
  }

  const rawCartItems = Array.isArray(raw?.cartItems) ? raw.cartItems : [];
  meta.sourceLineCount = rawCartItems.length;

  const reconciledItems = [];
  rawCartItems.forEach((entry, index) => {
    const result = reconcileStoredCartItem(entry, index + 1, lookup, maxItemQuantity);
    if (result.wasRemoved) {
      meta.removedItems += 1;
      return;
    }
    if (result.wasUpdated) {
      meta.updatedItems += 1;
    }
    reconciledItems.push(result.item);
  });

  const merged = mergeCartItems(reconciledItems, maxItemQuantity);
  meta.mergedLines = merged.mergedLines;
  meta.restoredLineCount = merged.items.length;

  const rawVersion = Number(raw?.version);
  const isCurrentDraftVersion = rawVersion === orderDraftVersion;
  const rawNextCartId = Number(raw?.nextCartId);
  const highestCartId = merged.items.reduce((max, item) => Math.max(max, Number(item.id || 0)), 0);
  const selectedCategory = isCurrentDraftVersion ? normalizeText(raw?.selectedCategory) : "";
  const searchQuery = isCurrentDraftVersion ? normalizeText(raw?.searchQuery) : "";

  const draft = {
    version: orderDraftVersion,
    cartItems: merged.items,
    nextCartId: Math.max(Number.isInteger(rawNextCartId) ? rawNextCartId : 1, highestCartId + 1, 1),
    selectedCategory,
    searchQuery,
    basketOpen: Boolean(raw?.basketOpen) && merged.items.length > 0,
    schedules: {
      collection: normalizeStoredSchedule(raw?.schedules?.collection, asapValue),
      delivery: normalizeStoredSchedule(raw?.schedules?.delivery, asapValue)
    }
  };

  meta.hadChanges = meta.removedItems > 0
    || meta.updatedItems > 0
    || meta.mergedLines > 0
    || rawVersion !== orderDraftVersion;

  return {
    draft,
    meta
  };
}
