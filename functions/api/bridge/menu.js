"use strict";

import { resolveVenueBridgeTokens, isTokenAuthorized } from "../../_lib/auth.js";
import { ApiError, errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed, readJsonBody } from "../../_lib/json.js";
import { getMenuCatalog, saveMenuCatalog } from "../../_lib/site-config.js";

function assertBridge(context, bodyToken = "") {
  const tokens = resolveVenueBridgeTokens(context.env);
  if (tokens.length === 0) {
    throw new ApiError("Venue bridge token is not configured.", 503);
  }
  if (!isTokenAuthorized(context.request, tokens, bodyToken)) {
    throw new ApiError("Unauthorized.", 401);
  }
}

function countItems(menu) {
  return (Array.isArray(menu) ? menu : []).reduce((sum, category) => (
    sum + (Array.isArray(category?.items) ? category.items.length : 0)
  ), 0);
}

export async function onRequestGet(context) {
  try {
    assertBridge(context);
    const menu = await getMenuCatalog(context.env);
    return json({
      ok: true,
      menu,
      categoryCount: menu.length,
      itemCount: countItems(menu)
    });
  } catch (error) {
    return errorResponse(error, "Bridge menu could not be loaded.");
  }
}

export async function onRequestPut(context) {
  try {
    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }
    assertBridge(context, payload.token);
    const menu = await saveMenuCatalog(context.env, payload.menu || payload.categories);
    return json({
      ok: true,
      source: String(payload.source || "pos").trim(),
      menuVersion: String(payload.menuVersion || "").trim(),
      updatedAt: String(payload.updatedAt || "").trim(),
      publishedAt: new Date().toISOString(),
      menu,
      categoryCount: menu.length,
      itemCount: countItems(menu)
    });
  } catch (error) {
    return errorResponse(error, "Bridge menu could not be saved.");
  }
}

export async function onRequestPost(context) {
  return onRequestPut(context);
}

export function onRequest() {
  return methodNotAllowed(["GET", "PUT", "POST"]);
}
