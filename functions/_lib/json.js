"use strict";

function withNoStore(headers = {}) {
  return {
    "Cache-Control": "no-store",
    ...headers
  };
}

export function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: withNoStore({
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    })
  });
}

export function jsonError(message, status = 400, details = null) {
  const body = { error: String(message || "Request failed.") };
  if (details && typeof details === "object") body.details = details;
  return json(body, status);
}

export function csv(text, status = 200) {
  return new Response(String(text || ""), {
    status,
    headers: withNoStore({
      "Content-Type": "text/csv; charset=utf-8"
    })
  });
}

export function methodNotAllowed(allowedMethods) {
  const allow = Array.isArray(allowedMethods) ? allowedMethods.join(", ") : "GET";
  return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405,
    headers: withNoStore({
      "Content-Type": "application/json; charset=utf-8",
      Allow: allow
    })
  });
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch (error) {
    return null;
  }
}

