#!/usr/bin/env bash
# Spoken quickstart: search for an episode, then fetch its transcript as Markdown.
# Docs: https://spoken.md/agents.md
set -euo pipefail

API_KEY="${SPOKEN_API_KEY:-pt_demo}"   # get a key at https://spoken.md (pt_demo works for the demo episode)

# 1. Find an episode — search by text, or paste a Spotify/YouTube URL as the query.
echo "Searching..."
curl -s "https://spoken.md/search?q=huberman+sleep" \
  -H "x-api-key: ${API_KEY}"

# 2. Fetch a transcript by id (the demo episode id is used here).
echo -e "\n\nFetching transcript..."
curl -s "https://spoken.md/transcripts/1000651996090" \
  -H "x-api-key: ${API_KEY}"
