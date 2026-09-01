"use strict";

const DEFAULT_ORDER_DRAFT_VERSION = 3;

export function createEmptyOrderDraftState(options = {}) {
  const orderDraftVersion = Number.isInteger(options.orderDraftVersion)
    ? options.orderDraftVersion
    : DEFAULT_ORDER_DRAFT_VERSION;

  return {
    version: orderDraftVersion,
    cartItems: [],
    nextCartId: 1,
    selectedCategory: "",
    searchQuery: "",
    basketOpen: false,
    schedules: {
      collection: { date: "", time: "" },
      delivery: { date: "", time: "" }
    }
  };
}
