"use strict";

import { buildAccountSessionCookie, verifyAccountSignInCode } from "../../_lib/account-auth.js";
import { ApiError, errorResponse } from "../../_lib/errors.js";
import { readJsonBody, json, methodNotAllowed } from "../../_lib/json.js";
import { recordAnalyticsEvent } from "../../_lib/analytics.js";
import { enforceRateLimit } from "../../_lib/rate-limit.js";

export async function onRequestPost(context) {
  try {
    await enforceRateLimit(context.env, context.request, {
      prefix: "account_verify_code",
      limit: 10,
      windowSeconds: 300,
      message: "Too many sign-in attempts. Please wait a few minutes and try again."
    });

    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }

    const verified = await verifyAccountSignInCode(context.env, payload.email, payload.code);
    const { sessionToken, ...body } = verified;
    await recordAnalyticsEvent(context.env, "account_code_verified", {
      page: "account",
      route: "/api/account/verify-code"
    });
    return json(body, 200, {
      "Set-Cookie": buildAccountSessionCookie(context.request, sessionToken)
    });
  } catch (error) {
    return errorResponse(error, "Sign-in code could not be verified.");
  }
}

export function onRequest() {
  return methodNotAllowed(["POST"]);
}
