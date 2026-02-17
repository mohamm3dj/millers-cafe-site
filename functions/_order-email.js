"use strict";

const RESEND_API_URL = "https://api.resend.com/emails";

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function typeLabel(orderType) {
  return String(orderType || "").toLowerCase() === "delivery" ? "Delivery" : "Collection";
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

function fullAddress(order) {
  return [order.addressLine1, order.addressLine2, order.townCity, order.postcode]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

function orderDetailsLines(order, reference) {
  const lines = [
    ["Reference", reference],
    ["Order type", typeLabel(order.orderType)],
    ["Name", order.customerName],
    ["Date", formatDateForEmail(order.date)],
    ["Time", order.time],
    ["Phone", order.phoneNumber],
    ["Email", order.email],
    ["Occasion", order.specialOccasion && order.specialOccasion !== "None" ? order.specialOccasion : "None"],
    ["Order", order.itemsSummary],
    ["Notes", order.notes || "None"]
  ];

  if (String(order.orderType || "").toLowerCase() === "delivery") {
    lines.splice(9, 0, ["Delivery address", fullAddress(order) || "None"]);
  }

  return lines;
}

function customerEmailPayload(fromAddress, replyTo, order, reference) {
  const details = orderDetailsLines(order, reference);
  const listHtml = details
    .map(([label, value]) => `<li><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</li>`)
    .join("");

  return {
    from: fromAddress,
    to: order.email,
    reply_to: replyTo,
    subject: `Your Millers Café ${typeLabel(order.orderType).toLowerCase()} order is confirmed (${reference})`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      `<h2 style=\"margin: 0 0 12px;\">${htmlEscape(typeLabel(order.orderType))} order confirmed</h2>`,
      "<p style=\"margin: 0 0 12px;\">Thanks for ordering with Millers Café. Here are your order details:</p>",
      `<ul style=\"margin: 0 0 16px; padding-left: 18px;\">${listHtml}</ul>`,
      "<p style=\"margin: 0;\">If you need to update your order, reply to this email.</p>",
      "</div>"
    ].join(""),
    text: [
      `${typeLabel(order.orderType)} order confirmed at Millers Café.`,
      "",
      ...details.map(([label, value]) => `${label}: ${value}`),
      "",
      "If you need to update your order, reply to this email."
    ].join("\n")
  };
}

function ownerEmailPayload(fromAddress, replyTo, ownerEmail, order, reference) {
  const details = orderDetailsLines(order, reference);
  const listHtml = details
    .map(([label, value]) => `<li><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</li>`)
    .join("");

  return {
    from: fromAddress,
    to: ownerEmail,
    reply_to: replyTo,
    subject: `New ${typeLabel(order.orderType).toLowerCase()} order (${reference})`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      `<h2 style=\"margin: 0 0 12px;\">New ${htmlEscape(typeLabel(order.orderType).toLowerCase())} order</h2>`,
      `<ul style=\"margin: 0; padding-left: 18px;\">${listHtml}</ul>`,
      "</div>"
    ].join(""),
    text: [
      `New ${typeLabel(order.orderType).toLowerCase()} order received.`,
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

export async function sendOrderEmails(env, order, reference) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const fromAddress = String(env.ORDERS_EMAIL_FROM || env.BOOKINGS_EMAIL_FROM || "").trim();
  const ownerEmail = String(env.ORDERS_NOTIFICATION_EMAIL || env.BOOKINGS_NOTIFICATION_EMAIL || "help@millers.cafe").trim();
  const replyTo = String(env.ORDERS_REPLY_TO || env.BOOKINGS_REPLY_TO || ownerEmail).trim();

  if (!apiKey || !fromAddress) {
    return { enabled: false, sentAll: false, delivered: 0, total: 0, errors: ["Email provider not configured."] };
  }

  const jobs = [
    customerEmailPayload(fromAddress, replyTo, order, reference),
    ownerEmailPayload(fromAddress, replyTo, ownerEmail, order, reference)
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
