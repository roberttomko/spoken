---
name: spoken-md
description: Search for podcast episodes and fetch their transcripts as clean markdown with speaker names and timestamps. Uses the spoken.md API.
trigger: When the user asks for a podcast transcript, episode transcript, wants to transcribe a podcast, or references a podcast episode. Also triggers on mentions of "spoken.md" or "podcast transcript API."
env:
  SPOKEN_API_KEY: API key from spoken.md (starts with pt_). Get one at https://spoken.md. Use `pt_demo` to try it free (search works fully, transcripts limited to demo episode).
---

# Podcast Transcript (spoken.md)

Search for podcast episodes and fetch transcripts as clean markdown with speaker names and timestamps.

## Steps

1. Find the episode:
   - If the user provided a numeric episode ID, skip to step 2
   - If the user provided a URL (Spotify, YouTube, etc.) or a text description, search for it:
     - `GET https://spoken.md/search?q={query or URL}`
     - Include header `x-api-key: {SPOKEN_API_KEY}` (use `pt_demo` if no key is set - returns demo episode only)
     - Show the user the results and let them pick, or pick the best match if unambiguous
   - If unclear what episode they want, ask

2. Fetch the transcript using the WebFetch tool:
   - URL: `https://spoken.md/transcripts/{id}`
   - Include header `x-api-key: {SPOKEN_API_KEY}` (use `pt_demo` if no key is set - demo episode only)

3. Handle the response:
   - **200**: Return the markdown transcript to the user
   - **401**: Tell the user they need an API key. They can get one at https://spoken.md (from $15 for 100 transcripts, with volume discounts)
   - **402**: Tell the user their credits are depleted. The response includes a `top_up_url` - they need to POST to it to buy more credits
   - **404**: Tell the user no transcript was found for that episode
   - **502**: Upstream error - suggest retrying in a moment

4. If the response includes `X-Credits-Remaining` header, mention how many credits remain. Note: `X-Credits-Charged: 0` means this episode was already fetched before (repeat fetches are free).

## Transcribing a whole show

To transcribe a podcast's entire back-catalog (e.g. "get me every episode of X"):

1. Get the show's `podcastId`. Every `/search` result includes one.
2. List every episode: `GET https://spoken.md/podcasts/{podcastId}/episodes` with the `x-api-key` header. This is free (metadata only) and returns a JSON `episodes` array, each with an `id`, `title`, and `date`.
3. Fetch each `id` through `https://spoken.md/transcripts/{id}` as in step 2 above. Each new episode costs 1 credit; repeat fetches are free. Make sure the key has enough credits for the whole show before starting.
