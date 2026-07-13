"use strict";

(function menuPage() {
  const knownCodes = new Set([
    "LC", "V", "VE", "VG", "M", "ME", "MS", "HT", "VH",
    "CE", "G", "CR", "E", "F", "L", "D", "MO", "MU", "P", "SE", "SO", "SU", "N"
  ]);
  const jumpLabelOverrides = new Map([
    ["Shakes and Chillers", "Shakes"],
    ["Desserts and Cakes", "Desserts"],
    ["Starters - Mixed", "Mixed Starters"],
    ["Starters - Lamb", "Lamb Starters"],
    ["Starters - Seafood", "Seafood Starters"],
    ["Starters - Vegetarian", "Veg Starters"],
    ["Starters - Chicken", "Chicken Starters"],
    ["Mumbai Sizzle Burgers", "Burgers"],
    ["Vegetarian Mains", "Veg Mains"],
    ["Biryani Dishes", "Biryani"],
    ["Tandoori Dishes", "Tandoori"],
    ["Vegetarian Specialities", "Vegetarian"],
    ["Medium Dishes", "Medium"],
    ["Hot Dishes", "Hot"],
    ["Very Hot Dishes", "Very Hot"],
    ["Bread & Snacks", "Bread & Snacks"],
    ["Side Dishes", "Side Dishes"],
    ["Mumbai Sizzle Burger Style", "Burgers"],
    ["Kiddies Corner", "Kiddies"]
  ]);
  const jumpCollapsedStorageKey = "millers.menu.jump-collapsed";

  const labelsToggle = document.getElementById("labelsToggle");
  const legendToggle = document.getElementById("legendToggle");
  const menuSearchInput = document.getElementById("menuSearchInput");
  const clearMenuSearch = document.getElementById("clearMenuSearch");
  const menuJumpChips = document.getElementById("menuJumpChips");
  const menuSearchMeta = document.getElementById("menuSearchMeta");
  const menuToolsPanel = document.querySelector(".menuTools");
  const menuJumpWrap = document.getElementById("menuJumpWrap");
  const jumpMenuToggle = document.getElementById("jumpMenuToggle");
  const legendSection = document.querySelector(".menuLegend");
  const main = document.querySelector("main");
  const menuSections = Array.from(document.querySelectorAll(".menuSection.menuGroup"));
  const contentSections = menuSections.filter((section) => !section.classList.contains("menuLegend"));
  const searchIndex = new Map();

  let activeJumpChipId = "";
  let searchTimer = 0;

  let prefersReducedMotion = false;
  try {
    prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (error) {
    prefersReducedMotion = false;
  }

  function trackClientEvent(eventName, details = {}) {
    if (!window.MillersClient || typeof window.MillersClient.trackEvent !== "function") {
      return Promise.resolve(false);
    }
    return window.MillersClient.trackEvent(eventName, details);
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normalizeText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function decorateLabels(root) {
    root.querySelectorAll(".menuName").forEach((el) => {
      const raw = (el.textContent || "").replace(/\s+/g, " ").trim();
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

      el.textContent = cleaned;
      if (!found.length) return;

      const textCodes = document.createElement("span");
      textCodes.className = "labelText";
      textCodes.textContent = ` (${found.join(", ")})`;
      el.appendChild(textCodes);

      const wrap = document.createElement("span");
      wrap.className = "labels";
      wrap.setAttribute("aria-hidden", "true");
      found.forEach((code) => {
        const chip = document.createElement("span");
        chip.className = "label";
        chip.textContent = code;
        wrap.appendChild(chip);
      });
      el.appendChild(wrap);
    });
  }

  function allSections() {
    return menuSections;
  }

  function searchableSections() {
    return contentSections;
  }

  function applyToggles() {
    document.body.classList.toggle("hide-labels", !(labelsToggle && labelsToggle.checked));
    document.body.classList.toggle("hide-legend", !(legendToggle && legendToggle.checked));
  }

  function ensureSectionIds() {
    const used = new Set();
    searchableSections().forEach((section, index) => {
      const heading = section.querySelector(".tileTitle");
      const rawHeading = (heading?.textContent || "").replace(/\s+/g, " ").trim();
      const fallback = `section-${index + 1}`;
      const base = slugify(rawHeading) || fallback;
      let id = base;
      let num = 2;
      while (used.has(id) || document.getElementById(id)) {
        id = `${base}-${num}`;
        num += 1;
      }
      section.id = id;
      section.dataset.jumpTitle = rawHeading;
      used.add(id);
    });
  }

  function toJumpLabel(rawHeading) {
    if (!rawHeading) return "Section";
    const normalized = rawHeading.replace(/\s+/g, " ").trim();
    if (jumpLabelOverrides.has(normalized)) return jumpLabelOverrides.get(normalized);

    const withoutTail = normalized
      .replace(/\bDishes\b/gi, "")
      .replace(/\bSpecialities\b/gi, "Specials")
      .replace(/\s+/g, " ")
      .trim();

    if (withoutTail.length <= 16) return withoutTail;
    const words = withoutTail.split(" ");
    if (words.length >= 2) return `${words[0]} ${words[1]}`;
    return withoutTail.slice(0, 16).trim();
  }

  function getStickyToolsOffset() {
    if (!(menuToolsPanel instanceof HTMLElement)) return 22;
    const rect = menuToolsPanel.getBoundingClientRect();
    const styles = window.getComputedStyle(menuToolsPanel);
    const marginBottom = Number.parseFloat(styles.marginBottom || "0") || 0;
    return Math.ceil(rect.height + marginBottom + 14);
  }

  function getAccordionBody(section) {
    return section.querySelector(":scope > .accordionBody");
  }

  function setCollapsed(section, collapsed, options = {}) {
    section.classList.toggle("collapsed", collapsed);

    const toggle = section.querySelector(":scope > .tileTitle > .menuAccordionToggle");
    if (toggle) toggle.setAttribute("aria-expanded", String(!collapsed));

    const body = getAccordionBody(section);
    if (!body) return;

    body.setAttribute("aria-hidden", String(collapsed));
    if (collapsed) {
      body.setAttribute("inert", "");
    } else {
      body.removeAttribute("inert");
    }

    if (collapsed) {
      body.style.maxHeight = "0px";
      body.style.opacity = "0";
    } else {
      body.style.opacity = "1";
      body.style.maxHeight = "none";
    }
  }

  function setupAccordions() {
    searchableSections().forEach((section) => {
      section.classList.add("accordion");

      const title = section.querySelector(":scope > .tileTitle");
      if (!title) return;

      let body = getAccordionBody(section);
      if (!body) {
        body = document.createElement("div");
        body.className = "accordionBody";
        while (title.nextSibling) {
          body.appendChild(title.nextSibling);
        }
        section.appendChild(body);
      }

      const titleText = normalizeText(title.textContent);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "menuAccordionToggle";
      toggle.textContent = titleText;
      body.id = `${section.id}-content`;
      toggle.setAttribute("aria-controls", body.id);
      title.replaceChildren(toggle);

      const toggleSection = () => setCollapsed(section, !section.classList.contains("collapsed"));
      toggle.addEventListener("click", toggleSection);

      setCollapsed(section, true, { immediate: true });
    });
  }

  function applySectionScrollMargins() {
    const offset = getStickyToolsOffset();
    searchableSections().forEach((section) => {
      section.style.scrollMarginTop = `${offset}px`;
    });
  }

  function refreshExpandedSectionsHeight() {
    // Accordion bodies use content-driven height. Avoid scrollHeight reads that
    // force layout across the entire menu during resize and search.
  }

  function scrollToSection(section) {
    const offset = getStickyToolsOffset();
    const top = section.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({
      top: Math.max(0, top),
      behavior: prefersReducedMotion ? "auto" : "smooth"
    });
  }

  function setActiveJumpChip(id) {
    if (!menuJumpChips) return;
    if (activeJumpChipId === id) return;
    activeJumpChipId = id;
    menuJumpChips.querySelectorAll(".jumpChip").forEach((button) => {
      const active = button.dataset.targetSection === id;
      button.classList.toggle("isActive", active);
      button.setAttribute("aria-current", active ? "true" : "false");
    });
  }

  function buildJumpChips() {
    if (!menuJumpChips) return;
    const previousActiveId = activeJumpChipId;
    activeJumpChipId = "";
    menuJumpChips.innerHTML = "";
    const fragment = document.createDocumentFragment();

    searchableSections()
      .filter((section) => !section.classList.contains("noSearchMatch"))
      .forEach((section) => {
        const heading = section.querySelector(".tileTitle");
        if (!heading) return;

        const fullHeading = (section.dataset.jumpTitle || heading.textContent || "").replace(/\s+/g, " ").trim();
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "jumpChip";
        chip.textContent = toJumpLabel(fullHeading);
        chip.title = fullHeading;
        chip.dataset.targetSection = section.id;
        chip.addEventListener("click", () => {
          setCollapsed(section, false);
          scrollToSection(section);
          setActiveJumpChip(section.id);
        });

        fragment.appendChild(chip);
      });

    menuJumpChips.appendChild(fragment);
    if (previousActiveId && document.getElementById(previousActiveId)?.classList.contains("noSearchMatch") === false) {
      setActiveJumpChip(previousActiveId);
    }
  }

  function syncActiveJumpChipFromViewport() {
    const sections = searchableSections().filter((section) => !section.classList.contains("noSearchMatch"));
    if (!sections.length) return;

    let bestSection = sections[0];
    let bestScore = Number.POSITIVE_INFINITY;
    const anchorY = Math.max(140, window.innerHeight * 0.24);

    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      if (rect.bottom < 120 || rect.top > window.innerHeight - 70) return;
      const score = Math.abs(rect.top - anchorY);
      if (score < bestScore) {
        bestScore = score;
        bestSection = section;
      }
    });

    setActiveJumpChip(bestSection.id);
  }

  function setJumpMenuCollapsed(collapsed, options = {}) {
    if (!menuJumpWrap || !jumpMenuToggle || !menuJumpChips) return;

    menuJumpWrap.classList.toggle("isCollapsed", collapsed);
    jumpMenuToggle.checked = !collapsed;
    menuJumpChips.hidden = collapsed;
    menuJumpChips.setAttribute("aria-hidden", String(collapsed));

    if (options.persist !== false) {
      try {
        window.localStorage.setItem(jumpCollapsedStorageKey, collapsed ? "1" : "0");
      } catch (error) {
        // ignore storage failures
      }
    }

    applySectionScrollMargins();
  }

  function setupJumpMenuToggle() {
    if (!menuJumpWrap || !jumpMenuToggle) return;

    let shouldCollapse = false;
    try {
      shouldCollapse = window.localStorage.getItem(jumpCollapsedStorageKey) === "1";
    } catch (error) {
      shouldCollapse = false;
    }

    setJumpMenuCollapsed(shouldCollapse, { persist: false });
    jumpMenuToggle.addEventListener("change", () => {
      setJumpMenuCollapsed(!jumpMenuToggle.checked);
    });
  }

  function applySearch() {
    const query = normalizeText(menuSearchInput?.value || "").toLowerCase();
    const sections = searchableSections();

    if (!query) {
      sections.forEach((section) => {
        section.classList.remove("noSearchMatch");
        section.querySelectorAll(".menuItem.hiddenBySearch").forEach((item) => item.classList.remove("hiddenBySearch"));
        setCollapsed(section, true, { immediate: true });
      });
      if (menuSearchMeta) menuSearchMeta.textContent = "";
      buildJumpChips();
      refreshExpandedSectionsHeight();
      return;
    }

    let matchedSections = 0;
    let matchedItems = 0;

    sections.forEach((section) => {
      const indexedSection = searchIndex.get(section);
      const headingText = indexedSection?.headingText || "";
      const sectionTitleMatch = headingText.includes(query);
      const items = indexedSection?.items || [];
      let sectionHasMatch = false;
      let localMatches = 0;

      items.forEach(({ element, text }) => {
        const itemMatch = sectionTitleMatch || text.includes(query);
        element.classList.toggle("hiddenBySearch", !itemMatch);
        if (itemMatch) {
          sectionHasMatch = true;
          localMatches += 1;
        }
      });

      section.classList.toggle("noSearchMatch", !sectionHasMatch);
      if (sectionHasMatch) {
        matchedSections += 1;
        matchedItems += localMatches;
        setCollapsed(section, false, { immediate: true });
      } else {
        setCollapsed(section, true, { immediate: true });
      }
    });

    if (menuSearchMeta) {
      if (!matchedSections) {
        menuSearchMeta.textContent = `No matches for "${menuSearchInput?.value.trim() || ""}"`;
      } else {
        const sectionWord = matchedSections === 1 ? "section" : "sections";
        const itemWord = matchedItems === 1 ? "item" : "items";
        menuSearchMeta.textContent = `Showing ${matchedItems} ${itemWord} in ${matchedSections} ${sectionWord}`;
      }
    }

    buildJumpChips();
    refreshExpandedSectionsHeight();
  }

  function setupSectionReveal() {
    allSections().forEach((section) => section.classList.add("sectionPreReveal", "isVisible"));
  }

  function setupTracking() {
    let ticking = false;
    let lastSync = 0;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame((timestamp) => {
        if (timestamp - lastSync >= 120) {
          syncActiveJumpChipFromViewport();
          lastSync = timestamp;
        }
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", () => {
      applySectionScrollMargins();
      refreshExpandedSectionsHeight();
      syncActiveJumpChipFromViewport();
    });
  }

  function setupControls() {
    labelsToggle?.addEventListener("change", applyToggles);
    legendToggle?.addEventListener("change", applyToggles);
    menuSearchInput?.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(applySearch, 120);
    });
    clearMenuSearch?.addEventListener("click", () => {
      if (!menuSearchInput) return;
      window.clearTimeout(searchTimer);
      menuSearchInput.value = "";
      applySearch();
      menuSearchInput.focus();
    });
  }

  function buildSearchIndex() {
    searchableSections().forEach((section) => {
      searchIndex.set(section, {
        headingText: normalizeText(section.dataset.jumpTitle || "").toLowerCase(),
        items: Array.from(section.querySelectorAll(".menuItem"), (element) => ({
          element,
          text: normalizeText(element.textContent).toLowerCase()
        }))
      });
    });
  }

  function initialize() {
    decorateLabels(main || document.body);
    ensureSectionIds();
    setupAccordions();
    buildSearchIndex();
    setupSectionReveal();
    applyToggles();
    setupJumpMenuToggle();
    applySectionScrollMargins();
    applySearch();
    setupTracking();
    setupControls();

    void trackClientEvent("menu_page_view", {
      page: "menu",
      route: window.location.pathname
    });

    if (legendSection instanceof HTMLElement) {
      legendSection.classList.add("isVisible");
    }
  }

  initialize();
}());
