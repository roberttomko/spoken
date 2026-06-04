"""Chunk a podcast transcript for a vector store / RAG pipeline.

Spoken's Markdown is already structured by speaker turns with timestamps, which
makes it easy to chunk while preserving who said what and when — useful metadata
to keep alongside each embedding.

Usage:
    export SPOKEN_API_KEY=pt_...   # get one at https://spoken.md
    python rag_pipeline.py 1000651996090

Docs: https://spoken.md/agents.md
"""

import os
import re
import sys

import requests

SPOKEN_API_KEY = os.environ.get("SPOKEN_API_KEY", "pt_demo")
SPOKEN_BASE = "https://spoken.md"

# Matches Spoken's speaker-turn header, e.g. "**Jane Doe** (0:15)"
TURN_RE = re.compile(r"\*\*(?P<speaker>[^*]+)\*\*\s*\((?P<ts>[\d:]+)\)\s*(?P<text>.*?)(?=\n\*\*|\Z)", re.S)


def fetch_transcript(episode_id: str) -> str:
    resp = requests.get(
        f"{SPOKEN_BASE}/transcripts/{episode_id}",
        headers={"x-api-key": SPOKEN_API_KEY},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.text


def chunk_by_speaker_turn(markdown: str, max_chars: int = 1500) -> list[dict]:
    """Group consecutive speaker turns into chunks, keeping speaker + timestamp metadata."""
    chunks: list[dict] = []
    buf, buf_meta = "", None
    for m in TURN_RE.finditer(markdown):
        speaker, ts, text = m["speaker"].strip(), m["ts"], m["text"].strip()
        piece = f"{speaker} ({ts}): {text}\n"
        if buf and len(buf) + len(piece) > max_chars:
            chunks.append({"text": buf.strip(), **buf_meta})
            buf, buf_meta = "", None
        if buf_meta is None:
            buf_meta = {"start_speaker": speaker, "start_ts": ts}
        buf += piece
    if buf:
        chunks.append({"text": buf.strip(), **buf_meta})
    return chunks


if __name__ == "__main__":
    episode_id = sys.argv[1] if len(sys.argv) > 1 else "1000651996090"
    transcript = fetch_transcript(episode_id)
    chunks = chunk_by_speaker_turn(transcript)
    print(f"{len(chunks)} chunks ready for embedding.\n")
    for i, c in enumerate(chunks[:3]):
        print(f"[chunk {i}] starts at {c['start_ts']} ({c['start_speaker']}):")
        print(c["text"][:200], "...\n")
    # Next: embed each chunk["text"] and upsert into your vector store of choice,
    # keeping start_speaker / start_ts as metadata for citations.
