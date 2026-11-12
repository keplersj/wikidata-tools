import {
  applyMapping,
  collectUnresolved,
  emit,
  findUnmappedFields,
  keyId,
  makeSnapshot,
  plan,
  resolveEntries,
  type CurrentState,
  type Entry,
  type Mapping,
  type Plan,
  type Snapshot,
  type SourceEntry,
} from "@wdt/engine";
import type { OnProgress } from "./progress.js";
import type { WikidataClient } from "./wikidata/client.js";
import { readCurrent, readLookup, verifyLookup } from "./wikidata/reader.js";

export type ToolRun = {
  tool: string;
  runDate: string;
  mappingVersion: string;
  plan: Plan;
  /** What the run wanted (after resolution) and what it found on Wikidata; kept for self-checks and tests. */
  wanted: Entry[];
  current: CurrentState;
  /** QuickStatements v1 batch; empty when Wikidata already has everything. */
  text: string;
  snapshot: Snapshot;
  /** Anything the source adapter couldn't fetch (e.g. unknown npm packages). */
  notes: string[];
};

/**
 * The shared pipeline: map source entries, resolve item-valued fields through
 * identifier properties, read current Wikidata state by key, diff, emit.
 */
export async function runPipeline(args: {
  tool: string;
  client: WikidataClient;
  mapping: Mapping;
  entries: SourceEntry[];
  runDate: string;
  inputs?: Record<string, unknown>;
  notes?: string[];
  onProgress?: OnProgress;
}): Promise<ToolRun> {
  const { client, mapping, runDate } = args;
  const { onProgress } = args;
  const mapped: ReturnType<typeof applyMapping>[] = [];
  const mapStage = "Mapping source entries";
  onProgress?.({ stage: mapStage, done: 0, total: args.entries.length });
  for (const [i, e] of args.entries.entries()) {
    mapped.push(applyMapping(mapping, e, { runDate }));
    if ((i + 1) % 200 === 0 || i + 1 === args.entries.length) {
      onProgress?.({ stage: mapStage, done: i + 1, total: args.entries.length });
      await yieldToUi();
    }
  }
  const { lookup, dropped } = await verifyLookup(client, await readLookup(client, collectUnresolved(mapped), onProgress), onProgress);
  const wanted = resolveEntries(mapped, lookup);
  const { current, unloadable } = await readCurrent(client, wanted.map((e) => e.key), onProgress);
  onProgress?.({ stage: "Comparing with Wikidata and building the batch" });
  await yieldToUi(); // the comparison is one synchronous step; let the label paint first
  // A key Wikidata knows but whose item can't be loaded must not become a CREATE (that would duplicate it).
  const skip = new Set(unloadable);
  const notes = [...(args.notes ?? [])];
  for (const qid of dropped) notes.push(`${qid}: matched an identifier but the item no longer exists (deleted or redirected), not used`);
  for (const id of unloadable) notes.push(`${id}: found by query but the item could not be loaded (deleted or redirected?), skipped`);
  const result = plan(wanted.filter((e) => !skip.has(keyId(e.key))), current, { unmappedFields: findUnmappedFields(mapping, args.entries) });
  const snapshotArgs = { date: runDate, tool: args.tool, mappingVersion: mapping.version, plan: result };
  return {
    tool: args.tool,
    runDate,
    mappingVersion: mapping.version,
    plan: result,
    wanted,
    current,
    text: emit(result),
    snapshot: makeSnapshot(args.inputs ? { ...snapshotArgs, inputs: args.inputs } : snapshotArgs),
    notes,
  };
}

/** Lets the browser repaint (and run timers) between chunks of synchronous work. */
export const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Runs `task` over `items` with at most `limit` in flight; results keep input order. */
export async function pool<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await task(items[i] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
