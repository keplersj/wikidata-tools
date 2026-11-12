import {
  buildLookup,
  cmp,
  cmpId,
  keyId,
  normalizeString,
  timeFromWikidata,
  type CurrentState,
  type ExistingClaim,
  type ItemState,
  type Key,
  type Lookup,
  type Resolution,
  type Value,
} from "@wdt/engine";
import type { OnProgress } from "../progress.js";
import { chunk, type WikidataClient } from "./client.js";

export const SPARQL_BATCH = 50;

const PROPERTY_RE = /^P\d+$/;

function assertProperty(p: string): void {
  if (!PROPERTY_RE.test(p)) throw new Error(`Not a property id: ${p}`);
}

function sparqlString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
}

const qidFromUri = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

type Row = { v: string; qid: string };

/** All items carrying `property` = one of `values`, any rank. One SPARQL query per batch. */
async function itemsByValues(
  client: WikidataClient,
  property: string,
  values: string[],
  onBatch?: (n: number) => void,
): Promise<Row[]> {
  assertProperty(property);
  const rows: Row[] = [];
  for (const batch of chunk([...new Set(values)].sort(cmp), SPARQL_BATCH)) {
    const query = `SELECT ?item ?v WHERE { VALUES ?v { ${batch.map(sparqlString).join(" ")} } ?item p:${property}/ps:${property} ?v . }`;
    for (const b of await client.sparql(query)) {
      const item = b.item?.value;
      const v = b.v?.value;
      if (item && v !== undefined) rows.push({ v, qid: qidFromUri(item) });
    }
    onBatch?.(batch.length);
  }
  return rows;
}

/** Turns a Wikidata snak into one of our values; null for novalue/somevalue or types we don't compare. */
export function parseSnak(snak: unknown): Value | null {
  const s = snak as {
    snaktype?: string;
    datatype?: string;
    datavalue?: { type?: string; value?: unknown };
  };
  if (s?.snaktype !== "value" || !s.datavalue) return null;
  const { type, value } = s.datavalue;
  if (type === "string" && typeof value === "string") {
    return s.datatype === "url" ? { type: "url", value } : { type: "string", value };
  }
  if (type === "wikibase-entityid") {
    const id = (value as { id?: string }).id;
    return id && /^Q\d+$/.test(id) ? { type: "item", qid: id } : null;
  }
  if (type === "time") {
    const t = value as { time?: string; precision?: number };
    return t.time && t.precision !== undefined ? timeFromWikidata(t.time, t.precision) : null;
  }
  return null;
}

export function parseEntity(entity: Record<string, unknown>): ItemState | null {
  const id = entity.id;
  if (typeof id !== "string" || "missing" in entity) return null;
  const claims: ItemState["claims"] = {};
  const raw = (entity.claims ?? {}) as Record<string, { mainsnak: unknown; qualifiers?: Record<string, unknown[]> }[]>;
  for (const property of Object.keys(raw).sort(cmpId)) {
    for (const st of raw[property] ?? []) {
      const value = parseSnak(st.mainsnak);
      if (!value) continue;
      const qualifiers: ExistingClaim["qualifiers"] = {};
      for (const [qp, snaks] of Object.entries(st.qualifiers ?? {})) {
        const vs = snaks.map(parseSnak).filter((v): v is Value => v !== null);
        if (vs.length) qualifiers[qp] = vs;
      }
      (claims[property] ??= []).push({ value, qualifiers });
    }
  }
  return { qid: id, claims };
}

export async function loadStates(
  client: WikidataClient,
  qids: string[],
  onBatch?: (done: number, total: number) => void,
): Promise<Map<string, ItemState>> {
  const out = new Map<string, ItemState>();
  for (const entity of await client.getEntities(qids, onBatch)) {
    const state = parseEntity(entity);
    if (state) out.set(state.qid, state);
  }
  return out;
}

/**
 * Finds the item(s) for each key (one SPARQL query per property per batch),
 * then fetches their claims with `wbgetentities`. Matching is by key only.
 */
export type CurrentRead = {
  current: CurrentState;
  /** `keyId`s SPARQL found an item for, but whose entity could not be loaded (deleted? redirected?). */
  unloadable: string[];
};

export async function readCurrent(client: WikidataClient, keys: Key[], onProgress?: OnProgress): Promise<CurrentRead> {
  const byProperty = new Map<string, string[]>();
  for (const k of keys) {
    const list = byProperty.get(k.property) ?? [];
    list.push(normalizeString(k.value));
    byProperty.set(k.property, list);
  }
  const hits: { id: string; qid: string }[] = [];
  const total = [...byProperty.values()].reduce((n, v) => n + new Set(v).size, 0);
  let done = 0;
  onProgress?.({ stage: "Looking up existing items on Wikidata", done, total });
  for (const [property, values] of [...byProperty].sort(([a], [b]) => cmpId(a, b))) {
    const rows = await itemsByValues(client, property, values, (n) => {
      done += n;
      onProgress?.({ stage: "Looking up existing items on Wikidata", done, total });
    });
    for (const row of rows) {
      hits.push({ id: keyId({ property, value: row.v }), qid: row.qid });
    }
  }
  const stage = "Loading item data from Wikidata";
  const qids = hits.map((h) => h.qid);
  onProgress?.({ stage, done: 0, total: new Set(qids).size });
  const states = await loadStates(client, qids, (done, total) => onProgress?.({ stage, done, total }));
  const out: CurrentState = {};
  const unloadable = new Set<string>();
  for (const h of hits) {
    const state = states.get(h.qid);
    if (!state) {
      unloadable.add(h.id);
      continue;
    }
    const list = (out[h.id] ??= []);
    if (!list.some((s) => s.qid === state.qid)) list.push(state);
  }
  for (const list of Object.values(out)) list.sort((a, b) => cmpId(a.qid, b.qid));
  return { current: out, unloadable: [...unloadable].sort(cmp) };
}

/** Resolves (identifier property, raw value) pairs to QIDs, batched with SPARQL VALUES. */
export async function readLookup(client: WikidataClient, pairs: Resolution[], onProgress?: OnProgress): Promise<Lookup> {
  const byVia = new Map<string, string[]>();
  for (const p of pairs) {
    const list = byVia.get(p.via) ?? [];
    list.push(p.raw);
    byVia.set(p.via, list);
  }
  const rows: { via: string; raw: string; qid: string }[] = [];
  const stage = "Looking up referenced items on Wikidata";
  const total = [...byVia.values()].reduce((n, v) => n + new Set(v).size, 0);
  let done = 0;
  onProgress?.({ stage, done, total });
  for (const [via, raws] of [...byVia].sort(([a], [b]) => cmpId(a, b))) {
    const found = await itemsByValues(client, via, raws, (n) => {
      done += n;
      onProgress?.({ stage, done, total });
    });
    for (const r of found) rows.push({ via, raw: r.v, qid: r.qid });
  }
  return buildLookup(rows);
}

/** Distinct values of an identifier property, sorted, paged. Used to pick which packages to process. */
export async function listValues(
  client: WikidataClient,
  property: string,
  opts: { limit: number; offset?: number; prefix?: string },
): Promise<string[]> {
  assertProperty(property);
  const filter = opts.prefix ? `FILTER(STRSTARTS(?v, ${sparqlString(opts.prefix)}))` : "";
  const query = `SELECT DISTINCT ?v WHERE { ?item p:${property}/ps:${property} ?v . ${filter} } ORDER BY ?v LIMIT ${Math.trunc(opts.limit)} OFFSET ${Math.trunc(opts.offset ?? 0)}`;
  return (await client.sparql(query)).flatMap((b) => (b.v ? [b.v.value] : []));
}

/** Default page size for {@link listAllValues}. */
export const DEFAULT_PAGE_SIZE = 1000;

/**
 * Every distinct value of an identifier property, fetched in sorted pages of `pageSize`
 * until a short page comes back. Optional `offset` skips the first values; `max` caps the total.
 */
export async function listAllValues(
  client: WikidataClient,
  property: string,
  opts: { pageSize?: number; offset?: number; max?: number; prefix?: string; onPage?: (total: number) => void } = {},
): Promise<string[]> {
  const pageSize = Math.max(1, Math.trunc(opts.pageSize ?? DEFAULT_PAGE_SIZE));
  const max = opts.max === undefined ? Infinity : Math.max(0, Math.trunc(opts.max));
  const out: string[] = [];
  let offset = Math.max(0, Math.trunc(opts.offset ?? 0));
  while (out.length < max) {
    const limit = Math.min(pageSize, max - out.length);
    const page = await listValues(client, property, {
      limit,
      offset,
      ...(opts.prefix === undefined ? {} : { prefix: opts.prefix }),
    });
    out.push(...page);
    opts.onPage?.(out.length);
    if (page.length < limit) break;
    offset += page.length;
  }
  return out;
}

/** All values of an identifier property starting with `prefix` (no paging). One query. */
export async function allValuesWithPrefix(
  client: WikidataClient,
  property: string,
  prefix: string,
): Promise<string[]> {
  assertProperty(property);
  const query = `SELECT DISTINCT ?v WHERE { ?item p:${property}/ps:${property} ?v . FILTER(STRSTARTS(?v, ${sparqlString(prefix)})) }`;
  return (await client.sparql(query)).flatMap((b) => (b.v ? [b.v.value] : [])).sort(cmp);
}

/**
 * The Query Service can lag behind Wikidata and still return items that were
 * deleted or turned into redirects. Before a resolved QID is emitted as a
 * value, check the item still exists; otherwise drop it (the value then stays
 * unresolved and is reported). Returns the QIDs it dropped.
 */
export async function verifyLookup(
  client: WikidataClient,
  lookup: Lookup,
  onProgress?: OnProgress,
): Promise<{ lookup: Lookup; dropped: string[] }> {
  const qids = [...new Set([...lookup.values()].flat())].sort(cmpId);
  const stage = "Checking that referenced items still exist";
  onProgress?.({ stage, done: 0, total: qids.length });
  const alive = await loadStates(client, qids, (done, total) => onProgress?.({ stage, done, total }));
  const verified: Lookup = new Map();
  for (const [id, list] of lookup) {
    const kept = list.filter((q) => alive.has(q));
    if (kept.length) verified.set(id, kept);
  }
  return { lookup: verified, dropped: qids.filter((q) => !alive.has(q)) };
}
