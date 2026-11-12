/**
 * Core types. Everything in @wdt/engine is plain data: no DOM, no Worker, no
 * network, no clock. Other packages depend on these shapes, so change them
 * deliberately.
 */

/** The identifier that makes an item "exist" for a source, e.g. { P8262, "left-pad" }. */
export type Key = { property: string; value: string };

/** Time precisions we emit and compare: 9 = year, 10 = month, 11 = day. */
export type TimePrecision = 9 | 10 | 11;

export type Value =
  | { type: "string"; value: string }
  | { type: "url"; value: string }
  | { type: "item"; qid: string }
  /** `iso` is always a canonical `YYYY-MM-DD`; finer parts are ignored below `precision`. */
  | { type: "time"; iso: string; precision: TimePrecision }
  /** The resolver could not turn `raw` into a QID through identifier property `via`. */
  | { type: "unresolved"; via: string; raw: string };

export type Qualifier = { property: string; value: Value };

/** A statement we want an item to have. References are attached on creation, never compared. */
export type WantedClaim = {
  property: string;
  value: Value;
  qualifiers?: Qualifier[];
  references?: Qualifier[];
};

/** One source entry: the key that identifies it plus everything we want said about it. */
export type Entry = {
  key: Key;
  /** English label/description, used only when the item has to be created. */
  label?: string;
  description?: string;
  claims: WantedClaim[];
};

/**
 * A statement already on Wikidata. `value` is kept exactly as stored (raw),
 * because QuickStatements merges into an existing statement only on an exact
 * property+value match, so qualifier-only lines must repeat the stored value.
 */
export type ExistingClaim = { value: Value; qualifiers: Record<string, Value[]> };

export type ItemState = { qid: string; claims: Record<string, ExistingClaim[]> };

/** Items currently on Wikidata, by `keyId(key)`. More than one item means the key is ambiguous. */
export type CurrentState = Record<string, ItemState[]>;

export type Skipped = {
  key: Key;
  property?: string;
  reason: "unsafe-for-quickstatements" | "ambiguous-key" | "too-long";
  detail: string;
};

export type UnresolvedStatement = {
  key: Key;
  property: string;
  via: string;
  raw: string;
};

export type Coverage = {
  /** Entries in the source index. */
  entries: number;
  /** Entries that already have exactly one item. */
  linked: number;
  /** Wanted statements over all entries (incl. blocked and skipped). */
  wanted: number;
  /** Wanted statements over linked items only. */
  wantedLinked: number;
  /** Of those, how many are already on the item (value and wanted qualifiers). */
  presentLinked: number;
  /** Wanted statements whose value could not be resolved to a QID. */
  blocked: number;
};

export type RunReport = {
  unresolved: UnresolvedStatement[];
  skipped: Skipped[];
  /** Source fields no mapping row reads. */
  unmappedFields: string[];
  coverage: Coverage;
};

export type PlanAddition = { key: Key; qid: string; claims: WantedClaim[] };

export type Plan = {
  creates: Entry[];
  additions: PlanAddition[];
  report: RunReport;
};
