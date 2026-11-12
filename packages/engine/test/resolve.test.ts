import { describe, expect, it } from "vitest";
import { buildLookup, collectUnresolved, resolveEntries } from "../src/index.js";
import type { Entry } from "../src/index.js";

const entry: Entry = {
  key: { property: "P8262", value: "a" },
  claims: [
    { property: "P275", value: { type: "unresolved", via: "P2479", raw: "MIT" } },
    { property: "P1547", value: { type: "unresolved", via: "P8262", raw: "b" }, qualifiers: [{ property: "P1", value: { type: "unresolved", via: "P8262", raw: "c" } }] },
    { property: "P275", value: { type: "unresolved", via: "P2479", raw: "MIT" } },
  ],
};

describe("resolver", () => {
  it("collects distinct pairs, sorted", () => {
    expect(collectUnresolved([entry])).toEqual([
      { via: "P2479", raw: "MIT" },
      { via: "P8262", raw: "b" },
      { via: "P8262", raw: "c" },
    ]);
  });

  it("resolves only unique matches; zero or many stay unresolved", () => {
    const lookup = buildLookup([
      { via: "P2479", raw: "MIT", qid: "Q334661" },
      { via: "P8262", raw: "b", qid: "Q1" },
      { via: "P8262", raw: "b", qid: "Q2" },
    ]);
    const [out] = resolveEntries([entry], lookup);
    expect(out?.claims[0]?.value).toEqual({ type: "item", qid: "Q334661" });
    expect(out?.claims[1]?.value).toEqual({ type: "unresolved", via: "P8262", raw: "b" });
    expect(out?.claims[1]?.qualifiers?.[0]?.value).toEqual({ type: "unresolved", via: "P8262", raw: "c" });
  });

  it("duplicate rows for the same qid do not make a value ambiguous", () => {
    const lookup = buildLookup([
      { via: "P8262", raw: "b", qid: "Q1" },
      { via: "P8262", raw: "b", qid: "Q1" },
    ]);
    expect(resolveEntries([entry], lookup)[0]?.claims[1]?.value).toEqual({ type: "item", qid: "Q1" });
  });
});
