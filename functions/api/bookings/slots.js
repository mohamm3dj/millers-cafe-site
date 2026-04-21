"use strict";

import { getBookingAvailability } from "../../_lib/bookings-service.js";
import { errorResponse } from "../../_lib/errors.js";
import { queryPositiveInt, queryString, urlOf } from "../../_lib/http.js";
import { json, methodNotAllowed } from "../../_lib/json.js";

export async function onRequestGet(context) {
  try {
    const url = urlOf(context.request);
    const date = queryString(url, "date", "");
    const partySize = queryPositiveInt(url, "partySize", 2, { min: 1, max: 40 });
    const durationMinutes = queryPositiveInt(url, "durationMinutes", 90, { min: 15, max: 240 });

    const availability = await getBookingAvailability(context.env, {
      date,
      partySize,
      durationMinutes
    });
    return json(availability);
  } catch (error) {
    return errorResponse(error, "Could not load booking availability.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET"]);
}
