import { applyQuickStatements, indexStates, plan, type ItemState } from "@wdt/engine";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkCoverage,
  checkSnapshot,
  fetchArticles,
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
const pagesOf = (b: Record<string, unknown>) => (b.query as { allpages: FandomArticle[] }).allpages;
const articles = [...pagesOf(page1), ...pagesOf(page2)];

/** Fake api.php serving the synthetic fixtures; records the URLs asked for. */
const asked: string[] = [];
const fandomFetch: FetchLike = async (url) => {
  asked.push(url);
  const u = new URL(url);
  const title = u.searchParams.get("cmtitle");
  const body = title === "Category:Droids" ? read("category-droids.json")
    : title === "Category:Characters" ? read("category-characters.json")
    : u.searchParams.get("apcontinue") ? page2 : page1;
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
  it("turns titles into the underscored, decoded slugs Wikidata stores", () => {
    expect(slugOf({ title: "Anakin Skywalker" })).toBe("Anakin_Skywalker");
    expect(slugOf({ title: "R2-D2" })).toBe("R2-D2");
    // Real P6262 values seen on Wikidata, 2026-11-11: decoded, not percent-encoded.
    expect(slugOf({ title: "Dennis Brännvall" })).toBe("Dennis_Brännvall");
    expect(slugOf({ title: "Katy O'Brian" })).toBe("Katy_O'Brian");
    expect(slugOf({ title: "Chewbacca/Legends" })).toBe("Chewbacca/Legends");
    expect(slugOf({ title: " Padme Amidala " })).toBe("Padme_Amidala");
  });
});

describe("fetchArticles (MediaWiki api.php)", () => {
  it("parses a real recorded allpages response", async () => {
    const real = read("real-allpages-sample.json") as { query: { allpages: FandomArticle[] } };
    expect(real.query.allpages[0]).toMatchObject({ ns: 0 });
    expect(real.query.allpages.every((a) => typeof a.title === "string")).toBe(true);
  });

  it("follows `continue` and asks for non-redirect main-namespace pages with origin=*", async () => {
    asked.length = 0;
    const list = await fetchArticles(fandomFetch, "examplewiki");
    expect(list.map((a) => a.title)).toEqual(["Anakin Skywalker", "C-3PO", "Padme Amidala", "R2-D2", "Tatooine"]);
    expect(asked).toHaveLength(2);
    const first = new URL(asked[0] as string);
    expect(first.origin + first.pathname).toBe("https://examplewiki.fandom.com/api.php");
    expect(Object.fromEntries(first.searchParams)).toMatchObject({ list: "allpages", apnamespace: "0", apfilterredir: "nonredirects", origin: "*", format: "json" });
    expect(new URL(asked[1] as string).searchParams.get("apcontinue")).toBe("Padme_Amidala");
    expect(new URL(asked[1] as string).searchParams.get("continue")).toBe("-||");
  });

  it("lists a category, with or without the Category: prefix", async () => {
    for (const name of ["Droids", "Category:Droids"]) {
      asked.length = 0;
      expect((await fetchArticles(fandomFetch, "examplewiki", { category: name })).map((a) => a.title)).toEqual(["C-3PO", "R2-D2"]);
      expect(new URL(asked[0] as string).searchParams.get("cmtitle")).toBe("Category:Droids");
    }
  });

  it("surfaces API errors and HTTP failures, and rejects odd wiki names", async () => {
    const err: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({ error: { code: "badtitle", info: "nope" } }) });
    await expect(fetchArticles(err, "examplewiki")).rejects.toThrow(/badtitle: nope/);
    const bad: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await expect(fetchArticles(bad, "examplewiki")).rejects.toThrow(/403/);
    await expect(fetchArticles(fandomFetch, "evil.com/x")).rejects.toThrow(/wiki name/);
  });
});

describe("Fandom check", () => {
  it("legacy (title-based) numbers on the fixture", () => {
    expect(legacyCheck.name).toBe("legacyCheck");
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
      { title: "R2-D2", ns: 0 },
      { title: "Tatooine", ns: 0 },
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
