import type { ToolDefinition } from "../types.js";

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webFetchTool: ToolDefinition = {
  name: "WebFetch",
  description: "Fetch a URL and return its content as readable text (HTML is stripped of tags).",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
      maxChars: { type: "number", description: "Truncate content to this many characters, default 8000" },
    },
    required: ["url"],
  },
  needsApproval: () => true,
  async execute(input) {
    let res: Response;
    try {
      res = await fetch(input.url, {
        headers: { "User-Agent": "bedrock-agent/0.1 (+cli coding agent)" },
        redirect: "follow",
      });
    } catch (err) {
      return { content: `Error fetching URL: ${(err as Error).message}`, isError: true };
    }
    if (!res.ok) {
      return { content: `Error: HTTP ${res.status} ${res.statusText}`, isError: true };
    }
    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const text = contentType.includes("html") ? htmlToText(raw) : raw;
    const max = input.maxChars ?? 8000;
    return { content: text.length > max ? text.slice(0, max) + "\n...(truncated)" : text };
  },
};

export const webSearchTool: ToolDefinition = {
  name: "WebSearch",
  description:
    "Search the web and return a list of results (title, url, snippet). Requires BRAVE_API_KEY (api.search.brave.com) or SERPAPI_KEY env var to be set.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      count: { type: "number", description: "Number of results, default 5" },
    },
    required: ["query"],
  },
  needsApproval: () => true,
  async execute(input) {
    const count = input.count ?? 5;

    if (process.env.BRAVE_API_KEY) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(input.query)}&count=${count}`;
      const res = await fetch(url, {
        headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY, Accept: "application/json" },
      });
      if (!res.ok) return { content: `Brave Search error: HTTP ${res.status}`, isError: true };
      const data: any = await res.json();
      const results = (data.web?.results ?? []).slice(0, count);
      if (!results.length) return { content: "(no results)" };
      return {
        content: results
          .map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description ?? ""}`)
          .join("\n\n"),
      };
    }

    if (process.env.SERPAPI_KEY) {
      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(input.query)}&api_key=${process.env.SERPAPI_KEY}&num=${count}`;
      const res = await fetch(url);
      if (!res.ok) return { content: `SerpAPI error: HTTP ${res.status}`, isError: true };
      const data: any = await res.json();
      const results = (data.organic_results ?? []).slice(0, count);
      if (!results.length) return { content: "(no results)" };
      return {
        content: results
          .map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet ?? ""}`)
          .join("\n\n"),
      };
    }

    return {
      content:
        "Error: no web search provider configured. Set BRAVE_API_KEY or SERPAPI_KEY in the environment to enable WebSearch.",
      isError: true,
    };
  },
};
