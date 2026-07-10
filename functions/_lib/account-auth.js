"use strict";

import { sendAccountSignInEmail } from "../_account-email.js";
import { ApiError } from "./errors.js";

const ACCOUNT_CODE_PREFIX = "account_login_code:";
const ACCOUNT_SESSION_PREFIX = "account_session:";
const ACCOUNT_COOKIE_NAME = "millers_account_session";
const ACCOUNT_CODE_TTL_SECONDS = 10 * 60;
const ACCOUNT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACCOUNT_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
const ACCOUNT_MAX_FAILED_ATTEMPTS = 5;

function getInMemoryStore() {
  if (!globalThis.__millersCafeAccountStore || typeof globalThis.__millersCafeAccountStore !== "object") {
    globalThis.__millersCafeAccountStore = {};
  }
  return globalThis.__millersCafeAccountStore;
}

function getAccountCodeLockStore() {
  if (!(globalThis.__millersCafeAccountCodeLocks instanceof Map)) {
    globalThis.__millersCafeAccountCodeLocks = new Map();
  }
  return globalThis.__millersCafeAccountCodeLocks;
}

async function withAccountCodeLock(email, work) {
  const key = normalizeEmail(email);
  const locks = getAccountCodeLockStore();
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  locks.set(key, current);

  try {
    return await current;
  } finally {
    if (locks.get(key) === current) {
      locks.delete(key);
    }
  }
}

function nowISO() {
  return new Date().toISOString();
}

function nowMillis() {
  return Date.now();
}

function isLikelyEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeCode(code) {
  return String(code || "").replace(/\s+/g, "").trim();
}

function parseISOToMillis(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function secondsUntil(expiresAt) {
  const remainingMs = parseISOToMillis(expiresAt) - nowMillis();
  if (remainingMs <= 0) return 1;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function codeKey(email) {
  return `${ACCOUNT_CODE_PREFIX}${normalizeEmail(email)}`;
}

function sessionKey(token) {
  return `${ACCOUNT_SESSION_PREFIX}${String(token || "").trim()}`;
}

function randomInt(maxExclusive) {
  const max = Math.max(1, Math.floor(Number(maxExclusive || 1)));
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function randomToken(bytes = 24) {
  const length = Math.max(12, Math.floor(Number(bytes || 24)));
  const buffer = new Uint8Array(length);

  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(buffer);
  } else {
    for (let index = 0; index < buffer.length; index += 1) {
      buffer[index] = randomInt(256);
    }
  }

  return Array.from(buffer, (value) => value.toString(16).padStart(2, "0")).join("");
}

function makeSignInCode() {
  return String(100000 + randomInt(900000));
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.indexOf("@");
  if (atIndex <= 0) return normalized;

  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  if (local.length <= 2) {
    return `${local[0] || "*"}*@${domain}`;
  }
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function accountCodeRecord(raw) {
  if (!raw || typeof raw !== "object") return null;

  return {
    email: normalizeEmail(raw.email),
    codeHash: String(raw.codeHash || "").trim(),
    requestedAt: String(raw.requestedAt || ""),
    expiresAt: String(raw.expiresAt || ""),
    failedAttempts: Math.max(0, Math.round(Number(raw.failedAttempts || 0)))
  };
}

function accountSessionRecord(raw) {
  if (!raw || typeof raw !== "object") return null;

  return {
    email: normalizeEmail(raw.email),
    createdAt: String(raw.createdAt || ""),
    expiresAt: String(raw.expiresAt || "")
  };
}

async function readStoreRecord(env, key, normalizer = null) {
  let raw = null;

  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.get === "function") {
    raw = await env.BOOKINGS_KV.get(key, "json");
  } else {
    raw = getInMemoryStore()[key] || null;
  }

  return typeof normalizer === "function" ? normalizer(raw) : raw;
}

async function writeStoreRecord(env, key, value, ttlSeconds) {
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.put === "function") {
    if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
      await env.BOOKINGS_KV.put(key, JSON.stringify(value), {
        expirationTtl: Math.max(60, Math.round(ttlSeconds))
      });
      return;
    }
    await env.BOOKINGS_KV.put(key, JSON.stringify(value));
    return;
  }

  getInMemoryStore()[key] = value;
}

async function deleteStoreRecord(env, key) {
  if (env.BOOKINGS_KV && typeof env.BOOKINGS_KV.delete === "function") {
    await env.BOOKINGS_KV.delete(key);
    return;
  }

  delete getInMemoryStore()[key];
}

async function sha256Hex(value) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new ApiError("Secure hashing is unavailable in this runtime.", 500);
  }

  const buffer = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value || ""))
  );

  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashEmailCode(email, code) {
  return sha256Hex(`${normalizeEmail(email)}:${normalizeCode(code)}`);
}

function safeStringEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function parseCookieHeader(request) {
  const header = String(request.headers.get("cookie") || "");
  const map = new Map();

  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key) continue;
    map.set(key, decodeURIComponent(value));
  }

  return map;
}

function requestIsSecure(request) {
  try {
    return new URL(request.url).protocol === "https:";
  } catch (error) {
    return false;
  }
}

export function buildAccountSessionCookie(request, token) {
  const parts = [
    `${ACCOUNT_COOKIE_NAME}=${encodeURIComponent(String(token || "").trim())}`,
    `Max-Age=${ACCOUNT_SESSION_TTL_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (requestIsSecure(request)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function buildAccountLogoutCookie(request) {
  const parts = [
    `${ACCOUNT_COOKIE_NAME}=`,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (requestIsSecure(request)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export async function requestAccountSignInCode(env, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!isLikelyEmail(normalizedEmail)) {
    throw new ApiError("A valid email address is required.", 400);
  }

  const existing = await readStoreRecord(env, codeKey(normalizedEmail), accountCodeRecord);
  if (existing) {
    const requestedAtMs = parseISOToMillis(existing.requestedAt);
    if (requestedAtMs > 0 && (nowMillis() - requestedAtMs) < ACCOUNT_CODE_RESEND_COOLDOWN_MS) {
      throw new ApiError("Please wait a minute before requesting another code.", 429);
    }
  }

  const code = makeSignInCode();
  const expiresAt = new Date(nowMillis() + (ACCOUNT_CODE_TTL_SECONDS * 1000)).toISOString();
  const record = {
    email: normalizedEmail,
    codeHash: await hashEmailCode(normalizedEmail, code),
    requestedAt: nowISO(),
    expiresAt,
    failedAttempts: 0
  };

  await writeStoreRecord(env, codeKey(normalizedEmail), record, ACCOUNT_CODE_TTL_SECONDS);

  const emailResult = await sendAccountSignInEmail(env, normalizedEmail, code, {
    expiresInMinutes: ACCOUNT_CODE_TTL_SECONDS / 60
  });

  if (!emailResult.enabled) {
    await deleteStoreRecord(env, codeKey(normalizedEmail));
    throw new ApiError("Account sign-in email is not configured yet.", 503);
  }

  if (!emailResult.sent) {
    await deleteStoreRecord(env, codeKey(normalizedEmail));
    throw new ApiError("Sign-in email could not be sent. Please try again.", 502, {
      emailErrors: emailResult.errors || []
    });
  }

  return {
    ok: true,
    email: normalizedEmail,
    emailMasked: maskEmail(normalizedEmail),
    expiresInMinutes: ACCOUNT_CODE_TTL_SECONDS / 60
  };
}

export async function verifyAccountSignInCode(env, email, code) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = normalizeCode(code);

  if (!isLikelyEmail(normalizedEmail)) {
    throw new ApiError("A valid email address is required.", 400);
  }

  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new ApiError("Enter the 6-digit code from your email.", 400);
  }

  return withAccountCodeLock(normalizedEmail, async () => {
    const key = codeKey(normalizedEmail);
    const record = await readStoreRecord(env, key, accountCodeRecord);
    if (!record || record.email !== normalizedEmail || parseISOToMillis(record.expiresAt) <= nowMillis()) {
      if (record) {
        await deleteStoreRecord(env, key);
      }
      throw new ApiError("That sign-in code is invalid or has expired.", 401);
    }

    const expectedHash = await hashEmailCode(normalizedEmail, normalizedCode);
    if (!safeStringEqual(record.codeHash, expectedHash)) {
      const failedAttempts = record.failedAttempts + 1;
      if (failedAttempts >= ACCOUNT_MAX_FAILED_ATTEMPTS) {
        await deleteStoreRecord(env, key);
        throw new ApiError("That sign-in code has expired. Please request a new code.", 401);
      }

      await writeStoreRecord(env, key, {
        ...record,
        failedAttempts
      }, secondsUntil(record.expiresAt));

      throw new ApiError("That sign-in code is incorrect.", 401);
    }

    await deleteStoreRecord(env, key);

    const sessionToken = randomToken(24);
    const expiresAt = new Date(nowMillis() + (ACCOUNT_SESSION_TTL_SECONDS * 1000)).toISOString();
    await writeStoreRecord(env, sessionKey(sessionToken), {
      email: normalizedEmail,
      createdAt: nowISO(),
      expiresAt
    }, ACCOUNT_SESSION_TTL_SECONDS);

    return {
      ok: true,
      authenticated: true,
      email: normalizedEmail,
      expiresAt,
      sessionToken
    };
  });
}

export async function getOptionalAccountSession(env, request) {
  const cookies = parseCookieHeader(request);
  const sessionToken = String(cookies.get(ACCOUNT_COOKIE_NAME) || "").trim();
  if (!sessionToken) {
    return {
      authenticated: false,
      email: ""
    };
  }

  const key = sessionKey(sessionToken);
  const record = await readStoreRecord(env, key, accountSessionRecord);
  if (!record || !record.email) {
    return {
      authenticated: false,
      email: ""
    };
  }

  if (parseISOToMillis(record.expiresAt) <= nowMillis()) {
    await deleteStoreRecord(env, key);
    return {
      authenticated: false,
      email: ""
    };
  }

  return {
    authenticated: true,
    email: record.email,
    expiresAt: record.expiresAt,
    sessionToken
  };
}

export async function requireAccountSession(env, request) {
  const session = await getOptionalAccountSession(env, request);
  if (!session.authenticated) {
    throw new ApiError("Authentication required.", 401);
  }
  return session;
}

export async function clearAccountSession(env, request) {
  const session = await getOptionalAccountSession(env, request);
  if (session.sessionToken) {
    await deleteStoreRecord(env, sessionKey(session.sessionToken));
  }
}
