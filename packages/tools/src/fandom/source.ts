import type { FetchLike } from "../wikidata/client.js";

export type FandomArticle = { id: number; title: string; url: string; ns: number };

type ListResponse = { items: FandomArticle[]; basepath?: string; offset?: string };

/** Where to call the Fandom API. The browser app points this at the Worker proxy (Fandom sends no CORS headers). */
export type FandomBase = (wiki: string) => string;

export const directFandomBase: FandomBase = (wiki) => `https://${wiki}.fandom.com`;

/**
 * The article's URL slug, which is how P6262 values are stored (`wiki:Slug`).
 * The old scripts compared titles ("Anakin Skywalker") in one place and slugs
 * ("Anakin_Skywalker") in the other; always use this.
 */
export function slugOf(article: Pick<FandomArticle, "url">): string {
  return article.url.replace(/^\/wiki\//, "");
}

export const fandomKeyValue = (wiki: string, slug: string): string => `${wiki}:${slug}`;

/** Follows `offset` pagination through Articles/List. */
export async function fetchArticles(
  fetchFn: FetchLike,
  wiki: string,
  opts: { category?: string; base?: FandomBase } = {},
): Promise<FandomArticle[]> {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)?$/i.test(wiki)) throw new Error(`Not a Fandom wiki name: ${wiki}`);
  const base = (opts.base ?? directFandomBase)(wiki);
  const out: FandomArticle[] = [];
  let offset: string | undefined = "";
  while (offset !== undefined) {
    const params = new URLSearchParams({ limit: "1000", offset });
    if (opts.category) params.set("category", opts.category);
    const res = await fetchFn(`${base}/api/v1/Articles/List?${params.toString()}`);
    if (!res.ok) throw new Error(`Fandom ${wiki}: HTTP ${res.status}`);
    const body = (await res.json()) as ListResponse;
    out.push(...body.items);
    offset = body.offset || undefined;
  }
  return out;
}
