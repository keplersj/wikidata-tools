import { cmp, type Key, type SourceEntry } from "@wdt/engine";
import type { FetchLike } from "../wikidata/client.js";

export const NPM_REGISTRY = "https://registry.npmjs.org";

export type VersionFilter =
  | { mode: "all" }
  /** No prereleases. The default; see NOTES.md. */
  | { mode: "releases-only" }
  /** The `n` most recently published versions, prereleases included. */
  | { mode: "latest-n"; n: number };

export const DEFAULT_VERSION_FILTER: VersionFilter = { mode: "releases-only" };

type Packument = {
  name?: string;
  description?: string;
  homepage?: string;
  bugs?: string | { url?: string };
  repository?: string | { url?: string };
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, { dependencies?: Record<string, string> }>;
  time?: Record<string, string>;
  [field: string]: unknown;
};

const RELEASE_RE = /^\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?$/;

export const isRelease = (version: string): boolean => RELEASE_RE.test(version);

export function filterVersions(
  versions: { version: string; time?: string }[],
  filter: VersionFilter,
): { version: string; time?: string }[] {
  if (filter.mode === "all") return versions;
  if (filter.mode === "releases-only") return versions.filter((v) => isRelease(v.version));
  return [...versions]
    .sort((a, b) => cmp(b.time ?? "", a.time ?? "") || cmp(b.version, a.version))
    .slice(0, Math.max(0, Math.trunc(filter.n)));
}

function licenseOf(p: Packument): string | undefined {
  if (typeof p.license === "string") return p.license;
  if (p.license && typeof p.license === "object") return p.license.type;
  if (p.licenses?.length === 1) return p.licenses[0]?.type;
  return undefined;
}

const urlOf = (v: string | { url?: string } | undefined): string | undefined =>
  typeof v === "string" ? v : v?.url;

/** Registry URL for a package; scoped names need the slash encoded. */
export function packumentUrl(name: string, base = NPM_REGISTRY): string {
  return `${base}/${name.replace("/", "%2F")}`;
}

/** Flattens a full packument into source fields the mapping rows read. */
export function packumentToSource(p: Packument, name: string, filter: VersionFilter): SourceEntry {
  const key: Key = { property: "P8262", value: name };
  const published = Object.keys(p.versions ?? {}).map((version) => {
    const time = p.time?.[version];
    return time === undefined ? { version } : { version, time };
  });
  const latest = p["dist-tags"]?.latest;
  const deps = latest ? Object.keys(p.versions?.[latest]?.dependencies ?? {}).sort(cmp) : [];

  // Everything the registry sent stays visible, so unmapped fields show up in the run report.
  const fields: Record<string, unknown> = { ...p };
  delete fields.versions;
  delete fields.licenses;
  fields.name = name;
  fields.versions = filterVersions(published, filter);
  fields.dependencies = deps;
  const bugs = urlOf(p.bugs);
  fields.bugs = bugs ? { url: bugs } : undefined;
  fields.repository = urlOf(p.repository);
  fields.license = licenseOf(p);
  return { key, fields };
}

/** Fetches a packument; null if the registry has no such package. */
export async function fetchPackument(
  fetchFn: FetchLike,
  name: string,
  base = NPM_REGISTRY,
): Promise<Packument | null> {
  // No custom headers: npm's CORS preflight rejects them.
  const res = await fetchFn(packumentUrl(name, base));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`npm registry ${name}: HTTP ${res.status}`);
  return (await res.json()) as Packument;
}
