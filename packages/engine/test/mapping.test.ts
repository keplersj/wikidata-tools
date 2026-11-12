import { describe, expect, it } from "vitest";
import { applyMapping, findUnmappedFields } from "../src/index.js";
import type { Mapping } from "../src/index.js";

const mapping: Mapping = {
  version: "t1",
  rows: [
    { id: "name-label", field: "name", target: "label" },
    { id: "name", field: "name", property: "P8262", value: { as: "string" } },
    { id: "versions", field: "versions", property: "P348", value: { as: "string", path: "version" }, qualifiers: [{ property: "P577", value: { as: "time-day", path: "time" } }] },
    { id: "home", field: "homepage", property: "P856", value: { as: "url" } },
    { id: "bugs", field: "bugs.url", property: "P1401", value: { as: "url" } },
    { id: "repo", field: "repository", property: "P1324", value: { as: "normalized-url" } },
    { id: "license", field: "license", property: "P275", value: { as: "item", via: "P2479" } },
  ],
  references: [
    { property: "P854", kind: "url-template", template: "https://registry.npmjs.org/{key}" },
    { property: "P813", kind: "run-date" },
  ],
  ignore: ["readme"],
};

describe("applyMapping", () => {
  const source = {
    key: { property: "P8262", value: "pkg" },
    fields: {
      name: "pkg",
      versions: [{ version: "1.0.0", time: "2016-03-23T18:59:58.364Z" }, { version: "1.1.0", time: "bad" }],
      homepage: "  https://h.example/ ",
      bugs: { url: "https://b.example" },
      repository: "git+ssh://git@github.com/a/b.git",
      license: "MIT",
      keywords: ["x"],
      readme: "...",
    },
  };

  it("maps fields to claims with qualifiers and references", () => {
    const e = applyMapping(mapping, source, { runDate: "2026-11-11" });
    expect(e.label).toBe("pkg");
    expect(e.claims.map((c) => [c.property, c.value])).toEqual([
      ["P8262", { type: "string", value: "pkg" }],
      ["P348", { type: "string", value: "1.0.0" }],
      ["P348", { type: "string", value: "1.1.0" }],
      ["P856", { type: "url", value: "https://h.example/" }],
      ["P1401", { type: "url", value: "https://b.example" }],
      ["P1324", { type: "url", value: "https://github.com/a/b" }],
      ["P275", { type: "unresolved", via: "P2479", raw: "MIT" }],
    ]);
    expect(e.claims[1]?.qualifiers).toEqual([{ property: "P577", value: { type: "time", iso: "2016-03-23", precision: 11 } }]);
    expect(e.claims[2]?.qualifiers).toBeUndefined(); // unparseable date: qualifier dropped
    expect(e.claims[0]?.references).toEqual([
      { property: "P854", value: { type: "url", value: "https://registry.npmjs.org/pkg" } },
      { property: "P813", value: { type: "time", iso: "2026-11-11", precision: 11 } },
    ]);
  });

  it("maps direct QIDs and drops malformed ones", () => {
    const m: Mapping = { version: "t", rows: [{ id: "c", field: "classes", property: "P31", value: { as: "qid" } }], references: [], ignore: [] };
    const e = applyMapping(m, { key: source.key, fields: { classes: ["Q5", "droid", "q7"] } }, { runDate: "2026-11-11" });
    expect(e.claims.map((c) => c.value)).toEqual([{ type: "item", qid: "Q5" }]);
  });

  it("skips missing and empty fields", () => {
    const e = applyMapping(mapping, { key: source.key, fields: { name: "pkg", homepage: "  " } }, { runDate: "2026-11-11" });
    expect(e.claims.map((c) => c.property)).toEqual(["P8262"]);
  });

  it("requires a YYYY-MM-DD run date", () => {
    expect(() => applyMapping(mapping, source, { runDate: "today" })).toThrow(/runDate/);
  });

  it("lists unmapped fields, minus ignored ones", () => {
    expect(findUnmappedFields(mapping, [source])).toEqual(["keywords"]);
  });
});
