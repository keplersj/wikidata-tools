# Kepler's WikiData Tools

A static web app (planned for `wikidata.keplersj.com`). Each tool reads a source and Wikidata and outputs a
[QuickStatements](https://www.wikidata.org/wiki/Help:QuickStatements) v1 batch containing **only what Wikidata is
missing**. The app never edits Wikidata and has no sign-in: you review each batch and run it in QuickStatements.

v1 tools: **npm packages**, **Fandom check**, **Fandom category map** (with per-wiki class mapping).

## Principles (and where they live)

| Principle | How it is enforced |
| --- | --- |
| Idempotent: apply the batch, run again, the second batch is empty | `packages/engine/test/idempotency.test.ts` applies the emitted *text* with a QuickStatements model, then plans again |
| Deterministic: same inputs, byte-identical output | `determinism.test.ts`; sorted by key → property id → normalized value; code-unit comparison only; run date is an input |
| Keyed matching only | items are found through the source's identifier property (`p:Pxxx/ps:Pxxx`, any rank), never by label |
| Value-level / qualifier-level diff | `packages/engine/src/diff.ts` |
| References attached, never compared | new statements carry references; existing ones are never re-emitted just to add one |
| No guessing | item-valued fields resolve only through an identifier property, only when exactly one item matches; otherwise listed as *unresolved* |
| Pure engine | `packages/engine` has no DOM/Worker/network/clock; ESLint bans `Date`, `fetch`, `localeCompare` there and its tsconfig has no DOM lib |

## Layout

```
packages/engine   pure: types, normalizers, diff, emitter, resolver logic, mapping applier, coverage
packages/tools    Wikidata client + reader, source adapters and mappings (npm, Fandom), shared pipeline
apps/web          Vite UI, served as Cloudflare Workers static assets (no Worker code)
```

```
source adapter → entries → mapping table → resolver ⇄ Wikidata reader → diff engine → emitter → QuickStatements
```

## Develop

Requires Node 22 (a `.devcontainer` is provided).

```bash
npm install
npm test            # vitest: unit, property (fast-check), fixture snapshots
npm run lint
npm run typecheck
npm run build       # static bundle in apps/web/dist
npm run mutate      # Stryker mutation testing on the engine
```

Tests never touch the network: the global `fetch` is replaced with a function that throws, and code under test takes
`fetch` as a parameter. npm fixtures are real recordings (`packages/tools/scripts/record-npm.ts`); the Fandom ones are
**synthetic** (see `packages/tools/fixtures/fandom/README.md`).

## Adding a mapping row

Mappings are data (`packages/tools/src/npm/mapping.ts`, `packages/tools/src/fandom/tool.ts`). A row says *which source
field becomes which property*:

```ts
{ id: "versions", field: "versions", property: "P348",
  value: { as: "string", path: "version" },                                       // each array element → one statement
  qualifiers: [{ property: "P577", value: { as: "time-day", path: "time" } }] }
```

1. Make sure the adapter exposes the field (`packumentToSource` in `npm/source.ts` for npm). Array fields fan out.
2. Add the row. Value kinds: `string`, `url`, `normalized-url`, `time-day`, `item` (resolved through an identifier
   property, `via`), `qid` (given directly). Dotted `field` paths (`bugs.url`) work.
3. Bump the mapping `version` string; it is recorded in snapshots.
4. Re-record or extend a fixture and review the golden batch under `packages/tools/test/__snapshots__/`.

Fields no row reads show up in the run report as *unmapped*, so you can see what you are not mapping. List a field in
the mapping's `ignore` to silence it.

## Adding a tool

1. In `packages/tools/src/<tool>/`: a **source adapter** returning `{ key, fields }[]` (key = `{ property, value }`
   of the identifier property), a **mapping** (above), and a `run…` function that calls `runPipeline` from
   `pipeline.ts`. The pipeline does mapping → resolution → reading → diff → emit; you supply only the source.
2. Export it from `packages/tools/src/index.ts`.
3. Add a tab in `apps/web/src/main.ts` (`tools` array: a form, and a `run` that calls `showRun`).
4. Tests: a fixture snapshot, plus an idempotency check (apply the batch, plan again, expect empty). Never call live
   APIs in tests.
5. If a source blocks browser requests (no CORS headers), add one allow-listed Worker route for it; never an open proxy. None of the v1 sources needs one.

## npm tool options

Versions: `releases-only` (default, no prereleases), `all`, or `latest-n`. The default is the maintainer's pick
pending a decision from the owner, see `NOTES.md`.

## Not in v1

Kubernetes, Audit and Explore tools. The shared pipeline is shaped so they can be added as further tools.
