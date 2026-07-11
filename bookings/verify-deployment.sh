#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://millers.cafe}"
DATE_SAMPLE="${2:-$(date +%F)}"
FEED_TOKEN="${BOOKINGS_FEED_TOKEN:-}"

echo "Checking ${BASE_URL}"
echo

echo "1) Bookings page"
curl -s -o /dev/null -w "status=%{http_code}\n" "${BASE_URL}/bookings/"
echo

echo "2) Slots endpoint"
curl -s -o /dev/null -w "status=%{http_code}\n" "${BASE_URL}/api/bookings/slots?date=${DATE_SAMPLE}&partySize=2&durationMinutes=90"
echo

echo "3) CSV feed endpoint"
if [[ -n "${FEED_TOKEN}" ]]; then
  curl -sS -o /dev/null -w "status=%{http_code} content-type=%{content_type}\n" \
    -H "Authorization: Bearer ${FEED_TOKEN}" \
    "${BASE_URL}/bookings/feed.csv"
else
  curl -sS -o /dev/null -w "status=%{http_code} (expected 401 without BOOKINGS_FEED_TOKEN)\n" \
    "${BASE_URL}/bookings/feed.csv"
fi
echo

echo "4) CSV feed header preview"
if [[ -n "${FEED_TOKEN}" ]]; then
  curl -sS -H "Authorization: Bearer ${FEED_TOKEN}" "${BASE_URL}/bookings/feed.csv" | sed -n '1,2p'
else
  echo "Skipped. Export BOOKINGS_FEED_TOKEN to inspect the protected feed."
fi
echo
