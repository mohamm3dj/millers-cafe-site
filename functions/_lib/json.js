"use strict";

const DEFAULT_JSON_BODY_BYTES = 1024 * 1024;

export class RequestBodyError extends Error {
  constructor(message, status = 413) {
    super(String(message || "Request body is invalid."));
    this.name = "RequestBodyError";
    this.status = Number.isInteger(status) ? status : 413;
  }
}

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

function normalizedBodyLimit(value, fallback = DEFAULT_JSON_BODY_BYTES) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
}

export async function readTextBody(request, options = {}) {
  const maxBytes = normalizedBodyLimit(options.maxBytes);
  const declaredHeader = request.headers.get("content-length");
  const declaredBytes = declaredHeader === null ? NaN : Number(declaredHeader);
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new RequestBodyError("Request body is too large.", 413);
  }

  if (!request.body || typeof request.body.getReader !== "function") {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new RequestBodyError("Request body is too large.", 413);
    }
    return text;
  }

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel();
      } catch (error) {
        // The size error below is authoritative.
      }
      throw new RequestBodyError("Request body is too large.", 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJsonBody(request, options = {}) {
  try {
    const text = await readTextBody(request, options);
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    return null;
  }
}
