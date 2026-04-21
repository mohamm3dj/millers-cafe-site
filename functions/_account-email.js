"use strict";

const RESEND_API_URL = "https://api.resend.com/emails";

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

async function sendResendEmail(apiKey, payload) {
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

  return {
    ok: false,
    error: `HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`
  };
}

export async function sendAccountSignInEmail(env, email, code, options = {}) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const fromAddress = String(env.ACCOUNT_EMAIL_FROM || env.BOOKINGS_EMAIL_FROM || "").trim();
  const replyTo = String(env.ACCOUNT_REPLY_TO || env.BOOKINGS_REPLY_TO || "help@millers.cafe").trim();
  const expiresInMinutes = Math.max(1, Math.round(Number(options.expiresInMinutes || 10)));

  if (!apiKey || !fromAddress) {
    return {
      enabled: false,
      sent: false,
      errors: ["Email provider not configured."]
    };
  }

  const payload = {
    from: fromAddress,
    to: String(email || "").trim(),
    reply_to: replyTo,
    subject: `Your Millers Cafe sign-in code: ${code}`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      "<h2 style=\"margin: 0 0 12px;\">Sign in to your Millers Cafe account</h2>",
      "<p style=\"margin: 0 0 12px;\">Use this one-time code to view your bookings and order history.</p>",
      `<p style="margin: 0 0 14px; font-size: 28px; font-weight: 700; letter-spacing: 0.18em;">${htmlEscape(code)}</p>`,
      `<p style="margin: 0 0 12px;">This code expires in ${htmlEscape(expiresInMinutes)} minute${expiresInMinutes === 1 ? "" : "s"}.</p>`,
      "<p style=\"margin: 0; color: #475467;\">If you did not request this, you can ignore the email.</p>",
      "</div>"
    ].join(""),
    text: [
      "Sign in to your Millers Cafe account.",
      "",
      `Your one-time code is: ${code}`,
      `This code expires in ${expiresInMinutes} minute${expiresInMinutes === 1 ? "" : "s"}.`,
      "",
      "If you did not request this, you can ignore the email."
    ].join("\n")
  };

  const result = await sendResendEmail(apiKey, payload);
  if (result.ok) {
    return {
      enabled: true,
      sent: true,
      errors: []
    };
  }

  return {
    enabled: true,
    sent: false,
    errors: [result.error || "Unknown email delivery error."]
  };
}
