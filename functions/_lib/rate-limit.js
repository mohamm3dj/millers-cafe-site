"use strict";

import { ApiError } from "./errors.js";

function getInMemoryStore() {
  if (!globalThis.__millersCafeRateLimitStore || typeof globalThis.__millersCafeRateLimitStore !== "object") {
    globalThis.__millersCafeRateLimitStore = {};
  }
  return globalThis.__millersCafeRateLimitStore;
}

function getLockStore() {
  if (!(globalThis.__millersCafeRateLimitLocks instanceof Map)) {
    globalThis.__millersCafeRateLimitLocks = new Map();
  }
  return globalThis.__millersCafeRateLimitLocks;
}

function enabledFlag(value) {
  return ["1", "true", "yes", "on", "required"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function hasKvStore(env) {
  return Boolean(
    env?.BOOKINGS_KV &&
    typeof env.BOOKINGS_KV.get === "function" &&
    typeof env.BOOKINGS_KV.put === "function"
  );
}

function rateLimitKey(prefix, clientId) {
  return `rate_limit:${String(prefix || "route").trim()}:${String(clientId || "anon").trim()}`;
}

function nowMillis() {
  return Date.now();
}

function clientIdentifier(request) {
  const forwarded = String(request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "").trim();
  if (!forwarded) return "anon";
  return forwarded.split(",")[0].trim().slice(0, 128) || "anon";
}

function normalizeRecord(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    count: Math.max(0, Math.round(Number(source.count || 0))),
    resetAt: Math.max(0, Math.round(Number(source.resetAt || 0)))
  };
}

async function readRecord(env, key) {
  if (hasKvStore(env)) {
    const stored = await env.BOOKINGS_KV.get(key, "json");
    return normalizeRecord(stored);
  }
  return normalizeRecord(getInMemoryStore()[key]);
}

async function writeRecord(env, key, record, ttlSeconds) {
  const normalized = normalizeRecord(record);
  if (hasKvStore(env)) {
    await env.BOOKINGS_KV.put(key, JSON.stringify(normalized), {
      expirationTtl: Math.max(60, Math.round(Number(ttlSeconds || 60)))
    });
    return;
  }
  getInMemoryStore()[key] = normalized;
}

async function withKeyLock(key, work) {
  const locks = getLockStore();
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => {}).then(() => current);
  locks.set(key, queued);

  try {
    await previous.catch(() => {});
    return await work();
  } finally {
    release();
    if (locks.get(key) === queued) {
      locks.delete(key);
    }
  }
}

function isKvWriteRateLimit(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || "").toLowerCase();
  return status === 429 || message.includes("429") || message.includes("write rate limit");
}

function retryAfterSeconds(record, now) {
  return Math.max(1, Math.ceil((Number(record?.resetAt || 0) - now) / 1000));
}

export async function enforceRateLimit(env, request, options = {}) {
  const limit = Math.max(1, Math.round(Number(options.limit || 10)));
  const windowSeconds = Math.max(1, Math.round(Number(options.windowSeconds || 60)));
  const prefix = String(options.prefix || "route").trim() || "route";
  const message = String(options.message || "Too many requests. Please wait and try again.");

  if (enabledFlag(env?.REQUIRE_DISTRIBUTED_RATE_LIMIT) && !hasKvStore(env)) {
    throw new ApiError("Request protection is temporarily unavailable.", 503);
  }

  const clientId = clientIdentifier(request);
  const key = rateLimitKey(prefix, clientId);

  return withKeyLock(key, async () => {
    let current;
    try {
      current = await readRecord(env, key);
    } catch (error) {
      if (enabledFlag(env?.REQUIRE_DISTRIBUTED_RATE_LIMIT)) {
        throw new ApiError("Request protection is temporarily unavailable.", 503);
      }
      throw error;
    }
    const now = nowMillis();

    if (current.resetAt > now && current.count >= limit) {
      throw new ApiError(message, 429, {
        retryAfterSeconds: retryAfterSeconds(current, now)
      });
    }

    const next = current.resetAt <= now
      ? {
        count: 1,
        resetAt: now + (windowSeconds * 1000)
      }
      : {
        count: current.count + 1,
        resetAt: current.resetAt
      };

    try {
      await writeRecord(
        env,
        key,
        next,
        current.resetAt <= now ? windowSeconds : retryAfterSeconds(current, now)
      );
    } catch (error) {
      if (isKvWriteRateLimit(error)) {
        throw new ApiError(message, 429, {
          retryAfterSeconds: retryAfterSeconds(next, now)
        });
      }
      if (enabledFlag(env?.REQUIRE_DISTRIBUTED_RATE_LIMIT)) {
        throw new ApiError("Request protection is temporarily unavailable.", 503);
      }
      throw error;
    }

    return next;
  });
}
