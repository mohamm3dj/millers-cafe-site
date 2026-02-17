#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://millers.cafe}"
DATE_SAMPLE="${2:-2026-02-18}"

echo "Checking ${BASE_URL}"
echo

echo "1) Bookings page"
curl -s -o /dev/null -w "status=%{http_code}\n" "${BASE_URL}/bookings/"
echo

echo "2) Slots endpoint"
curl -s -o /dev/null -w "status=%{http_code}\n" "${BASE_URL}/api/bookings/slots?date=${DATE_SAMPLE}&partySize=2&durationMinutes=90"
echo

echo "3) CSV feed endpoint"
curl -s -o /dev/null -w "status=%{http_code} content-type=%{content_type}\n" "${BASE_URL}/bookings/feed.csv"
echo

echo "4) CSV feed header preview"
curl -s "${BASE_URL}/bookings/feed.csv" | sed -n '1,2p'
echo

echo "If you enabled BOOKINGS_FEED_TOKEN, run:"
echo "  ${BASE_URL}/bookings/feed.csv?token=YOUR_TOKEN"
