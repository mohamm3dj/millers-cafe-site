"use strict";

import { buildAccountLogoutCookie, clearAccountSession } from "../../_lib/account-auth.js";
import { errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed } from "../../_lib/json.js";

export async function onRequestPost(context) {
  try {
    await clearAccountSession(context.env, context.request);
    return json({
      ok: true,
      authenticated: false
    }, 200, {
      "Set-Cookie": buildAccountLogoutCookie(context.request)
    });
  } catch (error) {
    return errorResponse(error, "Account sign-out could not be completed.");
  }
}

export function onRequest() {
  return methodNotAllowed(["POST"]);
}
