"use strict";

(function menuPage() {
  const knownCodes = new Set([
    "LC", "V", "VE", "VG", "M", "ME", "MS", "HT", "VH",
    "CE", "G", "CR", "E", "F", "L", "D", "MO", "MU", "P", "SE", "SO", "SU", "N"
  ]);

  const menuGroups = [
    {
      id: "fresh-lunch-deal",
      label: "Fresh Lunch Deal",
      description: "Build a fresh lunch with a main, filling, sauce, optional salad, crisps or a snack, and a drink.",
      icon: "../assets/icon-bag.svg",
      headings: ["Fresh Lunch Deal"]
    },
    {
      id: "starters",
      label: "Starters",
      description: "Vegetarian, chicken, lamb, mixed and seafood starters.",
      icon: "../assets/icon-tools-kitchen.svg",
      headings: [
        "Starters - Vegetarian",
        "Starters - Chicken",
        "Starters - Lamb",
        "Starters - Mixed",
        "Starters - Seafood"
      ]
    },
    {
      id: "lunch-specials",
      label: "Lunch Specials",
      description: "Salad bowls, wraps, jacket potatoes, omelettes and wings.",
      icon: "../assets/icon-tools-kitchen.svg",
      headings: [
        "Salad Bowls",
        "Wraps",
        "Jacket Potato",
        "Curry Sauce",
        "Omelettes",
        "Wings"
      ]
    },
    {
      id: "street-kitchen",
      label: "Street Kitchen",
      description: "Mumbai Sizzle burgers and Millers Desi Crust.",
      icon: "../assets/icon-bag.svg",
      headings: ["Mumbai Sizzle Burgers", "Desi Crust"]
    },
    {
      id: "tandoori",
      label: "Tandoori",
      description: "Flame-cooked grills served with salad and vegetable curry sauce.",
      icon: "../assets/icon-tools-kitchen.svg",
      headings: ["Tandoori"]
    },
    {
      id: "biryani",
      label: "Biryani",
      description: "Traditional basmati rice dishes with meat, seafood or vegetables.",
      icon: "../assets/icon-bag.svg",
      headings: ["Biryani"]
    },
    {
      id: "vegetarian-mains",
      label: "Vegetarian Mains",
      description: "Vegetable and paneer mains from the printed menu.",
      icon: "../assets/icon-tools-kitchen.svg",
      headings: ["Vegetarian Mains"]
    },
    {
      id: "cafe-curries",
      label: "Café Curries",
      description: "Choose your protein, then pick a curry from mild to very hot.",
      icon: "../assets/icon-tools-kitchen.svg",
      headings: [
        "Mild Curries",
        "Medium Curries",
        "Hot Curries",
        "Very Hot Curries"
      ]
    },
    {
      id: "rice",
      label: "Rice",
      description: "Boiled, pilau and flavoured rice sides.",
      icon: "../assets/icon-bag.svg",
      headings: ["Rice"]
    },
    {
      id: "bread-and-snacks",
      label: "Bread & Snacks",
      description: "Naan, chapati and paratha.",
      icon: "../assets/icon-book.svg",
      headings: ["Bread & Snacks"]
    },
    {
      id: "side-dishes",
      label: "Side Dishes",
      description: "Vegetable sides, chips and café extras.",
      icon: "../assets/icon-bag.svg",
      headings: ["Side Dishes"]
    },
    {
      id: "desserts-and-cakes",
      label: "Desserts & Cakes",
      description: "Desserts, cakes and sweet favourites.",
      icon: "../assets/icon-cake.svg",
      headings: ["Desserts and Cakes"]
    },
    {
      id: "drinks",
      label: "Drinks",
      description: "Shakes, chillers, hot drinks and soft drinks.",
      icon: "../assets/icon-bottle.svg",
      headings: ["Shakes and Chillers", "Hot Drinks", "Soft Drinks"]
    }
  ];

  const defaultGroupId = "fresh-lunch-deal";
  const sectionDisplayLabels = new Map([
    ["Starters - Vegetarian", "Vegetarian"],
    ["Starters - Chicken", "Chicken"],
    ["Starters - Lamb", "Lamb"],
    ["Starters - Mixed", "Mixed"],
    ["Starters - Seafood", "Seafood"],
    ["Mild Curries", "Mild"],
    ["Medium Curries", "Medium"],
    ["Hot Curries", "Hot"],
    ["Very Hot Curries", "Very Hot"],
    ["Shakes and Chillers", "Shakes & Chillers"],
    ["Desserts and Cakes", "Desserts & Cakes"]
  ]);
  const legacyMenuGroupAliases = new Map([
    ["mains-and-curries", "cafe-curries"],
    ["biryani-and-rice", "biryani"],
    ["breads", "bread-and-snacks"],
    ["burgers-wraps-and-more", "lunch-specials"],
    ["sides-and-soft-drinks", "side-dishes"]
  ]);
  const labelsToggle = document.getElementById("labelsToggle");
  const legendToggle = document.getElementById("legendToggle");
  const menuSearchInput = document.getElementById("menuSearchInput");
  const clearMenuSearch = document.getElementById("clearMenuSearch");
  const clearMenuSearchEmpty = document.getElementById("clearMenuSearchEmpty");
  const menuSearchMeta = document.getElementById("menuSearchMeta");
  const menuCategoryRailList = document.getElementById("menuCategoryRailList");
  const menuGroupTabs = document.getElementById("menuGroupTabs");
  const menuActiveGroupTitle = document.getElementById("menuActiveGroupTitle");
  const menuActiveGroupDescription = document.getElementById("menuActiveGroupDescription");
  const menuNoResults = document.getElementById("menuNoResults");
  const menuSafetySlot = document.getElementById("menuSafetySlot");
  const legendSection = document.querySelector(".menuLegend");
  const menuBrowseMain = document.querySelector(".menuBrowseMain");
  const main = document.querySelector("main");
  const contentSections = Array.from(document.querySelectorAll(".menuSection.menuGroup:not(.menuLegend)"));
  const searchIndex = new Map();
  const sectionsByHeading = new Map();
  const sectionsById = new Map();
  const sectionGroupIds = new Map();
  const mobileCollapsedState = new Map();

  let activeGroupId = defaultGroupId;
  let activeSubcategoryId = "all";
  let activeJumpChipId = "";
  let railFocusIndex = 0;
  let searchTimer = 0;
  let activeSearchTokens = [];
  let activeSearchQuery = "";

  let desktopMedia = null;
  let reducedMotionMedia = null;
  try {
    desktopMedia = window.matchMedia("(min-width: 960px)");
    reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  } catch (error) {
    desktopMedia = { matches: false };
    reducedMotionMedia = { matches: false };
  }

  function trackClientEvent(eventName, details = {}) {
    if (!window.MillersClient || typeof window.MillersClient.trackEvent !== "function") {
      return Promise.resolve(false);
    }
    return window.MillersClient.trackEvent(eventName, details);
  }

  function normalizeText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function slugify(text) {
    return normalizeText(text)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function tokenize(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => (token.length > 3 && token.endsWith("ies") ? `${token.slice(0, -3)}y` : token));
  }

  function tokensMatch(tokens, indexedTokens) {
    return tokens.every((queryToken) => indexedTokens.some((token) => token.includes(queryToken)));
  }

  function isDesktop() {
    return Boolean(desktopMedia?.matches);
  }

  function requiredHooksExist() {
    return Boolean(
      labelsToggle &&
      legendToggle &&
      menuSearchInput &&
      clearMenuSearch &&
      clearMenuSearchEmpty &&
      menuSearchMeta &&
      menuCategoryRailList &&
      menuGroupTabs &&
      menuActiveGroupTitle &&
      menuActiveGroupDescription &&
      menuNoResults &&
      menuSafetySlot &&
      legendSection &&
      menuBrowseMain &&
      main &&
      contentSections.length
    );
  }

  function decorateLabels(root) {
    root.querySelectorAll(".menuName").forEach((element) => {
      const raw = normalizeText(element.textContent);
      if (!raw) return;

      const found = [];
      const cleaned = raw.replace(/\(([^()]+)\)/g, (full, inner) => {
        const tokens = inner.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
        if (!tokens.length || !tokens.every((token) => knownCodes.has(token))) return full;
        tokens.forEach((token) => {
          if (!found.includes(token)) found.push(token);
        });
        return "";
      }).replace(/\s{2,}/g, " ").trim();

      element.textContent = cleaned;
      if (!found.length) return;

      const textCodes = document.createElement("span");
      textCodes.className = "labelText";
      textCodes.textContent = ` (${found.join(", ")})`;
      element.appendChild(textCodes);

      const wrap = document.createElement("span");
      wrap.className = "labels";
      wrap.setAttribute("aria-hidden", "true");
      found.forEach((code) => {
        const chip = document.createElement("span");
        chip.className = "label";
        chip.textContent = code;
        wrap.appendChild(chip);
      });
      element.appendChild(wrap);
    });
  }

  function ensureSectionIdsAndGroups() {
    const configuredHeadings = new Set(menuGroups.flatMap((group) => group.headings));
    const configuredHeadingOrder = new Map(
      menuGroups.flatMap((group) => group.headings).map((heading, index) => [heading, index])
    );

    contentSections.forEach((section, index) => {
      const heading = section.querySelector(":scope > .tileTitle");
      const headingText = normalizeText(heading?.textContent);
      if (!headingText || !configuredHeadings.has(headingText) || sectionsByHeading.has(headingText)) {
        throw new Error(`Menu group mapping is incomplete for section ${index + 1}: ${headingText || "untitled"}`);
      }
      sectionsByHeading.set(headingText, section);
    });

    if (configuredHeadings.size !== contentSections.length) {
      throw new Error("Menu group mapping does not match the static catalogue.");
    }

    const usedIds = new Set();
    contentSections.forEach((section, index) => {
      const headingText = normalizeText(section.querySelector(":scope > .tileTitle")?.textContent);
      const base = slugify(headingText) || `section-${index + 1}`;
      let id = base;
      let suffix = 2;
      while (usedIds.has(id) || (document.getElementById(id) && document.getElementById(id) !== section)) {
        id = `${base}-${suffix}`;
        suffix += 1;
      }
      section.id = id;
      section.dataset.menuHeading = headingText;
      section.dataset.menuOriginalIndex = String(configuredHeadingOrder.get(headingText) ?? index);
      usedIds.add(id);
      sectionsById.set(id, section);
    });

    menuGroups.forEach((group) => {
      group.sections = group.headings.map((heading) => sectionsByHeading.get(heading));
      group.sections.forEach((section) => {
        section.dataset.menuGroup = group.id;
        section.dataset.menuSubcategory = section.id;
        sectionGroupIds.set(section, group.id);
      });
    });
  }

  function getAccordionBody(section) {
    return section.querySelector(":scope > .accordionBody");
  }

  function sectionDisplayLabel(section) {
    const heading = normalizeText(section?.dataset?.menuHeading);
    return sectionDisplayLabels.get(heading) || heading;
  }

  function syncSectionBodyInteractivity(section) {
    const body = getAccordionBody(section);
    if (!body) return;
    const unavailable = section.hidden || section.classList.contains("collapsed");
    body.setAttribute("aria-hidden", String(unavailable));
    if (unavailable) {
      body.setAttribute("inert", "");
    } else {
      body.removeAttribute("inert");
    }
  }

  function setCollapsed(section, collapsed, options = {}) {
    section.classList.toggle("collapsed", collapsed);
    const toggle = section.querySelector(":scope > .tileTitle > .menuAccordionToggle");
    if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));

    const body = getAccordionBody(section);
    if (body) {
      body.style.maxHeight = collapsed ? "0px" : "none";
      body.style.opacity = collapsed ? "0" : "1";
    }

    if (options.remember !== false) {
      mobileCollapsedState.set(section, collapsed);
    }
    syncSectionBodyInteractivity(section);
  }

  function setupAccordions() {
    contentSections.forEach((section) => {
      section.classList.add("accordion");
      const title = section.querySelector(":scope > .tileTitle");
      if (!title) return;

      let body = getAccordionBody(section);
      if (!body) {
        body = document.createElement("div");
        body.className = "accordionBody";
        while (title.nextSibling) body.appendChild(title.nextSibling);
        section.appendChild(body);
      }

      const titleText = sectionDisplayLabel(section);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "menuAccordionToggle";
      toggle.textContent = titleText;
      toggle.id = `${section.id}-toggle`;
      body.id = `${section.id}-content`;
      body.setAttribute("role", "region");
      body.setAttribute("aria-labelledby", toggle.id);
      toggle.setAttribute("aria-controls", body.id);
      title.replaceChildren(toggle);

      toggle.addEventListener("click", () => {
        if (isDesktop()) return;
        setCollapsed(section, !section.classList.contains("collapsed"), {
          remember: activeSearchTokens.length === 0
        });
      });

      mobileCollapsedState.set(section, true);
      setCollapsed(section, true, { remember: false });
    });
  }

  function setupSafetyLegend() {
    menuSafetySlot.appendChild(legendSection);
    legendSection.hidden = false;
    legendSection.removeAttribute("aria-hidden");
    legendSection.classList.remove("noSearchMatch", "hiddenByGroup", "accordion", "collapsed");

    const legendGrid = legendSection.querySelector(".legendGrid");
    const notice = legendSection.querySelector(".menuAllergenNotice");
    if (legendGrid && !legendGrid.id) legendGrid.id = "menuSymbolKey";
    if (legendGrid) legendToggle.setAttribute("aria-controls", legendGrid.id);
    if (notice) {
      notice.hidden = false;
      notice.removeAttribute("aria-hidden");
      notice.removeAttribute("inert");
    }
  }

  function cleanMenuName(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll(".labelText, .labels").forEach((label) => label.remove());
    return normalizeText(clone.textContent);
  }

  function buildSearchIndex() {
    contentSections.forEach((section) => {
      const headingText = section.dataset.menuHeading;
      const sectionDescriptions = Array.from(section.querySelectorAll(".menuDesc"))
        .filter((description) => !description.closest(".menuItem"))
        .map((description) => normalizeText(description.textContent));
      const sectionTokens = tokenize([headingText, ...sectionDescriptions].join(" "));
      const items = Array.from(section.querySelectorAll(".menuItem"), (element) => {
        const name = cleanMenuName(element.querySelector(".menuName"));
        const descriptions = Array.from(element.querySelectorAll(".menuDesc"), (description) => normalizeText(description.textContent));
        return {
          element,
          tokens: tokenize([headingText, ...sectionDescriptions, name, ...descriptions].join(" "))
        };
      });
      searchIndex.set(section, { sectionTokens, items });
    });
  }

  function getActiveGroup() {
    return menuGroups.find((group) => group.id === activeGroupId) || menuGroups.find((group) => group.id === defaultGroupId);
  }

  function setActiveJumpChip(id) {
    if (activeJumpChipId === id) return;
    activeJumpChipId = id;
  }

  function setSectionVisible(section, visible) {
    section.hidden = !visible;
    section.style.display = visible ? "" : "none";
    section.classList.toggle("hiddenByGroup", !visible);
    if (visible) {
      section.removeAttribute("aria-hidden");
    } else {
      section.setAttribute("aria-hidden", "true");
    }
    syncSectionBodyInteractivity(section);
  }

  function syncAccordionPresentation(visibleSections) {
    const visibleSet = new Set(visibleSections);
    contentSections.forEach((section) => {
      const toggle = section.querySelector(":scope > .tileTitle > .menuAccordionToggle");
      if (toggle) {
        toggle.tabIndex = isDesktop() ? -1 : 0;
        toggle.setAttribute("aria-disabled", String(isDesktop()));
      }

      if (!visibleSet.has(section)) {
        syncSectionBodyInteractivity(section);
        return;
      }

      if (isDesktop() || activeSearchTokens.length) {
        setCollapsed(section, false, { remember: false });
      } else {
        setCollapsed(section, mobileCollapsedState.get(section) !== false, { remember: false });
      }
    });
  }

  function applyGroupView() {
    const activeGroup = getActiveGroup();
    const visibleSections = activeGroup.sections.filter((section) => (
      activeSubcategoryId === "all" || section.id === activeSubcategoryId
    ));

    visibleSections.forEach((section) => menuBrowseMain.appendChild(section));

    contentSections.forEach((section) => {
      section.querySelectorAll(".menuItem.hiddenBySearch").forEach((item) => {
        item.classList.remove("hiddenBySearch");
        item.hidden = false;
        item.style.display = "";
      });
      section.classList.remove("noSearchMatch");
      setSectionVisible(section, visibleSections.includes(section));
    });
    syncAccordionPresentation(visibleSections);
  }

  function applySearchResults() {
    let matchedSections = 0;
    let matchedItems = 0;
    const visibleSections = [];

    contentSections.forEach((section) => {
      const indexed = searchIndex.get(section);
      const sectionMatch = tokensMatch(activeSearchTokens, indexed.sectionTokens);
      let localMatches = 0;

      indexed.items.forEach(({ element, tokens }) => {
        const itemMatch = sectionMatch || tokensMatch(activeSearchTokens, tokens);
        element.classList.toggle("hiddenBySearch", !itemMatch);
        element.hidden = !itemMatch;
        element.style.display = itemMatch ? "" : "none";
        if (itemMatch) localMatches += 1;
      });

      const sectionHasMatch = localMatches > 0;
      section.classList.toggle("noSearchMatch", !sectionHasMatch);
      setSectionVisible(section, sectionHasMatch);
      if (sectionHasMatch) {
        matchedSections += 1;
        matchedItems += localMatches;
        visibleSections.push(section);
      }
    });

    visibleSections
      .sort((left, right) => Number(left.dataset.menuOriginalIndex) - Number(right.dataset.menuOriginalIndex))
      .forEach((section) => menuBrowseMain.appendChild(section));

    syncAccordionPresentation(visibleSections);
    menuNoResults.hidden = matchedSections > 0;
    menuNoResults.style.display = matchedSections > 0 ? "none" : "";

    if (!matchedSections) {
      menuSearchMeta.textContent = `No matches for “${activeSearchQuery}”`;
      return;
    }

    const sectionWord = matchedSections === 1 ? "section" : "sections";
    const itemWord = matchedItems === 1 ? "item" : "items";
    menuSearchMeta.textContent = `Showing ${matchedItems} ${itemWord} in ${matchedSections} ${sectionWord}`;
  }

  function applySearch() {
    activeSearchQuery = normalizeText(menuSearchInput.value);
    activeSearchTokens = tokenize(activeSearchQuery);
    const hasQuery = activeSearchQuery.length > 0;
    if (hasQuery && !activeSearchTokens.length) activeSearchTokens = ["\u0000"];

    clearMenuSearch.hidden = !hasQuery;
    clearMenuSearch.style.display = hasQuery ? "" : "none";
    document.body.classList.toggle("menuSearchActive", hasQuery);

    if (!hasQuery) {
      menuNoResults.hidden = true;
      menuNoResults.style.display = "none";
      menuSearchMeta.textContent = "";
      applyGroupView();
      return;
    }

    applySearchResults();
  }

  function updateRailState() {
    const buttons = Array.from(menuCategoryRailList.querySelectorAll(".menuCategoryButton"));
    const activeIndex = buttons.findIndex((button) => button.dataset.groupId === activeGroupId);
    if (activeIndex >= 0) railFocusIndex = activeIndex;
    buttons.forEach((button, index) => {
      const active = button.dataset.groupId === activeGroupId;
      button.classList.toggle("isActive", active);
      button.setAttribute("aria-current", active ? "true" : "false");
      button.tabIndex = index === railFocusIndex ? 0 : -1;
    });

    const activeButton = buttons[activeIndex];
    if (activeButton && !desktopMedia.matches) {
      window.requestAnimationFrame(() => {
        const targetLeft = activeButton.offsetLeft - ((menuCategoryRailList.clientWidth - activeButton.offsetWidth) / 2);
        menuCategoryRailList.scrollTo({ left: Math.max(0, targetLeft), behavior: "auto" });
      });
    }
  }

  function moveRailFocus(nextIndex) {
    const buttons = Array.from(menuCategoryRailList.querySelectorAll(".menuCategoryButton"));
    if (!buttons.length) return;
    railFocusIndex = (nextIndex + buttons.length) % buttons.length;
    buttons.forEach((button, index) => {
      button.tabIndex = index === railFocusIndex ? 0 : -1;
    });
    buttons[railFocusIndex].focus();
  }

  function handleRailKeydown(event) {
    const buttons = Array.from(menuCategoryRailList.querySelectorAll(".menuCategoryButton"));
    const currentIndex = buttons.indexOf(event.currentTarget);
    if (currentIndex < 0) return;

    let nextIndex = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = currentIndex + 1;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = currentIndex - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = buttons.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    moveRailFocus(nextIndex);
  }

  function buildCategoryRail() {
    menuCategoryRailList.replaceChildren();
    const fragment = document.createDocumentFragment();

    menuGroups.forEach((group) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menuCategoryButton";
      button.dataset.groupId = group.id;
      button.innerHTML = `<img class="menuCategoryIcon" src="${group.icon}" alt="" width="20" height="20"><span>${group.label}</span>`;
      button.addEventListener("keydown", handleRailKeydown);
      button.addEventListener("click", () => {
        setActiveGroup(group.id, { updateHash: true });
        void trackClientEvent("menu_category_select", { category: group.id });
      });
      fragment.appendChild(button);
    });

    menuCategoryRailList.appendChild(fragment);
    updateRailState();
  }

  function updateTabState() {
    menuGroupTabs.querySelectorAll(".menuGroupTab").forEach((button) => {
      const active = button.dataset.subcategoryId === activeSubcategoryId;
      button.classList.toggle("isActive", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function handleTabKeydown(event) {
    const tabs = Array.from(menuGroupTabs.querySelectorAll(".menuGroupTab"));
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0) return;

    let nextIndex = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = currentIndex + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = currentIndex - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[(nextIndex + tabs.length) % tabs.length];
    setActiveSubcategory(nextTab.dataset.subcategoryId, { updateHash: true });
    nextTab.focus();
  }

  function buildSubcategoryTabs() {
    const activeGroup = getActiveGroup();
    menuGroupTabs.replaceChildren();
    menuGroupTabs.hidden = activeGroup.sections.length <= 1;
    if (menuGroupTabs.hidden) return;

    menuGroupTabs.setAttribute("role", "tablist");
    menuGroupTabs.setAttribute("aria-label", `${activeGroup.label} sections`);

    const entries = [
      { id: "all", label: "All", controls: activeGroup.sections.map((section) => section.id).join(" ") },
      ...activeGroup.sections.map((section) => ({
        id: section.id,
        label: sectionDisplayLabel(section),
        controls: section.id
      }))
    ];

    const fragment = document.createDocumentFragment();
    entries.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menuGroupTab";
      button.setAttribute("role", "tab");
      button.dataset.subcategoryId = entry.id;
      button.id = `${activeGroup.id}-${entry.id}-tab`;
      button.textContent = entry.label;
      button.setAttribute("aria-controls", entry.controls);
      button.addEventListener("keydown", handleTabKeydown);
      button.addEventListener("click", () => {
        setActiveSubcategory(entry.id, { updateHash: true });
        void trackClientEvent("menu_subcategory_select", {
          category: activeGroupId,
          subcategory: entry.id
        });
      });
      fragment.appendChild(button);
    });
    menuGroupTabs.appendChild(fragment);
    updateTabState();
  }

  function updateActiveGroupCopy() {
    const activeGroup = getActiveGroup();
    menuActiveGroupTitle.textContent = activeGroup.label;
    menuActiveGroupDescription.textContent = activeGroup.description;
  }

  function updateHash(id) {
    const nextHash = `#${id}`;
    if (window.location.hash === nextHash) return;
    try {
      window.history.pushState({ menu: id }, "", nextHash);
    } catch (error) {
      window.location.hash = id;
    }
  }

  function setActiveGroup(groupId, options = {}) {
    const group = menuGroups.find((candidate) => candidate.id === groupId);
    if (!group) return;

    activeGroupId = group.id;
    const requestedSubcategory = options.subcategoryId || "all";
    activeSubcategoryId = requestedSubcategory === "all" || group.sections.some((section) => section.id === requestedSubcategory)
      ? requestedSubcategory
      : "all";
    setActiveJumpChip(activeSubcategoryId === "all" ? activeGroupId : activeSubcategoryId);
    updateRailState();
    updateActiveGroupCopy();
    buildSubcategoryTabs();
    if (activeSearchTokens.length) applySearchResults();
    else applyGroupView();

    if (options.updateHash) {
      updateHash(activeSubcategoryId === "all" ? activeGroupId : activeSubcategoryId);
    }
  }

  function setActiveSubcategory(subcategoryId, options = {}) {
    const group = getActiveGroup();
    if (subcategoryId !== "all" && !group.sections.some((section) => section.id === subcategoryId)) return;
    activeSubcategoryId = subcategoryId;
    setActiveJumpChip(subcategoryId === "all" ? group.id : subcategoryId);
    updateTabState();
    if (activeSearchTokens.length) applySearchResults();
    else applyGroupView();
    if (options.updateHash) updateHash(subcategoryId === "all" ? group.id : subcategoryId);
  }

  function stateFromHash() {
    let id = "";
    try {
      id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    } catch (error) {
      id = window.location.hash.replace(/^#/, "");
    }
    if (!id) return null;

    if (id === "starters-veg") {
      const vegetarianStarters = sectionsByHeading.get("Starters - Vegetarian");
      return {
        groupId: "starters",
        subcategoryId: vegetarianStarters?.id || "all"
      };
    }
    if (id === "starters-non-veg") {
      return { groupId: "starters", subcategoryId: "all" };
    }

    const aliasedGroupId = legacyMenuGroupAliases.get(id);
    if (aliasedGroupId) {
      return { groupId: aliasedGroupId, subcategoryId: "all" };
    }

    const group = menuGroups.find((candidate) => candidate.id === id);
    if (group) return { groupId: group.id, subcategoryId: "all" };

    const section = sectionsById.get(id);
    if (!section) return null;
    return { groupId: sectionGroupIds.get(section), subcategoryId: section.id };
  }

  function applyHashState(options = {}) {
    const state = stateFromHash();
    if (!state) {
      if (options.useDefault) setActiveGroup(defaultGroupId, { subcategoryId: "all" });
      return;
    }
    setActiveGroup(state.groupId, { subcategoryId: state.subcategoryId });
  }

  function applyToggles() {
    document.body.classList.toggle("hide-labels", !labelsToggle.checked);
    document.body.classList.remove("hide-legend");

    const legendGrid = legendSection.querySelector(".legendGrid");
    const showLegendGrid = legendToggle.checked;
    legendToggle.setAttribute("aria-expanded", String(showLegendGrid));
    legendSection.classList.toggle("isLegendGridHidden", !showLegendGrid);
    if (legendGrid) {
      legendGrid.hidden = !showLegendGrid;
      legendGrid.style.display = showLegendGrid ? "" : "none";
    }

    const notice = legendSection.querySelector(".menuAllergenNotice");
    if (notice) {
      notice.hidden = false;
      notice.style.display = "";
      notice.removeAttribute("aria-hidden");
    }
  }

  function clearSearch() {
    window.clearTimeout(searchTimer);
    menuSearchInput.value = "";
    applySearch();
    menuSearchInput.focus();
  }

  function setupControls() {
    labelsToggle.addEventListener("change", applyToggles);
    legendToggle.addEventListener("change", applyToggles);
    menuSearchInput.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(applySearch, 120);
    });
    clearMenuSearch.addEventListener("click", clearSearch);
    clearMenuSearchEmpty.addEventListener("click", clearSearch);

    window.addEventListener("hashchange", () => applyHashState());
    window.addEventListener("popstate", () => applyHashState());

    const onDesktopChange = () => {
      if (activeSearchTokens.length) applySearchResults();
      else applyGroupView();
    };
    if (typeof desktopMedia?.addEventListener === "function") desktopMedia.addEventListener("change", onDesktopChange);
    else if (typeof desktopMedia?.addListener === "function") desktopMedia.addListener(onDesktopChange);

    const onReducedMotionChange = () => {
      document.body.classList.toggle("menuReducedMotion", Boolean(reducedMotionMedia?.matches));
    };
    onReducedMotionChange();
    if (typeof reducedMotionMedia?.addEventListener === "function") reducedMotionMedia.addEventListener("change", onReducedMotionChange);
    else if (typeof reducedMotionMedia?.addListener === "function") reducedMotionMedia.addListener(onReducedMotionChange);
  }

  function setupSectionReveal() {
    contentSections.forEach((section) => section.classList.add("sectionPreReveal", "isVisible"));
  }

  function initialize() {
    if (!requiredHooksExist()) return;

    ensureSectionIdsAndGroups();
    decorateLabels(main);
    setupAccordions();
    setupSafetyLegend();
    buildSearchIndex();
    buildCategoryRail();
    setupSectionReveal();
    setupControls();
    applyToggles();
    applyHashState({ useDefault: true });
    applySearch();

    legendSection.classList.add("isVisible");
    document.body.classList.add("menuWorkspaceReady");

    void trackClientEvent("menu_page_view", {
      page: "menu",
      route: window.location.pathname
    });
  }

  initialize();
}());
