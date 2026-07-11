"use strict";

import { jsonError, methodNotAllowed } from "../_lib/json.js";

export function onRequestPost() {
  return jsonError(
    "Direct order creation is disabled. Use the secure checkout endpoint.",
    410
  );
}

export function onRequest() {
  return methodNotAllowed(["POST"]);
}
