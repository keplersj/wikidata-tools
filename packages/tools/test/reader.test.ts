import { describe, expect, it } from "vitest";
import {
  chunk,
  createWikidataClient,
  parseEntity,
  parseSnak,
  readCurrent,
  readLookup,
  verifyLookup,
  type FetchLike,
  type SparqlBinding,
  type WikidataClient,
} from "../src/index.js";

const snak = (datatype: string, type: string, value: unknown, snaktype = "value") => ({
  snaktype,
  datatype,
  datavalue: { type, value },
});

describe("parseSnak", () => {
  it("maps datatypes to values", () => {
    expect(parseSnak(snak("external-id", "string", "x"))).toEqual({ type: "string", value: "x" });
    expect(parseSnak(snak("url", "string", "https://a"))).toEqual({ type: "url", value: "https://a" });
    expect(parseSnak(snak("wikibase-item", "wikibase-entityid", { id: "Q5" }))).toEqual({ type: "item", qid: "Q5" });
    expect(parseSnak(snak("wikibase-item", "wikibase-entityid", { id: "P5" }))).toBeNull();
    expect(parseSnak(snak("time", "time", { time: "+2020-05-00T00:00:00Z", precision: 10 }))).toEqual({
      type: "time",
      iso: "2020-05-01",
      precision: 10,
    });
  });
  it("ignores novalue/somevalue and unsupported types", () => {
    expect(parseSnak({ snaktype: "novalue" })).toBeNull();
    expect(parseSnak(snak("quantity", "quantity", { amount: "+1" }))).toBeNull();
  });
});

describe("parseEntity", () => {
  it("keeps every rank and parses qualifiers", () => {
    const state = parseEntity({
      id: "Q7",
      claims: {
        P348: [
          { rank: "deprecated", mainsnak: snak("string", "string", "1.0"), qualifiers: { P577: [snak("time", "time", { time: "+2020-01-02T00:00:00Z", precision: 11 })] } },
          { rank: "normal", mainsnak: snak("string", "string", "1.1") },
        ],
      },
    });
    expect(state?.claims.P348).toHaveLength(2);
    expect(state?.claims.P348?.[0]?.qualifiers.P577).toEqual([{ type: "time", iso: "2020-01-02", precision: 11 }]);
  });
  it("returns null for missing entities", () => {
    expect(parseEntity({ id: "Q9", missing: "" })).toBeNull();
  });
});

function fakeClient(opts: { sparql: (q: string) => SparqlBinding[]; entities?: Record<string, Record<string, unknown>> }): WikidataClient & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async sparql(q) {
      queries.push(q);
      return opts.sparql(q);
    },
    async getEntities(ids) {
      return ids.flatMap((id) => (opts.entities?.[id] ? [opts.entities[id] as Record<string, unknown>] : []));
    },
  };
}
const row = (v: string, qid: string): SparqlBinding => ({ v: { type: "literal", value: v }, item: { type: "uri", value: `http://www.wikidata.org/entity/${qid}` } });

describe("readCurrent", () => {
  it("matches by key only, includes all ranks in the query, and flags several items per key", async () => {
    const client = fakeClient({
      sparql: () => [row("a", "Q1"), row("a", "Q2"), row("b", "Q3")],
      entities: {
        Q1: { id: "Q1", claims: {} },
        Q2: { id: "Q2", claims: {} },
        Q3: { id: "Q3", claims: {} },
      },
    });
    const { current } = await readCurrent(client, [{ property: "P8262", value: "a" }, { property: "P8262", value: "b" }, { property: "P8262", value: "zzz" }]);
    expect(client.queries[0]).toContain("p:P8262/ps:P8262");
    expect(current["P8262=a"]?.map((s) => s.qid)).toEqual(["Q1", "Q2"]);
    expect(current["P8262=b"]?.map((s) => s.qid)).toEqual(["Q3"]);
    expect(current["P8262=zzz"]).toBeUndefined();
  });

  it("escapes values into SPARQL string literals and batches VALUES", async () => {
    const client = fakeClient({ sparql: () => [] });
    const keys = Array.from({ length: 120 }, (_, i) => ({ property: "P8262", value: `n${i}` }));
    keys.push({ property: "P8262", value: 'we"ird\\' });
    await readCurrent(client, keys);
    expect(client.queries).toHaveLength(3);
    expect(client.queries.join("\n")).toContain('"we\\"ird\\\\"');
  });

  it("reports items whose entity could not be loaded instead of treating them as absent", async () => {
    const client = fakeClient({ sparql: () => [row("a", "Q1")], entities: { Q1: { id: "Q1", missing: "" } } });
    expect(await readCurrent(client, [{ property: "P8262", value: "a" }])).toEqual({ current: {}, unloadable: ["P8262=a"] });
  });

  it("rejects property ids that are not P-numbers", async () => {
    await expect(readCurrent(fakeClient({ sparql: () => [] }), [{ property: "P1} #", value: "a" }])).rejects.toThrow();
  });
});

describe("readLookup", () => {
  it("returns resolutions; several matches stay ambiguous", async () => {
    const client = fakeClient({ sparql: () => [row("MIT", "Q334661"), row("dup", "Q1"), row("dup", "Q2")] });
    const lookup = await readLookup(client, [{ via: "P2479", raw: "MIT" }, { via: "P2479", raw: "dup" }]);
    expect(lookup.get("P2479\0MIT")).toEqual(["Q334661"]);
    expect(lookup.get("P2479\0dup")).toEqual(["Q1", "Q2"]);
  });
});

describe("client", () => {
  it("batches wbgetentities at 50 ids and sends Api-User-Agent to Wikimedia", async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, ...(init?.headers ? { headers: init.headers } : {}) });
      return { ok: true, status: 200, json: async () => ({ entities: {} }) };
    };
    await createWikidataClient(fetchFn).getEntities(Array.from({ length: 120 }, (_, i) => `Q${i + 1}`));
    expect(calls).toHaveLength(3);
    expect(calls[0]?.headers?.["Api-User-Agent"]).toMatch(/^KeplersWikiDataTools\/.+ \(https:\/\/wikidata\.keplersj\.com; kepler@stickajones\.org\)$/);
    expect(calls[0]?.url).toContain("origin=*");
  });
  it("requests JSON from SPARQL and throws on HTTP errors", async () => {
    const calls: string[] = [];
    const bad: FetchLike = async (url) => {
      calls.push(url);
      return { ok: false, status: 429, json: async () => ({}) };
    };
    await expect(createWikidataClient(bad).sparql("SELECT 1")).rejects.toThrow(/429/);
    expect(calls[0]).toContain("format=json");
  });
  it("chunk", () => expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]));
});

describe("verifyLookup", () => {
  it("drops QIDs whose item no longer exists (stale query service), keeps live ones", async () => {
    const client = fakeClient({
      sparql: () => [],
      entities: { Q1: { id: "Q1", claims: {} } }, // Q2 was deleted: wbgetentities has no entity for it
    });
    const lookup = new Map([
      ["P8262\0live", ["Q1"]],
      ["P8262\0gone", ["Q2"]],
      ["P8262\0both", ["Q1", "Q2"]],
    ]);
    const { lookup: out, dropped } = await verifyLookup(client, lookup);
    expect(out.get("P8262\0live")).toEqual(["Q1"]);
    expect(out.get("P8262\0gone")).toBeUndefined();
    expect(out.get("P8262\0both")).toEqual(["Q1"]);
    expect(dropped).toEqual(["Q2"]);
  });
});
