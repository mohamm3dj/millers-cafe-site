"use strict";

export const CHECKOUT_ATTEMPT_STORAGE_KEY = "millers-cafe-checkout-attempt-v1";
export const CHECKOUT_ATTEMPT_TTL_MS = 47 * 60 * 60 * 1000;

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function attemptPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const fingerprintPayload = { ...payload };
  delete fingerprintPayload.paymentMethod;
  return fingerprintPayload;
}

async function sha256Hex(source, cryptoProvider) {
  if (!cryptoProvider?.subtle || typeof cryptoProvider.subtle.digest !== "function") return "";
  try {
    const digest = await cryptoProvider.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(source)
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    return "";
  }
}

function removeStoredAttempt(storage, storageKey) {
  try {
    storage?.removeItem?.(storageKey);
  } catch (error) {
    // Storage is an optimization. In-memory retries still remain idempotent.
  }
}

function readStoredAttempt(storage, storageKey, now) {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const valid = parsed?.version === 1
      && typeof parsed.key === "string"
      && parsed.key.length > 0
      && parsed.key.length <= 200
      && typeof parsed.fingerprint === "string"
      && /^[a-f0-9]{64}$/.test(parsed.fingerprint)
      && Number.isFinite(Number(parsed.expiresAt))
      && Number(parsed.expiresAt) > now;
    if (valid) return parsed;
  } catch (error) {
    // Remove malformed or unreadable attempt data when possible.
  }
  removeStoredAttempt(storage, storageKey);
  return null;
}

function writeStoredAttempt(storage, storageKey, record) {
  try {
    storage?.setItem?.(storageKey, JSON.stringify(record));
  } catch (error) {
    // Storage is optional. The in-memory attempt remains available.
  }
}

export function createCheckoutAttemptManager(options = {}) {
  const storage = options.storage || null;
  const storageKey = String(options.storageKey || CHECKOUT_ATTEMPT_STORAGE_KEY);
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const createKey = typeof options.createKey === "function"
    ? options.createKey
    : () => `order-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const cryptoProvider = options.cryptoProvider === undefined ? globalThis.crypto : options.cryptoProvider;
  const ttlMs = Math.min(
    CHECKOUT_ATTEMPT_TTL_MS,
    Math.max(1, Number(options.ttlMs || CHECKOUT_ATTEMPT_TTL_MS))
  );

  let memoryKey = "";
  let memoryFingerprint = "";

  return {
    async keyFor(payload, cartItems) {
      // Card and cash are two settlement paths for the same logical checkout
      // attempt. The server uses one key to supersede/reconcile either path.
      const canonical = canonicalJson({ payload: attemptPayload(payload), cartItems });
      const digest = await sha256Hex(canonical, cryptoProvider);
      const comparisonFingerprint = digest || `memory:${canonical}`;

      if (memoryKey && memoryFingerprint === comparisonFingerprint) return memoryKey;

      if (digest) {
        const stored = readStoredAttempt(storage, storageKey, now());
        if (stored?.fingerprint === digest) {
          memoryKey = stored.key;
          memoryFingerprint = comparisonFingerprint;
          return memoryKey;
        }
        if (stored) removeStoredAttempt(storage, storageKey);
      } else {
        removeStoredAttempt(storage, storageKey);
      }

      memoryKey = String(createKey() || "").trim();
      if (!memoryKey || memoryKey.length > 200) {
        throw new Error("Could not create a valid checkout attempt key.");
      }
      memoryFingerprint = comparisonFingerprint;

      if (digest) {
        writeStoredAttempt(storage, storageKey, {
          version: 1,
          key: memoryKey,
          fingerprint: digest,
          expiresAt: now() + ttlMs
        });
      }
      return memoryKey;
    },

    clear() {
      memoryKey = "";
      memoryFingerprint = "";
      removeStoredAttempt(storage, storageKey);
    }
  };
}
