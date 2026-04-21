"use strict";

import { ApiError, errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed, readJsonBody } from "../../_lib/json.js";
import {
  requireAuthenticatedAccount,
  getAccountProfile,
  saveAccountProfile
} from "../../_lib/account-service.js";

export async function onRequestGet(context) {
  try {
    const session = await requireAuthenticatedAccount(context.env, context.request);
    const profile = await getAccountProfile(context.env, session.email);
    return json({
      ok: true,
      profile
    });
  } catch (error) {
    return errorResponse(error, "Account profile could not be loaded.");
  }
}

export async function onRequestPut(context) {
  try {
    const session = await requireAuthenticatedAccount(context.env, context.request);
    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }

    const profile = await saveAccountProfile(context.env, session.email, payload.profile);
    return json({
      ok: true,
      profile
    });
  } catch (error) {
    return errorResponse(error, "Account profile could not be saved.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET", "PUT"]);
}
