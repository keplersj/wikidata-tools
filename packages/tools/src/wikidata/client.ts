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
  getEntities(ids: string[]): Promise<Record<string, unknown>[]>;
};

export const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
export const API_ENDPOINT = "https://www.wikidata.org/w/api.php";
export const ENTITY_BATCH = 50;

/** Only Wikimedia hosts get Api-User-Agent: other hosts (npm) reject the CORS preflight it triggers. */
const wikimediaHeaders = { "Api-User-Agent": USER_AGENT };

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function createWikidataClient(fetchFn: FetchLike): WikidataClient {
  return {
    async sparql(query) {
      const url = `${SPARQL_ENDPOINT}?${new URLSearchParams({ query, format: "json" }).toString()}`;
      const res = await fetchFn(url, {
        headers: { Accept: "application/sparql-results+json", ...wikimediaHeaders },
      });
      if (!res.ok) throw new Error(`SPARQL request failed: HTTP ${res.status}`);
      const body = (await res.json()) as { results: { bindings: SparqlBinding[] } };
      return body.results.bindings;
    },

    async getEntities(ids) {
      const out: Record<string, unknown>[] = [];
      for (const batch of chunk([...new Set(ids)].sort(), ENTITY_BATCH)) {
        const params = new URLSearchParams({
          action: "wbgetentities",
          format: "json",
          props: "claims",
          ids: batch.join("|"),
          origin: "*",
        });
        const res = await fetchFn(`${API_ENDPOINT}?${params.toString()}`, { headers: wikimediaHeaders });
        if (!res.ok) throw new Error(`wbgetentities failed: HTTP ${res.status}`);
        const body = (await res.json()) as { entities?: Record<string, Record<string, unknown>> };
        for (const id of batch) {
          const entity = body.entities?.[id];
          if (entity) out.push(entity);
        }
      }
      return out;
    },
  };
}
