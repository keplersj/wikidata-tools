import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyQuickStatements,
  buildLookup,
  collectUnresolved,
  emit,
  indexStates,
  plan,
  resolveEntries,
} from "../src/index.js";
import type { Entry } from "../src/index.js";
import { entries, states, URL_PROPS } from "./helpers.js";

const sim = { urlProperties: URL_PROPS };

describe("QuickStatements merge semantics", () => {
  it("never makes QuickStatements create a duplicate of a statement that already exists", () => {
    fc.assert(
      fc.property(entries, states, (wanted, existing) => {
        const duplicates: string[] = [];
        const text = emit(plan(wanted, indexStates(existing, ["P8262"])));
        applyQuickStatements(text, existing, { ...sim, onNearDuplicate: (d) => duplicates.push(JSON.stringify(d)) });
        expect(duplicates).toEqual([]);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("idempotency", () => {
  it("applying the emitted QuickStatements text, then planning again, gives an empty batch", () => {
    fc.assert(
      fc.property(entries, states, (wanted, existing) => {
        const first = emit(plan(wanted, indexStates(existing, ["P8262"])));
        const after = applyQuickStatements(first, existing, sim);
        const second = emit(plan(wanted, indexStates(after, ["P8262"])));
        expect(second).toBe("");
      }),
      { numRuns: 1000 },
    );
  });

  it("a third run is still empty (applying is stable)", () => {
    fc.assert(
      fc.property(entries, states, (wanted, existing) => {
        const s1 = applyQuickStatements(emit(plan(wanted, indexStates(existing, ["P8262"]))), existing, sim);
        const s2 = applyQuickStatements(emit(plan(wanted, indexStates(s1, ["P8262"]))), s1, sim);
        expect(emit(plan(wanted, indexStates(s2, ["P8262"])))).toBe("");
      }),
      { numRuns: 300 },
    );
  });
});

describe("cross-item dependencies (known exception)", () => {
  // QuickStatements v1 can't reference another CREATE's LAST, so B's dependency on A
  // can't resolve in the same batch. It must settle on the next round, then stay empty.
  const raw: Entry[] = [
    { key: { property: "P8262", value: "a" }, claims: [] },
    {
      key: { property: "P8262", value: "b" },
      claims: [{ property: "P1547", value: { type: "unresolved", via: "P8262", raw: "a" } }],
    },
  ];

  function round(existing: ReturnType<typeof applyQuickStatements>) {
    const index = indexStates(existing, ["P8262"]);
    const rows = collectUnresolved(raw).flatMap((r) =>
      (index[`${r.via}=${r.raw}`] ?? []).map((s) => ({ via: r.via, raw: r.raw, qid: s.qid })),
    );
    const text = emit(plan(resolveEntries(raw, buildLookup(rows)), index));
    return { text, next: applyQuickStatements(text, existing, sim) };
  }

  it("settles within two rounds", () => {
    const r1 = round([]);
    expect(r1.text).not.toContain("P1547");
    const r2 = round(r1.next);
    expect(r2.text).toMatch(/^Q\d+\tP1547\tQ\d+$/);
    expect(round(r2.next).text).toBe("");
  });
});
