"use strict";

const labelsToggle = document.getElementById("labelsToggle");
const legendToggle = document.getElementById("legendToggle");
const menuSearchInput = document.getElementById("menuSearchInput");
const clearMenuSearch = document.getElementById("clearMenuSearch");
const menuJumpChips = document.getElementById("menuJumpChips");
const menuSearchMeta = document.getElementById("menuSearchMeta");

const knownCodes = new Set(["LC", "V", "VE", "M", "ME", "MS", "HT", "VH", "G", "D", "N"]);
const allSections = Array.from(document.querySelectorAll(".menuSection.menuGroup"));
const searchableSections = allSections.filter((section) => !section.classList.contains("menuLegend"));
const chipMap = new Map();
const jumpLabelOverrides = new Map([
  ["Timeless Classics", "Classics"],
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

let prefersReducedMotion = false;
try {
  prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
} catch (error) {
  prefersReducedMotion = false;
}

function decorateLabels() {
  document.querySelectorAll(".menuName").forEach((el) => {
    const raw = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!raw) return;

    const found = [];
    const cleaned = raw.replace(/\(([^()]+)\)/g, (full, inner) => {
      const tokens = inner.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
      if (!tokens.length) return full;
      if (!tokens.every((token) => knownCodes.has(token))) return full;
      tokens.forEach((token) => {
        if (!found.includes(token)) found.push(token);
      });
      return "";
    }).replace(/\s{2,}/g, " ").trim();

    if (!found.length) {
      if (cleaned !== raw) el.textContent = cleaned;
      return;
    }

    el.textContent = cleaned;
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

function applyToggles() {
  document.body.classList.toggle("hide-labels", !(labelsToggle && labelsToggle.checked));
  document.body.classList.toggle("hide-legend", !(legendToggle && legendToggle.checked));
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureSectionIds() {
  const used = new Set();
  searchableSections.forEach((section, index) => {
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

function getAccordionBody(section) {
  return section.querySelector(":scope > .accordionBody");
}

function setCollapsed(section, collapsed, options = {}) {
  section.classList.toggle("collapsed", collapsed);

  const title = section.querySelector(":scope > .tileTitle");
  if (title) title.setAttribute("aria-expanded", String(!collapsed));

  const body = getAccordionBody(section);
  if (!body) return;

  const immediate = Boolean(options.immediate);

  if (collapsed) {
    if (!immediate) {
      if (body.style.maxHeight === "none" || !body.style.maxHeight) {
        body.style.maxHeight = `${body.scrollHeight}px`;
        body.getBoundingClientRect();
      }
    }
    body.style.maxHeight = "0px";
    body.style.opacity = "0";
  } else {
    body.style.opacity = "1";
    body.style.maxHeight = `${body.scrollHeight}px`;
    if (immediate) body.style.maxHeight = "none";
  }
}

function setupAccordions() {
  searchableSections.forEach((section) => {
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

    body.addEventListener("transitionend", (event) => {
      if (event.propertyName !== "max-height") return;
      if (!section.classList.contains("collapsed")) {
        body.style.maxHeight = "none";
      }
    });

    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");

    const toggleSection = () => setCollapsed(section, !section.classList.contains("collapsed"));
    title.addEventListener("click", toggleSection);
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleSection();
      }
    });

    setCollapsed(section, true, { immediate: true });
  });
}

function setupSectionReveal() {
  allSections.forEach((section) => section.classList.add("sectionPreReveal"));

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    allSections.forEach((section) => section.classList.add("isVisible"));
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("isVisible");
      obs.unobserve(entry.target);
    });
  }, {
    threshold: 0.16,
    rootMargin: "0px 0px -8% 0px"
  });

  allSections.forEach((section) => observer.observe(section));
}

function setActiveJumpChip(id) {
  chipMap.forEach((button, sectionId) => {
    const active = sectionId === id;
    button.classList.toggle("isActive", active);
    button.setAttribute("aria-current", active ? "true" : "false");
  });
}

function syncActiveJumpChipFromViewport() {
  if (!chipMap.size) return;

  let bestSection = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const anchorY = Math.max(140, window.innerHeight * 0.24);

  searchableSections.forEach((section) => {
    if (section.classList.contains("noSearchMatch")) return;

    const rect = section.getBoundingClientRect();
    if (rect.bottom < 120 || rect.top > window.innerHeight - 70) return;

    const score = Math.abs(rect.top - anchorY);
    if (score < bestScore) {
      bestScore = score;
      bestSection = section;
    }
  });

  if (!bestSection) {
    bestSection = searchableSections.find((section) => !section.classList.contains("noSearchMatch")) || null;
  }

  if (bestSection) setActiveJumpChip(bestSection.id);
}

function buildJumpChips() {
  if (!menuJumpChips) return;
  menuJumpChips.innerHTML = "";
  chipMap.clear();

  searchableSections
    .filter((section) => !section.classList.contains("noSearchMatch"))
    .forEach((section) => {
      const heading = section.querySelector(".tileTitle");
      if (!heading) return;
      const fullHeading = (section.dataset.jumpTitle || heading.textContent || "").replace(/\s+/g, " ").trim();
      const jumpLabel = toJumpLabel(fullHeading);

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "jumpChip";
      chip.textContent = jumpLabel;
      chip.title = fullHeading;
      chip.setAttribute("aria-label", `Jump to ${fullHeading}`);
      chip.dataset.targetSection = section.id;
      chip.addEventListener("click", () => {
        setCollapsed(section, false);
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveJumpChip(section.id);
      });

      menuJumpChips.appendChild(chip);
      chipMap.set(section.id, chip);
    });

  syncActiveJumpChipFromViewport();
}

function refreshExpandedSectionsHeight() {
  searchableSections.forEach((section) => {
    if (section.classList.contains("collapsed")) return;
    const body = getAccordionBody(section);
    if (!body) return;
    if (body.style.maxHeight === "none") return;
    body.style.maxHeight = `${body.scrollHeight}px`;
  });
}

function applySearch() {
  const query = (menuSearchInput?.value || "").trim().toLowerCase();

  if (!query) {
    searchableSections.forEach((section) => {
      section.classList.remove("noSearchMatch");
      section.querySelectorAll(".menuItem.hiddenBySearch").forEach((item) => {
        item.classList.remove("hiddenBySearch");
      });
      setCollapsed(section, true);
    });

    if (menuSearchMeta) menuSearchMeta.textContent = "";
    buildJumpChips();
    refreshExpandedSectionsHeight();
    return;
  }

  let matchedSections = 0;
  let matchedItems = 0;

  searchableSections.forEach((section) => {
    const headingText = (section.querySelector(".tileTitle")?.textContent || "").toLowerCase();
    const sectionTitleMatch = headingText.includes(query);
    const items = Array.from(section.querySelectorAll(".menuItem"));
    let sectionHasMatch = false;
    let localMatches = 0;

    items.forEach((item) => {
      const itemMatch = sectionTitleMatch || item.textContent.toLowerCase().includes(query);
      item.classList.toggle("hiddenBySearch", !itemMatch);
      if (itemMatch) {
        sectionHasMatch = true;
        localMatches += 1;
      }
    });

    if (!items.length) {
      sectionHasMatch = sectionTitleMatch || section.textContent.toLowerCase().includes(query);
    }

    section.classList.toggle("noSearchMatch", !sectionHasMatch);

    if (sectionHasMatch) {
      matchedSections += 1;
      matchedItems += localMatches;
      setCollapsed(section, false);
    } else {
      setCollapsed(section, true);
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

function setupStickySectionTracking() {
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      syncActiveJumpChipFromViewport();
      ticking = false;
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    refreshExpandedSectionsHeight();
    syncActiveJumpChipFromViewport();
  });
}

function setupRipples() {
  const selector = ".tile, .jumpChip, .searchClearBtn, .flipBackBtn, .flipLink";

  document.querySelectorAll(selector).forEach((el) => {
    if (el instanceof HTMLElement) el.classList.add("rippleHost");
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const host = target.closest(selector);
    if (!(host instanceof HTMLElement)) return;

    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.2;
    const ripple = document.createElement("span");
    ripple.className = "tileRipple";
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    host.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  });
}

if (labelsToggle) labelsToggle.addEventListener("change", applyToggles);
if (legendToggle) legendToggle.addEventListener("change", applyToggles);
if (menuSearchInput) menuSearchInput.addEventListener("input", applySearch);
if (clearMenuSearch) {
  clearMenuSearch.addEventListener("click", () => {
    if (!menuSearchInput) return;
    menuSearchInput.value = "";
    applySearch();
    menuSearchInput.focus();
  });
}

ensureSectionIds();
decorateLabels();
setupAccordions();
setupSectionReveal();
applyToggles();
buildJumpChips();
applySearch();
setupStickySectionTracking();
// disabled: static mode
// setupRipples();
