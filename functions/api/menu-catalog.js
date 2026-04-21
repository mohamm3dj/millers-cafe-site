"use strict";

import { errorResponse } from "../_lib/errors.js";
import { json, methodNotAllowed } from "../_lib/json.js";
import { getMenuCatalog } from "../_lib/site-config.js";

export async function onRequestGet(context) {
  try {
    const menu = await getMenuCatalog(context.env);
    return json({
      ok: true,
      menu
    });
  } catch (error) {
    return errorResponse(error, "Menu catalog could not be loaded.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET"]);
}
