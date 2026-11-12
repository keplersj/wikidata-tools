import { describe, expect, it } from "vitest";
import { emit, indexStates, isEmptyPlan, keyId, makeTime, plan } from "../src/index.js";
import type { Entry, ItemState, Value } from "../src/index.js";

const s = (value: string): Value => ({ type: "string", value });
const u = (value: string): Value => ({ type: "url", value });
const key = { property: "P8262", value: "pkg" };
const ref = [{ property: "P854", value: u("https://registry.npmjs.org/pkg") }];

const entry = (claims: Entry["claims"], extra: Partial<Entry> = {}): Entry => ({ key, claims, ...extra });
const state = (claims: ItemState["claims"]): ItemState => ({ qid: "Q1", claims });
const current = (st?: ItemState[]) => ({ [keyId(key)]: st ?? [] });

describe("plan", () => {
  it("creates an item with the key claim, label and references when none exists", () => {
    const p = plan(
      [entry([{ property: "P856", value: u("https://a.example"), references: ref }], { label: "pkg" })],
      current(),
    );
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]?.label).toBe("pkg");
    expect(p.creates[0]?.claims.map((c) => c.property)).toEqual(["P856", "P8262"]);
    expect(emit(p)).toContain('LAST\tP8262\t"pkg"');
  });

  it("value-level: present whatever rank/references, nothing emitted", () => {
    const st = state({ P856: [{ value: u("https://a.example/"), qualifiers: {} }] });
    const p = plan([entry([{ property: "P856", value: u("https://A.example") }])], current([st]));
    expect(isEmptyPlan(p)).toBe(true);
    expect(p.report.coverage).toMatchObject({ linked: 1, wantedLinked: 1, presentLinked: 1 });
  });

  it("adds a missing statement with its references", () => {
    const p = plan([entry([{ property: "P856", value: u("https://a.example"), references: ref }])], current([state({})]));
    expect(p.additions).toHaveLength(1);
    expect(emit(p)).toBe('Q1\tP856\t"https://a.example"\tS854\t"https://registry.npmjs.org/pkg"');
  });

  it("qualifier-level: emits only the missing qualifier, on the stored raw value, without references", () => {
    const st = state({ P348: [{ value: s("1.0.0"), qualifiers: {} }] });
    const p = plan(
      [
        entry([
          {
            property: "P348",
            value: s("1.0.0"),
            qualifiers: [{ property: "P577", value: makeTime("2020-01-02", 11) }],
            references: ref,
          },
        ]),
      ],
      current([st]),
    );
    expect(emit(p)).toBe('Q1\tP348\t"1.0.0"\tP577\t+2020-01-02T00:00:00Z/11');
    expect(p.report.coverage.presentLinked).toBe(0);
  });

  it("qualifier-only lines repeat the stored value, not the wanted spelling", () => {
    const st = state({ P1324: [{ value: u("git+https://github.com/a/b.git"), qualifiers: {} }] });
    const p = plan(
      [entry([{ property: "P1324", value: u("https://github.com/a/b"), qualifiers: [{ property: "P813", value: makeTime("2026-01-01", 11) }] }])],
      current([st]),
    );
    expect(emit(p)).toBe('Q1\tP1324\t"git+https://github.com/a/b.git"\tP813\t+2026-01-01T00:00:00Z/11');
  });

  it("a qualifier present at a coarser precision counts as present", () => {
    const st = state({
      P348: [{ value: s("1.0.0"), qualifiers: { P577: [makeTime("2020-01-01", 9)] } }],
    });
    const p = plan(
      [entry([{ property: "P348", value: s("1.0.0"), qualifiers: [{ property: "P577", value: makeTime("2020-06-02", 11) }] }])],
      current([st]),
    );
    expect(isEmptyPlan(p)).toBe(true);
  });

  it("skips and reports unresolved values, never guesses", () => {
    const p = plan(
      [entry([{ property: "P275", value: { type: "unresolved", via: "P2479", raw: "SEE LICENSE" } }])],
      current([state({})]),
    );
    expect(isEmptyPlan(p)).toBe(true);
    expect(p.report.unresolved).toEqual([{ key, property: "P275", via: "P2479", raw: "SEE LICENSE" }]);
    expect(p.report.coverage).toMatchObject({ wanted: 1, blocked: 1, presentLinked: 0 });
  });

  it("skips ambiguous keys", () => {
    const a = { ...state({}), qid: "Q2" };
    const b = { ...state({}), qid: "Q1" };
    const p = plan([entry([{ property: "P856", value: u("https://a.example") }])], current([a, b]));
    expect(isEmptyPlan(p)).toBe(true);
    expect(p.report.skipped[0]).toMatchObject({ reason: "ambiguous-key", detail: "Q1, Q2" });
    expect(p.report.coverage.linked).toBe(0);
  });

  it("skips values QuickStatements can't carry and reports them", () => {
    const p = plan(
      [entry([{ property: "P856", value: u('https://a.example/"x') }, { property: "P348", value: s("1") }])],
      current([state({})]),
    );
    expect(emit(p)).toBe('Q1\tP348\t"1"');
    expect(p.report.skipped).toEqual([
      { key, property: "P856", reason: "unsafe-for-quickstatements", detail: 'https://a.example/"x' },
    ]);
  });

  it("does not create an item whose label is unsafe", () => {
    const p = plan([entry([], { label: 'a"b' })], current());
    expect(p.creates).toHaveLength(0);
    expect(p.report.skipped).toHaveLength(1);
  });

  it("drops an unsafe description but still creates the item", () => {
    const p = plan([entry([], { label: "pkg", description: 'say "hi"' })], current());
    expect(p.creates).toHaveLength(1);
    expect(p.creates[0]?.description).toBeUndefined();
    expect(p.report.skipped[0]).toMatchObject({ property: "description" });
  });

  it("merges duplicate claims, keeping the finer time and the union of qualifiers", () => {
    const p = plan(
      [
        entry([
          { property: "P348", value: s("1"), qualifiers: [{ property: "P577", value: makeTime("2020-01-01", 9) }] },
          { property: "P348", value: s("1"), qualifiers: [{ property: "P577", value: makeTime("2020-01-05", 11) }] },
        ]),
      ],
      current(),
    );
    expect(p.creates[0]?.claims.find((c) => c.property === "P348")?.qualifiers).toEqual([
      { property: "P577", value: makeTime("2020-01-05", 11) },
    ]);
  });

  it("merges entries sharing a key", () => {
    const p = plan([entry([{ property: "P856", value: u("https://a.example") }]), entry([{ property: "P348", value: s("1") }])], current());
    expect(p.creates).toHaveLength(1);
    expect(p.report.coverage.entries).toBe(1);
  });

  it("reports unmapped fields sorted and unique", () => {
    const p = plan([], {}, { unmappedFields: ["z", "a", "z"] });
    expect(p.report.unmappedFields).toEqual(["a", "z"]);
  });

  it("drops unresolved or unsafe qualifiers but keeps the statement", () => {
    const p = plan(
      [
        entry([
          {
            property: "P348",
            value: s("1"),
            qualifiers: [
              { property: "P577", value: { type: "unresolved", via: "P1", raw: "x" } },
              { property: "P1", value: s('bad"') },
            ],
          },
        ]),
      ],
      current([state({})]),
    );
    expect(emit(p)).toBe('Q1\tP348\t"1"');
    expect(p.report.unresolved).toHaveLength(1);
    expect(p.report.skipped).toHaveLength(1);
  });
});

describe("indexStates", () => {
  it("indexes by key property values, once per item", () => {
    const st = state({ P8262: [{ value: s("a"), qualifiers: {} }, { value: s("a"), qualifiers: {} }] });
    const idx = indexStates([st], ["P8262"]);
    expect(idx["P8262=a"]).toEqual([st]);
  });
});
