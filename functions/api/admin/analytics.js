"use strict";

import { resolveAdminTokens, isTokenAuthorized } from "../../_lib/auth.js";
import { ApiError, errorResponse } from "../../_lib/errors.js";
import { queryPositiveInt, urlOf } from "../../_lib/http.js";
import { json, methodNotAllowed } from "../../_lib/json.js";
import { getAnalyticsSummary } from "../../_lib/analytics.js";

function assertAdmin(context) {
  const tokens = resolveAdminTokens(context.env);
  if (!isTokenAuthorized(context.request, tokens)) {
    throw new ApiError("Unauthorized.", 401);
  }
}

export async function onRequestGet(context) {
  try {
    assertAdmin(context);
    const days = queryPositiveInt(urlOf(context.request), "days", 30, { min: 1, max: 90 });
    const summary = await getAnalyticsSummary(context.env, days);
    return json(summary);
  } catch (error) {
    return errorResponse(error, "Analytics summary could not be loaded.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET"]);
}
