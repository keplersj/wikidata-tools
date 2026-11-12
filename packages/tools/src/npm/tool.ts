import { cmp, normalizeString, type SourceEntry } from "@wdt/engine";
import type { OnProgress } from "../progress.js";
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
  onProgress?: OnProgress;
};

export async function runNpmTool(
  deps: { client: WikidataClient; fetchNpm: FetchLike; retry?: Parameters<typeof fetchPackument>[3] },
  input: NpmToolInput,
): Promise<ToolRun> {
  const filter = input.versions ?? DEFAULT_VERSION_FILTER;
  const names = new Set(input.names.map(normalizeString).filter((n) => n !== ""));
  const { onProgress } = input;
  if (input.fromWikidata) {
    const from = input.fromWikidata;
    onProgress?.({ stage: "Listing npm packages on Wikidata" });
    const values =
      "all" in from
        ? await listAllValues(deps.client, "P8262", {
            ...from,
            onPage: (n) => onProgress?.({ stage: `Listing npm packages on Wikidata (${n} so far)` }),
          })
        : await listValues(deps.client, "P8262", from);
    for (const v of values) names.add(v);
  }
  const sorted = [...names].sort(cmp);

  const notes: string[] = [];
  let done = 0;
  onProgress?.({ stage: "Fetching packages from the npm registry", done, total: sorted.length });
  const fetched = await pool(sorted, input.concurrency ?? 6, async (name) => {
    let packument: Awaited<ReturnType<typeof fetchPackument>> = null;
    try {
      packument = await fetchPackument(deps.fetchNpm, name, undefined, deps.retry);
      if (!packument) notes.push(`${name}: not found on the npm registry, skipped`);
    } catch (err) {
      // One bad package must not sink a batch of thousands; it is reported and picked up by the next run.
      notes.push(`${name}: could not be fetched from npm (${err instanceof Error ? err.message : String(err)}), skipped`);
    }
    onProgress?.({ stage: "Fetching packages from the npm registry", done: ++done, total: sorted.length });
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
    ...(onProgress ? { onProgress } : {}),
    inputs: { names: sorted, fromWikidata: input.fromWikidata ?? null, versions: filter },
  });
}
