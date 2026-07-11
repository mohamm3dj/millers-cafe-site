"use strict";

export function bearerTokenFromRequest(request) {
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

function tokensFromCsv(value) {
  return String(value || "")
    .split(",")
    .map((token) => token.trim());
}

function safeTokenEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export function resolveFeedTokens(env, scope = "bookings") {
  if (scope === "orders") {
    return uniqueNonEmpty([env?.ORDERS_FEED_TOKEN]);
  }
  return uniqueNonEmpty([env?.BOOKINGS_FEED_TOKEN]);
}

export function resolveOrderAdminTokens(env) {
  return uniqueNonEmpty([env?.ORDERS_ADMIN_TOKEN]);
}

export function resolveVenueBridgeTokens(env) {
  return uniqueNonEmpty([env?.VENUE_BRIDGE_TOKEN_V2]);
}

export function resolveAdminTokens(env) {
  return uniqueNonEmpty([
    env?.ADMIN_API_TOKEN,
    ...tokensFromCsv(env?.ADMIN_API_TOKENS)
  ]);
}

export function isTokenAuthorized(request, configuredTokens) {
  if (!Array.isArray(configuredTokens) || configuredTokens.length === 0) {
    return false;
  }

  const candidateTokens = uniqueNonEmpty([
    request.headers.get("x-api-key"),
    request.headers.get("x-orders-admin-token"),
    bearerTokenFromRequest(request)
  ]);

  if (candidateTokens.length === 0) return false;
  return candidateTokens.some((candidate) => (
    configuredTokens.some((configured) => safeTokenEqual(candidate, configured))
  ));
}
