"use strict";

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

import {
  MILLERS_ORDER_MENU,
  getMenuItemDietaryDisplay
} from "../orders/menu-catalog.js";

const MENU_HTML_URL = new URL("../menu/index.html", import.meta.url);
const MENU_JS_URL = new URL("../menu/menu.js", import.meta.url);
const STYLES_URL = new URL("../styles.css", import.meta.url);
const MENU_HTML = readFileSync(MENU_HTML_URL, "utf8");
const MENU_JS = readFileSync(MENU_JS_URL, "utf8");
const STYLES = readFileSync(STYLES_URL, "utf8");

const ORDER_LAYER_MARKER = "/* Millers quick-order workspace — option 2 */";
const MENU_LAYER_MARKER = "/* Millers guided menu workspace — option 3 */";
const MAX_MENU_IMAGE_BYTES = 350 * 1024;
const PRINTED_STARTER_CATEGORY_ORDER = Object.freeze([
  "Starters - Vegetarian",
  "Starters - Chicken",
  "Starters - Lamb",
  "Starters - Mixed",
  "Starters - Seafood"
]);

const CONDITIONAL_VEGAN_COPY = Object.freeze({
  "Vegetable Biryani": "The standard dish is the vegan option. The Parda upgrade includes garlic naan, cheese and sauce, so it is not vegan.",
  curry: "Vegan base option with Vegetables; meat and fish protein choices are not vegan."
});

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&pound;/gi, "£")
    .replace(/&quot;/gi, "\"")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\b${escapedName}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "i").exec(tag);
  return match?.[2] || "";
}

function parseDisplayedName(rawName) {
  const displayedName = decodeHtml(rawName);
  const suffix = /\s*\(([^()]*)\)\s*$/.exec(displayedName);
  if (!suffix) return displayedName;

  const tokens = suffix[1]
    .split(/[^A-Za-z]+/)
    .map((token) => token.toUpperCase())
    .filter(Boolean);
  const canonicalCodes = new Set(
    MILLERS_ORDER_MENU.flatMap((category) =>
      category.items.flatMap((item) => (item.codes || []).map((code) => String(code).toUpperCase()))
    )
  );
  if (!tokens.length || !tokens.every((token) => canonicalCodes.has(token))) return displayedName;
  return displayedName.slice(0, suffix.index).trim();
}

function parseStaticMenu(html) {
  const categories = [];
  const sectionPattern = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;

  for (const sectionMatch of html.matchAll(sectionPattern)) {
    const sectionClasses = getAttribute(sectionMatch[1], "class").split(/\s+/).filter(Boolean);
    if (!sectionClasses.includes("menuSection") || !sectionClasses.includes("menuGroup")) continue;
    if (sectionClasses.includes("menuLegend")) continue;

    const body = sectionMatch[2];
    const headingMatch = /<h2\b[^>]*class=(["'])[^"']*\btileTitle\b[^"']*\1[^>]*>([\s\S]*?)<\/h2>/i.exec(body);
    assert.ok(headingMatch, "every public menu category needs a tileTitle heading");

    const items = [];
    const itemPattern = /<div\b[^>]*class=(["'])[^"']*\bmenuItem\b[^"']*\1[^>]*>([\s\S]*?)<div\b[^>]*class=(["'])[^"']*\bmenuPrice\b[^"']*\3[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    for (const itemMatch of body.matchAll(itemPattern)) {
      const itemBody = itemMatch[2];
      const nameMatch = /<div\b[^>]*class=(["'])[^"']*\bmenuName\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/i.exec(itemBody);
      assert.ok(nameMatch, `${decodeHtml(headingMatch[2])} contains a menu row without a name`);
      const descriptionMatch = /<div\b[^>]*class=(["'])[^"']*\bmenuDesc\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/i.exec(itemBody);
      items.push({
        name: parseDisplayedName(nameMatch[2]),
        price: decodeHtml(itemMatch[4]),
        description: decodeHtml(descriptionMatch?.[2] || "")
      });
    }

    categories.push({
      name: decodeHtml(headingMatch[2]),
      items
    });
  }

  return categories;
}

function formatCanonicalPrice(item) {
  if (item.publicPriceLabel) return String(item.publicPriceLabel).trim();
  const price = Number(item.basePrice);
  assert.equal(Number.isFinite(price), true, `${item.name} needs a finite canonical base price`);
  return `£${Number.isInteger(price) ? price : price.toFixed(2)}`;
}

function expectedPublicDescription(item) {
  const canonical = String(item.description || "").trim();
  const dietary = getMenuItemDietaryDisplay(item);
  if (!dietary || dietary.confirmed || dietary.kind !== "vegan") return canonical;

  const qualifier = CONDITIONAL_VEGAN_COPY[item.name] || CONDITIONAL_VEGAN_COPY.curry;
  return [canonical, qualifier].filter(Boolean).join(" ");
}

function tagsFrom(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function documentMarkupOnly(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "");
}

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = "";
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function objectLiteralContaining(source, pattern, context) {
  const match = pattern.exec(source);
  assert.ok(match, `missing ${context}`);
  const open = source.lastIndexOf("{", match.index);
  assert.ok(open >= 0, `${context} must be an object literal`);
  const close = findMatchingBrace(source, open);
  assert.ok(close > open, `${context} must have balanced braces`);
  return source.slice(open, close + 1);
}

function stringArrayProperty(objectSource, property) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const arrayMatch = new RegExp(`\\b${escapedProperty}\\s*:\\s*\\[([\\s\\S]*?)\\]`).exec(objectSource);
  assert.ok(arrayMatch, `${property} must be an array`);
  return [...arrayMatch[1].matchAll(/(["'])(.*?)\1/g)].map((match) => match[2]);
}

function collectCssRules(source) {
  const rules = [];
  let cursor = 0;

  while (cursor < source.length) {
    const open = source.indexOf("{", cursor);
    if (open < 0) break;
    const close = findMatchingBrace(source, open);
    assert.ok(close > open, "menu CSS must have balanced braces");
    const prelude = source.slice(cursor, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const body = source.slice(open + 1, close);

    if (/^@(?:media|supports|container|layer)\b/i.test(prelude)) {
      rules.push(...collectCssRules(body));
    } else if (!/^@(?:keyframes|-webkit-keyframes)\b/i.test(prelude)) {
      rules.push({ selector: prelude, body });
    }
    cursor = close + 1;
  }

  return rules.filter(({ selector }) => selector && !selector.startsWith("@"));
}

function collectCssAtRules(source, atRuleName) {
  const results = [];
  const pattern = new RegExp(`@${atRuleName}\\b`, "gi");
  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf("{", match.index);
    if (open < 0) continue;
    const close = findMatchingBrace(source, open);
    if (close < 0) continue;
    results.push({
      prelude: source.slice(match.index, open).trim(),
      body: source.slice(open + 1, close)
    });
  }
  return results;
}

function rulesContaining(rules, selectorText) {
  return rules.filter(({ selector }) => selector.includes(selectorText));
}

function topLevelCssTokens(value) {
  const tokens = [];
  let current = "";
  let depth = 0;
  for (const char of value.trim()) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

test("public menu keeps exact canonical category and item parity", () => {
  const actual = parseStaticMenu(MENU_HTML);
  assert.equal(actual.length, 27, "the public menu must render every canonical category");
  assert.equal(actual.reduce((count, category) => count + category.items.length, 0), 177);

  assert.deepEqual(
    actual.map((category) => category.name),
    MILLERS_ORDER_MENU.map((category) => category.name),
    "category names and order must match the checkout catalogue"
  );

  actual.forEach((actualCategory, categoryIndex) => {
    const canonicalCategory = MILLERS_ORDER_MENU[categoryIndex];
    assert.deepEqual(
      actualCategory.items.map((item) => item.name),
      canonicalCategory.items.map((item) => item.name),
      `${canonicalCategory.name} must keep canonical item names and order`
    );
    assert.deepEqual(
      actualCategory.items.map((item) => item.price),
      canonicalCategory.items.map(formatCanonicalPrice),
      `${canonicalCategory.name} must keep canonical displayed prices`
    );
    assert.deepEqual(
      actualCategory.items.map((item) => item.description),
      canonicalCategory.items.map(expectedPublicDescription),
      `${canonicalCategory.name} descriptions may only use canonical copy and the verified conditional-vegan qualifier`
    );
  });
});

test("option 3 menu workspace exposes its complete semantic shell", () => {
  [
    "menuCategoryRailList",
    "menuGroupTabs",
    "menuActiveGroupTitle",
    "menuActiveGroupDescription",
    "menuNoResults",
    "menuSafetySlot"
  ].forEach((id) => {
    assert.equal((MENU_HTML.match(new RegExp(`\\bid=[\"']${id}[\"']`, "g")) || []).length, 1, `#${id} must exist once`);
  });

  assert.match(MENU_HTML, /<a\b[^>]*href=["']\.\.\/collection\/["'][^>]*>[\s\S]*?Collection[\s\S]*?<\/a>/i);
  assert.match(MENU_HTML, /<a\b[^>]*href=["']\.\.\/delivery\/["'][^>]*>[\s\S]*?Delivery[\s\S]*?<\/a>/i);
  assert.match(MENU_HTML, /\bclass=["'][^"']*\bmenuBrowseContext\b/i);
  assert.match(MENU_HTML, /\bclass=["'][^"']*\bmenuWorkspace\b/i);
  assert.match(MENU_HTML, /\bclass=["'][^"']*\bmenuCategoryRail\b/i);
  assert.match(MENU_HTML, /\bclass=["'][^"']*\bmenuBrowseMain\b/i);
  assert.match(MENU_HTML, /\bclass=["'][^"']*\bmenuOrderRail\b/i);
  assert.match(MENU_HTML, /\bclass=["'][^"']*\bmenuMobileOrderBar\b/i);

  const heroMarkup = /<section\b[^>]*class=(["'])[^"']*\bmenuFavouritesHero\b[^"']*\1[^>]*>([\s\S]*?)<\/section>/i.exec(MENU_HTML)?.[2] || "";
  const heroTag = tagsFrom(heroMarkup, "img")[0];
  assert.ok(heroTag, "the guided workspace needs its favourites hero image");
  assert.match(getAttribute(heroTag, "class"), /\bmenuFavouritesHeroImage\b/);
  assert.equal(getAttribute(heroTag, "src"), "../assets/menu-favourites-hero.jpg");
  assert.equal(getAttribute(heroTag, "width"), "1600");
  assert.equal(getAttribute(heroTag, "height"), "560");
  assert.ok(getAttribute(heroTag, "alt").trim(), "the menu hero needs descriptive alternative text");
});

test("public menu groups every printed starter subsection under one Starters category", () => {
  const menuGroupDefinitions = extractBetween(
    MENU_JS,
    "const menuGroups = [",
    "];\n\n  const defaultGroupId"
  );
  const starterGroup = objectLiteralContaining(
    menuGroupDefinitions,
    /\bid\s*:\s*["']starters["']/,
    "the Starters menu group"
  );

  assert.match(starterGroup, /\blabel\s*:\s*["']Starters["']/);
  assert.deepEqual(
    stringArrayProperty(starterGroup, "headings"),
    PRINTED_STARTER_CATEGORY_ORDER,
    "starter subsections must follow the order on the printed menu"
  );
  assert.equal((menuGroupDefinitions.match(/\bid\s*:\s*["']starters["']/g) || []).length, 1);
  assert.doesNotMatch(menuGroupDefinitions, /Starters\s*[·•]\s*(?:Veg|Non-Veg)/i);
  assert.doesNotMatch(menuGroupDefinitions, /starters-(?:veg|non-veg)/i);
  assert.match(MENU_JS, /id\s*===\s*["']starters-veg["'][\s\S]{0,220}groupId\s*:\s*["']starters["']/);
  assert.match(MENU_JS, /id\s*===\s*["']starters-non-veg["'][\s\S]{0,220}groupId\s*:\s*["']starters["']/);
});

test("menu controller provides grouped, keyboard-friendly, URL-addressable browsing", () => {
  [
    "menuCategoryRailList",
    "menuGroupTabs",
    "menuActiveGroupTitle",
    "menuActiveGroupDescription",
    "menuNoResults",
    "menuSafetySlot"
  ].forEach((id) => assert.match(MENU_JS, new RegExp(`[\"']${id}[\"']`), `${id} must be wired by menu.js`));

  assert.match(MENU_JS, /(?:MENU|menu)[A-Za-z_]*(?:GROUPS|Groups|groups)|groupedCategories/);
  MILLERS_ORDER_MENU.forEach(({ name }) => {
    assert.match(MENU_JS, new RegExp(`[\"']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"']`), `${name} must belong to a guided menu group`);
  });
  assert.match(MENU_JS, /\bmenuCategoryButton\b/);
  assert.match(MENU_JS, /addEventListener\(["']keydown["']/);
  ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].forEach((key) => {
    assert.match(MENU_JS, new RegExp(`[\"']${key}[\"']`), `roving controls must support ${key}`);
  });
  assert.match(MENU_JS, /\.tabIndex\s*=\s*(?:active|isActive|index|buttonIndex|nextIndex|0|-1)/);
  assert.match(MENU_JS, /\.tabIndex\s*=\s*-1|\?\s*0\s*:\s*-1/);
  assert.match(MENU_JS, /menuCategoryRailList\.scrollTo\(/, "the selected mobile category must scroll into view");

  assert.match(MENU_JS, /setTimeout[\s\S]{0,180},\s*120\s*\)/, "search must use the 120ms debounce");
  assert.match(MENU_JS, /function\s+tokenize\([^)]*\)\s*\{[\s\S]{0,500}\.split\([^)]*\)[\s\S]{0,120}\.filter\(/, "search must normalize the query into tokens");
  assert.match(MENU_JS, /\b[A-Za-z]*tokens?\.every\(/i, "all normalized search tokens must participate in matching");
  assert.match(MENU_JS, /\bmenuNoResults\b/);
  assert.match(MENU_JS, /\bclearMenuSearch\b/);

  assert.match(MENU_JS, /addEventListener\(["']hashchange["']/);
  assert.match(MENU_JS, /(?:window\.)?location\.hash/);
  assert.match(MENU_JS, /(?:window\.)?history\.(?:replaceState|pushState)\(/);
  assert.match(MENU_JS, /function\s+initialize\([^)]*\)\s*\{[\s\S]*?applyHashState\(\{\s*useDefault\s*:\s*true\s*\}\)/);
  assert.match(MENU_JS, /(?:initialize|init|setup)[A-Za-z]*(?:\(\)|\(document\)|\(window\.location\.hash\))/i);
});

test("menu redesign preserves visible allergy guidance without ingredient inference", () => {
  assert.match(MENU_HTML, /class=["'][^"']*\bmenuAllergenNotice\b/);
  assert.match(MENU_HTML, /<strong>Allergy notice:<\/strong>/i);
  assert.match(MENU_HTML, /no symbol does not mean allergen-free/i);
  assert.match(MENU_HTML, /shared preparation areas/i);

  const safetySlotTag = MENU_HTML.match(/<[^>]+\bid=["']menuSafetySlot["'][^>]*>/i)?.[0] || "";
  assert.ok(safetySlotTag);
  assert.doesNotMatch(safetySlotTag, /\b(?:hidden|inert)\b|aria-hidden=["']true["']/i);

  assert.doesNotMatch(MENU_JS, /infer(?:red)?(?:Dietary|Allergen)|(?:dietary|allergen)(?:Keyword|Pattern|Guess|Inference)/i);
  assert.doesNotMatch(MENU_JS, /(?:paneer|milk|cream|cheese|egg|chicken|lamb|prawn|nuts?)[^\n]{0,100}(?:vegan|vegetarian|allergen|dairy|nuts?)/i);

  const menuLayerStart = STYLES.indexOf(MENU_LAYER_MARKER);
  assert.ok(menuLayerStart >= 0, "the final guided menu layer must exist");
  const menuLayer = STYLES.slice(menuLayerStart);
  const noticeRules = rulesContaining(collectCssRules(menuLayer), ".menuAllergenNotice");
  noticeRules.forEach(({ body }) => {
    assert.doesNotMatch(body, /\bdisplay\s*:\s*none|\bvisibility\s*:\s*hidden|\bopacity\s*:\s*0(?:\D|$)/i);
  });
});

test("final option 3 CSS is scoped, efficient, responsive, and touch friendly", () => {
  const orderLayerStart = STYLES.indexOf(ORDER_LAYER_MARKER);
  const menuLayerStart = STYLES.indexOf(MENU_LAYER_MARKER);
  assert.ok(orderLayerStart >= 0, "the order option-2 layer must remain present");
  assert.ok(menuLayerStart > orderLayerStart, "the option-3 menu layer must be the final layer after ordering styles");

  const menuLayer = STYLES.slice(menuLayerStart);
  assert.doesNotMatch(menuLayer, /(?:-webkit-)?backdrop-filter\s*:/i, "the menu layer must not add expensive backdrop filters");
  assert.match(STYLES, /\.menuAccordionToggle::after[\s\S]{0,400}icon-arrow-right\.svg/, "mobile accordions must use the real arrow asset");

  const rules = collectCssRules(menuLayer);
  assert.ok(rules.length >= 20, "the option-3 layer should contain the complete workspace treatment");
  rules.forEach(({ selector }) => {
    selector.split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => {
      assert.match(part, /\.menuBody\b/, `option-3 selector must stay scoped to .menuBody: ${part}`);
    });
  });

  const workspaceRules = rulesContaining(rules, ".menuWorkspace");
  const desktopGrid = workspaceRules.find(({ body }) => /grid-template-columns\s*:/i.test(body));
  assert.ok(desktopGrid, ".menuWorkspace needs an explicit desktop column grid");
  const gridValue = /grid-template-columns\s*:\s*([^;]+)/i.exec(desktopGrid.body)?.[1] || "";
  assert.equal(topLevelCssTokens(gridValue).length, 3, "desktop menu browsing must use three columns");

  [".menuCategoryButton", ".menuGroupTab", ".menuOrderChoice"].forEach((selector) => {
    const touchRules = rulesContaining(rules, selector);
    assert.equal(
      touchRules.some(({ body }) => [...body.matchAll(/(?:min-)?height\s*:\s*(\d+(?:\.\d+)?)px\b/gi)]
        .some((match) => Number(match[1]) >= 44)),
      true,
      `${selector} needs at least a 44px touch target`
    );
  });

  const mobileAtRules = collectCssAtRules(menuLayer, "media")
    .filter(({ prelude }) => /max-width\s*:/i.test(prelude));
  assert.ok(mobileAtRules.length, "the guided menu needs a max-width mobile layout");
  const mobileCss = mobileAtRules.map(({ body }) => body).join("\n");
  const mobileRules = collectCssRules(mobileCss);
  assert.equal(
    rulesContaining(mobileRules, ".menuCategoryRailList").some(({ body }) => /overflow-x\s*:\s*auto/i.test(body)),
    true,
    "category navigation must become horizontally scrollable on mobile"
  );
  assert.equal(
    rulesContaining(rules, ".menuGroupTabs").some(({ body }) => /overflow-x\s*:\s*auto/i.test(body)),
    true,
    "group tabs must remain horizontally usable on mobile"
  );
  assert.equal(
    rulesContaining(mobileRules, ".menuMobileOrderBar").some(({ body }) => /position\s*:\s*(?:sticky|fixed)/i.test(body)),
    true,
    "mobile Collection and Delivery actions must stay within reach"
  );
});

test("menu imagery stays same-origin, correctly loaded, and within budget", () => {
  const imageTags = tagsFrom(documentMarkupOnly(MENU_HTML), "img");
  assert.ok(imageTags.length >= 2, "the page should include its brand and menu hero imagery");
  imageTags.forEach((tag) => {
    const src = getAttribute(tag, "src");
    assert.ok(src, "every menu image needs a src");
    assert.doesNotMatch(src, /^(?:https?:)?\/\/|^data:|^blob:|\\|[?#]/i, `${src} must stay on the site origin`);
  });

  const heroMarkup = /<section\b[^>]*class=(["'])[^"']*\bmenuFavouritesHero\b[^"']*\1[^>]*>([\s\S]*?)<\/section>/i.exec(MENU_HTML)?.[2] || "";
  const hero = tagsFrom(heroMarkup, "img")[0];
  assert.ok(hero);
  assert.notEqual(getAttribute(hero, "loading").toLowerCase(), "lazy", "the above-fold hero must not be lazy-loaded");

  imageTags
    .filter((tag) => /\bmenu(?:Item|Category|Feature)Image\b/i.test(getAttribute(tag, "class")))
    .forEach((tag) => assert.equal(getAttribute(tag, "loading").toLowerCase(), "lazy"));

  const menuAssetSources = [...new Set(
    imageTags
      .map((tag) => getAttribute(tag, "src"))
      .filter((src) => /(?:^|\/)menu-[^/]+\.(?:avif|jpe?g|png|webp)$/i.test(src))
  )];
  assert.ok(menuAssetSources.length, "the menu should reference at least one optimized raster asset");

  const menuAssetBytes = menuAssetSources.reduce((total, src) => {
    const assetUrl = new URL(src, MENU_HTML_URL);
    assert.equal(existsSync(assetUrl), true, `${src} must resolve to a local asset`);
    const bytes = statSync(assetUrl).size;
    assert.ok(bytes > 1_000, `${src} must not be an empty placeholder`);
    return total + bytes;
  }, 0);
  assert.ok(menuAssetBytes < MAX_MENU_IMAGE_BYTES, `menu imagery must remain below 350KB (got ${menuAssetBytes} bytes)`);
});
