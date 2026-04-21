"use strict";

import { errorResponse } from "../../_lib/errors.js";
import { json, methodNotAllowed } from "../../_lib/json.js";
import { listAccountOrders, requireAuthenticatedAccount } from "../../_lib/account-service.js";

export async function onRequestGet(context) {
  try {
    const session = await requireAuthenticatedAccount(context.env, context.request);
    const orders = await listAccountOrders(context.env, session.email);
    return json({
      ok: true,
      orders
    });
  } catch (error) {
    return errorResponse(error, "Account orders could not be loaded.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET"]);
}
