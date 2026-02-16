"use strict";

const addressText = "55 Brigsley Road, Waltham, Grimsby, DN37 0JZ";
const businessTimezone = "Europe/London";
const openingSummary = "Tue-Sun: 12:00-17:00";
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
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let internalNav = false;
  try {
    internalNav = window.sessionStorage.getItem("pt-internal-nav") === "1";
    if (internalNav) window.sessionStorage.removeItem("pt-internal-nav");
  } catch (e) {
    internalNav = false;
  }

  if (reducedMotion || internalNav) {
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

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
