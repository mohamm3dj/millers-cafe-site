"use strict";

import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKOUT_ATTEMPT_STORAGE_KEY,
  CHECKOUT_ATTEMPT_TTL_MS,
  createCheckoutAttemptManager
} from "../orders/checkout-attempt.js";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function checkoutData(paymentMethod = "cash") {
  return {
    payload: {
      orderType: "delivery",
      paymentMethod,
      customerName: "CHECKOUT_NAME_SENTINEL",
      phoneNumber: "CHECKOUT_PHONE_SENTINEL",
      email: "CHECKOUT_EMAIL_SENTINEL@example.test",
      date: "2026-09-15",
      time: "13:00",
      notes: "CHECKOUT_NOTES_SENTINEL",
      addressLine1: "CHECKOUT_ADDRESS_SENTINEL",
      townCity: "CHECKOUT_TOWN_SENTINEL",
      postcode: "ZZ1 1ZZ"
    },
    cartItems: [{
      itemName: "Test item",
      quantity: 1,
      modifierSelections: [{
        groupName: "Instructions",
        optionName: "CHECKOUT_MODIFIER_SENTINEL",
        isTextInput: true
      }]
    }]
  };
}

test("checkout attempts survive a reload without storing raw customer details", async () => {
  const storage = memoryStorage();
  const now = () => 1_700_000_000_000;
  const firstData = checkoutData();
  const first = createCheckoutAttemptManager({
    storage,
    now,
    createKey: () => "order-first",
    cryptoProvider: globalThis.crypto
  });

  assert.equal(await first.keyFor(firstData.payload, firstData.cartItems), "order-first");

  const raw = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  assert.ok(raw);
  const stored = JSON.parse(raw);
  assert.deepEqual(Object.keys(stored).sort(), ["expiresAt", "fingerprint", "key", "version"]);
  assert.match(stored.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(stored.expiresAt, now() + CHECKOUT_ATTEMPT_TTL_MS);
  [
    "CHECKOUT_NAME_SENTINEL",
    "CHECKOUT_PHONE_SENTINEL",
    "CHECKOUT_EMAIL_SENTINEL",
    "CHECKOUT_NOTES_SENTINEL",
    "CHECKOUT_ADDRESS_SENTINEL",
    "CHECKOUT_TOWN_SENTINEL",
    "CHECKOUT_MODIFIER_SENTINEL",
    "ZZ1 1ZZ"
  ].forEach((value) => assert.doesNotMatch(raw, new RegExp(value)));

  const afterReload = createCheckoutAttemptManager({
    storage,
    now,
    createKey: () => "order-second",
    cryptoProvider: globalThis.crypto
  });
  assert.equal(
    await afterReload.keyFor(firstData.payload, firstData.cartItems),
    "order-first",
    "an identical same-tab retry after reload must reuse the server idempotency key"
  );
});

test("checkout attempts span card/cash transitions, rotate for changed details, and clear after success", async () => {
  const storage = memoryStorage();
  let sequence = 0;
  const manager = createCheckoutAttemptManager({
    storage,
    now: () => 1_700_000_000_000,
    createKey: () => `order-${++sequence}`,
    cryptoProvider: globalThis.crypto
  });
  const cash = checkoutData("cash");
  const card = checkoutData("card");

  assert.equal(await manager.keyFor(cash.payload, cash.cartItems), "order-1");
  assert.equal(await manager.keyFor(cash.payload, cash.cartItems), "order-1");
  assert.equal(
    await manager.keyFor(card.payload, card.cartItems),
    "order-1",
    "changing only the payment method keeps one logical checkout attempt"
  );

  const changedEmail = checkoutData("card");
  changedEmail.payload.email = "changed@example.test";
  assert.equal(await manager.keyFor(changedEmail.payload, changedEmail.cartItems), "order-2");

  const changedCart = checkoutData("cash");
  changedCart.cartItems[0].quantity = 2;
  assert.equal(await manager.keyFor(changedCart.payload, changedCart.cartItems), "order-3");

  manager.clear();
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
  assert.equal(await manager.keyFor(changedCart.payload, changedCart.cartItems), "order-4");
});

test("card and cash reuse the same persisted checkout attempt after a reload", async () => {
  const storage = memoryStorage();
  const cash = checkoutData("cash");
  const card = checkoutData("card");
  const first = createCheckoutAttemptManager({
    storage,
    createKey: () => "order-shared-method",
    cryptoProvider: globalThis.crypto
  });
  assert.equal(await first.keyFor(card.payload, card.cartItems), "order-shared-method");

  const afterReload = createCheckoutAttemptManager({
    storage,
    createKey: () => "order-should-not-rotate",
    cryptoProvider: globalThis.crypto
  });
  assert.equal(await afterReload.keyFor(cash.payload, cash.cartItems), "order-shared-method");
});

test("invalid or expired stored attempts rotate without blocking checkout", async () => {
  const nowValue = 1_700_000_000_000;
  const data = checkoutData();
  const invalidRecords = [
    "not-json",
    JSON.stringify({ version: 2, key: "old", fingerprint: "a".repeat(64), expiresAt: nowValue + 1000 }),
    JSON.stringify({ version: 1, key: "old", fingerprint: "a".repeat(64), expiresAt: nowValue - 1 })
  ];

  for (const [index, raw] of invalidRecords.entries()) {
    const storage = memoryStorage();
    storage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, raw);
    const manager = createCheckoutAttemptManager({
      storage,
      now: () => nowValue,
      createKey: () => `order-valid-${index}`,
      cryptoProvider: globalThis.crypto
    });
    assert.equal(await manager.keyFor(data.payload, data.cartItems), `order-valid-${index}`);
  }
});

test("storage or Web Crypto failures retain same-page idempotency without persisting PII", async () => {
  const throwingStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); }
  };
  const data = checkoutData();
  let storageSequence = 0;
  const storageFailureManager = createCheckoutAttemptManager({
    storage: throwingStorage,
    createKey: () => `order-storage-${++storageSequence}`,
    cryptoProvider: globalThis.crypto
  });
  assert.equal(await storageFailureManager.keyFor(data.payload, data.cartItems), "order-storage-1");
  assert.equal(await storageFailureManager.keyFor(data.payload, data.cartItems), "order-storage-1");

  const storage = memoryStorage();
  let cryptoSequence = 0;
  const cryptoFailureManager = createCheckoutAttemptManager({
    storage,
    createKey: () => `order-crypto-${++cryptoSequence}`,
    cryptoProvider: null
  });
  assert.equal(await cryptoFailureManager.keyFor(data.payload, data.cartItems), "order-crypto-1");
  assert.equal(await cryptoFailureManager.keyFor(data.payload, data.cartItems), "order-crypto-1");
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
});
