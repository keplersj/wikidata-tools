import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { emit, indexStates, plan } from "../src/index.js";
import type { Entry } from "../src/index.js";
import { entries, shuffle, states } from "./helpers.js";

function shuffleEntry(e: Entry, seed: number): Entry {
  return {
    ...e,
    claims: shuffle(e.claims, seed).map((c) => ({
      ...c,
      ...(c.qualifiers ? { qualifiers: shuffle(c.qualifiers, seed + 1) } : {}),
      ...(c.references ? { references: shuffle(c.references, seed + 2) } : {}),
    })),
  };
}

describe("determinism", () => {
  it("shuffled inputs give byte-identical output and identical plans", () => {
    fc.assert(
      fc.property(entries, states, fc.integer(), (wanted, existing, seed) => {
        const a = plan(wanted, indexStates(existing, ["P8262"]));
        const b = plan(
          shuffle(wanted, seed).map((e) => shuffleEntry(e, seed)),
          indexStates(shuffle(existing, seed + 3), ["P8262"]),
        );
        expect(emit(b)).toBe(emit(a));
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        expect(JSON.stringify(b.report)).toBe(JSON.stringify(a.report));
      }),
      { numRuns: 500 },
    );
  });
});
