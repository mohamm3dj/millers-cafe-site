"use strict";

import { ApiError, errorResponse } from "../../_lib/errors.js";
import { readJsonBody, json, methodNotAllowed } from "../../_lib/json.js";
import { recordAnalyticsEvent } from "../../_lib/analytics.js";
import { enforceRateLimit } from "../../_lib/rate-limit.js";
import { requestAccountSignInCode } from "../../_lib/account-auth.js";
import { verifyTurnstileToken } from "../../_lib/turnstile.js";

export async function onRequestPost(context) {
  try {
    await enforceRateLimit(context.env, context.request, {
      prefix: "account_request_code",
      limit: 5,
      windowSeconds: 300,
      message: "Too many sign-in code requests. Please wait a few minutes and try again."
    });

    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }

    await verifyTurnstileToken(context.env, context.request, payload.turnstileToken);
    const result = await requestAccountSignInCode(context.env, payload.email);
    await recordAnalyticsEvent(context.env, "account_code_requested", {
      page: "account",
      route: "/api/account/request-code"
    });
    return json(result);
  } catch (error) {
    return errorResponse(error, "Sign-in code could not be requested.");
  }
}

export function onRequest() {
  return methodNotAllowed(["POST"]);
}
