(function setupPageTransitions() {
  var DIR_KEY = "pt-nav-dir";
  var INTERNAL_NAV_KEY = "pt-internal-nav";
  var DIR_FORWARD = "forward";
  var DIR_BACK = "back";
  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    reduceMotion = false;
  }
  if (reduceMotion) return;

  var savedDir = "";
  try {
    savedDir = window.sessionStorage.getItem(DIR_KEY) || "";
    if (savedDir === DIR_BACK) {
      document.body.classList.add("page-enter-back");
    }
    window.sessionStorage.removeItem(DIR_KEY);
  } catch (e) {
    // Ignore storage failures.
  }

  function isInternalNavigableLink(anchor) {
    if (!anchor) return false;
    var rawHref = anchor.getAttribute("href");
    if (!rawHref) return false;
    if (rawHref.startsWith("#")) return false;
    if (rawHref.startsWith("mailto:")) return false;
    if (rawHref.startsWith("tel:")) return false;
    if (rawHref.startsWith("javascript:")) return false;
    if (anchor.hasAttribute("download")) return false;
    if (anchor.target && anchor.target !== "_self") return false;

    var url;
    try {
      url = new URL(anchor.href, window.location.href);
    } catch (e) {
      return false;
    }

    if (url.origin !== window.location.origin) return false;
    return true;
  }

  function pathDepth(pathname) {
    return pathname.split("/").filter(Boolean).length;
  }

  function isBackLikeNavigation(anchor, destination) {
    if (!anchor || !destination) return false;
    if (anchor.classList && anchor.classList.contains("backBtn")) return true;

    var rawHref = (anchor.getAttribute("href") || "").trim();
    if (rawHref.startsWith("../")) return true;

    var currentDepth = pathDepth(window.location.pathname);
    var destinationDepth = pathDepth(destination.pathname);
    return destinationDepth < currentDepth;
  }

  var leaving = false;
  var LEAVE_MS = 280;

  document.addEventListener("click", function onClick(event) {
    if (leaving) return;
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!isInternalNavigableLink(anchor)) return;

    var destination = new URL(anchor.href, window.location.href);
    var currentWithoutHash = window.location.href.split("#")[0];
    if (destination.href === currentWithoutHash + destination.hash && destination.hash) return;

    leaving = true;
    event.preventDefault();
    var direction = isBackLikeNavigation(anchor, destination) ? DIR_BACK : DIR_FORWARD;
    try {
      window.sessionStorage.setItem(DIR_KEY, direction);
      window.sessionStorage.setItem(INTERNAL_NAV_KEY, "1");
    } catch (e) {
      // Ignore storage failures.
    }

    document.body.classList.remove("page-leaving-forward", "page-leaving-back");
    document.body.classList.add(direction === DIR_BACK ? "page-leaving-back" : "page-leaving-forward");
    window.setTimeout(function go() {
      window.location.assign(destination.href);
    }, LEAVE_MS);
  });

  window.addEventListener("pageshow", function onPageShow() {
    leaving = false;
    document.body.classList.remove("page-leaving-forward", "page-leaving-back");
  });
})();
