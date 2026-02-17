"use strict";

const API_BASE = "/api/orders";
const BUSINESS_TIMEZONE = "Europe/London";
const SERVICE_START_MINUTES = 12 * 60;
const SERVICE_END_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;
const ASAP_VALUE = "ASAP";
const COLLECTION_MIN_LEAD_MINUTES = 30;
const DELIVERY_MIN_LEAD_MINUTES = 60;
const COLLECTION_EARLIEST_SCHEDULED_MINUTES = (12 * 60) + 30;
const DELIVERY_EARLIEST_SCHEDULED_MINUTES = 13 * 60;
const MAX_ORDER_LOOKAHEAD_DAYS = 90;
const OPEN_DAY_INDEXES = new Set([0, 2, 3, 4, 5, 6]); // Sun, Tue-Sat (Mon closed)
const OCCASION_OPTIONS = [
  "None",
  "Birthday",
  "Anniversary",
  "Engagement",
  "Date Night",
  "Business",
  "Celebration"
];
const VALID_OCCASIONS = new Set(OCCASION_OPTIONS);
const MAX_ITEM_QUANTITY = 20;

const form = document.getElementById("orderForm");
const noticeEl = document.getElementById("orderNotice");
const resultEl = document.getElementById("orderResult");
const errorEl = document.getElementById("orderError");
const submitBtn = document.getElementById("orderSubmit");

const orderTypeField = document.getElementById("orderType");
const nameInput = document.getElementById("orderName");
const phoneInput = document.getElementById("orderPhone");
const emailInput = document.getElementById("orderEmail");
const dateSelect = document.getElementById("orderDate");
const timeSelect = document.getElementById("orderTime");
const occasionSelect = document.getElementById("orderOccasion");
const itemsInput = document.getElementById("orderItems");
const notesInput = document.getElementById("orderNotes");

const address1Input = document.getElementById("orderAddress1");
const address2Input = document.getElementById("orderAddress2");
const townInput = document.getElementById("orderTown");
const postcodeInput = document.getElementById("orderPostcode");

const menuCategorySelect = document.getElementById("menuCategory");
const menuItemSelect = document.getElementById("menuItem");
const menuQuantitySelect = document.getElementById("menuQuantity");
const addItemButton = document.getElementById("orderAddItem");
const modifierPanel = document.getElementById("orderModifierPanel");
const modifierTitle = document.getElementById("orderModifierTitle");
const modifierFields = document.getElementById("orderModifierFields");
const modifierError = document.getElementById("orderModifierError");
const modifierCancelBtn = document.getElementById("orderModifierCancel");
const modifierConfirmBtn = document.getElementById("orderModifierConfirm");
const cartList = document.getElementById("orderCartList");
const cartEmpty = document.getElementById("orderCartEmpty");
const orderTotalEl = document.getElementById("orderTotal");
const orderSummaryPreview = document.getElementById("orderSummaryPreview");

const GBP_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP"
});

let isSubmitting = false;
let hasSelectableTime = true;
let cartItems = [];
let nextCartId = 1;
let activeDraft = null;

const normalizedMenu = normalizeMenuCatalog(window.MILLERS_ORDER_MENU);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatGBP(value) {
  return GBP_FORMATTER.format(Number(value || 0));
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function summarySafeText(value) {
  return normalizeText(value).replace(/[\n\r,]+/g, " ");
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function minutesToClock(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

function clockToMinutes(clock) {
  const parts = String(clock || "").split(":");
  if (parts.length !== 2) return NaN;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return NaN;
  return (hours * 60) + minutes;
}

function slotTimes() {
  const slots = [];
  for (let minutes = SERVICE_START_MINUTES; minutes <= SERVICE_END_MINUTES; minutes += SLOT_STEP_MINUTES) {
    slots.push(minutesToClock(minutes));
  }
  return slots;
}

function ukNowDateAndMinutes() {
  const dateISO = ukTodayISODate();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");

  return {
    dateISO,
    minutesNow: (hour * 60) + minute
  };
}

function leadMinutesForOrderType(orderType) {
  return orderType === "delivery" ? DELIVERY_MIN_LEAD_MINUTES : COLLECTION_MIN_LEAD_MINUTES;
}

function earliestScheduledMinutesForOrderType(orderType) {
  return orderType === "delivery"
    ? DELIVERY_EARLIEST_SCHEDULED_MINUTES
    : COLLECTION_EARLIEST_SCHEDULED_MINUTES;
}

function roundUpToStep(minutes, stepMinutes) {
  return Math.ceil(minutes / stepMinutes) * stepMinutes;
}

function ukTodayISODate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

function dayIndexForISODate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function isBookableDay(isoDate) {
  const dayIndex = dayIndexForISODate(isoDate);
  return dayIndex !== null && OPEN_DAY_INDEXES.has(dayIndex);
}

function displayDateLabel(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(utcDate);
}

function buildBookableDateList(startISODate, maxDays) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISODate)) return [];

  const [year, month, day] = startISODate.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  const results = [];

  for (let i = 0; i < maxDays; i += 1) {
    const candidate = `${cursor.getUTCFullYear()}-${pad2(cursor.getUTCMonth() + 1)}-${pad2(cursor.getUTCDate())}`;
    if (isBookableDay(candidate)) {
      results.push(candidate);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return results;
}

function normalizePhoneField() {
  if (!phoneInput) return;
  const digits = phoneInput.value.replace(/\D/g, "").slice(0, 11);
  phoneInput.value = digits.length <= 5
    ? digits
    : `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function renderDateOptions() {
  if (!dateSelect) return;
  const priorValue = dateSelect.value;
  const options = buildBookableDateList(ukTodayISODate(), MAX_ORDER_LOOKAHEAD_DAYS);

  dateSelect.innerHTML = "";
  for (const isoDate of options) {
    const option = document.createElement("option");
    option.value = isoDate;
    option.textContent = `${displayDateLabel(isoDate)} (${isoDate})`;
    dateSelect.appendChild(option);
  }

  if (priorValue && options.includes(priorValue)) {
    dateSelect.value = priorValue;
  } else if (options.length > 0) {
    dateSelect.value = options[0];
  }
}

function minScheduledMinutes(orderType, isoDate) {
  const earliestScheduled = earliestScheduledMinutesForOrderType(orderType);
  const now = ukNowDateAndMinutes();
  if (isoDate !== now.dateISO) {
    return earliestScheduled;
  }

  const lead = leadMinutesForOrderType(orderType);
  const withLead = now.minutesNow + lead;
  return Math.max(earliestScheduled, roundUpToStep(withLead, SLOT_STEP_MINUTES));
}

function scheduledSlotTimes(orderType, isoDate) {
  const minimum = minScheduledMinutes(orderType, isoDate);
  return slotTimes().filter((clock) => {
    const minutes = clockToMinutes(clock);
    return Number.isFinite(minutes) && minutes >= minimum;
  });
}

function renderTimeOptions() {
  if (!timeSelect) return;
  const priorValue = timeSelect.value;
  const orderType = String(orderTypeField?.value || "collection").toLowerCase();
  const selectedDate = String(dateSelect?.value || ukTodayISODate());
  const now = ukNowDateAndMinutes();
  const isToday = selectedDate === now.dateISO;
  const asapEnabled = isToday && now.minutesNow <= SERVICE_END_MINUTES;
  const slots = scheduledSlotTimes(orderType, selectedDate);

  timeSelect.innerHTML = "";
  if (asapEnabled) {
    const asapOption = document.createElement("option");
    asapOption.value = ASAP_VALUE;
    asapOption.textContent = ASAP_VALUE;
    timeSelect.appendChild(asapOption);
  }

  for (const slot of slots) {
    const option = document.createElement("option");
    option.value = slot;
    option.textContent = slot;
    timeSelect.appendChild(option);
  }

  hasSelectableTime = asapEnabled || slots.length > 0;
  if (!hasSelectableTime) {
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "No slots available";
    timeSelect.appendChild(noneOption);
    timeSelect.value = "";
  } else if ([...timeSelect.options].some((option) => option.value === priorValue)) {
    timeSelect.value = priorValue;
  } else if (asapEnabled) {
    timeSelect.value = ASAP_VALUE;
  } else if (slots.length > 0) {
    timeSelect.value = slots[0];
  }

  updateSubmitButtonState();
  updateTimeNotice(orderType, selectedDate, slots, asapEnabled);
}

function renderOccasionOptions() {
  if (!occasionSelect) return;
  const priorValue = occasionSelect.value || "None";
  occasionSelect.innerHTML = "";

  for (const occasion of OCCASION_OPTIONS) {
    const option = document.createElement("option");
    option.value = occasion;
    option.textContent = occasion;
    if (occasion === "None") option.defaultSelected = true;
    occasionSelect.appendChild(option);
  }

  if (VALID_OCCASIONS.has(priorValue)) {
    occasionSelect.value = priorValue;
  } else {
    occasionSelect.value = "None";
  }
}

function clearFeedback() {
  if (resultEl) {
    resultEl.hidden = true;
    resultEl.textContent = "";
  }
  if (errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
}

function showError(message) {
  if (!errorEl) return;
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function showResult(message, referenceText) {
  if (!resultEl) return;
  resultEl.hidden = false;
  resultEl.textContent = "";

  const text = document.createElement("div");
  text.textContent = message;
  resultEl.appendChild(text);

  if (referenceText) {
    const reference = document.createElement("div");
    reference.className = "bookingRef";
    reference.textContent = referenceText;
    resultEl.appendChild(reference);
  }
}

function setNotice(message, warning = false) {
  if (!noticeEl) return;
  noticeEl.textContent = message;
  noticeEl.classList.toggle("isWarning", warning);
}

function setSubmitting(submitting) {
  if (!submitBtn) return;
  isSubmitting = Boolean(submitting);
  updateSubmitButtonState();
}

function updateSubmitButtonState() {
  if (!submitBtn) return;
  const orderType = String(orderTypeField?.value || "collection").toLowerCase();
  const idleLabel = orderType === "delivery" ? "Place delivery order" : "Place collection order";
  const hasItems = cartItems.length > 0;
  submitBtn.disabled = isSubmitting || !hasSelectableTime || !hasItems;
  submitBtn.textContent = isSubmitting ? "Submitting..." : idleLabel;
}

function updateTimeNotice(orderType, isoDate, slots, asapEnabled) {
  const label = orderType === "delivery" ? "Delivery" : "Collection";
  const isToday = isoDate === ukTodayISODate();
  if (!isToday) {
    setNotice(`${label} hours: Tue-Sun, 12:00-17:00. ${label} slots are in 15-minute intervals.`, false);
    return;
  }

  if (!asapEnabled && slots.length === 0) {
    setNotice("No slots are left today. Please choose another date.", true);
    return;
  }

  const lead = leadMinutesForOrderType(orderType);
  const earliest = slots[0] ? ` Earliest scheduled slot: ${slots[0]}.` : "";
  setNotice(`${label} defaults to ASAP today. Scheduled times must be at least ${lead} minutes from now.${earliest}`, false);
}

function normalizeMenuCatalog(rawCatalog) {
  if (!Array.isArray(rawCatalog)) return [];

  return rawCatalog
    .map((category) => {
      const categoryName = normalizeText(category?.name);
      const source = normalizeText(category?.source);
      if (!categoryName || !Array.isArray(category?.items)) return null;

      const items = category.items
        .map((item) => {
          const itemName = normalizeText(item?.name);
          const basePrice = Number(item?.basePrice);
          if (!itemName || !Number.isFinite(basePrice) || basePrice < 0) return null;

          const modifierGroups = Array.isArray(item?.modifierGroups)
            ? item.modifierGroups
              .map((group) => {
                const groupName = normalizeText(group?.name);
                if (!groupName) return null;

                const rawType = normalizeText(group?.selectionType).toLowerCase();
                const selectionType = rawType === "multiple" ? "multiple" : "single";
                const isTextInput = Boolean(group?.isTextInput);
                const isRequired = Boolean(group?.isRequired);

                const options = Array.isArray(group?.options)
                  ? group.options
                    .map((option) => {
                      const optionName = normalizeText(option?.name);
                      const priceAdjustment = Number(option?.priceAdjustment || 0);
                      if (!optionName || !Number.isFinite(priceAdjustment)) return null;
                      return {
                        name: optionName,
                        priceAdjustment: roundMoney(priceAdjustment)
                      };
                    })
                    .filter(Boolean)
                  : [];

                const maxSelections = Number(group?.maxSelections || (selectionType === "multiple" ? options.length : 1));

                return {
                  name: groupName,
                  selectionType,
                  isTextInput,
                  isRequired,
                  maxSelections: Number.isInteger(maxSelections) && maxSelections > 0 ? maxSelections : 1,
                  options
                };
              })
              .filter(Boolean)
            : [];

          return {
            name: itemName,
            basePrice: roundMoney(basePrice),
            modifierGroups
          };
        })
        .filter(Boolean);

      if (items.length === 0) return null;

      return {
        name: categoryName,
        source,
        items
      };
    })
    .filter(Boolean);
}

function getSelectedCategory() {
  const index = Number(menuCategorySelect?.value);
  if (!Number.isInteger(index) || index < 0 || index >= normalizedMenu.length) return null;
  return normalizedMenu[index];
}

function getSelectedItem() {
  const category = getSelectedCategory();
  if (!category) return null;
  const itemIndex = Number(menuItemSelect?.value);
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= category.items.length) return null;
  return category.items[itemIndex];
}

function selectedQuantity() {
  const quantity = Number(menuQuantitySelect?.value || "1");
  if (!Number.isInteger(quantity)) return 1;
  return Math.min(MAX_ITEM_QUANTITY, Math.max(1, quantity));
}

function renderMenuCategoryOptions() {
  if (!menuCategorySelect) return;
  const priorValue = menuCategorySelect.value;
  menuCategorySelect.innerHTML = "";

  normalizedMenu.forEach((category, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = category.name;
    menuCategorySelect.appendChild(option);
  });

  if (priorValue && [...menuCategorySelect.options].some((option) => option.value === priorValue)) {
    menuCategorySelect.value = priorValue;
  } else if (menuCategorySelect.options.length > 0) {
    menuCategorySelect.value = menuCategorySelect.options[0].value;
  }
}

function renderMenuItemOptions() {
  if (!menuItemSelect) return;
  const category = getSelectedCategory();
  const priorValue = menuItemSelect.value;

  menuItemSelect.innerHTML = "";
  if (!category) return;

  category.items.forEach((item, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${item.name} (${formatGBP(item.basePrice)})`;
    menuItemSelect.appendChild(option);
  });

  if (priorValue && [...menuItemSelect.options].some((option) => option.value === priorValue)) {
    menuItemSelect.value = priorValue;
  } else if (menuItemSelect.options.length > 0) {
    menuItemSelect.value = menuItemSelect.options[0].value;
  }
}

function renderQuantityOptions() {
  if (!menuQuantitySelect) return;
  const prior = menuQuantitySelect.value;
  menuQuantitySelect.innerHTML = "";
  for (let qty = 1; qty <= 10; qty += 1) {
    const option = document.createElement("option");
    option.value = String(qty);
    option.textContent = String(qty);
    menuQuantitySelect.appendChild(option);
  }
  if (prior && [...menuQuantitySelect.options].some((option) => option.value === prior)) {
    menuQuantitySelect.value = prior;
  } else {
    menuQuantitySelect.value = "1";
  }
}

function modifierOptionLabel(option) {
  if (!option) return "";
  const adjustment = Number(option.priceAdjustment || 0);
  if (adjustment === 0) return option.name;
  const sign = adjustment > 0 ? "+" : "-";
  return `${option.name} (${sign}${formatGBP(Math.abs(adjustment))})`;
}

function createModifierGroupField(group, groupIndex) {
  const wrapper = document.createElement("fieldset");
  wrapper.className = "orderModifierGroup";
  wrapper.dataset.groupIndex = String(groupIndex);

  const legend = document.createElement("legend");
  legend.className = "orderModifierLegend";
  legend.textContent = group.name;
  wrapper.appendChild(legend);

  const helper = document.createElement("p");
  helper.className = "orderModifierHint";
  const maxText = group.selectionType === "multiple" ? ` (max ${group.maxSelections})` : "";
  const requiredText = group.isRequired ? "Required" : "Optional";
  helper.textContent = `${requiredText}${maxText}`;
  wrapper.appendChild(helper);

  if (group.isTextInput) {
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 120;
    input.className = "orderModifierText";
    input.dataset.groupIndex = String(groupIndex);
    input.dataset.groupType = "text";
    input.placeholder = `Enter ${group.name.toLowerCase()}`;
    if (group.isRequired) input.required = true;
    wrapper.appendChild(input);
    return wrapper;
  }

  if (group.selectionType === "multiple") {
    const optionsWrap = document.createElement("div");
    optionsWrap.className = "orderModifierOptions";

    group.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "orderModifierOption";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.groupIndex = String(groupIndex);
      checkbox.dataset.optionIndex = String(optionIndex);
      checkbox.dataset.groupType = "multiple";

      const text = document.createElement("span");
      text.textContent = modifierOptionLabel(option);

      label.appendChild(checkbox);
      label.appendChild(text);
      optionsWrap.appendChild(label);
    });

    wrapper.appendChild(optionsWrap);
    return wrapper;
  }

  const select = document.createElement("select");
  select.className = "orderModifierSelect";
  select.dataset.groupIndex = String(groupIndex);
  select.dataset.groupType = "single";

  if (!group.isRequired) {
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "No selection";
    select.appendChild(noneOption);
  }

  group.options.forEach((option, optionIndex) => {
    const optionEl = document.createElement("option");
    optionEl.value = String(optionIndex);
    optionEl.textContent = modifierOptionLabel(option);
    select.appendChild(optionEl);
  });

  if (group.isRequired && group.options.length > 0) {
    select.value = "0";
  }

  wrapper.appendChild(select);
  return wrapper;
}

function clearModifierError() {
  if (!modifierError) return;
  modifierError.hidden = true;
  modifierError.textContent = "";
}

function showModifierError(message) {
  if (!modifierError) return;
  modifierError.hidden = false;
  modifierError.textContent = message;
}

function hideModifierPanel() {
  if (modifierPanel) modifierPanel.hidden = true;
  if (modifierFields) modifierFields.innerHTML = "";
  clearModifierError();
  activeDraft = null;
}

function startItemDraft() {
  clearFeedback();
  clearModifierError();

  const item = getSelectedItem();
  if (!item) {
    showError("Please select a menu item.");
    return;
  }

  const quantity = selectedQuantity();
  activeDraft = { item, quantity };

  const groups = Array.isArray(item.modifierGroups) ? item.modifierGroups : [];
  const hasGroups = groups.length > 0;

  if (!hasGroups) {
    addDraftToCart([]);
    return;
  }

  if (modifierTitle) {
    modifierTitle.textContent = `${item.name} x${quantity}`;
  }

  if (modifierFields) {
    modifierFields.innerHTML = "";
    groups.forEach((group, index) => {
      modifierFields.appendChild(createModifierGroupField(group, index));
    });
  }

  if (modifierPanel) modifierPanel.hidden = false;
}

function selectedModifiersFromDraft() {
  if (!activeDraft || !Array.isArray(activeDraft.item?.modifierGroups)) {
    return { ok: false, error: "No item is selected." };
  }

  const selections = [];
  const groups = activeDraft.item.modifierGroups;

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];

    if (group.isTextInput) {
      const input = modifierFields?.querySelector(`input[data-group-index="${groupIndex}"]`);
      const text = normalizeText(input?.value || "");

      if (group.isRequired && text.length === 0) {
        return { ok: false, error: `${group.name} is required.` };
      }

      if (text.length > 0) {
        selections.push({
          groupName: group.name,
          optionName: text,
          priceAdjustment: 0,
          isTextInput: true
        });
      }

      continue;
    }

    if (group.selectionType === "multiple") {
      const checked = [...(modifierFields?.querySelectorAll(`input[type="checkbox"][data-group-index="${groupIndex}"]:checked`) || [])];

      if (group.isRequired && checked.length === 0) {
        return { ok: false, error: `Please select at least one option for ${group.name}.` };
      }

      if (checked.length > group.maxSelections) {
        return { ok: false, error: `You can select up to ${group.maxSelections} option(s) for ${group.name}.` };
      }

      for (const checkbox of checked) {
        const optionIndex = Number(checkbox.dataset.optionIndex);
        if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= group.options.length) continue;
        const option = group.options[optionIndex];
        selections.push({
          groupName: group.name,
          optionName: option.name,
          priceAdjustment: Number(option.priceAdjustment || 0),
          isTextInput: false
        });
      }

      continue;
    }

    const select = modifierFields?.querySelector(`select[data-group-index="${groupIndex}"]`);
    const value = String(select?.value || "");

    if (value.length === 0) {
      if (group.isRequired) {
        return { ok: false, error: `${group.name} is required.` };
      }
      continue;
    }

    const optionIndex = Number(value);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= group.options.length) {
      return { ok: false, error: `Please choose a valid option for ${group.name}.` };
    }

    const option = group.options[optionIndex];
    selections.push({
      groupName: group.name,
      optionName: option.name,
      priceAdjustment: Number(option.priceAdjustment || 0),
      isTextInput: false
    });
  }

  return { ok: true, selections };
}

function cartLineTotals(basePrice, selections, quantity) {
  const modifierTotal = selections.reduce((sum, selection) => sum + Number(selection.priceAdjustment || 0), 0);
  const unitPrice = roundMoney(basePrice + modifierTotal);
  const linePrice = roundMoney(unitPrice * quantity);
  return {
    unitPrice,
    linePrice
  };
}

function addDraftToCart(modifierSelections) {
  if (!activeDraft) return;
  const quantity = Math.max(1, Math.min(MAX_ITEM_QUANTITY, Number(activeDraft.quantity || 1)));
  const { unitPrice, linePrice } = cartLineTotals(activeDraft.item.basePrice, modifierSelections, quantity);

  cartItems.push({
    id: nextCartId,
    itemName: activeDraft.item.name,
    basePrice: activeDraft.item.basePrice,
    quantity,
    modifierSelections,
    unitPrice,
    linePrice
  });
  nextCartId += 1;

  hideModifierPanel();
  renderCart();
}

function modifierSummary(selection) {
  const base = `${selection.groupName}: ${selection.optionName}`;
  const adjustment = Number(selection.priceAdjustment || 0);
  if (selection.isTextInput || adjustment === 0) return base;

  const sign = adjustment > 0 ? "+" : "-";
  return `${base} (${sign}${formatGBP(Math.abs(adjustment))})`;
}

function recalculateCartItem(item) {
  const quantity = Math.max(1, Math.min(MAX_ITEM_QUANTITY, Number(item.quantity || 1)));
  const totals = cartLineTotals(item.basePrice, item.modifierSelections || [], quantity);
  item.quantity = quantity;
  item.unitPrice = totals.unitPrice;
  item.linePrice = totals.linePrice;
}

function lineSummary(item) {
  const name = summarySafeText(item.itemName);
  const quantityText = `${item.quantity}x`;
  const modifierText = (item.modifierSelections || []).map(modifierSummary).map(summarySafeText).filter(Boolean).join(" | ");
  const base = modifierText ? `${quantityText} ${name} [${modifierText}]` : `${quantityText} ${name}`;
  return `${base} = ${formatGBP(item.linePrice)}`;
}

function syncItemsSummary() {
  if (!itemsInput) return;

  if (cartItems.length === 0) {
    itemsInput.value = "";
    if (orderSummaryPreview) orderSummaryPreview.textContent = "Add items to build your order.";
    return;
  }

  const lines = cartItems.map(lineSummary);
  const total = roundMoney(cartItems.reduce((sum, item) => sum + Number(item.linePrice || 0), 0));
  lines.push(`Total = ${formatGBP(total)}`);
  itemsInput.value = lines.join("\n");

  if (orderSummaryPreview) {
    orderSummaryPreview.textContent = `${cartItems.length} line item(s). Total ${formatGBP(total)}.`;
  }
}

function createActionButton(action, text, isDanger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = isDanger ? "orderCartBtn orderCartBtnDanger" : "orderCartBtn";
  button.dataset.action = action;
  button.textContent = text;
  return button;
}

function renderCart() {
  if (!cartList || !cartEmpty || !orderTotalEl) {
    updateSubmitButtonState();
    return;
  }

  cartItems.forEach(recalculateCartItem);
  cartList.innerHTML = "";

  if (cartItems.length === 0) {
    cartEmpty.hidden = false;
    cartList.hidden = true;
    orderTotalEl.textContent = formatGBP(0);
    syncItemsSummary();
    updateSubmitButtonState();
    return;
  }

  cartEmpty.hidden = true;
  cartList.hidden = false;

  let total = 0;
  for (const item of cartItems) {
    total += Number(item.linePrice || 0);

    const li = document.createElement("li");
    li.className = "orderCartItem";
    li.dataset.cartId = String(item.id);

    const top = document.createElement("div");
    top.className = "orderCartTop";

    const title = document.createElement("strong");
    title.className = "orderCartName";
    title.textContent = `${item.quantity}x ${item.itemName}`;

    const linePrice = document.createElement("span");
    linePrice.className = "orderCartPrice";
    linePrice.textContent = formatGBP(item.linePrice);

    top.appendChild(title);
    top.appendChild(linePrice);

    const unit = document.createElement("div");
    unit.className = "orderCartUnit";
    unit.textContent = `${formatGBP(item.unitPrice)} each`;

    const modifiers = document.createElement("div");
    modifiers.className = "orderCartModifiers";
    const modifierLines = (item.modifierSelections || []).map(modifierSummary);
    modifiers.textContent = modifierLines.length > 0 ? modifierLines.join(" | ") : "No modifiers";

    const actions = document.createElement("div");
    actions.className = "orderCartActionsRow";
    actions.appendChild(createActionButton("decrease", "−"));

    const qtyPill = document.createElement("span");
    qtyPill.className = "orderCartQty";
    qtyPill.textContent = String(item.quantity);
    actions.appendChild(qtyPill);

    actions.appendChild(createActionButton("increase", "+"));
    actions.appendChild(createActionButton("remove", "Remove", true));

    li.appendChild(top);
    li.appendChild(unit);
    li.appendChild(modifiers);
    li.appendChild(actions);

    cartList.appendChild(li);
  }

  orderTotalEl.textContent = formatGBP(roundMoney(total));
  syncItemsSummary();
  updateSubmitButtonState();
}

function updateCartQuantity(cartId, delta) {
  const item = cartItems.find((entry) => entry.id === cartId);
  if (!item) return;
  item.quantity = Math.max(1, Math.min(MAX_ITEM_QUANTITY, item.quantity + delta));
  renderCart();
}

function removeCartLine(cartId) {
  cartItems = cartItems.filter((entry) => entry.id !== cartId);
  renderCart();
}

function resetOrderBuilder() {
  cartItems = [];
  hideModifierPanel();
  renderMenuCategoryOptions();
  renderMenuItemOptions();
  if (menuQuantitySelect) menuQuantitySelect.value = "1";
  renderCart();
}

function initializeOrderBuilder() {
  if (!menuCategorySelect || !menuItemSelect || !menuQuantitySelect || !addItemButton || !itemsInput) {
    return false;
  }

  if (normalizedMenu.length === 0) {
    addItemButton.disabled = true;
    if (menuCategorySelect) menuCategorySelect.disabled = true;
    if (menuItemSelect) menuItemSelect.disabled = true;
    if (menuQuantitySelect) menuQuantitySelect.disabled = true;
    setNotice("Menu is temporarily unavailable. Please try again shortly.", true);
    return false;
  }

  renderMenuCategoryOptions();
  renderMenuItemOptions();
  renderQuantityOptions();
  renderCart();

  menuCategorySelect.addEventListener("change", () => {
    clearFeedback();
    hideModifierPanel();
    renderMenuItemOptions();
  });

  addItemButton.addEventListener("click", startItemDraft);

  modifierCancelBtn?.addEventListener("click", hideModifierPanel);
  modifierConfirmBtn?.addEventListener("click", () => {
    clearModifierError();
    const result = selectedModifiersFromDraft();
    if (!result.ok) {
      showModifierError(result.error || "Please check your selections.");
      return;
    }
    addDraftToCart(result.selections);
  });

  modifierFields?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "checkbox") return;

    const groupIndex = Number(target.dataset.groupIndex);
    if (!Number.isInteger(groupIndex) || !activeDraft) return;

    const group = activeDraft.item.modifierGroups[groupIndex];
    if (!group || group.selectionType !== "multiple") return;

    const checked = [...modifierFields.querySelectorAll(`input[type="checkbox"][data-group-index="${groupIndex}"]:checked`)];
    if (checked.length > group.maxSelections) {
      target.checked = false;
      showModifierError(`You can select up to ${group.maxSelections} option(s) for ${group.name}.`);
    } else {
      clearModifierError();
    }
  });

  cartList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest("button[data-action]");
    if (!(button instanceof HTMLButtonElement)) return;

    const row = button.closest("li[data-cart-id]");
    if (!(row instanceof HTMLLIElement)) return;

    const cartId = Number(row.dataset.cartId);
    if (!Number.isInteger(cartId)) return;

    const action = button.dataset.action;
    if (action === "increase") {
      updateCartQuantity(cartId, 1);
    } else if (action === "decrease") {
      updateCartQuantity(cartId, -1);
    } else if (action === "remove") {
      removeCartLine(cartId);
    }
  });

  return true;
}

function validatePayload(payload) {
  if (!payload.customerName || payload.customerName.length < 2) {
    return "Please enter a valid name.";
  }

  if (!/^\d{5}\s\d{6}$/.test(payload.phoneNumber)) {
    return "Phone number must be in format XXXXX XXXXXX.";
  }

  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return "Please enter a valid email address.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    return "Please choose a valid date.";
  }

  if (!isBookableDay(payload.date)) {
    return "Orders are available Tuesday to Sunday only.";
  }

  if (payload.time === ASAP_VALUE) {
    const now = ukNowDateAndMinutes();
    if (payload.date !== now.dateISO) {
      return "ASAP is only available for today's date.";
    }
    if (now.minutesNow > SERVICE_END_MINUTES) {
      return "No slots are left today. Please choose another date.";
    }
  } else if (!/^\d{2}:\d{2}$/.test(payload.time)) {
    return "Please choose a valid time or ASAP.";
  }

  if (payload.time !== ASAP_VALUE) {
    const minutes = clockToMinutes(payload.time);
    const earliestScheduled = earliestScheduledMinutesForOrderType(payload.orderType);
    if (!Number.isFinite(minutes)) {
      return "Please choose a valid time.";
    }

    if (minutes < earliestScheduled || minutes > SERVICE_END_MINUTES) {
      const orderLabel = payload.orderType === "delivery" ? "Delivery" : "Collection";
      return `${orderLabel} scheduled times must be between ${minutesToClock(earliestScheduled)} and 17:00.`;
    }

    if (minutes % SLOT_STEP_MINUTES !== 0) {
      return "Orders must be in 15-minute intervals.";
    }

    if (payload.date === ukTodayISODate()) {
      const minimum = minScheduledMinutes(payload.orderType, payload.date);
      if (minimum > SERVICE_END_MINUTES) {
        return "No scheduled slots are left today. Please choose another date.";
      }
      if (minutes < minimum) {
        const lead = leadMinutesForOrderType(payload.orderType);
        return `Scheduled time must be at least ${lead} minutes from now (${minutesToClock(minimum)} or later).`;
      }
    }
  }

  if (!VALID_OCCASIONS.has(payload.specialOccasion || "None")) {
    return "Please choose a valid occasion.";
  }

  if (!payload.itemsSummary || payload.itemsSummary.length < 3) {
    return "Please add at least one menu item.";
  }

  if (payload.orderType === "delivery") {
    if (!payload.addressLine1) return "Address line 1 is required for delivery.";
    if (!payload.townCity) return "Town / City is required for delivery.";
    if (!payload.postcode) return "Postcode is required for delivery.";
  }

  return null;
}

async function handleSubmit(event) {
  event.preventDefault();
  clearFeedback();
  syncItemsSummary();

  const orderType = String(orderTypeField?.value || "collection").toLowerCase();
  const payload = {
    orderType,
    customerName: (nameInput?.value || "").trim(),
    phoneNumber: (phoneInput?.value || "").trim(),
    email: (emailInput?.value || "").trim(),
    date: dateSelect?.value || "",
    time: timeSelect?.value || "",
    specialOccasion: (occasionSelect?.value || "None").trim(),
    itemsSummary: (itemsInput?.value || "").trim(),
    notes: (notesInput?.value || "").trim(),
    addressLine1: (address1Input?.value || "").trim(),
    addressLine2: (address2Input?.value || "").trim(),
    townCity: (townInput?.value || "").trim(),
    postcode: (postcodeInput?.value || "").trim()
  };

  const validationError = validatePayload(payload);
  if (validationError) {
    showError(validationError);
    return;
  }

  setSubmitting(true);

  try {
    const response = await fetch(API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    let body = {};
    try {
      body = await response.json();
    } catch (error) {
      body = {};
    }

    if (!response.ok) {
      showError(body.error || "Could not place order right now. Please try again.");
      return;
    }

    const orderLabel = payload.orderType === "delivery" ? "Delivery" : "Collection";
    const whenText = payload.time === ASAP_VALUE
      ? "as soon as possible"
      : `for ${payload.date} at ${payload.time}`;
    const successMessage = `${orderLabel} order confirmed ${whenText}. Confirmation emails sent to you and Millers Café.`;
    const reference = body.reference ? `Reference: ${body.reference}` : "";

    showResult(successMessage, reference);
    setNotice(`${orderLabel} order submitted successfully.`, false);

    const preservedDate = payload.date;
    const preservedTime = payload.time;

    form.reset();
    if (orderTypeField) orderTypeField.value = orderType;
    renderOccasionOptions();

    if (dateSelect) dateSelect.value = preservedDate;
    if (timeSelect) {
      renderTimeOptions();
      if ([...timeSelect.options].some((option) => option.value === preservedTime)) {
        timeSelect.value = preservedTime;
      }
    }

    resetOrderBuilder();
  } catch (error) {
    showError("Order service is currently unavailable. Please try again shortly.");
  } finally {
    setSubmitting(false);
  }
}

function initialize() {
  if (!form) return;

  renderDateOptions();
  renderTimeOptions();
  renderOccasionOptions();
  initializeOrderBuilder();

  form.addEventListener("submit", handleSubmit);
  dateSelect?.addEventListener("change", () => {
    clearFeedback();
    renderTimeOptions();
  });
  phoneInput?.addEventListener("input", normalizePhoneField);
  phoneInput?.addEventListener("blur", normalizePhoneField);
  updateSubmitButtonState();
}

initialize();
