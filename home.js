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
  const phoneDigits = String(business.phoneTel || "1472828600").trim().replace(/\D/g, "").replace(/^0+/, "");
  const schema = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: String(business.name || "Millers Café").trim() || "Millers Café",
    image: `${window.location.origin}/assets/millers-logo.png`,
    url: `${window.location.origin}/`,
    telephone: `+44 ${phoneDigits || "1472828600"}`,
    servesCuisine: ["Cafe", "Indian", "Desserts", "Milkshakes"],
    menu: `${window.location.origin}/menu/`,
    acceptsReservations: "True",
    address: {
      "@type": "PostalAddress",
      streetAddress: String(business.address || addressText).trim(),
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

async function copyAddress() {
  const feedback = document.getElementById("findCopyFeedback");
  if (!feedback) return;

  const done = (message) => {
    feedback.textContent = message;
    if (findCopyAddressBtn) {
      findCopyAddressBtn.classList.remove("copyPulse");
      // Restart pulse animation each time copy feedback is shown.
      window.requestAnimationFrame(() => {
        if (findCopyAddressBtn) findCopyAddressBtn.classList.add("copyPulse");
      });
      window.setTimeout(() => {
        if (findCopyAddressBtn) findCopyAddressBtn.classList.remove("copyPulse");
      }, 560);
    }
    window.setTimeout(() => {
      if (feedback.textContent === message) feedback.textContent = "";
    }, 2200);
  };

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(addressText);
      done("Address copied");
      return;
    }
  } catch (error) {
    // Fall back to execCommand copy.
  }

  const temp = document.createElement("textarea");
  temp.value = addressText;
  temp.setAttribute("readonly", "");
  temp.style.position = "absolute";
  temp.style.left = "-9999px";
  document.body.appendChild(temp);
  temp.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(temp);
  done(copied ? "Address copied" : "Copy failed");
}

const intro = document.getElementById("intro");
if (intro) {
  let internalNav = false;
  try {
    internalNav = window.sessionStorage.getItem("pt-internal-nav") === "1";
    if (internalNav) window.sessionStorage.removeItem("pt-internal-nav");
  } catch (e) {
    internalNav = false;
  }

  if (prefersReducedMotion || internalNav) {
    intro.remove();
  } else {
    window.addEventListener("load", () => {
      setTimeout(() => intro.classList.add("introDone"), 2400);
      setTimeout(() => intro.remove(), 3200);
    });
  }
}

void loadHomeConfig();
updateOpeningStatus();
window.setInterval(updateOpeningStatus, 60 * 1000);
void trackClientEvent("page_view", {
  page: "home",
  route: window.location.pathname
});

const findCopyAddressBtn = document.getElementById("findCopyAddressBtn");
if (findCopyAddressBtn) {
  findCopyAddressBtn.addEventListener("click", copyAddress);
}

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

function setupFlipTile(tile) {
  if (!tile) return;

  const trigger = tile.querySelector(".homeFlipTrigger");
  const front = tile.querySelector(".homeFlipFront");
  const back = tile.querySelector(".homeFlipBack");
  if (!(trigger instanceof HTMLButtonElement) || !(front instanceof HTMLElement) || !(back instanceof HTMLElement)) {
    return;
  }

  const setFaceAvailable = (face, available) => {
    face.toggleAttribute("inert", !available);
    face.setAttribute("aria-hidden", available ? "false" : "true");
    const tabStopCandidates = [
      face,
      ...face.querySelectorAll("a, button, input, select, textarea, [tabindex]")
    ];
    tabStopCandidates.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (available) {
        const priorTabIndex = el.dataset.priorTabIndex;
        if (priorTabIndex === "none") {
          el.removeAttribute("tabindex");
        } else if (typeof priorTabIndex === "string") {
          el.setAttribute("tabindex", priorTabIndex);
        }
        delete el.dataset.priorTabIndex;
        return;
      }

      if (!("priorTabIndex" in el.dataset)) {
        el.dataset.priorTabIndex = el.hasAttribute("tabindex") ? el.getAttribute("tabindex") || "" : "none";
      }
      el.setAttribute("tabindex", "-1");
    });
  };

  const setFlipped = (flipped, options = {}) => {
    tile.classList.toggle("isFlipped", flipped);
    trigger.setAttribute("aria-expanded", flipped ? "true" : "false");
    setFaceAvailable(front, !flipped);
    setFaceAvailable(back, flipped);
    if (!flipped && options.restoreFocus) {
      trigger.focus({ preventScroll: true });
    }
  };

  trigger.addEventListener("click", () => {
    setFlipped(!tile.classList.contains("isFlipped"));
  });

  tile.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest(".flipNoToggle")) return;

    if (target.closest(".flipBackBtn")) {
      event.preventDefault();
      setFlipped(false, { restoreFocus: true });
    }
  });

  tile.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setFlipped(false);
    }
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (!tile.contains(event.target)) setFlipped(false);
  });

  setFlipped(false);
}

setupFlipTile(document.getElementById("locationFlipTile"));
setupFlipTile(document.getElementById("contactFlipTile"));
// Hero motion intentionally disabled for a cleaner static header.
// setupHeroParallax();
// disabled: static mode
// setupRippleEffects();
