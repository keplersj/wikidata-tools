import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FetchLike } from "../src/index.js";

/** Serves recorded responses by URL. Any request without a fixture fails the test: no live calls. */
export function replayFetch(dir: URL, log: string[] = []): FetchLike {
  return async (url) => {
    log.push(url);
    const file = `${createHash("sha1").update(url).digest("hex")}.json`;
    let recorded: { status: number; body: string };
    try {
      recorded = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as typeof recorded;
    } catch {
      throw new Error(`No recorded fixture for ${url}`);
    }
    return { ok: recorded.status >= 200 && recorded.status < 300, status: recorded.status, json: async () => JSON.parse(recorded.body) as unknown };
  };
}
