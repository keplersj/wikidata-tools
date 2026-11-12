import { cmp, normalizeString, type SourceEntry } from "@wdt/engine";
import { pool, runPipeline, type ToolRun } from "../pipeline.js";
import type { FetchLike, WikidataClient } from "../wikidata/client.js";
import { listAllValues, listValues } from "../wikidata/reader.js";
import { npmMapping } from "./mapping.js";
import { DEFAULT_VERSION_FILTER, fetchPackument, packumentToSource, type VersionFilter } from "./source.js";

export type NpmToolInput = {
  /** Package names typed in by the user. */
  names: string[];
  /**
   * Also take packages that already have P8262 on Wikidata. `{ limit, offset }` is one sorted page;
   * `{ all: true }` pages through every one (`pageSize` per query, optional `offset` and `max`)
   * so a single batch covers them all.
   */
  fromWikidata?: { limit: number; offset?: number } | { all: true; pageSize?: number; offset?: number; max?: number };
  versions?: VersionFilter;
  /** `YYYY-MM-DD`. An input, never read from a clock. */
  runDate: string;
  concurrency?: number;
};

export async function runNpmTool(
  deps: { client: WikidataClient; fetchNpm: FetchLike },
  input: NpmToolInput,
): Promise<ToolRun> {
  const filter = input.versions ?? DEFAULT_VERSION_FILTER;
  const names = new Set(input.names.map(normalizeString).filter((n) => n !== ""));
  if (input.fromWikidata) {
    const from = input.fromWikidata;
    const values = "all" in from ? await listAllValues(deps.client, "P8262", from) : await listValues(deps.client, "P8262", from);
    for (const v of values) names.add(v);
  }
  const sorted = [...names].sort(cmp);

  const notes: string[] = [];
  const fetched = await pool(sorted, input.concurrency ?? 6, async (name) => {
    const packument = await fetchPackument(deps.fetchNpm, name);
    if (!packument) notes.push(`${name}: not found on the npm registry, skipped`);
    return packument ? packumentToSource(packument, name, filter) : null;
  });
  const entries = fetched.filter((e): e is SourceEntry => e !== null);

  return runPipeline({
    tool: "npm",
    client: deps.client,
    mapping: npmMapping,
    entries,
    runDate: input.runDate,
    notes: notes.sort(cmp),
    inputs: { names: sorted, fromWikidata: input.fromWikidata ?? null, versions: filter },
  });
}
