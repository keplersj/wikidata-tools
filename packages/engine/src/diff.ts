import { cmpClaim, isQsSafe, isQsSafeText, isTooLong } from "./emit.js";
import {
  cmp,
  cmpId,
  cmpKey,
  keyId,
  normalizeString,
  valueKey,
  valuesEqual,
} from "./normalize.js";
import type {
  CurrentState,
  Entry,
  ExistingClaim,
  ItemState,
  Key,
  Plan,
  Qualifier,
  RunReport,
  Skipped,
  UnresolvedStatement,
  Value,
  WantedClaim,
} from "./types.js";

export type PlanOptions = {
  /** Source fields no mapping row reads; passed through to the run report. */
  unmappedFields?: string[];
};

function finer(a: Value, b: Value): Value {
  if (a.type === "time" && b.type === "time") {
    if (a.precision !== b.precision) return b.precision > a.precision ? b : a;
    return cmp(b.iso, a.iso) < 0 ? b : a; // equal at this precision: pick independent of order
  }
  return a;
}

function cmpQualifier(a: Qualifier, b: Qualifier): number {
  return cmpId(a.property, b.property) || cmp(valueKey(a.value), valueKey(b.value));
}

/** Sorted, de-duplicated (by value equality) qualifier/reference list. */
function dedupeQualifiers(list: Qualifier[]): Qualifier[] {
  const kept: Qualifier[] = [];
  for (const q of [...list].sort(cmpQualifier)) {
    const same = kept.find((k) => k.property === q.property && valuesEqual(k.value, q.value));
    if (same) same.value = finer(same.value, q.value);
    else kept.push({ property: q.property, value: q.value });
  }
  return kept;
}

type Cleaned = {
  claims: WantedClaim[];
  unresolved: UnresolvedStatement[];
  skipped: Skipped[];
  /** Wanted statements counted for coverage (resolved + blocked + skipped). */
  wanted: number;
  blocked: number;
};

/** Splits off unresolved/unsafe parts, merges duplicates, and sorts. */
function clean(entry: Entry): Cleaned {
  const unresolved = new Map<string, UnresolvedStatement>();
  const skipped: Skipped[] = [];
  const resolved: WantedClaim[] = [];
  const blockedMain = new Set<string>();
  const unsafeMain = new Set<string>();
  const noteUnresolved = (property: string, v: Extract<Value, { type: "unresolved" }>) => {
    unresolved.set(`${property}\0${v.via}\0${v.raw}`, {
      key: entry.key,
      property,
      via: v.via,
      raw: v.raw,
    });
  };
  const noteUnsafe = (property: string, v: Value) =>
    skipped.push({
      key: entry.key,
      property,
      reason: "unsafe-for-quickstatements",
      detail: v.type === "string" || v.type === "url" ? v.value : valueKey(v),
    });

  const usable = (list: Qualifier[] | undefined): Qualifier[] => {
    const out: Qualifier[] = [];
    for (const q of list ?? []) {
      if (q.value.type === "unresolved") noteUnresolved(q.property, q.value);
      else if (!isQsSafe(q.value)) noteUnsafe(q.property, q.value);
      else out.push(q);
    }
    return out;
  };

  for (const c of entry.claims) {
    if (c.value.type === "unresolved") {
      noteUnresolved(c.property, c.value);
      blockedMain.add(`${c.property}\0${c.value.via}\0${c.value.raw}`);
      continue;
    }
    if (!isQsSafe(c.value)) {
      noteUnsafe(c.property, c.value);
      unsafeMain.add(`${c.property}\0${valueKey(c.value)}`);
      continue;
    }
    resolved.push({
      property: c.property,
      value: c.value,
      qualifiers: usable(c.qualifiers),
      references: usable(c.references),
    });
  }

  // Merge duplicate claims (same property, equal value), in canonical order.
  const merged: WantedClaim[] = [];
  for (const c of [...resolved].sort(cmpClaim)) {
    const same = merged.find((m) => m.property === c.property && valuesEqual(m.value, c.value));
    if (same) {
      same.value = finer(same.value, c.value);
      same.qualifiers = [...(same.qualifiers ?? []), ...(c.qualifiers ?? [])];
      same.references = [...(same.references ?? []), ...(c.references ?? [])];
    } else {
      merged.push(c);
    }
  }
  const claims = merged.map((c) => {
    const claim: WantedClaim = { property: c.property, value: c.value };
    const qualifiers = dedupeQualifiers(c.qualifiers ?? []);
    const references = dedupeQualifiers(c.references ?? []);
    if (qualifiers.length) claim.qualifiers = qualifiers;
    if (references.length) claim.references = references;
    return claim;
  });
  claims.sort(cmpClaim);

  return {
    claims,
    unresolved: [...unresolved.values()],
    skipped,
    // Duplicates were merged above, so each distinct wanted statement counts once.
    wanted: claims.length + blockedMain.size + unsafeMain.size,
    blocked: blockedMain.size,
  };
}

function mergeEntries(entries: Entry[]): Entry[] {
  const byKey = new Map<string, Entry>();
  for (const e of entries) {
    const id = keyId(e.key);
    const prev = byKey.get(id);
    if (!prev) {
      byKey.set(id, { ...e, claims: [...e.claims] });
      continue;
    }
    prev.claims.push(...e.claims);
    // Pick label/description independent of input order.
    for (const f of ["label", "description"] as const) {
      const a = prev[f];
      const b = e[f];
      if (b !== undefined && (a === undefined || cmp(b, a) < 0)) prev[f] = b;
    }
  }
  return [...byKey.values()].sort((a, b) => cmpKey(a.key, b.key));
}

function existingFor(item: ItemState, property: string, value: Value): ExistingClaim[] {
  return (item.claims[property] ?? []).filter((c) => valuesEqual(c.value, value));
}

function hasQualifier(matches: ExistingClaim[], q: Qualifier): boolean {
  return matches.some((m) => (m.qualifiers[q.property] ?? []).some((v) => valuesEqual(v, q.value)));
}

/**
 * Diff wanted entries against Wikidata. Pure: no network, no clock.
 *
 * - Value-level: a wanted statement is present if the item has that property
 *   with an equal normalized value, whatever its rank or references.
 * - Qualifier-level: if the value is present but a wanted qualifier is
 *   missing, only that qualifier is emitted, on the *existing* raw value so
 *   QuickStatements merges it into the existing statement.
 * - References ride along on new statements only.
 * - Keys held by several items are skipped and reported, never guessed.
 */
export function plan(entries: Entry[], current: CurrentState, options: PlanOptions = {}): Plan {
  const merged = mergeEntries(entries);
  const creates: Entry[] = [];
  const additions: Plan["additions"] = [];
  const unresolved: UnresolvedStatement[] = [];
  const skipped: Skipped[] = [];
  const coverage = {
    entries: merged.length,
    linked: 0,
    wanted: 0,
    wantedLinked: 0,
    presentLinked: 0,
    blocked: 0,
  };

  for (const entry of merged) {
    const c = clean(entry);
    unresolved.push(...c.unresolved);
    skipped.push(...c.skipped);
    coverage.wanted += c.wanted;
    coverage.blocked += c.blocked;

    const items = current[keyId(entry.key)] ?? [];
    if (items.length > 1) {
      skipped.push({
        key: entry.key,
        reason: "ambiguous-key",
        detail: items.map((i) => i.qid).sort(cmpId).join(", "),
      });
      continue;
    }

    const item = items[0];
    if (!item) {
      // A label is essential, so an unsafe one blocks the create. A description is optional: drop it and say so.
      if (entry.label !== undefined && !isQsSafeText(entry.label)) {
        skipped.push({ key: entry.key, reason: "unsafe-for-quickstatements", detail: entry.label });
        continue;
      }
      if (entry.label !== undefined && isTooLong(entry.label)) {
        skipped.push({ key: entry.key, reason: "too-long", detail: entry.label });
        continue;
      }
      let description = entry.description;
      if (description !== undefined && !isQsSafeText(description)) {
        skipped.push({
          key: entry.key,
          property: "description",
          reason: "unsafe-for-quickstatements",
          detail: description,
        });
        description = undefined;
      }
      const keyClaim: WantedClaim = {
        property: entry.key.property,
        value: { type: "string", value: normalizeString(entry.key.value) },
      };
      if (description !== undefined && isTooLong(description)) {
        skipped.push({ key: entry.key, property: "description", reason: "too-long", detail: description });
        description = undefined;
      }
      const claims = [...c.claims];
      if (!claims.some((x) => x.property === keyClaim.property && valuesEqual(x.value, keyClaim.value))) {
        claims.push(keyClaim);
        claims.sort(cmpClaim);
      }
      const create: Entry = { key: entry.key, claims };
      if (entry.label !== undefined) create.label = entry.label;
      if (description !== undefined) create.description = description;
      creates.push(create);
      continue;
    }

    coverage.linked += 1;
    coverage.wantedLinked += c.wanted;
    const toAdd: WantedClaim[] = [];
    for (const claim of c.claims) {
      const matches = existingFor(item, claim.property, claim.value);
      if (matches.length === 0) {
        toAdd.push(claim);
        continue;
      }
      const missing = (claim.qualifiers ?? []).filter((q) => !hasQualifier(matches, q));
      if (missing.length === 0) {
        coverage.presentLinked += 1;
        continue;
      }
      // Emit on the first matching statement's raw value (stable order).
      const target = [...matches].sort((a, b) => cmp(valueKey(a.value), valueKey(b.value)))[0];
      toAdd.push({
        property: claim.property,
        value: (target ?? matches[0]!).value,
        qualifiers: missing,
      });
    }
    if (toAdd.length) additions.push({ key: entry.key, qid: item.qid, claims: toAdd });
  }

  const report: RunReport = {
    unresolved: dedupeBy(unresolved, (u) => `${keyId(u.key)}\0${u.property}\0${u.via}\0${u.raw}`).sort(
      (a, b) =>
        cmpKey(a.key, b.key) ||
        cmpId(a.property, b.property) ||
        cmp(a.via, b.via) ||
        cmp(a.raw, b.raw),
    ),
    skipped: dedupeBy(
      skipped,
      (s) => `${keyId(s.key)}\0${s.property ?? ""}\0${s.reason}\0${s.detail}`,
    ).sort(
      (a, b) =>
        cmpKey(a.key, b.key) ||
        cmp(a.property ?? "", b.property ?? "") ||
        cmp(a.reason, b.reason) ||
        cmp(a.detail, b.detail),
    ),
    unmappedFields: [...new Set(options.unmappedFields ?? [])].sort(cmp),
    coverage,
  };

  return { creates, additions, report };
}

function dedupeBy<T>(list: T[], id: (t: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const t of list) if (!seen.has(id(t))) seen.set(id(t), t);
  return [...seen.values()];
}

export function isEmptyPlan(p: Plan): boolean {
  return p.creates.length === 0 && p.additions.length === 0;
}

/** Index states by every value they carry for `property`, as `keyId`s. */
export function indexStates(states: ItemState[], keyProperties: string[]): CurrentState {
  const out: CurrentState = {};
  for (const s of states) {
    for (const property of keyProperties) {
      const seen = new Set<string>();
      for (const c of s.claims[property] ?? []) {
        if (c.value.type !== "string") continue;
        const id = keyId({ property, value: c.value.value } as Key);
        if (seen.has(id)) continue;
        seen.add(id);
        (out[id] ??= []).push(s);
      }
    }
  }
  return out;
}
