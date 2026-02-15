(function setupPageTransitions() {
  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) {
    reduceMotion = false;
  }
  if (reduceMotion) return;

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

  var leaving = false;
  var LEAVE_MS = 260;

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
    document.body.classList.add("page-leaving");
    window.setTimeout(function go() {
      window.location.assign(destination.href);
    }, LEAVE_MS);
  });

  window.addEventListener("pageshow", function onPageShow() {
    leaving = false;
    document.body.classList.remove("page-leaving");
  });
})();
