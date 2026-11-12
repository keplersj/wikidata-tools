import { cmp, type Mapping, type Snapshot, type SourceEntry } from "@wdt/engine";
import type { OnProgress } from "../progress.js";
import { pool, runPipeline, type ToolRun } from "../pipeline.js";
import type { FetchLike, WikidataClient } from "../wikidata/client.js";
import { allValuesWithPrefix } from "../wikidata/reader.js";
import type { FandomConfig } from "./config.js";
import {
  fandomKeyValue,
  fetchArticles,
  slugOf,
  directFandomBase,
  type FandomArticle,
  type FandomBase,
} from "./source.js";

export const FANDOM_MAPPING_VERSION = "fandom-1";

export const fandomMapping: Mapping = {
  version: FANDOM_MAPPING_VERSION,
  rows: [
    { id: "label", field: "title", target: "label" },
    { id: "key", field: "keyValue", property: "P6262", value: { as: "string" } },
    { id: "class", field: "instanceOf", property: "P31", value: { as: "qid" } },
  ],
  references: [
    { property: "P854", kind: "url-template", template: "https://{wiki}.fandom.com/wiki/{slug}" },
    { property: "P813", kind: "run-date" },
  ],
  ignore: ["wiki", "slug", "id", "ns", "url"],
};

export type FandomCheck = {
  wiki: string;
  total: number;
  linked: number;
  notLinked: number;
  /** 0..1 */
  ratio: number;
  /** Slugs without an item, sorted. */
  missing: string[];
};

/** Pure: articles on the wiki vs. P6262 values on Wikidata (`wiki:Slug`). Compared by slug. */
export function checkCoverage(wiki: string, articles: FandomArticle[], wikidataValues: string[]): FandomCheck {
  const have = new Set(wikidataValues);
  const slugs = [...new Set(articles.map(slugOf))].sort(cmp);
  const missing = slugs.filter((s) => !have.has(fandomKeyValue(wiki, s)));
  const linked = slugs.length - missing.length;
  return {
    wiki,
    total: slugs.length,
    linked,
    notLinked: missing.length,
    ratio: slugs.length === 0 ? 0 : linked / slugs.length,
    missing,
  };
}

export const FANDOM_CHECK_VERSION = "fandom-check-1";

/** Snapshot for a check run (there is no Plan to hand to makeSnapshot). `date` is an input. */
export function checkSnapshot(check: FandomCheck, date: string): Snapshot {
  return {
    date,
    tool: "fandom-check",
    mappingVersion: FANDOM_CHECK_VERSION,
    coverage: { entries: check.total, linked: check.linked, wanted: 0, wantedLinked: 0, presentLinked: 0, blocked: 0 },
    counts: { creates: 0, additions: 0, unresolved: 0, skipped: 0 },
    inputs: { wiki: check.wiki },
  };
}

type Deps = { client: WikidataClient; fetchFandom: FetchLike; base?: FandomBase; onProgress?: OnProgress };

/** Check: articles with an item vs. articles total, for a whole wiki. */
export async function runFandomCheck(deps: Deps, wiki: string): Promise<FandomCheck> {
  const stage = `Listing articles on ${wiki}`;
  deps.onProgress?.({ stage });
  const articles = await fetchArticles(deps.fetchFandom, wiki, {
    ...(deps.base ? { base: deps.base } : {}),
    onPage: (n) => deps.onProgress?.({ stage: `${stage} (${n} so far)` }),
  });
  deps.onProgress?.({ stage: "Reading Fandom article IDs (P6262) from Wikidata" });
  const values = await allValuesWithPrefix(deps.client, "P6262", `${wiki}:`);
  return checkCoverage(wiki, articles, values);
}

/**
 * Category map: CREATE items (label + P6262) for articles in the configured
 * categories that have none, and backfill P31 from the class mapping onto
 * existing items.
 */
export async function runFandomCategoryMap(
  deps: Deps,
  config: FandomConfig,
  runDate: string,
): Promise<ToolRun> {
  const base = deps.base ?? directFandomBase;
  const seen = new Map<string, number>();
  const report = () => {
    const n = [...seen.values()].reduce((a, b) => a + b, 0);
    deps.onProgress?.({ stage: `Listing category articles on ${config.wiki} (${n} so far, ${seen.size} of ${config.categories.length} categories started)` });
  };
  deps.onProgress?.({ stage: `Listing category articles on ${config.wiki}` });
  const perCategory = await pool(config.categories, 3, async (cat) => ({
    cat,
    articles: await fetchArticles(deps.fetchFandom, config.wiki, {
      category: cat.name,
      base,
      onPage: (n) => {
        seen.set(cat.name, n);
        report();
      },
    }),
  }));

  const bySlug = new Map<string, { title: string; instanceOf: Set<string> }>();
  for (const { cat, articles } of perCategory) {
    for (const a of articles) {
      const slug = slugOf(a);
      const row = bySlug.get(slug) ?? { title: a.title, instanceOf: new Set<string>() };
      if (cat.instanceOf) row.instanceOf.add(cat.instanceOf);
      bySlug.set(slug, row);
    }
  }
  const entries: SourceEntry[] = [...bySlug]
    .sort(([a], [b]) => cmp(a, b))
    .map(([slug, row]) => ({
      key: { property: "P6262", value: fandomKeyValue(config.wiki, slug) },
      fields: {
        wiki: config.wiki,
        slug,
        title: row.title,
        keyValue: fandomKeyValue(config.wiki, slug),
        instanceOf: [...row.instanceOf].sort(cmp),
      },
    }));

  return runPipeline({
    tool: "fandom-category-map",
    client: deps.client,
    mapping: fandomMapping,
    entries,
    runDate,
    ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
    inputs: { wiki: config.wiki, categories: config.categories },
  });
}
