import { formatValue } from "./emit.js";
import { makeTime, valuesEqual } from "./normalize.js";
import type { ExistingClaim, ItemState, TimePrecision, Value } from "./types.js";

/**
 * A faithful-enough model of what QuickStatements v1 does with our output,
 * for tests: it parses the emitted *text* (not the Plan) and applies it to
 * item states the way QuickStatements does. Notably, it merges into an
 * existing statement only on an exact property + literal match; anything
 * else adds a new statement. This is what catches "qualifier-only line
 * repeated the wanted value instead of the stored one" bugs.
 *
 * Not used in production code.
 */
export type SimOptions = {
  /** Properties whose quoted values are URLs rather than plain strings. */
  urlProperties?: string[];
  /** First QID number to hand out for CREATE. */
  firstNewQid?: number;
  /**
   * Called when a line adds a new statement although an equal-after-normalization
   * one already exists: QuickStatements would create a duplicate instead of merging.
   */
  onNearDuplicate?: (info: { subject: string; property: string; literal: string }) => void;
};

function parseLiteral(lit: string, property: string, urls: Set<string>): Value {
  if (lit.startsWith('"')) {
    const value = lit.slice(1, -1);
    return urls.has(property) ? { type: "url", value } : { type: "string", value };
  }
  if (/^Q\d+$/.test(lit)) return { type: "item", qid: lit };
  const t = /^\+(\d{4}-\d{2}-\d{2})T00:00:00Z\/(9|10|11)$/.exec(lit);
  if (t) return makeTime(t[1] ?? "", Number(t[2]) as TimePrecision);
  throw new Error(`Unparseable QuickStatements value: ${lit}`);
}

export function applyQuickStatements(
  text: string,
  states: ItemState[],
  options: SimOptions = {},
): ItemState[] {
  const urls = new Set(options.urlProperties ?? []);
  const out: ItemState[] = states.map((s) => ({
    qid: s.qid,
    claims: Object.fromEntries(
      Object.entries(s.claims).map(([p, list]) => [
        p,
        list.map((c) => ({
          value: c.value,
          qualifiers: Object.fromEntries(
            Object.entries(c.qualifiers).map(([qp, vs]) => [qp, [...vs]]),
          ),
        })),
      ]),
    ),
  }));
  const byQid = new Map(out.map((s) => [s.qid, s]));
  let next = options.firstNewQid ?? 900_000_000;
  let last: ItemState | undefined;

  for (const line of text.split("\n")) {
    if (line === "") continue;
    if (line === "CREATE") {
      last = { qid: `Q${next++}`, claims: {} };
      out.push(last);
      byQid.set(last.qid, last);
      continue;
    }
    const [subject, property, valueLit, ...rest] = line.split("\t");
    if (!subject || !property) throw new Error(`Bad line: ${line}`);
    if (property === "Len" || property === "Den") continue;
    const item = subject === "LAST" ? last : byQid.get(subject);
    if (!item) throw new Error(`Unknown subject ${subject}`);
    if (valueLit === undefined) throw new Error(`Missing value: ${line}`);
    const value = parseLiteral(valueLit, property, urls);
    const qualifiers: [string, Value][] = [];
    for (let i = 0; i + 1 < rest.length; i += 2) {
      const qp = rest[i] ?? "";
      if (qp.startsWith("S")) continue; // references aren't modelled
      qualifiers.push([qp, parseLiteral(rest[i + 1] ?? "", qp, urls)]);
    }
    const list = (item.claims[property] ??= []);
    const exact = formatValue(value);
    let target: ExistingClaim | undefined = list.find((c) => formatValue(c.value) === exact);
    if (!target) {
      if (list.some((c) => valuesEqual(c.value, value))) {
        options.onNearDuplicate?.({ subject: item.qid, property, literal: exact });
      }
      target = { value, qualifiers: {} };
      list.push(target);
    }
    for (const [qp, qv] of qualifiers) {
      const have = (target.qualifiers[qp] ??= []);
      if (!have.some((h) => formatValue(h) === formatValue(qv))) have.push(qv);
    }
  }
  return out;
}
