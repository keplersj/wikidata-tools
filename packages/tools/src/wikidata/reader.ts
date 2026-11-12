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
async function itemsByValues(client: WikidataClient, property: string, values: string[]): Promise<Row[]> {
  assertProperty(property);
  const rows: Row[] = [];
  for (const batch of chunk([...new Set(values)].sort(cmp), SPARQL_BATCH)) {
    const query = `SELECT ?item ?v WHERE { VALUES ?v { ${batch.map(sparqlString).join(" ")} } ?item p:${property}/ps:${property} ?v . }`;
    for (const b of await client.sparql(query)) {
      const item = b.item?.value;
      const v = b.v?.value;
      if (item && v !== undefined) rows.push({ v, qid: qidFromUri(item) });
    }
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

export async function loadStates(client: WikidataClient, qids: string[]): Promise<Map<string, ItemState>> {
  const out = new Map<string, ItemState>();
  for (const entity of await client.getEntities(qids)) {
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

export async function readCurrent(client: WikidataClient, keys: Key[]): Promise<CurrentRead> {
  const byProperty = new Map<string, string[]>();
  for (const k of keys) {
    const list = byProperty.get(k.property) ?? [];
    list.push(normalizeString(k.value));
    byProperty.set(k.property, list);
  }
  const hits: { id: string; qid: string }[] = [];
  for (const [property, values] of [...byProperty].sort(([a], [b]) => cmpId(a, b))) {
    for (const row of await itemsByValues(client, property, values)) {
      hits.push({ id: keyId({ property, value: row.v }), qid: row.qid });
    }
  }
  const states = await loadStates(client, hits.map((h) => h.qid));
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
export async function readLookup(client: WikidataClient, pairs: Resolution[]): Promise<Lookup> {
  const byVia = new Map<string, string[]>();
  for (const p of pairs) {
    const list = byVia.get(p.via) ?? [];
    list.push(p.raw);
    byVia.set(p.via, list);
  }
  const rows: { via: string; raw: string; qid: string }[] = [];
  for (const [via, raws] of [...byVia].sort(([a], [b]) => cmpId(a, b))) {
    for (const r of await itemsByValues(client, via, raws)) rows.push({ via, raw: r.v, qid: r.qid });
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
