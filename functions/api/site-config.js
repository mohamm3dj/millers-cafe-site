"use strict";

import { errorResponse } from "../_lib/errors.js";
import { isOnlineOrderingEnabled } from "../_lib/feature-flags.js";
import { json, methodNotAllowed } from "../_lib/json.js";
import { buildOpeningSummary, getSiteConfig } from "../_lib/site-config.js";

export async function onRequestGet(context) {
  try {
    const config = await getSiteConfig(context.env);
    return json({
      ok: true,
      config: {
        ...config,
        home: {
          ...config.home,
          openingSummary: buildOpeningSummary(config.home.weeklyHours)
        },
        orders: {
          ...config.orders,
          onlineOrderingEnabled: isOnlineOrderingEnabled(context.env, context.request.url)
        },
        security: {
          turnstileEnabled: Boolean(context.env?.TURNSTILE_SITE_KEY && context.env?.TURNSTILE_SECRET_KEY),
          turnstileSiteKey: String(context.env?.TURNSTILE_SITE_KEY || "").trim()
        }
      }
    });
  } catch (error) {
    return errorResponse(error, "Site configuration could not be loaded.");
  }
}

export function onRequest() {
  return methodNotAllowed(["GET"]);
}
