"use strict";

const addressText = "55 Brigsley Road, Waltham, Grimsby, DN37 0JZ";
const businessTimezone = "Europe/London";
const openingSummary = "Tue-Sun: 12:00-17:00";
let prefersReducedMotion = false;
try {
  prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
} catch (error) {
  prefersReducedMotion = false;
}
const weeklyHours = {
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

updateOpeningStatus();
window.setInterval(updateOpeningStatus, 60 * 1000);

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

function setupHeroCounters() {
  const counters = Array.from(document.querySelectorAll(".heroStatNum"));
  if (!counters.length) return;

  const startCounters = () => {
    counters.forEach((el, index) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.dataset.counted === "1") return;
      el.dataset.counted = "1";

      const target = Number(el.dataset.target || "0");
      const duration = 1200 + (index * 180);
      const start = performance.now();

      const tick = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = Math.round(target * eased);
        el.textContent = String(value);
        if (progress < 1) window.requestAnimationFrame(tick);
      };

      window.requestAnimationFrame(tick);
    });
  };

  const hero = document.querySelector(".glassHero");
  if (!(hero instanceof Element) || prefersReducedMotion || !("IntersectionObserver" in window)) {
    startCounters();
    return;
  }

  const observer = new IntersectionObserver((entries, obs) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      startCounters();
      obs.disconnect();
    }
  }, { threshold: 0.45 });

  observer.observe(hero);
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

  const setFlipped = (flipped) => {
    tile.classList.toggle("isFlipped", flipped);
    tile.setAttribute("aria-expanded", flipped ? "true" : "false");
  };

  tile.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest(".flipNoToggle")) return;

    if (target.closest(".flipBackBtn")) {
      event.preventDefault();
      setFlipped(false);
      return;
    }

    setFlipped(!tile.classList.contains("isFlipped"));
  });

  tile.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setFlipped(!tile.classList.contains("isFlipped"));
    } else if (event.key === "Escape") {
      setFlipped(false);
    }
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (!tile.contains(event.target)) setFlipped(false);
  });
}

setupFlipTile(document.getElementById("locationFlipTile"));
setupFlipTile(document.getElementById("contactFlipTile"));
setupHeroParallax();
setupHeroCounters();
setupRippleEffects();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
