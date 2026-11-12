import { describe, expect, it } from "vitest";
import {
  cmpId,
  expandRepositoryShorthand,
  keyId,
  makeTime,
  normalizeString,
  normalizeUrl,
  timeFromWikidata,
  valuesEqual,
} from "../src/index.js";
import type { Value } from "../src/index.js";

describe("normalizeUrl", () => {
  it.each([
    ["git+https://github.com/user/repo.git", "https://github.com/user/repo"],
    ["git+ssh://git@github.com/user/repo.git", "https://github.com/user/repo"],
    ["git://github.com/user/repo.git", "https://github.com/user/repo"],
    ["ssh://git@github.com/user/repo.git", "https://github.com/user/repo"],
    ["git@github.com:user/repo.git", "https://github.com/user/repo"],
    ["https://GitHub.COM/User/Repo", "https://github.com/User/Repo"],
    ["https://github.com/user/repo/", "https://github.com/user/repo"],
    ["https://github.com/user/repo.git/", "https://github.com/user/repo"],
    ["HTTPS://example.org/", "https://example.org"],
    ["  https://example.org/a  ", "https://example.org/a"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it("keeps path case, query and fragment", () => {
    expect(normalizeUrl("https://Example.org/Docs/?q=A#Frag")).toBe("https://example.org/Docs?q=A#Frag");
  });

  it("does not unify http and https", () => {
    expect(normalizeUrl("http://example.org")).toBe("http://example.org");
  });

  it("is idempotent on its own output", () => {
    const once = normalizeUrl("git+ssh://git@github.com/a/b.git/");
    expect(normalizeUrl(once)).toBe(once);
  });

  it("leaves non-URLs alone", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("expandRepositoryShorthand", () => {
  it("expands npm shorthands", () => {
    expect(expandRepositoryShorthand("github:user/repo")).toBe("https://github.com/user/repo");
    expect(expandRepositoryShorthand("gitlab:user/repo")).toBe("https://gitlab.com/user/repo");
    expect(expandRepositoryShorthand("bitbucket:user/repo")).toBe("https://bitbucket.org/user/repo");
    expect(expandRepositoryShorthand("user/repo")).toBe("https://github.com/user/repo");
  });
  it("leaves full URLs alone", () => {
    expect(expandRepositoryShorthand("https://github.com/user/repo")).toBe("https://github.com/user/repo");
  });
});

describe("strings", () => {
  it("trims and does not fold case", () => {
    expect(normalizeString("  Left-Pad ")).toBe("Left-Pad");
    const a: Value = { type: "string", value: " MIT " };
    expect(valuesEqual(a, { type: "string", value: "MIT" })).toBe(true);
    expect(valuesEqual(a, { type: "string", value: "mit" })).toBe(false);
  });
  it("keyId trims", () => {
    expect(keyId({ property: "P8262", value: " x " })).toBe("P8262=x");
  });
});

describe("times", () => {
  const day = (iso: string) => makeTime(iso, 11);
  it("equal days are equal; different days are not", () => {
    expect(valuesEqual(day("2020-05-02"), day("2020-05-02"))).toBe(true);
    expect(valuesEqual(day("2020-05-02"), day("2020-05-03"))).toBe(false);
  });
  it("compares at the coarser precision", () => {
    expect(valuesEqual(day("2020-05-02"), makeTime("2020-05-30", 10))).toBe(true);
    expect(valuesEqual(day("2020-05-02"), makeTime("2020-06-01", 10))).toBe(false);
    expect(valuesEqual(day("2020-05-02"), makeTime("2020-12-31", 9))).toBe(true);
    expect(valuesEqual(day("2020-05-02"), makeTime("2021-05-02", 9))).toBe(false);
    expect(valuesEqual(makeTime("2020-05-01", 10), makeTime("2020-01-01", 9))).toBe(true);
  });
  it("parses Wikidata literals including -00 parts", () => {
    expect(timeFromWikidata("+2020-00-00T00:00:00Z", 9)).toEqual({ type: "time", iso: "2020-01-01", precision: 9 });
    expect(timeFromWikidata("+2020-05-00T00:00:00Z", 10)).toEqual({ type: "time", iso: "2020-05-01", precision: 10 });
    expect(timeFromWikidata("+2020-05-02T00:00:00Z", 11)).toEqual({ type: "time", iso: "2020-05-02", precision: 11 });
  });
  it("clamps finer precisions to a day and rejects coarser/BCE", () => {
    expect(timeFromWikidata("+2020-05-02T10:00:00Z", 14)).toEqual({ type: "time", iso: "2020-05-02", precision: 11 });
    expect(timeFromWikidata("+2000-00-00T00:00:00Z", 8)).toBeNull();
    expect(timeFromWikidata("-0500-00-00T00:00:00Z", 9)).toBeNull();
  });
  it("makeTime rejects junk", () => {
    expect(() => makeTime("yesterday", 11)).toThrow();
  });
});

describe("values of different types", () => {
  it("never equal; unresolved never equals anything", () => {
    expect(valuesEqual({ type: "string", value: "Q1" }, { type: "item", qid: "Q1" })).toBe(false);
    const u: Value = { type: "unresolved", via: "P2479", raw: "MIT" };
    expect(valuesEqual(u, u)).toBe(false);
  });
});

describe("cmpId", () => {
  it("orders ids numerically", () => {
    expect(["P1401", "P348", "P8262", "P31"].sort(cmpId)).toEqual(["P31", "P348", "P1401", "P8262"]);
  });
});
