"use strict";

import { sendResendEmail, singleRecipient } from "./_lib/resend.js";

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

function tableLabel(booking) {
  const tables = Array.isArray(booking.assignedTables)
    ? booking.assignedTables.map((table) => String(table || "").trim()).filter(Boolean)
    : [];
  return tables.length > 0 ? tables.join(", ") : "To be confirmed";
}

function customerRequestEmailPayload(fromAddress, replyTo, booking, reference) {
  const details = bookingDetailsLines(booking, reference);
  const listHtml = details
    .map(([label, value]) => `<li><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</li>`)
    .join("");

  return {
    from: fromAddress,
    to: singleRecipient(booking.email),
    reply_to: replyTo,
    subject: `Your Millers Café booking request (${reference})`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      "<h2 style=\"margin: 0 0 12px;\">Booking request received</h2>",
      "<p style=\"margin: 0 0 12px;\">Thanks for requesting a table at Millers Café. Your booking is not confirmed yet; we will email again when it has been accepted or declined.</p>",
      `<ul style="margin: 0 0 16px; padding-left: 18px;">${listHtml}</ul>`,
      "<p style=\"margin: 0;\">If you need to update your booking, reply to this email.</p>",
      "</div>"
    ].join(""),
    text: [
      "Your booking request has been received by Millers Café.",
      "Your booking is not confirmed yet; we will email again when it has been accepted or declined.",
      "",
      ...details.map(([label, value]) => `${label}: ${value}`),
      "",
      "If you need to update your booking, reply to this email."
    ].join("\n")
  };
}

function ownerRequestEmailPayload(fromAddress, replyTo, ownerEmail, booking, reference) {
  const details = bookingDetailsLines(booking, reference);
  const listHtml = details
    .map(([label, value]) => `<li><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</li>`)
    .join("");

  return {
    from: fromAddress,
    to: singleRecipient(ownerEmail),
    reply_to: replyTo,
    subject: `New booking request received (${reference})`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      "<h2 style=\"margin: 0 0 12px;\">New website booking request</h2>",
      `<ul style="margin: 0; padding-left: 18px;">${listHtml}</ul>`,
      "</div>"
    ].join(""),
    text: [
      "New website booking request received.",
      "",
      ...details.map(([label, value]) => `${label}: ${value}`)
    ].join("\n")
  };
}

function normalizedDecisionStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "accepted" || normalized === "approved" || normalized === "confirmed") return "accepted";
  if (normalized === "rejected" || normalized === "declined" || normalized === "cancelled") return "rejected";
  return "";
}

function bookingDecisionText(status, reason = "") {
  const normalized = normalizedDecisionStatus(status);
  if (normalized === "accepted") {
    return {
      title: "Booking accepted",
      subjectStatus: "accepted",
      intro: "Your Millers Café booking has been accepted.",
      plain: "Your Millers Café booking has been accepted."
    };
  }

  const reasonText = String(reason || "").trim();
  return {
    title: "Booking declined",
    subjectStatus: "declined",
    intro: reasonText
      ? `Your Millers Café booking has been declined. Reason: ${reasonText}`
      : "Your Millers Café booking has been declined.",
    plain: reasonText
      ? `Your Millers Café booking has been declined. Reason: ${reasonText}`
      : "Your Millers Café booking has been declined."
  };
}

function customerDecisionEmailPayload(fromAddress, replyTo, booking, reference, decision) {
  const details = [
    ...bookingDetailsLines(booking, reference),
    ["Tables", tableLabel(booking)]
  ];
  const listHtml = details
    .map(([label, value]) => `<li><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</li>`)
    .join("");
  const text = bookingDecisionText(decision.status, decision.reason);

  return {
    from: fromAddress,
    to: singleRecipient(booking.email),
    reply_to: replyTo,
    subject: `Your Millers Café booking is ${text.subjectStatus} (${reference})`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      `<h2 style=\"margin: 0 0 12px;\">${htmlEscape(text.title)}</h2>`,
      `<p style=\"margin: 0 0 12px;\">${htmlEscape(text.intro)}</p>`,
      `<ul style="margin: 0 0 16px; padding-left: 18px;">${listHtml}</ul>`,
      "<p style=\"margin: 0;\">If you need help, reply to this email.</p>",
      "</div>"
    ].join(""),
    text: [
      text.plain,
      "",
      ...details.map(([label, value]) => `${label}: ${value}`),
      "",
      "If you need help, reply to this email."
    ].join("\n")
  };
}

function ownerDecisionEmailPayload(fromAddress, replyTo, ownerEmail, booking, reference, decision) {
  const details = [
    ...bookingDetailsLines(booking, reference),
    ["Tables", tableLabel(booking)]
  ];
  const listHtml = details
    .map(([label, value]) => `<li><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</li>`)
    .join("");
  const text = bookingDecisionText(decision.status, decision.reason);

  return {
    from: fromAddress,
    to: singleRecipient(ownerEmail),
    reply_to: replyTo,
    subject: `${reference} booking ${text.subjectStatus}`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      `<h2 style=\"margin: 0 0 12px;\">Website booking ${htmlEscape(text.subjectStatus)}</h2>`,
      `<ul style="margin: 0; padding-left: 18px;">${listHtml}</ul>`,
      "</div>"
    ].join(""),
    text: [
      `Website booking ${reference} ${text.subjectStatus}.`,
      "",
      ...details.map(([label, value]) => `${label}: ${value}`)
    ].join("\n")
  };
}

async function sendBookingEmailJobs(env, jobs) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();

  if (!apiKey || jobs.length === 0) {
    return { enabled: false, sentAll: false, delivered: 0, total: 0, errors: ["Email provider not configured."] };
  }

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

function bookingEmailAddresses(env) {
  const ownerEmail = String(env.BOOKINGS_NOTIFICATION_EMAIL || "help@millers.cafe").trim();
  return {
    fromAddress: String(env.BOOKINGS_EMAIL_FROM || "").trim(),
    ownerEmail,
    replyTo: String(env.BOOKINGS_REPLY_TO || ownerEmail).trim()
  };
}

export async function sendBookingRequestEmails(env, booking, reference) {
  const { fromAddress, ownerEmail, replyTo } = bookingEmailAddresses(env);
  if (!fromAddress) {
    return { enabled: false, sentAll: false, delivered: 0, total: 0, errors: ["Email provider not configured."] };
  }

  return sendBookingEmailJobs(env, [
    customerRequestEmailPayload(fromAddress, replyTo, booking, reference),
    ownerRequestEmailPayload(fromAddress, replyTo, ownerEmail, booking, reference)
  ]);
}

export async function sendBookingDecisionEmails(env, booking, reference, decision) {
  const { fromAddress, ownerEmail, replyTo } = bookingEmailAddresses(env);
  if (!fromAddress) {
    return { enabled: false, sentAll: false, delivered: 0, total: 0, errors: ["Email provider not configured."] };
  }

  return sendBookingEmailJobs(env, [
    customerDecisionEmailPayload(fromAddress, replyTo, booking, reference, decision),
    ownerDecisionEmailPayload(fromAddress, replyTo, ownerEmail, booking, reference, decision)
  ]);
}

export const sendBookingEmails = sendBookingRequestEmails;
