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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
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
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Tavily search failed: ${response.status} ${details}`);
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
  } finally {
    clearTimeout(timeout);
  }
}
