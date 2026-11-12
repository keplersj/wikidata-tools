import { cmp, cmpId, cmpKey, valueKey } from "./normalize.js";
import type { Entry, Plan, Qualifier, Value, WantedClaim } from "./types.js";

const TAB = "\t";

/**
 * Wikidata caps labels and descriptions at 250 characters. From memory, not
 * verified against the live site (see NOTES.md): over-long text is dropped and
 * reported rather than sent to fail inside QuickStatements.
 */
export const WIKIDATA_TEXT_LIMIT = 250;

export const isTooLong = (s: string): boolean => [...s.trim()].length > WIKIDATA_TEXT_LIMIT;

/**
 * QuickStatements v1 documents no escape for `"` in strings (it only lists
 * double quotes among characters that "confuse the tool"), and tab/newline
 * would break the row structure. We never emit such values; the diff reports
 * them as skipped instead.
 */
export function isQsSafe(v: Value): boolean {
  if (v.type === "unresolved") return false;
  if (v.type === "string" || v.type === "url") return !/["\t\r\n]/.test(v.value);
  return true;
}

export function isQsSafeText(s: string): boolean {
  return !/["\t\r\n]/.test(s);
}

function timeLiteral(iso: string, precision: 9 | 10 | 11): string {
  const y = iso.slice(0, 4);
  const m = iso.slice(5, 7);
  const d = iso.slice(8, 10);
  if (precision === 9) return `+${y}-00-00T00:00:00Z/9`;
  if (precision === 10) return `+${y}-${m}-00T00:00:00Z/10`;
  return `+${y}-${m}-${d}T00:00:00Z/11`;
}

/** The literal QuickStatements expects for a value. Throws on unresolved values. */
export function formatValue(v: Value): string {
  switch (v.type) {
    case "string":
    case "url":
      return `"${v.value.trim()}"`;
    case "item":
      return v.qid;
    case "time":
      return timeLiteral(v.iso, v.precision);
    case "unresolved":
      throw new Error(`Cannot emit unresolved value ${v.via}:${v.raw}`);
  }
}

function cmpQualifier(a: Qualifier, b: Qualifier): number {
  return cmpId(a.property, b.property) || cmp(valueKey(a.value), valueKey(b.value));
}

export function cmpClaim(a: WantedClaim, b: WantedClaim): number {
  return cmpId(a.property, b.property) || cmp(valueKey(a.value), valueKey(b.value));
}

/** `P854` → `S854`: reference properties use the S prefix in QuickStatements. */
function referenceProperty(p: string): string {
  return `S${p.slice(1)}`;
}

function claimLine(subject: string, c: WantedClaim): string {
  const parts = [subject, c.property, formatValue(c.value)];
  for (const q of [...(c.qualifiers ?? [])].sort(cmpQualifier)) {
    parts.push(q.property, formatValue(q.value));
  }
  for (const r of [...(c.references ?? [])].sort(cmpQualifier)) {
    parts.push(referenceProperty(r.property), formatValue(r.value));
  }
  return parts.join(TAB);
}

function createLines(e: Entry): string[] {
  const lines = ["CREATE"];
  if (e.label !== undefined) lines.push(["LAST", "Len", `"${e.label.trim()}"`].join(TAB));
  if (e.description !== undefined) lines.push(["LAST", "Den", `"${e.description.trim()}"`].join(TAB));
  for (const c of [...e.claims].sort(cmpClaim)) lines.push(claimLine("LAST", c));
  return lines;
}

/**
 * Plan → QuickStatements v1 text. Pure and deterministic: items sorted by
 * source key, statements by property id then normalized value. Empty plan → "".
 */
export function emit(plan: Plan): string {
  const lines: string[] = [];
  for (const e of [...plan.creates].sort((a, b) => cmpKey(a.key, b.key))) {
    lines.push(...createLines(e));
  }
  for (const a of [...plan.additions].sort((x, y) => cmpKey(x.key, y.key) || cmpId(x.qid, y.qid))) {
    for (const c of [...a.claims].sort(cmpClaim)) lines.push(claimLine(a.qid, c));
  }
  return lines.join("\n");
}

/** Prefilled QuickStatements link, or null if the batch can't travel in a URL. */
export const QS_URL_LIMIT = 6000;

export function quickStatementsUrl(text: string): string | null {
  if (text === "" || text.includes("|")) return null;
  const encoded = encodeURIComponent(text.replace(/\t/g, "|").replace(/\n/g, "||"));
  if (encoded.length > QS_URL_LIMIT) return null;
  return `https://quickstatements.toolforge.org/#/v1=${encoded}`;
}
