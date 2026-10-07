import { runAiOperation } from "./aiReliability.service";

export interface WebSearchSource {
  title: string;
  url: string;
  content: string;
}

interface TavilyResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

const SEARCH_REQUEST_PATTERN =
  /\b(latest|today|current|recent|news|update|updates|search|web|online|website|source|sources|202[4-9]|20[3-9]\d)\b|ताज़ा|ताजा|आज|वर्तमान|समाचार|अपडेट|वेब|ऑनलाइन|स्रोत/iu;

export function needsWebSearch(text: string): boolean {
  return SEARCH_REQUEST_PATTERN.test(text.trim());
}

export function getSourceLabel(sources: WebSearchSource[]): string {
  const firstSource = sources[0];
  if (!firstSource) return "MP Public Assistant";
  try {
    const hostname = new URL(firstSource.url).hostname.replace(/^www\./i, "");
    return hostname ? `Tavily · ${hostname}` : "Tavily web search";
  } catch {
    return "Tavily web search";
  }
}

export async function searchWeb(query: string): Promise<WebSearchSource[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn("Web search requested but TAVILY_API_KEY is not configured.");
    return [];
  }

  const privateComplaintQuery =
    /\b(?:my|track|tracking|status of)\b.{0,50}\b(?:complaint|ticket|case)\b|मेरी शिकायत|माझी तक्रार/iu.test(query);
  if (
    privateComplaintQuery ||
    /\bJHS-\d{4}-\d{3,}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/iu.test(query)
  ) {
    return [];
  }

  return runAiOperation("web-search", async () => {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        topic: "general",
        search_depth: "advanced",
        max_results: 3,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const error = new Error("Web search provider request failed.");
      Object.assign(error, { status: response.status });
      throw error;
    }

    const payload = (await response.json()) as TavilyResponse;
    return (payload.results ?? []).flatMap((result) => {
      if (
        typeof result.title !== "string" ||
        typeof result.url !== "string" ||
        typeof result.content !== "string"
      ) {
        return [];
      }
      return [{ title: result.title, url: result.url, content: result.content }];
    });
  });
}
