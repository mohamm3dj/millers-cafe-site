"use strict";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const PRODUCTION_HOSTNAMES = new Set(["millers.cafe", "www.millers.cafe"]);

function explicitBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return TRUE_VALUES.has(normalized);
}

export function isOnlineOrderingEnabled(env, requestUrl) {
  const configured = explicitBoolean(env?.ONLINE_ORDERING_ENABLED);
  if (configured !== null) return configured;

  try {
    return !PRODUCTION_HOSTNAMES.has(new URL(requestUrl).hostname.toLowerCase());
  } catch (error) {
    return false;
  }
}
