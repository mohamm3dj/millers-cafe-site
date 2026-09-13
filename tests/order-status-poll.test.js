"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ORDER_FORM_SOURCE = readFileSync(new URL("../orders/order-form.js", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = ORDER_FORM_SOURCE.indexOf(`function ${name}(`);
  const end = ORDER_FORM_SOURCE.indexOf(`\nfunction ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} must remain available to the order-status harness`);
  assert.notEqual(end, -1, `${nextName} must follow ${name} in order-form.js`);
  return ORDER_FORM_SOURCE.slice(start, end);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createStatusPollHarness(fetchOrderStatus) {
  const renders = [];
  const notices = [];
  const intervalCallbacks = [];
  const clearedIntervals = [];
  const buildHarness = new Function(
    "fetchOrderStatus",
    "renderOrderStatusTracker",
    "setNotice",
    "formatEtaLabel",
    "cashDueStatusMessage",
    "setInterval",
    "clearInterval",
    `
      let statusPollTimer = null;
      let statusPollKey = "";
      let statusPollGeneration = 0;
      ${functionSource("stopStatusPolling", "formatEtaLabel")}
      ${functionSource("startOrderStatusTracking", "setNotice")}
      return { startOrderStatusTracking };
    `
  );

  const api = buildHarness(
    fetchOrderStatus,
    (state) => renders.push(state),
    (message, warning) => notices.push({ message, warning }),
    () => "Estimated collection time: about 10 minutes.",
    () => "Cash is due on collection.",
    (callback) => {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
    (timer) => clearedIntervals.push(timer)
  );

  return { ...api, renders, notices, intervalCallbacks, clearedIntervals };
}

test("a stale overlapping order-status poll cannot overwrite a newer terminal response", async () => {
  const olderRequest = deferred();
  const newerRequest = deferred();
  const requests = [olderRequest, newerRequest];
  let requestIndex = 0;
  const harness = createStatusPollHarness(() => requests[requestIndex++].promise);

  harness.startOrderStatusTracking("MCO-OVERLAP", "tracking-token", "collection");
  assert.equal(harness.intervalCallbacks.length, 1);

  const newerPoll = harness.intervalCallbacks[0]();
  newerRequest.resolve({
    status: "accepted",
    paymentMethod: "card",
    etaMinutes: 10
  });
  await newerPoll;

  assert.equal(harness.renders.at(-1).type, "accepted");
  assert.equal(harness.notices.length, 1);
  assert.equal(harness.clearedIntervals.length, 1);

  olderRequest.resolve({ status: "submitted", paymentMethod: "card" });
  await olderRequest.promise;
  await Promise.resolve();

  assert.equal(harness.renders.at(-1).type, "accepted");
  assert.equal(harness.renders.length, 2, "the stale pending response must not render");
  assert.equal(harness.notices.length, 1, "the stale response must not replace the accepted notice");
});

test("restarting the same order-status tracker invalidates its earlier poll generation", async () => {
  const staleRequest = deferred();
  const currentRequest = deferred();
  const requests = [staleRequest, currentRequest];
  let requestIndex = 0;
  const harness = createStatusPollHarness(() => requests[requestIndex++].promise);

  harness.startOrderStatusTracking("MCO-RESTART", "same-tracking-token", "collection");
  harness.startOrderStatusTracking("MCO-RESTART", "same-tracking-token", "collection");

  assert.equal(harness.renders.length, 2);
  assert.equal(harness.clearedIntervals.length, 1, "the restart must clear the first timer");

  staleRequest.resolve({
    status: "accepted",
    paymentMethod: "card",
    etaMinutes: 10
  });
  await staleRequest.promise;
  await Promise.resolve();

  assert.equal(harness.renders.length, 2, "the prior generation must not render a terminal state");
  assert.ok(harness.renders.every((state) => state.type === "pending"));
  assert.equal(harness.notices.length, 0);
  assert.equal(harness.clearedIntervals.length, 1, "the stale response must not stop the current timer");

  currentRequest.resolve({
    status: "accepted",
    paymentMethod: "card",
    etaMinutes: 10
  });
  await currentRequest.promise;
  await Promise.resolve();

  assert.equal(harness.renders.at(-1).type, "accepted");
  assert.equal(harness.notices.length, 1);
  assert.equal(harness.clearedIntervals.length, 2);
});
