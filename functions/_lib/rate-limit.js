"use strict";

import { ApiError } from "./errors.js";

function getInMemoryStore() {
  if (!globalThis.__millersCafeRateLimitStore || typeof globalThis.__millersCafeRateLimitStore !== "object") {
    globalThis.__millersCafeRateLimitStore = {};
  }
  return globalThis.__millersCafeRateLimitStore;
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
  return forwarded.split(",")[0].trim() || "anon";
}

function normalizeRecord(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    count: Math.max(0, Math.round(Number(source.count || 0))),
    resetAt: Math.max(0, Math.round(Number(source.resetAt || 0)))
  };
}

async function readRecord(env, key) {
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    const stored = await env.BOOKINGS_KV.get(key, "json");
    return normalizeRecord(stored);
  }
  return normalizeRecord(getInMemoryStore()[key]);
}

async function writeRecord(env, key, record, ttlSeconds) {
  const normalized = normalizeRecord(record);
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    await env.BOOKINGS_KV.put(key, JSON.stringify(normalized), {
      expirationTtl: Math.max(1, Math.round(Number(ttlSeconds || 60)))
    });
    return;
  }
  getInMemoryStore()[key] = normalized;
}

export async function enforceRateLimit(env, request, options = {}) {
  const limit = Math.max(1, Math.round(Number(options.limit || 10)));
  const windowSeconds = Math.max(1, Math.round(Number(options.windowSeconds || 60)));
  const prefix = String(options.prefix || "route").trim() || "route";
  const message = String(options.message || "Too many requests. Please wait and try again.");

  const clientId = clientIdentifier(request);
  const key = rateLimitKey(prefix, clientId);
  const current = await readRecord(env, key);
  const now = nowMillis();

  if (current.resetAt <= now) {
    const next = {
      count: 1,
      resetAt: now + (windowSeconds * 1000)
    };
    await writeRecord(env, key, next, windowSeconds);
    return next;
  }

  if (current.count >= limit) {
    throw new ApiError(message, 429, {
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    });
  }

  const next = {
    count: current.count + 1,
    resetAt: current.resetAt
  };
  await writeRecord(env, key, next, Math.max(1, Math.ceil((current.resetAt - now) / 1000)));
  return next;
}
