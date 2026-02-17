"use strict";

const RESEND_API_URL = "https://api.resend.com/emails";

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function formatDateForEmail(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return String(isoDate || "");
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function bookingDetailsLines(booking, reference) {
  const occasionLine = booking.specialOccasion && booking.specialOccasion !== "None"
    ? booking.specialOccasion
    : "None";

  return [
    ["Reference", reference],
    ["Name", booking.customerName],
    ["Date", formatDateForEmail(booking.date)],
    ["Time", booking.time],
    ["Party size", String(booking.partySize)],
    ["Occasion", occasionLine],
    ["Phone", booking.phoneNumber],
    ["Email", booking.email],
    ["Notes", booking.notes || "None"]
  ];
}

function customerEmailPayload(fromAddress, replyTo, booking, reference) {
  const details = bookingDetailsLines(booking, reference);
  const listHtml = details
    .map(([label, value]) => `<li><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</li>`)
    .join("");

  return {
    from: fromAddress,
    to: booking.email,
    reply_to: replyTo,
    subject: `Your Millers Café booking is confirmed (${reference})`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      "<h2 style=\"margin: 0 0 12px;\">Booking confirmed</h2>",
      "<p style=\"margin: 0 0 12px;\">Thanks for booking with Millers Café. Here are your booking details:</p>",
      `<ul style="margin: 0 0 16px; padding-left: 18px;">${listHtml}</ul>`,
      "<p style=\"margin: 0;\">If you need to update your booking, reply to this email.</p>",
      "</div>"
    ].join(""),
    text: [
      "Your booking is confirmed at Millers Café.",
      "",
      ...details.map(([label, value]) => `${label}: ${value}`),
      "",
      "If you need to update your booking, reply to this email."
    ].join("\n")
  };
}

function ownerEmailPayload(fromAddress, replyTo, ownerEmail, booking, reference) {
  const details = bookingDetailsLines(booking, reference);
  const listHtml = details
    .map(([label, value]) => `<li><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</li>`)
    .join("");

  return {
    from: fromAddress,
    to: ownerEmail,
    reply_to: replyTo,
    subject: `New booking received (${reference})`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      "<h2 style=\"margin: 0 0 12px;\">New website booking</h2>",
      `<ul style="margin: 0; padding-left: 18px;">${listHtml}</ul>`,
      "</div>"
    ].join(""),
    text: [
      "New website booking received.",
      "",
      ...details.map(([label, value]) => `${label}: ${value}`)
    ].join("\n")
  };
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

export async function sendBookingEmails(env, booking, reference) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const fromAddress = String(env.BOOKINGS_EMAIL_FROM || "").trim();
  const ownerEmail = String(env.BOOKINGS_NOTIFICATION_EMAIL || "help@millers.cafe").trim();
  const replyTo = String(env.BOOKINGS_REPLY_TO || ownerEmail).trim();

  if (!apiKey || !fromAddress) {
    return { enabled: false, sentAll: false, delivered: 0, total: 0, errors: ["Email provider not configured."] };
  }

  const jobs = [
    customerEmailPayload(fromAddress, replyTo, booking, reference),
    ownerEmailPayload(fromAddress, replyTo, ownerEmail, booking, reference)
  ];

  let delivered = 0;
  const errors = [];

  for (const job of jobs) {
    const result = await sendResendEmail(apiKey, job);
    if (result.ok) {
      delivered += 1;
    } else {
      errors.push(result.error || "Unknown email delivery error.");
    }
  }

  return {
    enabled: true,
    sentAll: delivered === jobs.length,
    delivered,
    total: jobs.length,
    errors
  };
}
