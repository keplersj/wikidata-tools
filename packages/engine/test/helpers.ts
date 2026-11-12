import fc from "fast-check";
import { makeTime } from "../src/index.js";
import type { Entry, ExistingClaim, ItemState, Value, WantedClaim } from "../src/index.js";

export const URL_PROPS = ["P856", "P1324", "P1401"];
const NAMES = ["a", "b", "c", "d"];
const BASE_URLS = ["https://github.com/u/r", "https://example.org/x", "https://Example.org/y"];
const VERSIONS = ["1.0.0", "1.1.0", "2.0.0"];
const DAYS = ["2020-01-02", "2020-01-30", "2021-06-01"];

/** Non-canonical spellings of the same URL, as they might be stored on Wikidata. */
function urlVariants(u: string): string[] {
  const host = u.replace("https://", "");
  const [h = "", ...rest] = host.split("/");
  return [u, `${u}/`, `git+https://${host}.git`, `https://${h.toUpperCase()}/${rest.join("/")}`];
}

const time = fc
  .tuple(fc.constantFrom(...DAYS), fc.constantFrom<9 | 10 | 11>(9, 10, 11, 11))
  .map(([d, p]) => makeTime(d, p));

const refs = [
  { property: "P854", value: { type: "url", value: "https://registry.npmjs.org/x" } as Value },
  { property: "P813", value: makeTime("2026-11-11", 11) },
];

export const wantedClaim: fc.Arbitrary<WantedClaim> = fc.oneof(
  fc
    .tuple(fc.constantFrom(...URL_PROPS), fc.constantFrom(...BASE_URLS), fc.option(time, { nil: undefined }))
    .map(([property, v, t]): WantedClaim => ({
      property,
      value: { type: "url", value: v },
      ...(t ? { qualifiers: [{ property: "P813", value: t }] } : {}),
      references: refs,
    })),
  fc
    .tuple(fc.constantFrom(...VERSIONS), fc.option(time, { nil: undefined }))
    .map(([v, t]): WantedClaim => ({
      property: "P348",
      value: { type: "string", value: v },
      ...(t ? { qualifiers: [{ property: "P577", value: t }] } : {}),
      references: refs,
    })),
  fc
    .constantFrom("Q1", "Q2", "Q3")
    .map((qid): WantedClaim => ({ property: "P275", value: { type: "item", qid }, references: refs })),
  fc
    .constantFrom("MIT", "GPL", "x")
    .map((raw): WantedClaim => ({ property: "P275", value: { type: "unresolved", via: "P2479", raw } })),
);

export const entry: fc.Arbitrary<Entry> = fc
  .tuple(fc.constantFrom(...NAMES), fc.array(wantedClaim, { maxLength: 8 }), fc.boolean())
  .map(([name, claims, labelled]) => ({
    key: { property: "P8262", value: name },
    claims,
    ...(labelled ? { label: name } : {}),
  }));

export const entries = fc.array(entry, { maxLength: 6 });

const existingClaim: fc.Arbitrary<[string, ExistingClaim]> = fc.oneof(
  fc
    .tuple(fc.constantFrom(...URL_PROPS), fc.constantFrom(...BASE_URLS), fc.nat(3), fc.option(time, { nil: undefined }))
    .map(([p, u, i, t]): [string, ExistingClaim] => [
      p,
      { value: { type: "url", value: urlVariants(u)[i] ?? u }, qualifiers: t ? { P813: [t] } : {} },
    ]),
  fc
    .tuple(fc.constantFrom(...VERSIONS), fc.option(time, { nil: undefined }))
    .map(([v, t]): [string, ExistingClaim] => [
      "P348",
      { value: { type: "string", value: v }, qualifiers: t ? { P577: [t] } : {} },
    ]),
  fc
    .constantFrom("Q1", "Q2", "Q3")
    .map((qid): [string, ExistingClaim] => ["P275", { value: { type: "item", qid }, qualifiers: {} }]),
);

/** Existing items: some keys present (possibly twice, i.e. ambiguous), with arbitrary existing claims. */
export const states: fc.Arbitrary<ItemState[]> = fc
  .array(
    fc.tuple(fc.constantFrom(...NAMES), fc.array(existingClaim, { maxLength: 8 })),
    { maxLength: 6 },
  )
  .map((rows) =>
    rows.map(([name, claims], i): ItemState => {
      const out: ItemState = { qid: `Q${100 + i}`, claims: { P8262: [{ value: { type: "string", value: name }, qualifiers: {} }] } };
      for (const [p, c] of claims) (out.claims[p] ??= []).push(c);
      return out;
    }),
  );

/** Deterministic Fisher–Yates driven by a seed (no Math.random anywhere). */
export function shuffle<T>(list: readonly T[], seed: number): T[] {
  const out = [...list];
  let x = (seed >>> 0) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
