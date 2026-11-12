import { coverageBars, type Coverage, type Snapshot } from "@wdt/engine";

export const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function barHtml(kind: "linked" | "complete" | "blocked", label: string, numerator: number, denominator: number): string {
  const ratio = denominator === 0 ? 0 : numerator / denominator;
  return `<div class="bar ${kind}"><span>${esc(label)}</span>
    <div class="track" role="img" aria-label="${esc(label)} ${pct(ratio)}"><div class="fill" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
    <span class="num">${numerator.toLocaleString()} / ${denominator.toLocaleString()} (${pct(ratio)})</span></div>`;
}

/** The three coverage bars: Linked, Complete (over linked items), Blocked. */
export function coverageHtml(c: Coverage): string {
  const b = coverageBars(c);
  return `<div class="bars">${[
    barHtml("linked", "Linked", b.linked.numerator, b.linked.denominator),
    barHtml("complete", "Complete", b.complete.numerator, b.complete.denominator),
    barHtml("blocked", "Blocked", b.blocked.numerator, b.blocked.denominator),
  ].join("")}</div>`;
}

export const snapshotFileName = (s: Pick<Snapshot, "tool" | "date">): string => `snapshot-${s.tool}-${s.date}.json`;
export const batchFileName = (tool: string, date: string): string => `quickstatements-${tool}-${date}.txt`;

/** Fandom has no CORS headers, so the browser goes through the Worker's allow-listed proxy. */
export const fandomProxyBase = (wiki: string): string => `/api/proxy/fandom/${encodeURIComponent(wiki)}`;
