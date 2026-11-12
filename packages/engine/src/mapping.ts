import { expandRepositoryShorthand, makeTime, normalizeString, normalizeUrl } from "./normalize.js";
import type { Entry, Key, Qualifier, Value, WantedClaim } from "./types.js";

/**
 * Declarative mapping: source field → property, with a transform, optional
 * qualifiers, and a mapping-wide reference. To add a field, add a row.
 */

export type ValueSpec =
  /** Trimmed string. */
  | { as: "string"; path?: string }
  /** URL kept as given (comparison still normalizes it). */
  | { as: "url"; path?: string }
  /** URL emitted in normalized form (strips git+, .git, lowercases host...). */
  | { as: "normalized-url"; path?: string }
  /** ISO timestamp → day-precision time. */
  | { as: "time-day"; path?: string }
  /** Item resolved later through identifier property `via` (e.g. P2479 SPDX). */
  | { as: "item"; via: string; path?: string }
  /** A QID given directly (e.g. from a class-mapping config). Anything else is dropped. */
  | { as: "qid"; path?: string };

export type ClaimRow = {
  id: string;
  /** Source field name (top-level, or dotted path). Array fields fan out, one claim per element. */
  field: string;
  property: string;
  value: ValueSpec;
  /** Qualifier values are read from the same array element (or the field itself). */
  qualifiers?: { property: string; value: ValueSpec }[];
};

export type TextRow = { id: string; field: string; target: "label" | "description" };

export type ReferenceSpec =
  /** `{key}` and `{<field>}` are replaced from the entry. */
  | { property: string; kind: "url-template"; template: string }
  | { property: string; kind: "run-date" };

export type Mapping = {
  /** Bumped by hand when rows change; recorded in coverage snapshots. */
  version: string;
  rows: (ClaimRow | TextRow)[];
  references: ReferenceSpec[];
  /** Source fields deliberately not mapped, so they don't show as "unmapped". */
  ignore: string[];
};

export type SourceEntry = { key: Key; fields: Record<string, unknown> };

export type MapContext = { runDate: string };

const isTextRow = (r: ClaimRow | TextRow): r is TextRow => "target" in r;

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function asText(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const s = normalizeString(raw);
    return s === "" ? undefined : s;
  }
  if (typeof raw === "number") return String(raw);
  return undefined;
}

function toValue(spec: ValueSpec, element: unknown): Value | undefined {
  const raw = spec.path === undefined ? element : getPath(element, spec.path);
  const text = asText(raw);
  if (text === undefined) return undefined;
  switch (spec.as) {
    case "string":
      return { type: "string", value: text };
    case "url":
      return { type: "url", value: text };
    case "normalized-url":
      return { type: "url", value: normalizeUrl(expandRepositoryShorthand(text)) };
    case "time-day": {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(text);
      return m ? makeTime(m[1] ?? "", 11) : undefined;
    }
    case "item":
      return { type: "unresolved", via: spec.via, raw: text };
    case "qid":
      return /^Q\d+$/.test(text) ? { type: "item", qid: text } : undefined;
  }
}

function fanOut(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function fillTemplate(template: string, entry: SourceEntry): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (name === "key") return entry.key.value;
    return asText(entry.fields[name]) ?? "";
  });
}

function references(mapping: Mapping, entry: SourceEntry, ctx: MapContext): Qualifier[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ctx.runDate)) {
    throw new Error(`runDate must be YYYY-MM-DD, got "${ctx.runDate}"`);
  }
  return mapping.references.map((r) => ({
    property: r.property,
    value:
      r.kind === "run-date"
        ? makeTime(ctx.runDate, 11)
        : { type: "url", value: fillTemplate(r.template, entry) },
  }));
}

/** Applies every mapping row to one source entry. Pure: the run date is an input. */
export function applyMapping(mapping: Mapping, entry: SourceEntry, ctx: MapContext): Entry {
  const refs = references(mapping, entry, ctx);
  const claims: WantedClaim[] = [];
  const out: Entry = { key: entry.key, claims };

  for (const row of mapping.rows) {
    const elements = fanOut(getPath(entry.fields, row.field));
    if (isTextRow(row)) {
      const text = asText(elements[0]);
      if (text !== undefined) out[row.target] = text;
      continue;
    }
    for (const element of elements) {
      const value = toValue(row.value, element);
      if (!value) continue;
      const qualifiers: Qualifier[] = [];
      for (const q of row.qualifiers ?? []) {
        const qv = toValue(q.value, element);
        if (qv) qualifiers.push({ property: q.property, value: qv });
      }
      const claim: WantedClaim = { property: row.property, value, references: refs };
      if (qualifiers.length) claim.qualifiers = qualifiers;
      claims.push(claim);
    }
  }
  return out;
}

/** Top-level source fields in `entries` that no row reads and the mapping doesn't ignore. */
export function findUnmappedFields(mapping: Mapping, entries: SourceEntry[]): string[] {
  const known = new Set(mapping.ignore);
  for (const row of mapping.rows) known.add(row.field.split(".")[0] ?? row.field);
  const unmapped = new Set<string>();
  for (const e of entries) {
    for (const [name, value] of Object.entries(e.fields)) {
      if (!known.has(name) && value !== undefined && value !== null) unmapped.add(name);
    }
  }
  return [...unmapped].sort();
}
