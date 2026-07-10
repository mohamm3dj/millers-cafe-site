"use strict";

const SITE_CONFIG_API_BASE = "/api/site-config";
let addressText = "55 Brigsley Road, Waltham, Grimsby, DN37 0JZ";
const businessTimezone = "Europe/London";
let openingSummary = "Tue-Sun: 12:00-17:00";
let prefersReducedMotion = false;
try {
  prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
} catch (error) {
  prefersReducedMotion = false;
}
let weeklyHours = {
  0: [["12:00", "17:00"]],
  1: [],
  2: [["12:00", "17:00"]],
  3: [["12:00", "17:00"]],
  4: [["12:00", "17:00"]],
  5: [["12:00", "17:00"]],
  6: [["12:00", "17:00"]]
};

function toMinutes(clock) {
  const [hours, minutes] = clock.split(":").map(Number);
  return (hours * 60) + minutes;
}

function formatDayHours(windows) {
  if (!windows.length) return "Closed";
  return windows.map(([start, end]) => `${start}-${end}`).join(" / ");
}

function getNowInBusinessTimezone() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: businessTimezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const weekday = parts.find((part) => part.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    dayIndex: dayMap[weekday] ?? 1,
    minutesNow: (hour * 60) + minute
  };
}

function trackClientEvent(eventName, details = {}) {
  if (!window.MillersClient || typeof window.MillersClient.trackEvent !== "function") {
    return Promise.resolve(false);
  }
  return window.MillersClient.trackEvent(eventName, details);
}

function updateRestaurantSchema(config) {
  const schemaEl = document.getElementById("restaurantSchema");
  if (!(schemaEl instanceof HTMLScriptElement)) return;

  const business = config?.business || {};
  const rawPhoneDigits = String(business.phoneTel || "01472828600").trim().replace(/\D/g, "");
  const internationalPhone = rawPhoneDigits.startsWith("44")
    ? `+${rawPhoneDigits}`
    : `+44${rawPhoneDigits.replace(/^0+/, "") || "1472828600"}`;
  const addressParts = String(business.address || addressText)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const postcode = addressParts.find((part) => /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(part)) || "DN37 0JZ";
  const schema = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: String(business.name || "Millers Café").trim() || "Millers Café",
    image: `${window.location.origin}/assets/millers-logo.png`,
    url: `${window.location.origin}/`,
    telephone: internationalPhone,
    servesCuisine: ["Cafe", "Indian", "Desserts", "Milkshakes"],
    menu: `${window.location.origin}/menu/`,
    acceptsReservations: true,
    priceRange: "££",
    openingHoursSpecification: Object.entries(config?.home?.weeklyHours || weeklyHours)
      .filter(([, windows]) => Array.isArray(windows) && windows.length > 0)
      .flatMap(([dayIndex, windows]) => windows.map((windowValue) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(dayIndex)],
        opens: String(windowValue?.[0] || ""),
        closes: String(windowValue?.[1] || "")
      })))
      .filter((entry) => entry.dayOfWeek && entry.opens && entry.closes),
    address: {
      "@type": "PostalAddress",
      streetAddress: addressParts[0] || "55 Brigsley Road",
      addressLocality: addressParts[1] || "Waltham",
      addressRegion: addressParts[2] || "Grimsby",
      postalCode: postcode,
      addressCountry: "GB"
    }
  };

  schemaEl.textContent = JSON.stringify(schema);
}

function updateOpeningStatus() {
  const statusWrap = document.getElementById("heroStatus");
  const statusText = document.getElementById("heroStatusText");
  const heroHours = document.getElementById("heroHours");
  if (!statusWrap || !statusText || !heroHours) return;

  const { dayIndex, minutesNow } = getNowInBusinessTimezone();
  const windows = weeklyHours[dayIndex] || [];
  const isOpen = windows.some(([start, end]) => {
    const startMin = toMinutes(start);
    const endMin = toMinutes(end);
    return minutesNow >= startMin && minutesNow < endMin;
  });

  statusWrap.classList.toggle("isOpen", isOpen);
  statusWrap.classList.toggle("isClosed", !isOpen);
  statusText.textContent = isOpen ? "Open now" : "Closed now";
  heroHours.textContent = `${openingSummary} • Today: ${formatDayHours(windows)}`;
}

async function loadHomeConfig() {
  try {
    const response = await fetch(SITE_CONFIG_API_BASE, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return;
    const body = await response.json();
    const config = body?.config;
    if (!config) return;

    if (config.business?.address) {
      addressText = String(config.business.address).trim();
    }
    if (config.home?.openingSummary) {
      openingSummary = String(config.home.openingSummary).trim();
    }
    if (config.home?.weeklyHours && typeof config.home.weeklyHours === "object") {
      weeklyHours = config.home.weeklyHours;
    }

    const heroMeta = document.querySelector(".heroMeta");
    if (heroMeta instanceof HTMLElement && config.business?.address) {
      heroMeta.textContent = String(config.business.address).trim();
    }

    updateRestaurantSchema(config);
    updateOpeningStatus();
  } catch (error) {
    // Keep bundled defaults if live config is unavailable.
  }
}

void loadHomeConfig();
updateOpeningStatus();
window.setInterval(updateOpeningStatus, 60 * 1000);
void trackClientEvent("page_view", {
  page: "home",
  route: window.location.pathname
});

function setupHeroParallax() {
  const hero = document.querySelector(".glassHero");
  if (!(hero instanceof HTMLElement) || prefersReducedMotion) return;

  const resetParallax = () => {
    hero.style.setProperty("--px", "0");
    hero.style.setProperty("--py", "0");
  };

  hero.addEventListener("pointermove", (event) => {
    const rect = hero.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) - 0.5;
    const y = ((event.clientY - rect.top) / rect.height) - 0.5;
    hero.style.setProperty("--px", (x * 2).toFixed(3));
    hero.style.setProperty("--py", (y * 2).toFixed(3));
  });

  hero.addEventListener("pointerleave", resetParallax);
  window.addEventListener("blur", resetParallax);
}

function setupRippleEffects() {
  const selector = ".tile, .flipLink, .flipBackBtn, .searchClearBtn";

  document.querySelectorAll(selector).forEach((el) => {
    if (el instanceof HTMLElement) el.classList.add("rippleHost");
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const host = target.closest(selector);
    if (!(host instanceof HTMLElement)) return;

    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.25;
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

// Hero motion intentionally disabled for a cleaner static header.
// setupHeroParallax();
// disabled: static mode
// setupRippleEffects();
