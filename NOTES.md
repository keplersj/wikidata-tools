# Decisions made on the owner's behalf

Everything here was my call, not the owner's. Flip any of it freely.

## Product decisions

- **npm version filter default: `releases-only`** (no prereleases). `all` and `latest-n` are available in the UI and the
  mapping options. `latest-n` means "the n most recently published versions, prereleases included". A version counts
  as a release only if it is plain semver (`1.2.3`, optionally `+build`); non-semver strings such as `1.0` are treated
  as non-releases and dropped by `releases-only`.
- **Which npm packages:** names typed in, plus an optional sorted page of packages that already have P8262 on Wikidata
  ("how many" default 25, "skip first" for paging). The registry is never crawled.
- **Description on new npm items:** the registry `description` goes into `Den` on `CREATE`. Language is always `en`.
- **Fandom references:** the brief only specified npm references. Fandom statements get S854 = the article URL
  (`https://<wiki>.fandom.com/wiki/<slug>`) and S813 = run date. The old category-map script attached none.
- **Fandom P6262 values** are `wiki:` + the page title with spaces as underscores (decoded, not percent-encoded).
  Checked against real Wikidata values on 2026-11-11 (`starwars:Dennis_Brännvall`, `starwars:Katy_O'Brian`,
  `starwars:Chewbacca/Legends`).
- **Class-mapping config** is a JSON file per wiki (`{ wiki, categories: [{ name, instanceOf? }] }`), pasted into the
  UI. No QIDs are shipped: none were invented.
- **Dependencies (P1547)** resolve through P8262 only to items that already exist. A dependency whose own item is
  created in the same batch stays *unresolved* until a later run (see "Known exception").
- **Unresolved licenses:** `license` resolves through P2479 (SPDX ID) by exact match. Expressions such as
  `(MIT OR Apache-2.0)`, `SEE LICENSE IN ...` and `UNLICENSED` have no item and are listed as unresolved, not guessed.
- **`repository` shorthands** (`github:u/r`, bare `u/r`) are expanded to https GitHub-style URLs, following npm's
  documented meaning, before normalization.
- **Ambiguous keys:** if more than one item carries the same key value, the entry is skipped and reported
  (`ambiguous-key`), never guessed. It does not count as Linked.
- **Values QuickStatements v1 can't safely carry** (a `"`, tab or newline in a string/URL) are skipped and reported
  (`unsafe-for-quickstatements`). The v1 help documents no escape for `"` (only the CSV format has one). An unsafe
  *label* blocks creating that item; an unsafe *description* is dropped and reported.
- **"Open in QuickStatements" link** uses the documented `#/v1=` form (tab → `|`, newline → `||`, URL-encoded). It is
  disabled when the batch contains `|` or exceeds ~6000 encoded characters; use Copy or the .txt download then.
- **Month/year times** are emitted as `+YYYY-MM-00…/10` and `+YYYY-00-00…/9`, matching the QuickStatements help.
  Existing times coarser than a year, BCE dates and unsupported datatypes are ignored when diffing.
- **Coverage counting:** Complete counts a statement present only when its value *and* all wanted qualifiers exist.
  Blocked counts unresolved main values. Skipped-unsafe statements count as wanted but neither present nor blocked.
- **Snapshots** are downloaded JSON only: no backend, nothing stored.
- **UI** is vanilla TypeScript, no framework.

## Known exception to "second batch is empty"

QuickStatements v1 cannot reference another `CREATE`'s `LAST`. If package B depends on package A and A is created in
this batch, B's dependency is *unresolved* in this batch, and appears in the next run once A has an item. It settles in
two rounds and stays empty after that (`packages/engine/test/idempotency.test.ts`, "cross-item dependencies"). The
recorded npm fixture used for the done-criterion has no such case.

## CORS checks (run from curl with `Origin: https://wikidata.keplersj.com`, 2026-11-11)

| Source | Result |
| --- | --- |
| `registry.npmjs.org` GET | OK, `access-control-allow-origin: *`. **Preflight (OPTIONS) returns 404**, so never send non-safelisted headers (e.g. `Api-User-Agent`) to npm. The code sends none. |
| `query.wikidata.org/sparql` | OK; default response is XML, so we send `format=json` and an `Accept` header. Preflight allows `api-user-agent`. |
| `www.wikidata.org/w/api.php` | OK with `origin=*` (`access-control-allow-origin: *`); preflight allows `api-user-agent`. Needs a descriptive UA: a bare curl got an HTML page. |
| **Fandom `/api/v1/Articles/List` — FAILED** | HTTP 403, Cloudflare "Just a moment…" challenge (`cf-mitigated: challenge`), no CORS headers. Same result from curl with the default UA, with an honest UA, and with the old scripts' `got` UA, from this machine. I did not try to get around it. |
| **Fandom `/api.php` (MediaWiki API) — OK** | HTTP 200 JSON, `access-control-allow-origin: *`, no challenge (with `origin=*` and an honest UA). **The Fandom tools use this instead**, so no proxy is needed and the Worker was removed. Only `allpages` was probed; `categorymembers` returned a valid empty result for `Category:Droids` on starwars (category probably doesn't exist), so category listing and `continue` paging against the live site are unverified. No custom headers are sent to Fandom (avoids a preflight whose answer I didn't check). |

**Worker/proxy:** an earlier version had one allow-listed Fandom proxy route. It was removed when the MediaWiki API
turned out to answer CORS. The deployed site is now static assets only.

**Fandom fixtures:** `packages/tools/fixtures/fandom/` has one real recorded `allpages` response
(`real-allpages-sample.json`); the rest are hand-written in the same shape and labelled synthetic.

## Fandom check vs the old `fandom-check` numbers

The old command compared article **titles** ("Anakin Skywalker") with stored values that are **slugs**
("Anakin_Skywalker"), so any multi-word title was reported as unlinked. The new check compares slugs, as the brief
asked. The test suite keeps a verbatim-behaviour copy of the old title-based check (`legacyCheck`) and asserts both
results on the same fixture: legacy 1 of 5 linked (20%), slug-based 2 of 5 (40%). They agree exactly when every
title equals its slug (also tested). So the old numbers are reproduced by the legacy logic, and the difference
is the intended fix, not a regression.

## Environment and what has *not* run

- The dev machine had no Node. Tests were run in a `node:22` container through the host's podman, the same image
  family as `.devcontainer/devcontainer.json`. I did **not** install the Dev Containers CLI (it is itself an npm
  package and needs a Node to bootstrap); the devcontainer file is written but untested.
- **CI has never run.** `.github/workflows/ci.yml` is written (lint, typecheck, test, build) and its steps were run
  locally, but there is no remote yet, so there is no green CI badge to point to.
- **Not deployed.** `apps/web/wrangler.toml` (static assets only) has the custom-domain route for `wikidata.keplersj.com`; no deploy, no
  DNS record. `npm run deploy -w @wdt/web` deliberately fails with a reminder.
- QuickStatements was modelled (`packages/engine/src/qs-sim.ts`: exact property+value merge, otherwise add), not run
  against the real tool. The model follows the documented behaviour; real-world quirks may differ.
- **Query Service lag:** items are found with SPARQL (as the brief mandates). The Wikidata Query Service can lag
  minutes behind edits, so re-running a tool right after applying a batch with CREATEs can propose the same CREATEs
  again. The UI warns above any batch that creates items. Wait before re-running. This cannot be engineered away
  without a different lookup path.
- **Items SPARQL finds but `wbgetentities` can't load** (deleted, or a redirect returned under its target id): the
  entry is skipped with a note, never turned into a CREATE (that would duplicate a key that exists).
- **Text limits:** labels and descriptions over 250 characters are not sent (an over-long label blocks the create, an
  over-long description is dropped), and both are listed as `too-long`. The 250 figure is from memory and I could not
  confirm it in the Wikidata help pages; change `WIKIDATA_TEXT_LIMIT` in `packages/engine/src/emit.ts` if wrong.
- **`"license": "MIT"`** in the root `package.json` is my placeholder; the owner should choose the licence.
- **Images:** tests ran in `docker.io/library/node:22`; the devcontainer uses
  `mcr.microsoft.com/devcontainers/typescript-node:22`. Both are Node 22 but they are different images, and the
  devcontainer one has never been started.
- **Mutation testing:** Stryker on `packages/engine` scores about 88% (see `npm run mutate`). The remaining survivors
  are mostly in `diff.ts` (order-of-merge details) and `normalize.ts` (regex anchoring); the gaps were chosen over
  chasing equivalent mutants.
