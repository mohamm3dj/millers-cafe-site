"use strict";

import { ApiError, errorResponse } from "../../../_lib/errors.js";
import { json, methodNotAllowed, readJsonBody } from "../../../_lib/json.js";
import {
  cancelAccountBooking,
  requireAuthenticatedAccount
} from "../../../_lib/account-service.js";

export async function onRequestPost(context) {
  try {
    const session = await requireAuthenticatedAccount(context.env, context.request);
    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }

    const booking = await cancelAccountBooking(context.env, session.email, payload.bookingId);
    return json({
      ok: true,
      booking
    });
  } catch (error) {
    return errorResponse(error, "Booking could not be cancelled.");
  }
}

export function onRequest() {
  return methodNotAllowed(["POST"]);
}
