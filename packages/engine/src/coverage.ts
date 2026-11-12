import type { Coverage, Plan } from "./types.js";

export type Bar = { numerator: number; denominator: number; ratio: number };

const bar = (numerator: number, denominator: number): Bar => ({
  numerator,
  denominator,
  ratio: denominator === 0 ? 0 : numerator / denominator,
});

/** The three bars every tool shows. */
export function coverageBars(c: Coverage): { linked: Bar; complete: Bar; blocked: Bar } {
  return {
    linked: bar(c.linked, c.entries),
    complete: bar(c.presentLinked, c.wantedLinked),
    blocked: bar(c.blocked, c.wanted),
  };
}

export type Snapshot = {
  /** Run date, `YYYY-MM-DD`, an input rather than a clock read. */
  date: string;
  tool: string;
  mappingVersion: string;
  coverage: Coverage;
  counts: { creates: number; additions: number; unresolved: number; skipped: number };
  /** Free-form run inputs (wiki, categories, version filter...). */
  inputs?: Record<string, unknown>;
};

export function makeSnapshot(args: {
  date: string;
  tool: string;
  mappingVersion: string;
  plan: Plan;
  inputs?: Record<string, unknown>;
}): Snapshot {
  const { plan } = args;
  const snapshot: Snapshot = {
    date: args.date,
    tool: args.tool,
    mappingVersion: args.mappingVersion,
    coverage: plan.report.coverage,
    counts: {
      creates: plan.creates.length,
      additions: plan.additions.reduce((n, a) => n + a.claims.length, 0),
      unresolved: plan.report.unresolved.length,
      skipped: plan.report.skipped.length,
    },
  };
  if (args.inputs) snapshot.inputs = args.inputs;
  return snapshot;
}
