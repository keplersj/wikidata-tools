import {
  applyQuickStatements,
  indexStates,
  plan,
  type ItemState,
} from "@wdt/engine";
import { describe, expect, it } from "vitest";
import {
  createWikidataClient,
  filterVersions,
  isRelease,
  packumentToSource,
  runNpmTool,
  type Progress,
} from "../src/index.js";
import { replayFetch } from "./replay.js";

const dir = new URL("../fixtures/npm/", import.meta.url);
const input = { names: ["is-number", "is-odd", "left-pad"], runDate: "2026-11-11", concurrency: 1 };

function run(log: string[] = []) {
  const fetchFn = replayFetch(dir, log);
  return runNpmTool({ client: createWikidataClient(fetchFn), fetchNpm: fetchFn }, input);
}

describe("npm tool against recorded fixtures", () => {
  it("matches the golden batch", async () => {
    const r = await run();
    await expect(r.text).toMatchFileSnapshot("./__snapshots__/npm.qs.txt");
  });

  it("matches the golden run report", async () => {
    const r = await run();
    await expect(JSON.stringify({ report: r.plan.report, notes: r.notes, snapshot: r.snapshot }, null, 2)).toMatchFileSnapshot(
      "./__snapshots__/npm.report.json",
    );
  });

  it("is idempotent: apply the batch, plan again, the second batch is empty", async () => {
    const r = await run();
    expect(r.text).not.toBe("");
    const existing: ItemState[] = [...new Map(Object.values(r.current).flat().map((s) => [s.qid, s])).values()];
    const after = applyQuickStatements(r.text, existing, { urlProperties: ["P856", "P1324", "P1401"] });
    const second = plan(r.wanted, indexStates(after, ["P8262"]));
    expect(second.creates).toEqual([]);
    expect(second.additions).toEqual([]);
  });

  it("only makes requests that were recorded, with no custom headers to npm", async () => {
    const log: string[] = [];
    await run(log);
    expect(log.filter((u) => u.startsWith("https://registry.npmjs.org/")).length).toBe(3);
  });

  it("never sends more than 50 ids per wbgetentities request", async () => {
    const log: string[] = [];
    await run(log);
    for (const u of log.filter((x) => x.includes("wbgetentities"))) {
      expect(new URL(u).searchParams.get("ids")?.split("|").length ?? 0).toBeLessThanOrEqual(50);
    }
  });
});

describe("version filter", () => {
  const versions = [
    { version: "1.0.0", time: "2020-01-01T00:00:00Z" },
    { version: "2.0.0-beta.1", time: "2021-01-01T00:00:00Z" },
    { version: "2.0.0", time: "2022-01-01T00:00:00Z" },
    { version: "2.1.0+build.5", time: "2023-01-01T00:00:00Z" },
  ];
  it("classifies releases", () => {
    expect(["1.0.0", "1.0.0+x", "1.0.0-rc.1", "1.0", "v1.0.0"].map(isRelease)).toEqual([true, true, false, false, false]);
  });
  it("all / releases-only / latest-n", () => {
    expect(filterVersions(versions, { mode: "all" })).toHaveLength(4);
    expect(filterVersions(versions, { mode: "releases-only" }).map((v) => v.version)).toEqual(["1.0.0", "2.0.0", "2.1.0+build.5"]);
    expect(filterVersions(versions, { mode: "latest-n", n: 2 }).map((v) => v.version)).toEqual(["2.1.0+build.5", "2.0.0"]);
    expect(filterVersions(versions, { mode: "latest-n", n: 0 })).toEqual([]);
  });
});

describe("packumentToSource", () => {
  const p = {
    name: "x",
    "dist-tags": { latest: "1.0.0" },
    versions: { "1.0.0": { dependencies: { zeta: "1", alpha: "2" } } },
    time: { "1.0.0": "2020-01-01T00:00:00.000Z", created: "2019-01-01T00:00:00.000Z" },
    bugs: "https://b.example",
    repository: { type: "git", url: "git+https://github.com/a/x.git" },
    license: { type: "MIT" },
    keywords: ["k"],
  };
  const e = packumentToSource(p, "x", { mode: "all" });
  it("flattens registry shapes", () => {
    expect(e.fields.bugs).toEqual({ url: "https://b.example" });
    expect(e.fields.repository).toBe("git+https://github.com/a/x.git");
    expect(e.fields.license).toBe("MIT");
    expect(e.fields.dependencies).toEqual(["alpha", "zeta"]);
    expect(e.fields.versions).toEqual([{ version: "1.0.0", time: "2020-01-01T00:00:00.000Z" }]);
    expect(e.fields.keywords).toEqual(["k"]);
  });
});

describe("npm tool progress", () => {
  it("reports counted fetching and the later stages, without changing the batch", async () => {
    const events: Progress[] = [];
    const fetchFn = replayFetch(dir, []);
    const r = await runNpmTool(
      { client: createWikidataClient(fetchFn), fetchNpm: fetchFn },
      { ...input, onProgress: (p) => events.push(p) },
    );
    expect(r.text).toBe((await run()).text);
    const fetching = events.filter((e) => e.stage.startsWith("Fetching"));
    expect(fetching.map((e) => e.done)).toEqual([0, 1, 2, 3]);
    expect(fetching.every((e) => e.total === 3)).toBe(true);
    const stages = events.map((e) => e.stage);
    expect(stages.at(-1)).toBe("Comparing and building the batch");
    expect(stages).toContain("Looking up existing items on Wikidata");
    expect(stages).toContain("Looking up referenced items on Wikidata");
    for (const e of events.filter((x) => x.total !== undefined)) expect(e.done).toBeLessThanOrEqual(e.total as number);
  });
});

describe("npm tool resilience", () => {
  it("skips a package whose fetch fails and still builds the rest", async () => {
    const replay = replayFetch(dir, []);
    const fetchNpm: typeof replay = (url, init) =>
      url.includes("ghost-pkg") ? Promise.reject(new TypeError("Failed to fetch")) : replay(url, init);
    const r = await runNpmTool(
      { client: createWikidataClient(replay), fetchNpm, retry: { sleep: async () => {} } },
      { ...input, names: [...input.names, "ghost-pkg"] },
    );
    expect(r.notes).toEqual([expect.stringMatching(/^ghost-pkg: could not be fetched from npm \(Failed to fetch\), skipped$/)]);
    expect(r.text).toBe((await run()).text);
  });
});
