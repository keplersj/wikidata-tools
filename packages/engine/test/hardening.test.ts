import { describe, expect, it } from "vitest";
import {
  applyMapping,
  buildLookup,
  cmp,
  cmpId,
  coverageBars,
  emit,
  expandRepositoryShorthand,
  findUnmappedFields,
  formatValue,
  keyId,
  makeSnapshot,
  makeTime,
  normalizeUrl,
  plan,
  quickStatementsUrl,
  resolveEntries,
  timeFromWikidata,
  valueKey,
  valuesEqual,
} from "../src/index.js";
import type { Entry, ItemState, Mapping, Plan, Value } from "../src/index.js";

const s = (value: string): Value => ({ type: "string", value });
const u = (value: string): Value => ({ type: "url", value });
const key = { property: "P8262", value: "pkg" };
const none = { [keyId(key)]: [] as ItemState[] };
const report: Plan["report"] = { unresolved: [], skipped: [], unmappedFields: [], coverage: { entries: 0, linked: 0, wanted: 0, wantedLinked: 0, presentLinked: 0, blocked: 0 } };

describe("comparators", () => {
  it("cmp is three-way", () => {
    expect([cmp("a", "b"), cmp("b", "a"), cmp("a", "a")]).toEqual([-1, 1, 0]);
  });
  it("cmpId orders numerically, then by code units", () => {
    expect(cmpId("P10", "P9")).toBeGreaterThan(0);
    expect(cmpId("P9", "P10")).toBeLessThan(0);
    expect(cmpId("P5", "P5")).toBe(0);
    expect(cmpId("Pb", "Pa")).toBeGreaterThan(0);
    expect(cmpId("Pa", "P5")).not.toBe(0);
  });
});

describe("normalizeUrl anchoring", () => {
  it.each([
    ["https://x.org/git+y", "https://x.org/git+y"],
    ["https://x.org/p?u=git://a", "https://x.org/p?u=git://a"],
    ["https://x.org/a.git/b", "https://x.org/a.git/b"],
    ["https://x.org/a//", "https://x.org/a"],
    ["https://x.org/a.GIT", "https://x.org/a"],
    ["https://x.org/a.git//", "https://x.org/a"],
    ["see git@github.com:u/r", "see git@github.com:u/r"],
    ["https://x.org/p?next=ssh://git@h/x", "https://x.org/p?next=ssh://git@h/x"],
    ["  git+ssh://git@GitHub.com/u/r.git  ", "https://github.com/u/r"],
  ])("%s", (input, expected) => expect(normalizeUrl(input)).toBe(expected));

  it("shorthand is anchored and trimmed", () => {
    expect(expandRepositoryShorthand(" github:u/r ")).toBe("https://github.com/u/r");
    expect(expandRepositoryShorthand("x github:u/r")).toBe("x github:u/r");
    expect(expandRepositoryShorthand("github:u/r/extra")).toBe("github:u/r/extra");
    expect(expandRepositoryShorthand("u/r/extra")).toBe("u/r/extra");
    expect(expandRepositoryShorthand("GitHub:u/r")).toBe("https://github.com/u/r");
  });
});

describe("values", () => {
  it("strings are not URL-normalized", () => {
    expect(valuesEqual(s("https://x.org/"), s("https://x.org"))).toBe(false);
    expect(valuesEqual(u("https://x.org/"), u("https://x.org"))).toBe(true);
    expect(valueKey(s("git+https://x.org/a.git"))).toBe("s:git+https://x.org/a.git");
  });
  it("times truncate to date, keep the time part out, and clamp finer precisions", () => {
    expect(makeTime("2020-05-02T10:11:12Z", 11)).toEqual({ type: "time", iso: "2020-05-02", precision: 11 });
    expect(valueKey(makeTime("2020-05-02", 11))).toBe("t:2020-05-02/11");
    expect(timeFromWikidata("+2020-05-02T00:00:00Z", 11)).toMatchObject({ precision: 11 });
    expect(timeFromWikidata("+2020-05-02T00:00:00Z", 12)).toMatchObject({ precision: 11 });
    expect(timeFromWikidata("+2020-05-02T00:00:00Z", 9)).toMatchObject({ precision: 9 });
  });
  it("unresolved never equal, in either position", () => {
    const un: Value = { type: "unresolved", via: "P1", raw: "x" };
    expect(valuesEqual(un, un)).toBe(false);
    expect(valuesEqual(un, s("x"))).toBe(false);
    expect(valuesEqual(s("x"), un)).toBe(false);
  });
});

describe("emitter details", () => {
  it("trims values, labels and descriptions", () => {
    expect(formatValue(s(" x "))).toBe('"x"');
    const p: Plan = { creates: [{ key, label: " L ", description: " D ", claims: [] }], additions: [], report };
    expect(emit(p)).toBe('CREATE\nLAST\tLen\t"L"\nLAST\tDen\t"D"');
  });
  it("names unresolved values in the error", () => {
    expect(() => formatValue({ type: "unresolved", via: "P2479", raw: "MIT" })).toThrow(/P2479:MIT/);
  });
  it("sorts qualifiers, claims, items and additions regardless of input order", () => {
    const p: Plan = {
      creates: [
        { key: { property: "P8262", value: "b" }, claims: [{ property: "P1", value: s("y") }, { property: "P1", value: s("x") }, { property: "P9", value: s("z") }, { property: "P2", value: s("z") }] },
        {
          key: { property: "P8262", value: "a" },
          claims: [{ property: "P348", value: s("1"), qualifiers: [{ property: "P813", value: makeTime("2020-01-01", 11) }, { property: "P577", value: makeTime("2020-01-02", 11) }], references: [{ property: "P854", value: u("https://r") }, { property: "P813", value: makeTime("2020-01-03", 11) }] }],
        },
      ],
      additions: [
        { key: { property: "P8262", value: "d" }, qid: "Q9", claims: [{ property: "P2", value: s("1") }, { property: "P1", value: s("1") }] },
        { key: { property: "P8262", value: "c" }, qid: "Q10", claims: [{ property: "P1", value: s("1") }] },
        { key: { property: "P8262", value: "c" }, qid: "Q2", claims: [{ property: "P1", value: s("2") }] },
      ],
      report,
    };
    expect(emit(p).split("\n")).toEqual([
      "CREATE",
      'LAST\tP348\t"1"\tP577\t+2020-01-02T00:00:00Z/11\tP813\t+2020-01-01T00:00:00Z/11\tS813\t+2020-01-03T00:00:00Z/11\tS854\t"https://r"',
      "CREATE",
      'LAST\tP1\t"x"',
      'LAST\tP1\t"y"',
      'LAST\tP2\t"z"',
      'LAST\tP9\t"z"',
      'Q2\tP1\t"2"',
      'Q10\tP1\t"1"',
      'Q9\tP1\t"1"',
      'Q9\tP2\t"1"',
    ]);
  });
  it("the URL limit is inclusive", () => {
    const at = (n: number) => `Q1\tP1\t"${"x".repeat(n)}"`;
    // encoded length is 3 chars ("%7C") per tab + literal chars; find the exact boundary.
    let n = 5900;
    while (encodeURIComponent(at(n).replace(/\t/g, "|")).length < 6000) n++;
    expect(encodeURIComponent(at(n).replace(/\t/g, "|")).length).toBe(6000);
    expect(quickStatementsUrl(at(n))).not.toBeNull();
    expect(quickStatementsUrl(at(n + 1))).toBeNull();
  });
});

describe("diff details", () => {
  const entry = (claims: Entry["claims"], extra: Partial<Entry> = {}): Entry => ({ key, claims, ...extra });

  it("picks label/description independent of entry order", () => {
    const a = entry([], { label: "b", description: "y" });
    const b = entry([], { label: "a", description: "z" });
    for (const list of [[a, b], [b, a]]) {
      const created = plan(list, none).creates[0];
      expect([created?.label, created?.description]).toEqual(["a", "y"]);
    }
  });

  it("does not duplicate a key claim the mapping already supplies, and adds it when absent", () => {
    const withKey = plan([entry([{ property: "P8262", value: s("pkg") }])], none).creates[0];
    expect(withKey?.claims).toHaveLength(1);
    const without = plan([entry([{ property: "P1", value: s("x") }])], none).creates[0];
    expect(without?.claims.map((c) => c.property)).toEqual(["P1", "P8262"]);
    const other = plan([entry([{ property: "P8262", value: s("different") }])], none).creates[0];
    expect(other?.claims).toHaveLength(2);
  });

  it("omits empty qualifier/reference lists", () => {
    const claim = plan([entry([{ property: "P1", value: s("x") }])], none).creates[0]?.claims[0];
    expect(claim).toEqual({ property: "P1", value: s("x") });
  });

  it("merging duplicates unions references (deduped) and keeps the finer time in either order", () => {
    const r1 = { property: "P854", value: u("https://r1") };
    const r2 = { property: "P854", value: u("https://r2") };
    const coarse = { property: "P348", value: s("1"), qualifiers: [{ property: "P577", value: makeTime("2020-01-01", 9) }], references: [r1] };
    const fine = { property: "P348", value: s("1"), qualifiers: [{ property: "P577", value: makeTime("2020-03-04", 11) }], references: [r1, r2] };
    for (const list of [[coarse, fine], [fine, coarse]]) {
      const claim = plan([entry(list)], none).creates[0]?.claims.find((c) => c.property === "P348");
      expect(claim?.references).toEqual([r1, r2]);
      expect(claim?.qualifiers).toEqual([{ property: "P577", value: makeTime("2020-03-04", 11) }]);
    }
  });

  it("equal-at-precision times merge to the same value in either order (fast-check regression)", () => {
    const mk = (iso: string): Entry["claims"][number] => ({ property: "P1324", value: u("https://a"), qualifiers: [{ property: "P813", value: makeTime(iso, 10) }] });
    for (const list of [[mk("2020-01-30"), mk("2020-01-02")], [mk("2020-01-02"), mk("2020-01-30")]]) {
      expect(plan([entry(list)], none).creates[0]?.claims[0]?.qualifiers).toEqual([{ property: "P813", value: makeTime("2020-01-02", 10) }]);
    }
  });

  it("claims that differ only in value are kept apart; same value on different properties too", () => {
    const c = plan([entry([{ property: "P1", value: s("x") }, { property: "P1", value: s("y") }, { property: "P2", value: s("x") }])], none).creates[0];
    expect(c?.claims).toHaveLength(4); // + key
  });

  it("an existing qualifier on ANY equal statement counts", () => {
    const st: ItemState = { qid: "Q1", claims: { P348: [{ value: s("1"), qualifiers: {} }, { value: s("1"), qualifiers: { P577: [makeTime("2020-01-02", 11)] } }] } };
    const p = plan([entry([{ property: "P348", value: s("1"), qualifiers: [{ property: "P577", value: makeTime("2020-01-02", 11) }] }])], { [keyId(key)]: [st] });
    expect(p.additions).toEqual([]);
    expect(p.report.coverage.presentLinked).toBe(1);
  });

  it("a qualifier with a different value than the existing one is added", () => {
    const st: ItemState = { qid: "Q1", claims: { P348: [{ value: s("1"), qualifiers: { P577: [makeTime("2020-01-02", 11)] } }] } };
    const p = plan([entry([{ property: "P348", value: s("1"), qualifiers: [{ property: "P577", value: makeTime("2021-01-02", 11) }] }])], { [keyId(key)]: [st] });
    expect(emit(p)).toBe('Q1\tP348\t"1"\tP577\t+2021-01-02T00:00:00Z/11');
  });

  it("only the missing qualifiers are emitted", () => {
    const st: ItemState = { qid: "Q1", claims: { P348: [{ value: s("1"), qualifiers: { P577: [makeTime("2020-01-02", 11)] } }] } };
    const p = plan([entry([{ property: "P348", value: s("1"), qualifiers: [{ property: "P577", value: makeTime("2020-01-02", 11) }, { property: "P813", value: makeTime("2026-01-01", 11) }] }])], { [keyId(key)]: [st] });
    expect(emit(p)).toBe('Q1\tP348\t"1"\tP813\t+2026-01-01T00:00:00Z/11');
  });

  it("coverage: duplicates count once, blocked counts distinct unresolved, unsafe counts as wanted", () => {
    const st: ItemState = { qid: "Q1", claims: { P1: [{ value: s("x"), qualifiers: {} }] } };
    const un = (raw: string): Entry["claims"][number] => ({ property: "P275", value: { type: "unresolved", via: "P2479", raw } });
    const p = plan([entry([{ property: "P1", value: s("x") }, { property: "P1", value: s("x") }, un("a"), un("a"), un("b"), { property: "P2", value: s('q"') }, { property: "P2", value: s('q"') }])], { [keyId(key)]: [st] });
    expect(p.report.coverage).toEqual({ entries: 1, linked: 1, wanted: 4, wantedLinked: 4, presentLinked: 1, blocked: 2 });
    expect(p.report.unresolved.map((x) => x.raw)).toEqual(["a", "b"]);
  });

  it("reports are sorted and de-duplicated", () => {
    const a: Entry = { key: { property: "P8262", value: "a" }, claims: [{ property: "P275", value: { type: "unresolved", via: "P2479", raw: "z" } }, { property: "P275", value: { type: "unresolved", via: "P2479", raw: "m" } }, { property: "P1", value: s('b"d') }] };
    const b: Entry = { key: { property: "P8262", value: "b" }, claims: [{ property: "P275", value: { type: "unresolved", via: "P2479", raw: "a" } }] };
    const p1 = plan([b, a], {});
    const p2 = plan([a, b], {});
    expect(p1.report).toEqual(p2.report);
    expect(p1.report.unresolved.map((x) => `${x.key.value}:${x.raw}`)).toEqual(["a:m", "a:z", "b:a"]);
    expect(p1.report.skipped).toEqual([{ key: a.key, property: "P1", reason: "unsafe-for-quickstatements", detail: 'b"d' }]);
  });

  it("an unsafe label skips the create with the exact reason", () => {
    const p = plan([entry([], { label: 'a"b' })], none);
    expect(p.report.skipped).toEqual([{ key, reason: "unsafe-for-quickstatements", detail: 'a"b' }]);
  });

  it("over-long labels block the create; over-long descriptions are dropped and reported", () => {
    const long = "x".repeat(251);
    const ok = "y".repeat(250);
    expect(plan([entry([], { label: long })], none).creates).toEqual([]);
    expect(plan([entry([], { label: long })], none).report.skipped[0]).toMatchObject({ reason: "too-long" });
    const p = plan([entry([], { label: ok, description: long })], none);
    expect(p.creates[0]?.label).toBe(ok);
    expect(p.creates[0]?.description).toBeUndefined();
    expect(p.report.skipped).toEqual([{ key, property: "description", reason: "too-long", detail: long }]);
    expect(plan([entry([], { description: ok })], none).creates[0]?.description).toBe(ok);
  });

  it("a safe description is kept", () => {
    expect(plan([entry([], { description: "fine" })], none).creates[0]?.description).toBe("fine");
    expect(plan([entry([])], none).creates[0]).not.toHaveProperty("description");
    expect(plan([entry([])], none).creates[0]).not.toHaveProperty("label");
  });

  it("plans are canonical: identical regardless of input order", () => {
    const e = (name: string, v: string): Entry => ({ key: { property: "P8262", value: name }, claims: [{ property: "P2", value: s(v) }, { property: "P1", value: s(v), qualifiers: [{ property: "P813", value: makeTime("2020-01-01", 11) }, { property: "P577", value: makeTime("2020-01-01", 11) }] }] });
    const list = [e("c", "1"), e("a", "2"), e("b", "3")];
    expect(JSON.stringify(plan([...list].reverse(), {}))).toBe(JSON.stringify(plan(list, {})));
  });
});

describe("resolver details", () => {
  it("resolves qualifiers and references; leaves claims without them alone", () => {
    const e: Entry = { key, claims: [{ property: "P1", value: s("x") }, { property: "P2", value: s("y"), qualifiers: [{ property: "P3", value: { type: "unresolved", via: "P8262", raw: "q" } }], references: [{ property: "P4", value: { type: "unresolved", via: "P8262", raw: "r" } }] }] };
    const [out] = resolveEntries([e], buildLookup([{ via: "P8262", raw: "q", qid: "Q1" }, { via: "P8262", raw: "r", qid: "Q2" }]));
    expect(out?.claims[0]).toEqual({ property: "P1", value: s("x") });
    expect(out?.claims[1]?.qualifiers?.[0]?.value).toEqual({ type: "item", qid: "Q1" });
    expect(out?.claims[1]?.references?.[0]?.value).toEqual({ type: "item", qid: "Q2" });
  });
});

describe("mapping details", () => {
  const m = (rows: Mapping["rows"], extra: Partial<Mapping> = {}): Mapping => ({ version: "t", rows, references: [], ignore: [], ...extra });
  const run = (mapping: Mapping, fields: Record<string, unknown>) => applyMapping(mapping, { key, fields }, { runDate: "2026-11-11" });

  it("reads dotted paths through null and non-objects without throwing", () => {
    const mapping = m([{ id: "b", field: "bugs.url", property: "P1", value: { as: "url" } }]);
    expect(run(mapping, { bugs: null }).claims).toEqual([]);
    expect(run(mapping, { bugs: "str" }).claims).toEqual([]);
    expect(run(mapping, { bugs: { url: "https://b" } }).claims).toHaveLength(1);
  });

  it("accepts strings and numbers, rejects other types and blanks", () => {
    const mapping = m([{ id: "x", field: "x", property: "P1", value: { as: "string" } }]);
    expect(run(mapping, { x: 5 }).claims[0]?.value).toEqual(s("5"));
    expect(run(mapping, { x: true }).claims).toEqual([]);
    expect(run(mapping, { x: { a: 1 } }).claims).toEqual([]);
    expect(run(mapping, { x: null }).claims).toEqual([]);
    expect(run(mapping, { x: undefined }).claims).toEqual([]);
    expect(run(mapping, { x: ["", " a "] }).claims.map((c) => c.value)).toEqual([s("a")]);
  });

  it("time-day and qid are anchored", () => {
    const t = m([{ id: "t", field: "t", property: "P1", value: { as: "time-day" } }]);
    expect(run(t, { t: "x2020-01-02" }).claims).toEqual([]);
    expect(run(t, { t: "2020-01-02T10:00:00Z" }).claims[0]?.value).toEqual(makeTime("2020-01-02", 11));
    const q = m([{ id: "q", field: "q", property: "P1", value: { as: "qid" } }]);
    for (const bad of ["Q5x", "xQ5", "Q", "5"]) expect(run(q, { q: bad }).claims).toEqual([]);
    expect(run(q, { q: "Q12" }).claims).toHaveLength(1);
  });

  it("fills reference templates from the key, fields, and blank for unknown names", () => {
    const mapping = m([], { references: [{ property: "P854", kind: "url-template", template: "https://x/{key}/{slug}/{nope}" }] });
    const e = run(mapping, { slug: "s" });
    expect(e.claims).toEqual([]);
    const withClaim = m([{ id: "x", field: "x", property: "P1", value: { as: "string" } }], { references: [{ property: "P854", kind: "url-template", template: "https://x/{key}/{slug}/{nope}" }] });
    expect(run(withClaim, { x: "1", slug: "s" }).claims[0]?.references?.[0]?.value).toEqual(u("https://x/pkg/s/"));
  });

  it("the run date must be exactly YYYY-MM-DD", () => {
    const mapping = m([]);
    for (const bad of ["2026-11-11x", "x2026-11-11", "2026-1-1", ""]) {
      expect(() => applyMapping(mapping, { key, fields: {} }, { runDate: bad })).toThrow(/runDate/);
    }
  });

  it("text rows only set what is present", () => {
    const mapping = m([{ id: "l", field: "name", target: "label" }]);
    expect(run(mapping, { name: "n" }).label).toBe("n");
    expect(run(mapping, {})).not.toHaveProperty("label");
    expect(run(mapping, { name: " " })).not.toHaveProperty("label");
  });

  it("unmapped fields ignore null/undefined, and are sorted", () => {
    const mapping = m([{ id: "a", field: "a.b", property: "P1", value: { as: "string" } }], { ignore: ["i"] });
    expect(findUnmappedFields(mapping, [{ key, fields: { z: 1, y: 1, a: 1, i: 1, n: null, u: undefined } }])).toEqual(["y", "z"]);
  });
});

describe("coverage", () => {
  it("bars are ratios, zero-safe", () => {
    const b = coverageBars({ entries: 4, linked: 1, wanted: 10, wantedLinked: 5, presentLinked: 4, blocked: 2 });
    expect(b.linked).toEqual({ numerator: 1, denominator: 4, ratio: 0.25 });
    expect(b.complete).toEqual({ numerator: 4, denominator: 5, ratio: 0.8 });
    expect(b.blocked).toEqual({ numerator: 2, denominator: 10, ratio: 0.2 });
    expect(coverageBars({ entries: 0, linked: 0, wanted: 0, wantedLinked: 0, presentLinked: 0, blocked: 0 }).linked.ratio).toBe(0);
  });
  it("snapshots record date, tool, mapping version, counts, and inputs when given", () => {
    const p = plan([{ key, claims: [{ property: "P1", value: s("x") }] }], none);
    const snap = makeSnapshot({ date: "2026-11-11", tool: "npm", mappingVersion: "v1", plan: p, inputs: { names: ["a"] } });
    expect(snap).toEqual({ date: "2026-11-11", tool: "npm", mappingVersion: "v1", coverage: p.report.coverage, counts: { creates: 1, additions: 0, unresolved: 0, skipped: 0 }, inputs: { names: ["a"] } });
    expect(makeSnapshot({ date: "d", tool: "t", mappingVersion: "v", plan: p })).not.toHaveProperty("inputs");
    const withAdds = plan([{ key, claims: [{ property: "P1", value: s("x") }, { property: "P2", value: s("y") }] }], { [keyId(key)]: [{ qid: "Q1", claims: {} }] });
    expect(makeSnapshot({ date: "d", tool: "t", mappingVersion: "v", plan: withAdds }).counts.additions).toBe(2);
  });
});
