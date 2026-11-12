import { cmp } from "./normalize.js";
import type { Entry, Qualifier, Value } from "./types.js";

/** Resolver logic only. Fetching the lookup rows is the reader's job. */

export type Resolution = { via: string; raw: string };
export type ResolutionRow = { via: string; raw: string; qid: string };

/** (via, raw) → distinct QIDs found on Wikidata. */
export type Lookup = Map<string, string[]>;

const lookupId = (via: string, raw: string) => `${via}\0${raw}`;

/** Every distinct (via, raw) pair the entries still need resolved, sorted. */
export function collectUnresolved(entries: Entry[]): Resolution[] {
  const seen = new Map<string, Resolution>();
  const visit = (v: Value) => {
    if (v.type === "unresolved") seen.set(lookupId(v.via, v.raw), { via: v.via, raw: v.raw });
  };
  for (const e of entries) {
    for (const c of e.claims) {
      visit(c.value);
      for (const q of c.qualifiers ?? []) visit(q.value);
      for (const r of c.references ?? []) visit(r.value);
    }
  }
  return [...seen.values()].sort((a, b) => cmp(a.via, b.via) || cmp(a.raw, b.raw));
}

export function buildLookup(rows: ResolutionRow[]): Lookup {
  const lookup: Lookup = new Map();
  for (const r of rows) {
    const id = lookupId(r.via, r.raw);
    const list = lookup.get(id) ?? [];
    if (!list.includes(r.qid)) list.push(r.qid);
    lookup.set(id, list);
  }
  return lookup;
}

/**
 * A value resolves only when exactly one item carries it. Zero or several
 * matches stay unresolved: we never guess.
 */
function resolveValue(v: Value, lookup: Lookup): Value {
  if (v.type !== "unresolved") return v;
  const qids = lookup.get(lookupId(v.via, v.raw));
  return qids && qids.length === 1 ? { type: "item", qid: qids[0]! } : v;
}

const resolveQualifiers = (list: Qualifier[] | undefined, lookup: Lookup) =>
  list?.map((q) => ({ property: q.property, value: resolveValue(q.value, lookup) }));

export function resolveEntries(entries: Entry[], lookup: Lookup): Entry[] {
  return entries.map((e) => ({
    ...e,
    claims: e.claims.map((c) => {
      const out = { ...c, value: resolveValue(c.value, lookup) };
      const qualifiers = resolveQualifiers(c.qualifiers, lookup);
      const references = resolveQualifiers(c.references, lookup);
      if (qualifiers) out.qualifiers = qualifiers;
      if (references) out.references = references;
      return out;
    }),
  }));
}
