"use strict";

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { createBooking } from "../functions/_lib/bookings-service.js";
import { createOrderRecord, saveOrders } from "../functions/_orders-core.js";
import { onRequestGet as getAccountBookings } from "../functions/api/account/bookings.js";
import { onRequestPost as cancelAccountBookingRoute } from "../functions/api/account/bookings/cancel.js";
import { onRequestPost as rescheduleAccountBookingRoute } from "../functions/api/account/bookings/reschedule.js";
import { onRequestPost as logoutAccount } from "../functions/api/account/logout.js";
import { onRequestGet as getAccountMe } from "../functions/api/account/me.js";
import { onRequestGet as getAccountOrders } from "../functions/api/account/orders.js";
import { onRequestGet as getAccountProfile } from "../functions/api/account/profile.js";
import { onRequestPut as saveAccountProfileRoute } from "../functions/api/account/profile.js";
import { onRequestPost as requestAccountCode } from "../functions/api/account/request-code.js";
import { onRequestPost as verifyAccountCode } from "../functions/api/account/verify-code.js";
import {
  addDaysISO,
  makeBookingPayload,
  makeOrderPayload,
  nextOpenDate,
  resetInMemoryStores
} from "./helpers/factories.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetInMemoryStores();
  globalThis.fetch = originalFetch;
});

async function createAccountSession(email) {
  let sentCode = "";

  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    const payload = JSON.parse(String(options.body || "{}"));
    const subjectMatch = /(\d{6})/.exec(String(payload.subject || ""));
    assert.ok(subjectMatch);
    sentCode = subjectMatch[1];

    return new Response(JSON.stringify({ id: "email_test_123" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });
  };

  const requestResponse = await requestAccountCode({
    env: {
      RESEND_API_KEY: "re_test_123",
      BOOKINGS_EMAIL_FROM: "Millers Cafe <help@millers.cafe>"
    },
    request: new Request("https://example.com/api/account/request-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email })
    })
  });

  assert.equal(requestResponse.status, 200);
  const requestBody = await requestResponse.json();
  assert.equal(requestBody.ok, true);
  assert.match(sentCode, /^\d{6}$/);

  const verifyResponse = await verifyAccountCode({
    env: {},
    request: new Request("https://example.com/api/account/verify-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        code: sentCode
      })
    })
  });

  assert.equal(verifyResponse.status, 200);
  const verifyBody = await verifyResponse.json();
  assert.equal(verifyBody.authenticated, true);

  const cookie = String(verifyResponse.headers.get("set-cookie") || "");
  assert.match(cookie, /millers_account_session=/);
  return cookie;
}

test("customer account routes expose booking and order history for the signed-in email", async () => {
  const accountEmail = "alice@example.com";

  await createBooking({}, makeBookingPayload({
    customerName: "Alice Carter",
    phoneNumber: "07123 456789",
    email: accountEmail
  }));
  await createBooking({}, makeBookingPayload({
    customerName: "Bob Stone",
    phoneNumber: "07234 567890",
    email: "bob@example.com"
  }));

  const aliceOrder = createOrderRecord([], makeOrderPayload({
    customerName: "Alice Carter",
    phoneNumber: "07123 456789",
    email: accountEmail,
    itemsSummary: "2 x Miller burgers"
  }));
  const bobOrder = createOrderRecord([], makeOrderPayload({
    customerName: "Bob Stone",
    phoneNumber: "07234 567890",
    email: "bob@example.com",
    itemsSummary: "1 x Veg wrap",
    time: "13:30"
  }));

  assert.equal(aliceOrder.ok, true);
  assert.equal(bobOrder.ok, true);
  await saveOrders({}, [aliceOrder.record, bobOrder.record]);

  const cookie = await createAccountSession(accountEmail);

  const meResponse = await getAccountMe({
    env: {},
    request: new Request("https://example.com/api/account/me", {
      headers: {
        cookie
      }
    })
  });

  assert.equal(meResponse.status, 200);
  const meBody = await meResponse.json();
  assert.equal(meBody.authenticated, true);
  assert.equal(meBody.account.email, accountEmail);
  assert.equal(meBody.account.fullName, "Alice Carter");
  assert.equal(meBody.account.phoneNumber, "07123 456789");
  assert.equal(meBody.account.bookingCount, 1);
  assert.equal(meBody.account.orderCount, 1);
  assert.equal(meBody.account.upcomingBooking.reference.startsWith("MC-"), true);
  assert.equal(meBody.account.latestOrder.reference.startsWith("MCO-"), true);

  const bookingsResponse = await getAccountBookings({
    env: {},
    request: new Request("https://example.com/api/account/bookings", {
      headers: {
        cookie
      }
    })
  });

  assert.equal(bookingsResponse.status, 200);
  const bookingsBody = await bookingsResponse.json();
  assert.equal(bookingsBody.bookings.length, 1);
  assert.equal(bookingsBody.bookings[0].email, accountEmail);
  assert.equal(bookingsBody.bookings[0].customerName, "Alice Carter");

  const ordersResponse = await getAccountOrders({
    env: {},
    request: new Request("https://example.com/api/account/orders", {
      headers: {
        cookie
      }
    })
  });

  assert.equal(ordersResponse.status, 200);
  const ordersBody = await ordersResponse.json();
  assert.equal(ordersBody.orders.length, 1);
  assert.equal(ordersBody.orders[0].email, accountEmail);
  assert.equal(ordersBody.orders[0].itemsSummary, "2 x Miller burgers");
});

test("logging out removes the account session and protected routes reject the old cookie", async () => {
  const accountEmail = "alice@example.com";
  await createBooking({}, makeBookingPayload({ email: accountEmail }));

  const cookie = await createAccountSession(accountEmail);

  const logoutResponse = await logoutAccount({
    env: {},
    request: new Request("https://example.com/api/account/logout", {
      method: "POST",
      headers: {
        cookie
      }
    })
  });

  assert.equal(logoutResponse.status, 200);
  assert.match(String(logoutResponse.headers.get("set-cookie") || ""), /Max-Age=0/);

  const meResponse = await getAccountMe({
    env: {},
    request: new Request("https://example.com/api/account/me", {
      headers: {
        cookie
      }
    })
  });

  assert.equal(meResponse.status, 200);
  const meBody = await meResponse.json();
  assert.equal(meBody.authenticated, false);

  const ordersResponse = await getAccountOrders({
    env: {},
    request: new Request("https://example.com/api/account/orders", {
      headers: {
        cookie
      }
    })
  });

  assert.equal(ordersResponse.status, 401);
  const ordersBody = await ordersResponse.json();
  assert.match(String(ordersBody.error || ""), /authentication required/i);
});

test("signed-in customers can save a profile and it is reflected in the account summary", async () => {
  const accountEmail = "profile@example.com";
  const cookie = await createAccountSession(accountEmail);

  const saveResponse = await saveAccountProfileRoute({
    env: {},
    request: new Request("https://example.com/api/account/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        cookie
      },
      body: JSON.stringify({
        profile: {
          fullName: "Mo Khan",
          phoneNumber: "07123 456789",
          preferredOrderType: "delivery",
          defaultDeliveryAddress: {
            label: "Home",
            addressLine1: "55 Brigsley Road",
            townCity: "Grimsby",
            postcode: "dn37 0jz"
          }
        }
      })
    })
  });

  assert.equal(saveResponse.status, 200);
  const saveBody = await saveResponse.json();
  assert.equal(saveBody.profile.fullName, "Mo Khan");
  assert.equal(saveBody.profile.preferredOrderType, "delivery");
  assert.equal(saveBody.profile.defaultDeliveryAddress.postcode, "DN37 0JZ");

  const profileResponse = await getAccountProfile({
    env: {},
    request: new Request("https://example.com/api/account/profile", {
      headers: {
        cookie
      }
    })
  });

  assert.equal(profileResponse.status, 200);
  const profileBody = await profileResponse.json();
  assert.equal(profileBody.profile.fullName, "Mo Khan");

  const meResponse = await getAccountMe({
    env: {},
    request: new Request("https://example.com/api/account/me", {
      headers: {
        cookie
      }
    })
  });

  assert.equal(meResponse.status, 200);
  const meBody = await meResponse.json();
  assert.equal(meBody.account.profile.preferredOrderType, "delivery");
  assert.equal(meBody.account.profile.defaultDeliveryAddress.addressLine1, "55 Brigsley Road");
});

test("signed-in customers can cancel and reschedule their own bookings", async () => {
  const accountEmail = "bookings@example.com";
  const originalDate = nextOpenDate(3);
  const upcomingBooking = await createBooking({}, makeBookingPayload({
    customerName: "Booking Owner",
    phoneNumber: "07123 456789",
    email: accountEmail,
    date: originalDate,
    time: "12:00"
  }));

  const secondBooking = await createBooking({}, makeBookingPayload({
    customerName: "Booking Owner",
    phoneNumber: "07123 456789",
    email: accountEmail,
    date: addDaysISO(originalDate, 1),
    time: "12:15"
  }));

  const cookie = await createAccountSession(accountEmail);

  const cancelResponse = await cancelAccountBookingRoute({
    env: {},
    request: new Request("https://example.com/api/account/bookings/cancel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie
      },
      body: JSON.stringify({
        bookingId: upcomingBooking.bookingId
      })
    })
  });

  assert.equal(cancelResponse.status, 200);
  const cancelBody = await cancelResponse.json();
  assert.equal(cancelBody.booking.status, "cancelled");

  const rescheduleResponse = await rescheduleAccountBookingRoute({
    env: {},
    request: new Request("https://example.com/api/account/bookings/reschedule", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie
      },
      body: JSON.stringify({
        bookingId: secondBooking.bookingId,
        booking: {
          date: addDaysISO(originalDate, 2),
          time: "13:30",
          partySize: 4,
          notes: "Window table please"
        }
      })
    })
  });

  assert.equal(rescheduleResponse.status, 200);
  const rescheduleBody = await rescheduleResponse.json();
  assert.equal(rescheduleBody.booking.date, addDaysISO(originalDate, 2));
  assert.equal(rescheduleBody.booking.time, "13:30");
  assert.equal(rescheduleBody.booking.partySize, 4);
  assert.equal(rescheduleBody.booking.notes, "Window table please");

  const bookingsResponse = await getAccountBookings({
    env: {},
    request: new Request("https://example.com/api/account/bookings", {
      headers: {
        cookie
      }
    })
  });

  assert.equal(bookingsResponse.status, 200);
  const bookingsBody = await bookingsResponse.json();
  assert.equal(bookingsBody.bookings.length, 2);
  assert.equal(bookingsBody.bookings.some((booking) => booking.status === "cancelled"), true);
  assert.equal(bookingsBody.bookings.some((booking) => booking.time === "13:30" && booking.partySize === 4), true);
});
