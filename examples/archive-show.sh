#!/usr/bin/env bash
# Archive a podcast's whole back catalogue as Markdown — one file per episode.
# Docs: https://spoken.md/agents.md
#
# Usage:
#   SPOKEN_API_KEY=pt_yourkey ./archive-show.sh <podcast-id> [out-dir]
#
# Example (Huberman Lab):
#   SPOKEN_API_KEY=pt_yourkey ./archive-show.sh 1545953110 ./huberman
#
# Find a show's id on its page at https://spoken.md/podcast/<slug>, or in any
# /search result — every result carries a podcastId.
#
# Safe to re-run: episodes already on disk are skipped, and the API charges
# nothing to re-fetch an episode this key has fetched before. If you run out of
# credits partway, top up and run it again — it picks up where it stopped.

set -euo pipefail

BASE="https://spoken.md"
API_KEY="${SPOKEN_API_KEY:-}"
PODCAST_ID="${1:-}"
OUT_DIR="${2:-.}"

die() { echo "Error: $*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || die "jq is required — https://jqlang.github.io/jq/"
command -v curl >/dev/null 2>&1 || die "curl is required."

[[ -n "$PODCAST_ID" ]] || die "Usage: SPOKEN_API_KEY=pt_yourkey $0 <podcast-id> [out-dir]"
[[ -n "$API_KEY" ]] || die "Set SPOKEN_API_KEY. Get a key at $BASE"
[[ "$API_KEY" != "pt_demo" ]] || \
  die "pt_demo only fetches the demo episode. Archiving a show needs a real key: $BASE"

HEADERS=(-H "x-api-key: $API_KEY")

mkdir -p "$OUT_DIR"

# --- Episode list — metadata only, never charged --------------------------------
LIST=$(curl -sf "${HEADERS[@]}" "$BASE/podcasts/$PODCAST_ID/episodes") || die \
  "Could not list episodes for podcast $PODCAST_ID. Check the id and your key."

PODCAST_NAME=$(jq -r '.podcast // "Unknown show"' <<< "$LIST")
IDS=$(jq -r '.episodes[].id' <<< "$LIST")
EPISODES=$(jq -r '.episodes | length' <<< "$LIST")

[[ "$EPISODES" -gt 0 ]] || die "No fetchable episodes found for podcast $PODCAST_ID."

TO_FETCH=0
while IFS= read -r ID; do
  [[ -f "$OUT_DIR/$ID.md" ]] || TO_FETCH=$((TO_FETCH + 1))
done <<< "$IDS"
ON_DISK=$((EPISODES - TO_FETCH))

# --- Pre-flight: know the cost before spending anything -------------------------
BALANCE=$(curl -sf "${HEADERS[@]}" "$BASE/balance") || die \
  "Could not check your balance. Is SPOKEN_API_KEY correct?"

CREDITS=$(jq -r '.credits' <<< "$BALANCE")
TOPUP_URL=$(jq -r '.top_up.top_up_url // empty' <<< "$BALANCE")

echo "$PODCAST_NAME — $EPISODES episodes"
echo "  already on disk: $ON_DISK (skipped, free)"
echo "  to fetch:        $TO_FETCH"
echo "  credits:         $CREDITS"
echo "  saving to:       $OUT_DIR/"
echo

if (( TO_FETCH > CREDITS )); then
  echo "That is up to $((TO_FETCH - CREDITS)) more than this key can pay for."
  echo "Episodes this key already fetched are free, so the real shortfall may be smaller."
  if [[ -n "$TOPUP_URL" ]]; then
    echo "Top up: $TOPUP_URL"
  fi
  echo
  if [[ -t 0 ]]; then
    read -r -p "Fetch as many as the credits cover? [y/N] " ANSWER
    [[ "$ANSWER" =~ ^[Yy]$ ]] || exit 0
    echo
  else
    echo "Continuing — the run stops cleanly when the credits run out."
    echo
  fi
fi

# --- Fetch ----------------------------------------------------------------------
DONE=0
SKIPPED=0
ERRORS=0

while IFS= read -r ID; do
  OUT_FILE="$OUT_DIR/$ID.md"

  if [[ -f "$OUT_FILE" ]]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  RESPONSE_HEADERS=$(mktemp)
  # -f keeps the error body out of OUT_FILE; --write-out still reports the status.
  HTTP=$(curl -sf --write-out "%{http_code}" -o "$OUT_FILE" -D "$RESPONSE_HEADERS" \
    "${HEADERS[@]}" "$BASE/transcripts/$ID" || true)

  if [[ "$HTTP" == "200" ]]; then
    LEFT=$(grep -i "^x-credits-remaining:" "$RESPONSE_HEADERS" | tr -d '[:space:]' | cut -d: -f2 || true)
    rm -f "$RESPONSE_HEADERS"
    DONE=$((DONE + 1))
    echo "  [$DONE/$TO_FETCH] $ID  (credits remaining: ${LEFT:-?})"
  elif [[ "$HTTP" == "402" ]]; then
    rm -f "$OUT_FILE" "$RESPONSE_HEADERS"
    echo
    if (( DONE > 0 )); then
      echo "Out of credits after $DONE fetches."
    else
      echo "No credits remaining."
    fi
    if [[ -n "$TOPUP_URL" ]]; then
      echo "Top up: $TOPUP_URL"
    fi
    echo "Re-run this script afterwards — everything already saved is skipped."
    exit 2
  else
    rm -f "$OUT_FILE" "$RESPONSE_HEADERS"
    ERRORS=$((ERRORS + 1))
    echo "  skip $ID (HTTP ${HTTP:-no response})"
  fi

  # Be a polite client — ~3 req/s is plenty for a background job.
  sleep 0.34
done <<< "$IDS"

echo
echo "Done. $DONE fetched, $SKIPPED already on disk, $ERRORS skipped."
