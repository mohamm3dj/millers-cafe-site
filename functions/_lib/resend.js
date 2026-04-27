"use strict";

const RESEND_API_URL = "https://api.resend.com/emails";

function firstNonEmptyString(values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function compactText(value, maxLength = 600) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function responseDetail(rawText) {
  const text = compactText(rawText);
  if (!text) return "";

  try {
    const parsed = JSON.parse(text);
    const nestedError = parsed?.error && typeof parsed.error === "object"
      ? parsed.error.message
      : parsed?.error;
    return compactText(firstNonEmptyString([
      parsed?.message,
      nestedError,
      parsed?.name,
      text
    ]));
  } catch (error) {
    return text;
  }
}

function recipientLabel(to) {
  if (Array.isArray(to)) {
    return to.map((value) => String(value || "").trim()).filter(Boolean).join(", ");
  }
  return String(to || "").trim();
}

export function singleRecipient(value) {
  const recipient = String(value || "").trim();
  return recipient ? [recipient] : [];
}

export function recipientList(...values) {
  const seen = new Set();
  const recipients = [];

  for (const value of values.flat()) {
    const parts = String(value || "")
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const key = part.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        recipients.push(part);
      }
    }
  }

  return recipients;
}

export async function sendResendEmail(apiKey, payload) {
  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (response.ok) {
    return { ok: true };
  }

  let errorText = "";
  try {
    errorText = await response.text();
  } catch (error) {
    errorText = "";
  }

  const detail = responseDetail(errorText);
  const recipient = recipientLabel(payload?.to);
  return {
    ok: false,
    status: response.status,
    error: `Resend ${response.status}${detail ? `: ${detail}` : ""}${recipient ? ` (to ${recipient})` : ""}`
  };
}
