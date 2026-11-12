import { describe, expect, it } from "vitest";
import { emit, formatValue, isQsSafe, makeTime, quickStatementsUrl } from "../src/index.js";
import type { Plan } from "../src/index.js";

const emptyReport: Plan["report"] = {
  unresolved: [],
  skipped: [],
  unmappedFields: [],
  coverage: { entries: 0, linked: 0, wanted: 0, wantedLinked: 0, presentLinked: 0, blocked: 0 },
};

const refs = [
  { property: "P854", value: { type: "url", value: "https://registry.npmjs.org/left-pad" } },
  { property: "P813", value: makeTime("2026-11-11", 11) },
] as const;

describe("emit (golden)", () => {
  it("emits CREATE blocks and additions in QuickStatements v1", () => {
    const plan: Plan = {
      creates: [
        {
          key: { property: "P8262", value: "left-pad" },
          label: "left-pad",
          description: "pads strings",
          claims: [
            { property: "P8262", value: { type: "string", value: "left-pad" }, references: [...refs] },
            {
              property: "P348",
              value: { type: "string", value: "1.0.0" },
              qualifiers: [{ property: "P577", value: makeTime("2016-03-23", 11) }],
              references: [...refs],
            },
            { property: "P275", value: { type: "item", qid: "Q334661" } },
          ],
        },
      ],
      additions: [
        {
          key: { property: "P8262", value: "is-odd" },
          qid: "Q42",
          claims: [{ property: "P856", value: { type: "url", value: "https://x.example/" } }],
        },
      ],
      report: emptyReport,
    };
    expect(emit(plan)).toBe(
      [
        "CREATE",
        'LAST\tLen\t"left-pad"',
        'LAST\tDen\t"pads strings"',
        'LAST\tP275\tQ334661',
        'LAST\tP348\t"1.0.0"\tP577\t+2016-03-23T00:00:00Z/11\tS813\t+2026-11-11T00:00:00Z/11\tS854\t"https://registry.npmjs.org/left-pad"',
        'LAST\tP8262\t"left-pad"\tS813\t+2026-11-11T00:00:00Z/11\tS854\t"https://registry.npmjs.org/left-pad"',
        'Q42\tP856\t"https://x.example/"',
      ].join("\n"),
    );
  });

  it("an empty plan emits an empty batch", () => {
    expect(emit({ creates: [], additions: [], report: emptyReport })).toBe("");
  });

  it("formats times at each precision", () => {
    expect(formatValue(makeTime("2020-05-02", 11))).toBe("+2020-05-02T00:00:00Z/11");
    expect(formatValue(makeTime("2020-05-02", 10))).toBe("+2020-05-00T00:00:00Z/10");
    expect(formatValue(makeTime("2020-05-02", 9))).toBe("+2020-00-00T00:00:00Z/9");
  });

  it("refuses to emit unresolved values", () => {
    expect(() => formatValue({ type: "unresolved", via: "P2479", raw: "MIT" })).toThrow();
  });
});

describe("isQsSafe", () => {
  it("rejects quotes, tabs and newlines", () => {
    for (const bad of ['a"b', "a\tb", "a\nb", "a\rb"]) {
      expect(isQsSafe({ type: "string", value: bad })).toBe(false);
      expect(isQsSafe({ type: "url", value: bad })).toBe(false);
    }
    expect(isQsSafe({ type: "string", value: "fine" })).toBe(true);
    expect(isQsSafe({ type: "item", qid: "Q1" })).toBe(true);
    expect(isQsSafe({ type: "unresolved", via: "P1", raw: "x" })).toBe(false);
  });
});

describe("quickStatementsUrl", () => {
  it("encodes tabs as | and newlines as || per the QuickStatements help", () => {
    expect(quickStatementsUrl('Q37887397\tP214\t"96480189"\tS143\tQ565')).toBe(
      "https://quickstatements.toolforge.org/#/v1=Q37887397%7CP214%7C%2296480189%22%7CS143%7CQ565",
    );
    expect(quickStatementsUrl("Q1\tP31\tQ2\nQ3\tP31\tQ4")).toContain("%7C%7C");
  });
  it("returns null when empty, containing |, or too long", () => {
    expect(quickStatementsUrl("")).toBeNull();
    expect(quickStatementsUrl('Q1\tP1\t"a|b"')).toBeNull();
    expect(quickStatementsUrl(`Q1\tP1\t"${"x".repeat(7000)}"`)).toBeNull();
  });
});
