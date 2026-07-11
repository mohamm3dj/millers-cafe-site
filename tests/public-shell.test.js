"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { onRequest as applySiteMiddleware } from "../functions/_middleware.js";

const homeHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const serviceWorker = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const privacyHtml = readFileSync(new URL("../privacy/index.html", import.meta.url), "utf8");

test("home contact details are directly actionable without a hidden card state", () => {
  assert.match(homeHtml, /href="https:\/\/www\.google\.com\/maps\/dir\//);
  assert.match(homeHtml, /href="tel:\+441472828600"/);
  assert.match(homeHtml, /href="mailto:help@millers\.cafe"/);
  assert.doesNotMatch(homeHtml, /homeFlipTrigger|aria-controls="(?:location|contact)FlipBack"/);
  assert.doesNotMatch(homeSource, /setupFlipTile|data\.flipClicks/);
});

test("page chrome clips decorative overflow and mobile ordering removes the oversized shine", () => {
  assert.match(styles, /html, body\s*\{[\s\S]*?overflow-x:\s*clip;/);
  assert.match(
    styles,
    /@media \(max-width: 959px\)[\s\S]*?\.orderPage \.bookingsPanel::before\s*\{\s*display:\s*none;/
  );
});

test("service worker respects versioned asset URLs before using an offline fallback", () => {
  assert.match(serviceWorker, /millers-static-v\d+/);
  assert.match(serviceWorker, /const cached = await cache\.match\(request\);/);
  assert.match(serviceWorker, /cache\.match\(request, \{ ignoreSearch: true \}\)\) \|\| Response\.error\(\)/);
  assert.match(serviceWorker, /cacheResponse:\s*requestUrl\.search\.length === 0/);
});

test("privacy notice identifies separate explicit consent and limits vital interests", () => {
  assert.match(privacyHtml, /separate explicit consent/i);
  assert.match(privacyHtml, /life-critical situation/i);
  assert.match(privacyHtml, /physically or legally unable to consent/i);
});

test("site middleware can shield production with a non-cacheable maintenance response", async () => {
  let nextCalled = false;
  const response = await applySiteMiddleware({
    env: { MAINTENANCE_MODE: "true" },
    request: new Request("https://millers.cafe/orders/feed.json"),
    async next() {
      nextCalled = true;
      return new Response("sensitive");
    }
  });

  assert.equal(nextCalled, false);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  assert.doesNotMatch(await response.text(), /sensitive/);
});

test("site middleware applies security headers to function responses", async () => {
  const response = await applySiteMiddleware({
    env: {},
    request: new Request("https://millers.cafe/api/site-config"),
    async next() {
      return Response.json({ ok: true });
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.deepEqual(await response.json(), { ok: true });
});
