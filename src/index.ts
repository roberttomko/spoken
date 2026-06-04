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

const API_KEY: string = process.env.SPOKEN_API_KEY ?? "pt_demo";
const BASE_URL: string = (process.env.SPOKEN_BASE_URL ?? "https://spoken.md").replace(/\/$/, "");

interface SearchResult {
  id: string;
  title: string;
  podcast: string;
  date: string;
}

interface SearchResponse {
  results: SearchResult[];
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
    402: "No credits remaining. Top up at https://spoken.md.",
    404: "Episode not found or has no transcript.",
    502: "Upstream error — safe to retry in a moment.",
  };
  return `${res.status} ${res.statusText}. ${hints[res.status] ?? ""} ${detail}`.trim();
}

const server = new McpServer({ name: "spoken", version: "0.1.0" });

server.registerTool(
  "search_podcasts",
  {
    title: "Search podcasts",
    description:
      "Search published podcast episodes by text query, or paste an episode URL (Spotify, YouTube, etc.). Returns matching episodes with their id, title, podcast, and date. Use the id with get_transcript. Does not consume credits.",
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
      (r) => `- ${r.title} — ${r.podcast} (${r.date}) · id: ${r.id}`,
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("spoken-mcp failed to start:", err);
  process.exit(1);
});
