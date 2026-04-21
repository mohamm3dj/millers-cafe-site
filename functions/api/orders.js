"use strict";

import { createOrder } from "../_lib/orders-service.js";
import { ApiError, errorResponse } from "../_lib/errors.js";
import { json, methodNotAllowed, readJsonBody } from "../_lib/json.js";

export async function onRequestPost(context) {
  try {
    const payload = await readJsonBody(context.request);
    if (!payload || typeof payload !== "object") {
      throw new ApiError("Invalid JSON body.", 400);
    }
    const created = await createOrder(context.env, payload);
    return json(created, 201);
  } catch (error) {
    return errorResponse(error, "Order could not be created.");
  }
}

export function onRequest() {
  return methodNotAllowed(["POST"]);
}
