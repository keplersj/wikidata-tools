/**
 * Records the live responses the npm tool needs into fixtures/npm/.
 * Run manually, never from tests:  npx vite-node packages/tools/scripts/record-npm.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createWikidataClient, runNpmTool, USER_AGENT, type FetchLike } from "../src/index.js";

const dir = new URL("../fixtures/npm/", import.meta.url);
mkdirSync(dir, { recursive: true });

const recording: FetchLike = async (url, init) => {
  const headers = { ...init?.headers };
  if (url.includes("wikidata.org")) headers["User-Agent"] = USER_AGENT;
  const res = await fetch(url, { headers });
  const body = await res.text();
  const file = `${createHash("sha1").update(url).digest("hex")}.json`;
  writeFileSync(new URL(file, dir), JSON.stringify({ url, status: res.status, body }, null, 1));
  console.log(res.status, url.slice(0, 120));
  return { ok: res.ok, status: res.status, json: async () => JSON.parse(body) as unknown };
};

const run = await runNpmTool(
  { client: createWikidataClient(recording), fetchNpm: recording },
  { names: ["is-number", "is-odd", "left-pad"], runDate: "2026-11-11", concurrency: 1 },
);
console.log(run.text.split("\n").length, "lines");
