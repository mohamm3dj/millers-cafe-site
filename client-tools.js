(function attachMillersClient(global) {
  "use strict";

  const ANALYTICS_API = "/api/analytics";
  const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

  function toObject(value) {
    return value && typeof value === "object" ? value : {};
  }

  function trackEvent(event, details) {
    const payload = {
      event: String(event || "").trim(),
      ...toObject(details)
    };

    if (!payload.event) return Promise.resolve(false);

    return fetch(ANALYTICS_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      keepalive: true,
      body: JSON.stringify(payload)
    }).then(() => true).catch(() => false);
  }

  function loadTurnstileScript() {
    if (global.turnstile && typeof global.turnstile.render === "function") {
      return Promise.resolve(global.turnstile);
    }

    if (global.__millersTurnstilePromise) {
      return global.__millersTurnstilePromise;
    }

    global.__millersTurnstilePromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(global.turnstile), { once: true });
        existing.addEventListener("error", () => reject(new Error("Turnstile script failed to load.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", () => resolve(global.turnstile), { once: true });
      script.addEventListener("error", () => reject(new Error("Turnstile script failed to load.")), { once: true });
      document.head.appendChild(script);
    });

    return global.__millersTurnstilePromise;
  }

  async function mountTurnstile(container, siteKey, callbacks) {
    const options = toObject(callbacks);
    if (!(container instanceof HTMLElement) || !siteKey) return null;

    const turnstile = await loadTurnstileScript();
    if (!turnstile || typeof turnstile.render !== "function") {
      throw new Error("Turnstile is unavailable.");
    }

    container.hidden = false;
    const widgetId = turnstile.render(container, {
      sitekey: siteKey,
      theme: "light",
      callback: (token) => {
        if (typeof options.onToken === "function") options.onToken(String(token || ""));
      },
      "expired-callback": () => {
        if (typeof options.onToken === "function") options.onToken("");
        if (typeof options.onExpire === "function") options.onExpire();
      },
      "error-callback": () => {
        if (typeof options.onToken === "function") options.onToken("");
        if (typeof options.onError === "function") options.onError();
      }
    });

    return {
      reset() {
        if (global.turnstile && typeof global.turnstile.reset === "function") {
          global.turnstile.reset(widgetId);
        }
      }
    };
  }

  global.MillersClient = {
    trackEvent,
    mountTurnstile
  };
}(window));
