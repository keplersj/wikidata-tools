/**
 * Per-wiki class mapping: Fandom category → P31 instance of.
 *
 *   { "wiki": "starwars", "categories": [ { "name": "Droids", "instanceOf": "Q…" } ] }
 *
 * `instanceOf` is optional: a category without one is only used to find articles.
 */
export type FandomConfig = {
  wiki: string;
  categories: { name: string; instanceOf?: string }[];
};

export function parseFandomConfig(json: unknown): FandomConfig {
  const c = json as { wiki?: unknown; categories?: unknown };
  if (typeof c?.wiki !== "string" || !/^[a-z0-9-]+(\.[a-z0-9-]+)?$/i.test(c.wiki)) {
    throw new Error('Config needs a "wiki" (the Fandom subdomain)');
  }
  if (!Array.isArray(c.categories) || c.categories.length === 0) {
    throw new Error('Config needs a non-empty "categories" array');
  }
  const categories = c.categories.map((row: { name?: unknown; instanceOf?: unknown }, i: number) => {
    if (typeof row?.name !== "string" || row.name.trim() === "") {
      throw new Error(`categories[${i}] needs a "name"`);
    }
    if (row.instanceOf !== undefined && !(typeof row.instanceOf === "string" && /^Q\d+$/.test(row.instanceOf))) {
      throw new Error(`categories[${i}].instanceOf must be a QID like "Q123"`);
    }
    const out: FandomConfig["categories"][number] = { name: row.name.trim() };
    if (row.instanceOf !== undefined) out.instanceOf = row.instanceOf as string;
    return out;
  });
  return { wiki: c.wiki, categories };
}
