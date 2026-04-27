"use strict";

function tokenFromAuthorizationHeader(request) {
  const auth = String(request.headers.get("authorization") || "").trim();
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function normalizeToken(raw) {
  return String(raw || "").trim();
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const results = [];
  for (const value of values) {
    const token = normalizeToken(value);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    results.push(token);
  }
  return results;
}

export function resolveFeedTokens(env, scope = "bookings") {
  if (scope === "orders") {
    return uniqueNonEmpty([env.ORDERS_FEED_TOKEN]);
  }
  return uniqueNonEmpty([env.BOOKINGS_FEED_TOKEN]);
}

export function resolveOrderAdminTokens(env) {
  return uniqueNonEmpty([
    env.ORDERS_ADMIN_TOKEN,
    env.ORDERS_FEED_TOKEN
  ]);
}

export function resolveVenueBridgeTokens(env) {
  return uniqueNonEmpty([
    env.VENUE_BRIDGE_TOKEN,
    ...String(env?.ADMIN_API_TOKENS || "")
      .split(",")
      .map((value) => value.trim()),
    env.ORDERS_ADMIN_TOKEN,
    env.BOOKINGS_FEED_TOKEN
  ]);
}

export function resolveAdminTokens(env) {
  const configured = uniqueNonEmpty(
    String(env?.ADMIN_API_TOKENS || "")
      .split(",")
      .map((value) => value.trim())
  );

  if (configured.length > 0) {
    return configured;
  }

  return uniqueNonEmpty([
    env.ORDERS_ADMIN_TOKEN,
    env.ORDERS_FEED_TOKEN,
    env.BOOKINGS_FEED_TOKEN
  ]);
}

export function isTokenAuthorized(request, configuredTokens, bodyToken = "") {
  if (!Array.isArray(configuredTokens) || configuredTokens.length === 0) {
    return true;
  }

  const url = new URL(request.url);
  const candidateTokens = uniqueNonEmpty([
    url.searchParams.get("token"),
    request.headers.get("x-api-key"),
    request.headers.get("x-orders-admin-token"),
    tokenFromAuthorizationHeader(request),
    bodyToken
  ]);

  if (candidateTokens.length === 0) return false;
  return candidateTokens.some((token) => configuredTokens.includes(token));
}
