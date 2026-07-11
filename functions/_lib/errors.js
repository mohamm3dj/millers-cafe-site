"use strict";

import { jsonError, RequestBodyError } from "./json.js";

export class ApiError extends Error {
  constructor(message, status = 400, details = null) {
    super(String(message || "Request failed."));
    this.name = "ApiError";
    this.status = Number.isInteger(status) ? status : 400;
    this.details = details;
  }
}

export function asApiError(error, fallbackMessage = "Request failed.") {
  if (error instanceof ApiError) return error;
  if (error instanceof RequestBodyError) {
    return new ApiError(error.message, error.status);
  }
  const message = error instanceof Error && error.message
    ? error.message
    : fallbackMessage;
  return new ApiError(message, 500);
}

export function errorResponse(error, fallbackMessage = "Request failed.") {
  const normalized = asApiError(error, fallbackMessage);
  return jsonError(normalized.message, normalized.status, normalized.details);
}
