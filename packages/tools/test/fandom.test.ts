import { applyQuickStatements, indexStates, plan, type ItemState } from "@wdt/engine";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkCoverage,
  checkSnapshot,
  parseFandomConfig,
  runFandomCategoryMap,
  runFandomCheck,
  slugOf,
  type FandomArticle,
  type FetchLike,
  type SparqlBinding,
  type WikidataClient,
} from "../src/index.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/fandom/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
const page1 = read("articles-page1.json");
const page2 = read("articles-page2.json");
const wd = read("wikidata.json") as {
  values: string[];
  items: Record<string, string>;
  entities: Record<string, Record<string, unknown>>;
};
const articles = [...(page1.items as FandomArticle[]), ...(page2.items as FandomArticle[])];

/** Fake Fandom API serving the synthetic fixtures. */
const fandomFetch: FetchLike = async (url) => {
  const u = new URL(url);
  const category = u.searchParams.get("category");
  const offset = u.searchParams.get("offset");
  const body = category === "Droids" ? read("category-droids.json")
    : category === "Characters" ? read("category-characters.json")
    : offset ? page2 : page1;
  return { ok: true, status: 200, json: async () => body };
};

/** Fake Wikidata: answers the queries the Fandom tools make from wikidata.json. */
const binding = (v: string, qid?: string): SparqlBinding => ({
  v: { type: "literal", value: v },
  ...(qid ? { item: { type: "uri", value: `http://www.wikidata.org/entity/${qid}` } } : {}),
});
const wikidata: WikidataClient = {
  async sparql(q) {
    if (q.includes("STRSTARTS")) return wd.values.map((v) => binding(v));
    const asked = [...q.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
    return asked.filter((v) => wd.items[v]).map((v) => binding(v, wd.items[v]));
  },
  async getEntities(ids) {
    return ids.flatMap((id) => (wd.entities[id] ? [wd.entities[id] as Record<string, unknown>] : []));
  },
};

/** The old fandom-check, verbatim in behaviour: compares article TITLES to stored values. */
function legacyCheck(wiki: string, list: FandomArticle[], values: string[]) {
  const prefix = `${wiki}:`;
  const stored = [...new Set(values.map((v) => v.replace(prefix, "")).sort())];
  const titles = list.map((a) => a.title);
  const linked = titles.filter((t) => stored.includes(t)).length;
  return { total: titles.length, linked, percent: (linked / titles.length) * 100 };
}

describe("slugOf", () => {
  it("uses the URL slug, not the title", () => {
    expect(slugOf({ url: "/wiki/Anakin_Skywalker" })).toBe("Anakin_Skywalker");
    expect(slugOf({ url: "/wiki/R2-D2" })).toBe("R2-D2");
  });
});

describe("Fandom check", () => {
  it("legacy (title-based) numbers on the fixture", () => {
    // Multi-word titles never match their underscored slugs, so only R2-D2 counted.
    expect(legacyCheck("examplewiki", articles, wd.values)).toEqual({ total: 5, linked: 1, percent: 20 });
  });

  it("slug-based numbers differ from the legacy ones exactly where titles contain spaces", () => {
    const check = checkCoverage("examplewiki", articles, wd.values);
    expect(check).toMatchObject({ total: 5, linked: 2, notLinked: 3, ratio: 0.4 });
    expect(check.missing).toEqual(["C-3PO", "Padme_Amidala", "Tatooine"]);
  });

  it("agrees with the legacy check when every title equals its slug", () => {
    const simple: FandomArticle[] = [
      { id: 1, title: "R2-D2", url: "/wiki/R2-D2", ns: 0 },
      { id: 2, title: "Tatooine", url: "/wiki/Tatooine", ns: 0 },
    ];
    expect(checkCoverage("examplewiki", simple, wd.values).linked).toBe(legacyCheck("examplewiki", simple, wd.values).linked);
  });

  it("makes a snapshot with the run date and counts", () => {
    const snap = checkSnapshot(checkCoverage("examplewiki", articles, wd.values), "2026-11-11");
    expect(snap).toMatchObject({ date: "2026-11-11", tool: "fandom-check", coverage: { entries: 5, linked: 2 }, inputs: { wiki: "examplewiki" } });
  });

  it("follows pagination and reads Wikidata once", async () => {
    const check = await runFandomCheck({ client: wikidata, fetchFandom: fandomFetch }, "examplewiki");
    expect(check).toMatchObject({ total: 5, linked: 2 });
  });
});

describe("Fandom category map", () => {
  const config = parseFandomConfig({
    wiki: "examplewiki",
    categories: [{ name: "Droids", instanceOf: "Q100" }, { name: "Characters", instanceOf: "Q101" }],
  });
  const run = () => runFandomCategoryMap({ client: wikidata, fetchFandom: fandomFetch }, config, "2026-11-11");

  it("creates only unlinked articles, keyed by slug, and backfills P31 on existing items", async () => {
    const r = await run();
    await expect(r.text).toMatchFileSnapshot("./__snapshots__/fandom.qs.txt");
  });

  it("is idempotent", async () => {
    const r = await run();
    const existing: ItemState[] = [...new Map(Object.values(r.current).flat().map((s) => [s.qid, s])).values()];
    const after = applyQuickStatements(r.text, existing);
    const second = plan(r.wanted, indexStates(after, ["P6262"]));
    expect(second.creates).toEqual([]);
    expect(second.additions).toEqual([]);
  });

  it("never matches by label: an article is linked only through its P6262 slug", async () => {
    const r = await run();
    expect(r.plan.creates.map((c) => c.key.value)).toEqual(["examplewiki:C-3PO", "examplewiki:Padme_Amidala"]);
  });
});

describe("parseFandomConfig", () => {
  it("rejects bad configs", () => {
    expect(() => parseFandomConfig({})).toThrow(/wiki/);
    expect(() => parseFandomConfig({ wiki: "x", categories: [] })).toThrow(/categories/);
    expect(() => parseFandomConfig({ wiki: "x", categories: [{ name: "A", instanceOf: "droid" }] })).toThrow(/QID/);
  });
});
