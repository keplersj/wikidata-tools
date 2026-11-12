import { quickStatementsUrl } from "@wdt/engine";
import {
  createWikidataClient,
  parseFandomConfig,
  runFandomCategoryMap,
  runFandomCheck,
  runNpmTool,
  checkSnapshot,
  type FandomCheck,
  type FetchLike,
  type ToolRun,
  type VersionFilter,
} from "@wdt/tools";
import { barHtml, batchFileName, coverageHtml, esc, snapshotFileName } from "./format.js";

const fetchFn: FetchLike = (url, init) => fetch(url, init);
const client = createWikidataClient(fetchFn);
const today = () => new Date().toISOString().slice(0, 10); // the app, not the engine, reads the clock

type Tool = { id: string; label: string; form: () => string; run: (f: FormData, out: HTMLElement) => Promise<void> };

const dateField = `<label>Run date <small>(goes into the "retrieved" reference)</small>
  <input type="date" name="runDate" value="${today()}" required /></label>`;

const tools: Tool[] = [
  {
    id: "npm",
    label: "npm packages",
    form: () => `
      <label>Package names <small>one per line; new ones get an item</small>
        <textarea name="names" rows="5" placeholder="left-pad&#10;@babel/core"></textarea></label>
      <label class="check"><input type="checkbox" name="fromWikidata" /> Also check packages that already have an npm package (P8262) on Wikidata</label>
      <label class="check"><input type="checkbox" name="all" /> All of them, paged into one batch <small>(ignores "How many"; can take a while)</small></label>
      <div class="row">
        <label>How many <small>(sorted by name)</small><input type="number" name="limit" value="25" min="1" max="200" /></label>
        <label>Skip first<input type="number" name="offset" value="0" min="0" /></label>
      </div>
      <div class="row">
        <label>Versions
          <select name="mode">
            <option value="releases-only" selected>Releases only (no prereleases)</option>
            <option value="all">All versions</option>
            <option value="latest-n">Latest N</option>
          </select></label>
        <label>N <small>(for Latest N)</small><input type="number" name="n" value="10" min="1" /></label>
      </div>${dateField}`,
    async run(f, out) {
      const mode = String(f.get("mode"));
      const versions: VersionFilter =
        mode === "all" ? { mode: "all" } : mode === "latest-n" ? { mode: "latest-n", n: Number(f.get("n")) } : { mode: "releases-only" };
      const fromWikidata = f.get("fromWikidata")
        ? f.get("all")
          ? { all: true as const, offset: Number(f.get("offset")) }
          : { limit: Number(f.get("limit")), offset: Number(f.get("offset")) }
        : undefined;
      const run = await runNpmTool(
        { client, fetchNpm: fetchFn },
        { names: String(f.get("names")).split("\n"), versions, runDate: String(f.get("runDate")), ...(fromWikidata ? { fromWikidata } : {}) },
      );
      showRun(out, run);
    },
  },
  {
    id: "fandom-check",
    label: "Fandom check",
    form: () => `
      <label>Fandom wiki <small>the subdomain, e.g. starwars</small><input name="wiki" required placeholder="starwars" /></label>
      <p class="hint">Counts the wiki's articles that already have a Fandom article ID (P6262) item. Produces no batch.</p>
      ${dateField}`,
    async run(f, out) {
      const wiki = String(f.get("wiki")).trim();
      showCheck(out, await runFandomCheck({ client, fetchFandom: fetchFn }, wiki), String(f.get("runDate")));
    },
  },
  {
    id: "fandom-map",
    label: "Fandom category map",
    form: () => `
      <label>Fandom wiki<input name="wiki" placeholder="starwars" /></label>
      <label>Category <small>creates items for its articles that have none</small><input name="category" placeholder="Droids" /></label>
      <label>Or a class-mapping config <small>JSON: wiki + categories with optional instanceOf QIDs; overrides the two fields above</small>
        <textarea name="config" rows="6" placeholder='{ "wiki": "starwars", "categories": [ { "name": "Droids", "instanceOf": "Q…" } ] }'></textarea></label>
      ${dateField}`,
    async run(f, out) {
      const raw = String(f.get("config")).trim();
      const config = raw
        ? parseFandomConfig(JSON.parse(raw))
        : parseFandomConfig({ wiki: String(f.get("wiki")).trim(), categories: [{ name: String(f.get("category")).trim() }] });
      showRun(out, await runFandomCategoryMap({ client, fetchFandom: fetchFn }, config, String(f.get("runDate"))));
    },
  },
];

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const list = (items: string[]) => (items.length ? `<ul class="report">${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");

function showRun(out: HTMLElement, run: ToolRun) {
  const { report } = run.plan;
  const link = quickStatementsUrl(run.text);
  const empty = run.text === "";
  out.innerHTML = `
    <h2>Coverage</h2>${coverageHtml(report.coverage)}
    <h2>Batch</h2>
    ${run.plan.creates.length ? `<p class="hint"><strong>This batch creates ${run.plan.creates.length} new item(s).</strong> The Wikidata Query Service can take minutes to see them, so wait before running this tool again or the same CREATEs will be proposed again.</p>` : ""}
    ${empty ? `<p class="empty">Nothing to add: Wikidata already has everything this tool maps for these entries.</p>` : `
    <textarea readonly rows="12" aria-label="QuickStatements batch">${esc(run.text)}</textarea>
    <div class="actions">
      <button type="button" id="copy">Copy</button>
      <button type="button" id="dl">Download .txt</button>
      <a id="qs" href="${link ? esc(link) : "#"}" target="_blank" rel="noopener" ${link ? "" : 'aria-disabled="true" title="Too long for a link: copy the batch instead"'}>Open in QuickStatements</a>
    </div>`}
    <div class="actions"><button type="button" id="snap">Download snapshot JSON</button></div>
    <h2>Run report</h2>
    ${report.unresolved.length ? `<p><strong>${report.unresolved.length} unresolved</strong> (no item found through the identifier property, so skipped, not guessed):</p>${list(report.unresolved.map((u) => `<code>${esc(u.key.value)}</code> ${u.property} ← ${esc(u.raw)} via ${u.via}`))}` : "<p>No unresolved values.</p>"}
    ${report.skipped.length ? `<p><strong>${report.skipped.length} skipped:</strong></p>${list(report.skipped.map((s) => `<code>${esc(s.key.value)}</code> ${esc(s.property ?? "")} ${s.reason}: ${esc(s.detail)}`))}` : ""}
    ${report.unmappedFields.length ? `<p>Source fields no mapping row reads: ${report.unmappedFields.map((f) => `<code>${esc(f)}</code>`).join(", ")}</p>` : ""}
    ${list(run.notes.map(esc))}
    <p class="hint">Mapping version ${esc(run.mappingVersion)} · run date ${esc(run.runDate)} · ${run.plan.creates.length} new item(s), ${run.plan.additions.reduce((n, a) => n + a.claims.length, 0)} statement(s) to add.</p>`;
  out.querySelector("#copy")?.addEventListener("click", () => void navigator.clipboard.writeText(run.text));
  out.querySelector("#dl")?.addEventListener("click", () => download(batchFileName(run.tool, run.runDate), run.text + "\n", "text/plain"));
  out.querySelector("#snap")?.addEventListener("click", () =>
    download(snapshotFileName(run.snapshot), JSON.stringify(run.snapshot, null, 2) + "\n", "application/json"),
  );
}

function showCheck(out: HTMLElement, c: FandomCheck, runDate: string) {
  out.innerHTML = `<h2>Coverage</h2><div class="bars">${barHtml("linked", "Linked", c.linked, c.total)}</div>
    <p>${c.total.toLocaleString()} articles on <code>${esc(c.wiki)}</code>; ${c.notLinked.toLocaleString()} have no item yet.</p>
    <div class="actions"><button type="button" id="snap">Download snapshot JSON</button></div>
    ${c.missing.length ? `<details><summary>Articles without an item (first 200)</summary>${list(c.missing.slice(0, 200).map((s) => `<code>${esc(s)}</code>`))}</details>` : ""}`;
  const snapshot = checkSnapshot(c, runDate);
  out.querySelector("#snap")?.addEventListener("click", () =>
    download(snapshotFileName(snapshot), JSON.stringify(snapshot, null, 2) + "\n", "application/json"),
  );
}

const tabs = document.getElementById("tabs") as HTMLElement;
const main = document.getElementById("tool") as HTMLElement;

function select(id: string) {
  const tool = tools.find((t) => t.id === id) ?? (tools[0] as Tool);
  history.replaceState(null, "", `#${tool.id}`);
  for (const b of tabs.querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.id === tool.id));
  main.innerHTML = `<form id="form">${tool.form()}<button class="primary" type="submit">Run</button></form><div id="out" aria-live="polite"></div>`;
  const form = main.querySelector("form") as HTMLFormElement;
  const out = main.querySelector("#out") as HTMLElement;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const button = form.querySelector("button.primary") as HTMLButtonElement;
    button.disabled = true;
    out.innerHTML = "<p>Working…</p>";
    tool.run(new FormData(form), out)
      .catch((err: unknown) => {
        out.innerHTML = `<div class="error" role="alert">${esc(err instanceof Error ? err.message : String(err))}</div>`;
      })
      .finally(() => (button.disabled = false));
  });
}

tabs.innerHTML = tools.map((t) => `<button role="tab" data-id="${t.id}" aria-selected="false">${esc(t.label)}</button>`).join("");
tabs.addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).dataset.id;
  if (id) select(id);
});
select(location.hash.slice(1));
