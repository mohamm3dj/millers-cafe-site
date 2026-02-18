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
    ["Name", order.customerName || "Not provided"],
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
    subject: `We received your Millers Café ${typeLabel(order.orderType).toLowerCase()} order (${reference})`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      `<h2 style=\"margin: 0 0 12px;\">${htmlEscape(typeLabel(order.orderType))} order received</h2>`,
      "<p style=\"margin: 0 0 12px;\">Thanks for ordering with Millers Café. Your order is now waiting for team approval.</p>",
      `<ul style=\"margin: 0 0 16px; padding-left: 18px;\">${listHtml}</ul>`,
      "<p style=\"margin: 0;\">We will send another email once your order is accepted or rejected.</p>",
      "</div>"
    ].join(""),
    text: [
      `${typeLabel(order.orderType)} order received at Millers Café.`,
      "Your order is waiting for team approval.",
      "",
      ...details.map(([label, value]) => `${label}: ${value}`),
      "",
      "We will send another email once your order is accepted or rejected."
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

function decisionLabel(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "accepted") return "accepted";
  if (normalized === "rejected" || normalized === "declined" || normalized === "cancelled") return "rejected";
  return "updated";
}

function etaText(etaMinutes, fallbackDate, fallbackTime) {
  const eta = Number(etaMinutes);
  if (Number.isFinite(eta) && eta >= 0) {
    return eta === 0 ? "ready now" : `around ${eta} minute${eta === 1 ? "" : "s"}`;
  }

  if (fallbackDate && fallbackTime) {
    return `${fallbackDate} at ${fallbackTime}`;
  }

  if (fallbackTime) {
    return fallbackTime;
  }

  return "shortly";
}

function customerDecisionPayload(fromAddress, replyTo, order, reference, update) {
  const status = decisionLabel(update.status);
  const type = typeLabel(order.orderType).toLowerCase();
  const etaLine = etaText(update.etaMinutes, update.scheduledDate, update.scheduledTime);

  if (status === "accepted") {
    return {
      from: fromAddress,
      to: order.email,
      reply_to: replyTo,
      subject: `Your Millers Café ${type} order is accepted (${reference})`,
      html: [
        "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
        `<h2 style=\"margin: 0 0 12px;\">Order accepted</h2>`,
        `<p style=\"margin: 0 0 12px;\">Great news, your ${htmlEscape(type)} order <strong>${htmlEscape(reference)}</strong> has been accepted.</p>`,
        `<p style=\"margin: 0 0 12px;\"><strong>Estimated ready time:</strong> ${htmlEscape(etaLine)}</p>`,
        "<p style=\"margin: 0;\">If you need help, reply to this email.</p>",
        "</div>"
      ].join(""),
      text: [
        `Your ${type} order ${reference} has been accepted.`,
        `Estimated ready time: ${etaLine}.`,
        "",
        "If you need help, reply to this email."
      ].join("\n")
    };
  }

  return {
    from: fromAddress,
    to: order.email,
    reply_to: replyTo,
    subject: `Your Millers Café ${type} order update (${reference})`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      `<h2 style=\"margin: 0 0 12px;\">Order update</h2>`,
      `<p style=\"margin: 0 0 12px;\">Your ${htmlEscape(type)} order <strong>${htmlEscape(reference)}</strong> has been rejected.</p>`,
      "<p style=\"margin: 0;\">If this was unexpected, reply to this email and we'll help.</p>",
      "</div>"
    ].join(""),
    text: [
      `Your ${type} order ${reference} has been rejected.`,
      "",
      "If this was unexpected, reply to this email and we'll help."
    ].join("\n")
  };
}

function ownerDecisionPayload(fromAddress, replyTo, ownerEmail, order, reference, update) {
  const status = decisionLabel(update.status);
  const etaLine = etaText(update.etaMinutes, update.scheduledDate, update.scheduledTime);
  const details = orderDetailsLines(order, reference);
  const listHtml = details
    .map(([label, value]) => `<li><strong>${htmlEscape(label)}:</strong> ${htmlEscape(value)}</li>`)
    .join("");

  const statusLine = status === "accepted"
    ? `Accepted with ETA ${etaLine}.`
    : "Rejected.";

  return {
    from: fromAddress,
    to: ownerEmail,
    reply_to: replyTo,
    subject: `${reference} ${status === "accepted" ? "accepted" : "rejected"}`,
    html: [
      "<div style=\"font-family: Arial, sans-serif; color: #0f172a; line-height: 1.5;\">",
      `<h2 style=\"margin: 0 0 12px;\">Order ${htmlEscape(status)}</h2>`,
      `<p style=\"margin: 0 0 12px;\">${htmlEscape(statusLine)}</p>`,
      `<ul style=\"margin: 0; padding-left: 18px;\">${listHtml}</ul>`,
      "</div>"
    ].join(""),
    text: [
      `Order ${reference} ${status}.`,
      statusLine,
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

export async function sendOrderDecisionEmails(env, order, reference, update) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const fromAddress = String(env.ORDERS_EMAIL_FROM || env.BOOKINGS_EMAIL_FROM || "").trim();
  const ownerEmail = String(env.ORDERS_NOTIFICATION_EMAIL || env.BOOKINGS_NOTIFICATION_EMAIL || "help@millers.cafe").trim();
  const replyTo = String(env.ORDERS_REPLY_TO || env.BOOKINGS_REPLY_TO || ownerEmail).trim();

  if (!apiKey || !fromAddress) {
    return { enabled: false, sentAll: false, delivered: 0, total: 0, errors: ["Email provider not configured."] };
  }

  const jobs = [
    customerDecisionPayload(fromAddress, replyTo, order, reference, update),
    ownerDecisionPayload(fromAddress, replyTo, ownerEmail, order, reference, update)
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
