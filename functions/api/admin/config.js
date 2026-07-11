"use strict";

import { resolveAdminTokens, isTokenAuthorized } from "../../_lib/auth.js";
import { ApiError, errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed, readJsonBody } from "../../_lib/json.js";
import { getSiteConfig, saveSiteConfig } from "../../_lib/site-config.js";

function assertAdmin(context) {
  const tokens = resolveAdminTokens(context.env);
  if (!isTokenAuthorized(context.request, tokens)) {
    throw new ApiError("Unauthorized.", 401);
  }
}

export async function onRequestGet(context) {
  try {
    assertAdmin(context);
    const config = await getSiteConfig(context.env);
    return json({
      ok: true,
      config
    });
  } catch (error) {
    return errorResponse(error, "Admin config could not be loaded.");
  }
}

export async function onRequestPut(context) {
  try {
    assertAdmin(context);
    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }
    const config = await saveSiteConfig(context.env, payload.config);
    return json({
      ok: true,
      config
    });
  } catch (error) {
    return errorResponse(error, "Admin config could not be saved.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET", "PUT"]);
}
