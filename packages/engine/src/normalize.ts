import type { Key, TimePrecision, Value } from "./types.js";

/** Code-unit comparison. Never use localeCompare: output must not depend on locale. */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorts P-ids and Q-ids numerically ("P348" < "P1401"), falling back to code units. */
export function cmpId(a: string, b: string): number {
  const na = Number(a.slice(1));
  const nb = Number(b.slice(1));
  if (Number.isInteger(na) && Number.isInteger(nb) && na !== nb) return na - nb;
  return cmp(a, b);
}

export function normalizeString(s: string): string {
  return s.trim();
}

const SCHEME_HOST = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i;

/**
 * Canonical URL for comparison and for the repository mapping:
 * strips `git+`, turns `git://`, `ssh://git@host/` and `git@host:path` into
 * `https://`, lowercases scheme and host, drops `.git` and trailing slashes.
 * Path case, query and fragment are left alone.
 */
export function normalizeUrl(input: string): string {
  let s = input.trim();
  s = s.replace(/^git\+/i, "");
  // scp-like: git@github.com:user/repo.git
  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+)$/.exec(s);
  if (scp) s = `https://${scp[1]}/${scp[2]}`;
  s = s.replace(/^git:\/\//i, "https://");
  s = s.replace(/^ssh:\/\/git@/i, "https://");
  const m = SCHEME_HOST.exec(s);
  if (!m) return s;
  const scheme = (m[1] ?? "").toLowerCase();
  const host = (m[2] ?? "").toLowerCase();
  const rest = m[3] ?? "";
  const tail = /[?#]/.exec(rest);
  let path = tail ? rest.slice(0, tail.index) : rest;
  const suffix = tail ? rest.slice(tail.index) : "";
  path = path.replace(/\/+$/, "");
  path = path.replace(/\.git$/i, "");
  path = path.replace(/\/+$/, "");
  return `${scheme}://${host}${path}${suffix}`;
}

/** npm-style repository shorthand: `github:user/repo` and bare `user/repo` mean GitHub. */
export function expandRepositoryShorthand(input: string): string {
  const s = input.trim();
  const prefixed = /^(github|gitlab|bitbucket):([\w.-]+\/[\w.-]+)$/i.exec(s);
  if (prefixed) {
    const host = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" }[
      (prefixed[1] ?? "").toLowerCase() as "github" | "gitlab" | "bitbucket"
    ];
    return `https://${host}/${prefixed[2]}`;
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return `https://github.com/${s}`;
  return s;
}

const TIME_RE = /^([+-])?(\d{1,})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/;

/** `YYYY-MM-DD` truncated to the precision (year → `YYYY`, month → `YYYY-MM`). */
export function truncateTime(iso: string, precision: TimePrecision): string {
  if (precision === 9) return iso.slice(0, 4);
  if (precision === 10) return iso.slice(0, 7);
  return iso.slice(0, 10);
}

export function makeTime(iso: string, precision: TimePrecision): Value {
  const m = TIME_RE.exec(iso.trim());
  if (!m || m[1] === "-") throw new Error(`Unsupported time: ${iso}`);
  const year = (m[2] ?? "").padStart(4, "0");
  const month = m[3] === "00" ? "01" : m[3];
  const day = m[4] === "00" ? "01" : m[4];
  return { type: "time", iso: `${year}-${month}-${day}`, precision };
}

/**
 * Parses a Wikidata time literal (`+2020-01-00T00:00:00Z`) and precision.
 * Returns null for BCE dates and precisions coarser than a year, which we
 * never emit. Precisions finer than a day are treated as a day.
 */
export function timeFromWikidata(time: string, precision: number): Value | null {
  if (precision < 9 || time.startsWith("-")) return null;
  const p: TimePrecision = precision >= 11 ? 11 : (precision as TimePrecision);
  try {
    return makeTime(time, p);
  } catch {
    return null;
  }
}

/** Two times are equal at the coarser of their two precisions. */
export function timesEqual(
  a: { iso: string; precision: TimePrecision },
  b: { iso: string; precision: TimePrecision },
): boolean {
  const p = Math.min(a.precision, b.precision) as TimePrecision;
  return truncateTime(a.iso, p) === truncateTime(b.iso, p);
}

/** Stable string for a value, used for sorting and (except for times) equality. */
export function valueKey(v: Value): string {
  switch (v.type) {
    case "string":
      return `s:${normalizeString(v.value)}`;
    case "url":
      return `u:${normalizeUrl(v.value)}`;
    case "item":
      return `i:${v.qid}`;
    case "time":
      return `t:${truncateTime(v.iso, v.precision)}/${v.precision}`;
    case "unresolved":
      return `x:${v.via}:${v.raw}`;
  }
}

/** Value-level equality after normalization. Unresolved values never equal anything. */
export function valuesEqual(a: Value, b: Value): boolean {
  if (a.type === "unresolved" || b.type === "unresolved") return false;
  if (a.type === "time" && b.type === "time") return timesEqual(a, b);
  if (a.type !== b.type) return false;
  return valueKey(a) === valueKey(b);
}

export function keyId(key: Key): string {
  return `${key.property}=${normalizeString(key.value)}`;
}

export function cmpKey(a: Key, b: Key): number {
  return cmpId(a.property, b.property) || cmp(normalizeString(a.value), normalizeString(b.value));
}
