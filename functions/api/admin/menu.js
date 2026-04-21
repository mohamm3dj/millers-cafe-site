"use strict";

import { resolveAdminTokens, isTokenAuthorized } from "../../_lib/auth.js";
import { ApiError, errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed, readJsonBody } from "../../_lib/json.js";
import { getMenuCatalog, saveMenuCatalog } from "../../_lib/site-config.js";

function assertAdmin(context, bodyToken = "") {
  const tokens = resolveAdminTokens(context.env);
  if (!isTokenAuthorized(context.request, tokens, bodyToken)) {
    throw new ApiError("Unauthorized.", 401);
  }
}

export async function onRequestGet(context) {
  try {
    assertAdmin(context);
    const menu = await getMenuCatalog(context.env);
    return json({
      ok: true,
      menu
    });
  } catch (error) {
    return errorResponse(error, "Admin menu could not be loaded.");
  }
}

export async function onRequestPut(context) {
  try {
    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }
    assertAdmin(context, payload.token);
    const menu = await saveMenuCatalog(context.env, payload.menu);
    return json({
      ok: true,
      menu
    });
  } catch (error) {
    return errorResponse(error, "Admin menu could not be saved.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET", "PUT"]);
}
