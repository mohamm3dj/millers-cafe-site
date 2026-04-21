"use strict";

export function urlOf(request) {
  return new URL(request.url);
}

export function queryFlag(url, key) {
  return String(url.searchParams.get(key) || "") === "1";
}

export function queryString(url, key, fallback = "") {
  const value = url.searchParams.get(key);
  return value === null ? String(fallback) : String(value);
}

export function queryLower(url, key, fallback = "") {
  return queryString(url, key, fallback).trim().toLowerCase();
}

export function queryPositiveInt(url, key, fallback, options = {}) {
  const min = Number.isFinite(options.min) ? Number(options.min) : 1;
  const max = Number.isFinite(options.max) ? Number(options.max) : Number.POSITIVE_INFINITY;
  const parsed = Number(url.searchParams.get(key));
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.min(max, Math.max(min, rounded));
}

