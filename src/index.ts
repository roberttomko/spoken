#!/usr/bin/env node
/**
 * Spoken MCP server.
 *
 * Exposes the Spoken podcast-transcript API (https://spoken.md) to MCP-compatible
 * agents (Claude Desktop, Cursor, Cline, ...). Transcripts come back as clean
 * Markdown with real speaker names — not "Speaker 1."
 *
 * Auth: set SPOKEN_API_KEY (get one at https://spoken.md). Defaults to the free
 * `pt_demo` key, which can search fully but only fetch the demo episode.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const USING_DEMO_KEY: boolean = !process.env.SPOKEN_API_KEY;
const API_KEY: string = process.env.SPOKEN_API_KEY ?? "pt_demo";
const BASE_URL: string = (process.env.SPOKEN_BASE_URL ?? "https://spoken.md").replace(/\/$/, "");

interface SearchResult {
  id: string;
  title: string;
  podcast: string;
  podcastId: string;
  date: string;
}

interface SearchResponse {
  results: SearchResult[];
}

interface EpisodeRef {
  id: string;
  title: string;
  date: string;
}

interface EpisodesResponse {
  podcast: string;
  podcast_id: string;
  count: number;
  episodes: EpisodeRef[];
}

interface ApiError {
  error?: { code?: string; message?: string };
}

type TextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function text(body: string, isError = false): TextResult {
  return { content: [{ type: "text", text: body }], isError };
}

async function spokenFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "x-api-key": API_KEY, ...(init?.headers ?? {}) },
  });
}

/** Turn a non-200 response into a helpful, agent-readable message. */
async function describeError(res: Response): Promise<string> {
  if (res.status === 429) {
    return "429 Too Many Requests — Spoken is temporarily throttled. Back off and retry shortly.";
  }
  let detail = "";
  try {
    const json = (await res.json()) as ApiError;
    detail = json.error?.message ?? "";
  } catch {
    detail = await res.text().catch(() => "");
  }
  const hints: Record<number, string> = {
    401: "Missing or invalid API key. Set SPOKEN_API_KEY (get one at https://spoken.md).",
    // A 402 means two different things, and the demo case is by far the more common
    // one: no SPOKEN_API_KEY was set, so we fell back to pt_demo, which searches
    // fully but only fetches the demo episode. Telling that user to "top up" sends
    // them to buy credits for a key they do not have.
    402: USING_DEMO_KEY
      ? "No SPOKEN_API_KEY is set, so this server is using the free pt_demo key - " +
        "it can search everything but only fetch the demo episode. Get a key at " +
        "https://spoken.md and set SPOKEN_API_KEY to fetch this episode."
      : "No credits remaining. Top up at https://spoken.md.",
    404: "Episode not found or has no transcript.",
    502: "Upstream error — safe to retry in a moment.",
  };
  return `${res.status} ${res.statusText}. ${hints[res.status] ?? ""} ${detail}`.trim();
}

const server = new McpServer({ name: "spoken", version: "0.2.2" });

server.registerTool(
  "search_podcasts",
  {
    title: "Search podcasts",
    description:
      "Search published podcast episodes by text query, or paste an episode URL (Spotify, YouTube, etc.). Returns matching episodes with their id, title, podcast, podcast_id, and date. Use the id with get_transcript, or the podcast_id with list_episodes to get the show's whole back-catalog. Does not consume credits.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe("Free text (e.g. 'huberman sleep') or a pasted episode URL."),
    },
  },
  async ({ query }): Promise<TextResult> => {
    const res = await spokenFetch(`/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return text(await describeError(res), true);
    const { results } = (await res.json()) as SearchResponse;
    if (results.length === 0) return text(`No episodes found for "${query}".`);
    const lines = results.map(
      (r) => `- ${r.title} — ${r.podcast} (${r.date}) · id: ${r.id} · podcast_id: ${r.podcastId}`,
    );
    return text(`Found ${results.length} episode(s):\n${lines.join("\n")}`);
  },
);

server.registerTool(
  "get_transcript",
  {
    title: "Get transcript",
    description:
      "Fetch a podcast episode's transcript as clean Markdown with real speaker names and timestamps. Pass an episode id from search_podcasts. Costs 1 credit on the first fetch of an episode; repeat fetches are free and errors are never charged.",
    inputSchema: {
      episode_id: z
        .string()
        .min(1)
        .describe("Episode id returned by search_podcasts."),
    },
  },
  async ({ episode_id }): Promise<TextResult> => {
    const res = await spokenFetch(`/transcripts/${encodeURIComponent(episode_id)}`);
    if (!res.ok) return text(await describeError(res), true);
    const transcript = await res.text();
    const remaining = res.headers.get("X-Credits-Remaining");
    const charged = res.headers.get("X-Credits-Charged");
    const footer =
      remaining !== null
        ? `\n\n---\nCredits charged: ${charged ?? "?"} · remaining: ${remaining}`
        : "";
    return text(`${transcript}${footer}`);
  },
);

server.registerTool(
  "list_episodes",
  {
    title: "List a show's episodes",
    description:
      "List a podcast's entire back-catalog (every episode, newest first). Pass a podcast_id from a search_podcasts result. Returns each episode's id, title, and date — fetch any with get_transcript. Use this to transcribe a whole show. Does not consume credits itself; transcribing the returned episodes costs 1 credit each (repeat fetches are free), so make sure the key has enough credits before looping.",
    inputSchema: {
      podcast_id: z
        .string()
        .min(1)
        .describe("Show id (the podcast_id field from a search_podcasts result)."),
    },
  },
  async ({ podcast_id }): Promise<TextResult> => {
    const res = await spokenFetch(
      `/podcasts/${encodeURIComponent(podcast_id)}/episodes`,
    );
    if (!res.ok) return text(await describeError(res), true);
    const data = (await res.json()) as EpisodesResponse;
    if (data.count === 0) {
      return text(`No episodes found for podcast id ${podcast_id}.`);
    }
    const lines = data.episodes.map(
      (e) => `- ${e.title} (${e.date}) · id: ${e.id}`,
    );
    return text(
      `${data.podcast} — ${data.count} episode(s) (transcribing all costs up to ${data.count} credits):\n${lines.join("\n")}`,
    );
  },
);

server.registerTool(
  "get_balance",
  {
    title: "Get credit balance",
    description:
      "Check the current Spoken credit balance, account email, and recent usage for the configured API key. Does not consume credits.",
    inputSchema: {},
  },
  async (): Promise<TextResult> => {
    const res = await spokenFetch(`/balance`);
    if (!res.ok) return text(await describeError(res), true);
    const body = await res.json();
    return text(JSON.stringify(body, null, 2));
  },
);

async function main(): Promise<void> {
  // stderr only - stdout is the MCP protocol channel on a stdio transport.
  if (USING_DEMO_KEY) {
    console.error(
      "spoken-mcp: SPOKEN_API_KEY is not set, falling back to the free pt_demo key. " +
        "Search works fully, but transcript fetches will only succeed for the demo " +
        "episode. Get a key at https://spoken.md and set SPOKEN_API_KEY.",
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("spoken-mcp failed to start:", err);
  process.exit(1);
});
