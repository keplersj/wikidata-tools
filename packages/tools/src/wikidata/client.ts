import { USER_AGENT } from "../version.js";

export type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type SparqlBinding = Record<string, { type: string; value: string } | undefined>;

export type WikidataClient = {
  /** Runs a SPARQL query and returns its bindings. */
  sparql(query: string): Promise<SparqlBinding[]>;
  /** Raw `wbgetentities` (claims only) for up to 50 ids per request, batched. */
  getEntities(ids: string[], onBatch?: (done: number, total: number) => void): Promise<Record<string, unknown>[]>;
};

export const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
export const API_ENDPOINT = "https://www.wikidata.org/w/api.php";
export const ENTITY_BATCH = 50;

/** Only Wikimedia hosts get Api-User-Agent: other hosts (npm) reject the CORS preflight it triggers. */
const wikimediaHeaders = { "Api-User-Agent": USER_AGENT };

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `fetchFn`, retried with exponential backoff on 429/5xx and on network errors, so one
 * hiccup in a long run (a full batch makes thousands of requests) does not abort it.
 * Returns the last response if retries run out; rethrows the last network error.
 */
export async function fetchWithRetry(
  fetchFn: FetchLike,
  url: string,
  init?: { headers?: Record<string, string> },
  opts: { retries?: number; baseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): ReturnType<FetchLike> {
  const { retries = 4, baseMs = 1000, sleep = defaultSleep } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchFn(url, init);
      if (!RETRYABLE.has(res.status) || attempt >= retries) return res;
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    await sleep(baseMs * 2 ** attempt);
  }
}

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function createWikidataClient(fetchFn: FetchLike, retry: Parameters<typeof fetchWithRetry>[3] = {}): WikidataClient {
  return {
    async sparql(query) {
      const url = `${SPARQL_ENDPOINT}?${new URLSearchParams({ query, format: "json" }).toString()}`;
      const res = await fetchWithRetry(
        fetchFn,
        url,
        { headers: { Accept: "application/sparql-results+json", ...wikimediaHeaders } },
        retry,
      );
      if (!res.ok) throw new Error(`SPARQL request failed: HTTP ${res.status}`);
      const body = (await res.json()) as { results: { bindings: SparqlBinding[] } };
      return body.results.bindings;
    },

    async getEntities(ids, onBatch) {
      const out: Record<string, unknown>[] = [];
      const unique = [...new Set(ids)].sort();
      let done = 0;
      for (const batch of chunk(unique, ENTITY_BATCH)) {
        const params = new URLSearchParams({
          action: "wbgetentities",
          format: "json",
          props: "claims",
          ids: batch.join("|"),
          origin: "*",
        });
        const res = await fetchWithRetry(fetchFn, `${API_ENDPOINT}?${params.toString()}`, { headers: wikimediaHeaders }, retry);
        if (!res.ok) throw new Error(`wbgetentities failed: HTTP ${res.status}`);
        const body = (await res.json()) as { entities?: Record<string, Record<string, unknown>> };
        for (const id of batch) {
          const entity = body.entities?.[id];
          if (entity) out.push(entity);
        }
        done += batch.length;
        onBatch?.(done, unique.length);
      }
      return out;
    },
  };
}
