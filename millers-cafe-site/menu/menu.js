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
    const fallback = `section-${index + 1}`;
    const base = slugify((heading?.textContent || "").trim()) || fallback;
    let id = base;
    let num = 2;
    while (used.has(id) || document.getElementById(id)) {
      id = `${base}-${num}`;
      num += 1;
    }
    section.id = id;
    used.add(id);
  });
}

function setCollapsed(section, collapsed) {
  section.classList.toggle("collapsed", collapsed);
  const title = section.querySelector(".tileTitle");
  if (title) title.setAttribute("aria-expanded", String(!collapsed));
}

function setupAccordions() {
  document.querySelectorAll(".menuSection.menuGroup").forEach((section) => {
    if (section.classList.contains("menuLegend")) return;
    section.classList.add("accordion");
    setCollapsed(section, true);

    const title = section.querySelector(".tileTitle");
    if (!title) return;
    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");

    const toggleSection = () => setCollapsed(section, !section.classList.contains("collapsed"));
    title.addEventListener("click", toggleSection);
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSection();
      }
    });
  });
}

function buildJumpChips() {
  if (!menuJumpChips) return;
  menuJumpChips.innerHTML = "";

  searchableSections
    .filter((section) => !section.classList.contains("noSearchMatch"))
    .forEach((section) => {
      const heading = section.querySelector(".tileTitle");
      if (!heading) return;

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "jumpChip";
      chip.textContent = heading.textContent.trim();
      chip.addEventListener("click", () => {
        setCollapsed(section, false);
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      menuJumpChips.appendChild(chip);
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
applyToggles();
buildJumpChips();
applySearch();
