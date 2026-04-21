"use strict";

import { errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed } from "../../_lib/json.js";
import { listAccountBookings, requireAuthenticatedAccount } from "../../_lib/account-service.js";

export async function onRequestGet(context) {
  try {
    const session = await requireAuthenticatedAccount(context.env, context.request);
    const bookings = await listAccountBookings(context.env, session.email);
    return json({
      ok: true,
      bookings
    });
  } catch (error) {
    return errorResponse(error, "Account bookings could not be loaded.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET"]);
}
