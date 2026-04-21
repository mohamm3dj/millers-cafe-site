"use strict";

import { getOptionalAccountSession } from "../../_lib/account-auth.js";
import { errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed } from "../../_lib/json.js";
import { getAccountSummary } from "../../_lib/account-service.js";

export async function onRequestGet(context) {
  try {
    const session = await getOptionalAccountSession(context.env, context.request);
    if (!session.authenticated) {
      return json({
        ok: true,
        authenticated: false
      });
    }

    const account = await getAccountSummary(context.env, session.email);
    return json({
      ok: true,
      authenticated: true,
      account,
      session: {
        email: session.email,
        expiresAt: session.expiresAt
      }
    });
  } catch (error) {
    return errorResponse(error, "Account state could not be read.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET"]);
}
