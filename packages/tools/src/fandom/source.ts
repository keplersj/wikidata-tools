import type { FetchLike } from "../wikidata/client.js";

/** A page from the MediaWiki API (`allpages` / `categorymembers`). */
export type FandomArticle = { title: string; ns: number; pageid?: number };

type ApiResponse = {
  continue?: Record<string, string>;
  query?: { allpages?: FandomArticle[]; categorymembers?: FandomArticle[] };
  error?: { code?: string; info?: string };
};

/** Where a wiki's `api.php` lives. Overridable for tests. */
export type FandomBase = (wiki: string) => string;

export const directFandomBase: FandomBase = (wiki) => `https://${wiki}.fandom.com`;

/**
 * The page's P6262 slug: the title with spaces as underscores, otherwise as
 * is. Wikidata stores `starwars:Dennis_Brännvall` and `starwars:Katy_O'Brian`,
 * decoded, not percent-encoded. The old scripts compared titles ("Anakin
 * Skywalker") in one place and slugs in the other; always use this.
 */
export function slugOf(article: Pick<FandomArticle, "title">): string {
  return article.title.trim().replace(/ /g, "_");
}

export const fandomKeyValue = (wiki: string, slug: string): string => `${wiki}:${slug}`;

const MAX_PAGES = 400;

/**
 * Lists a wiki's content pages (namespace 0, no redirects), or one category's
 * members, through MediaWiki's `api.php`, following `continue`. Unlike
 * Fandom's `/api/v1`, `api.php` is not behind a Cloudflare challenge and
 * answers CORS (`origin=*`), so browsers call it directly. No custom headers
 * are sent, to avoid a CORS preflight.
 */
export async function fetchArticles(
  fetchFn: FetchLike,
  wiki: string,
  opts: { category?: string; base?: FandomBase; onPage?: (articlesSoFar: number) => void } = {},
): Promise<FandomArticle[]> {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)?$/i.test(wiki)) throw new Error(`Not a Fandom wiki name: ${wiki}`);
  const base = (opts.base ?? directFandomBase)(wiki);
  const category = opts.category?.trim().replace(/^Category:/i, "");
  const listing: Record<string, string> = category
    ? { list: "categorymembers", cmtitle: `Category:${category}`, cmnamespace: "0", cmtype: "page", cmlimit: "500" }
    : { list: "allpages", apnamespace: "0", apfilterredir: "nonredirects", aplimit: "500" };
  const out = new Map<string, FandomArticle>();
  let more: Record<string, string> = {};
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ action: "query", format: "json", origin: "*", ...listing, ...more });
    const res = await fetchFn(`${base}/api.php?${params.toString()}`);
    if (!res.ok) throw new Error(`Fandom ${wiki}: HTTP ${res.status}`);
    const body = (await res.json()) as ApiResponse;
    if (body.error) throw new Error(`Fandom ${wiki}: ${body.error.code ?? "error"}: ${body.error.info ?? ""}`);
    for (const a of body.query?.allpages ?? body.query?.categorymembers ?? []) out.set(a.title, a);
    opts.onPage?.(out.size);
    if (!body.continue) return [...out.values()];
    more = body.continue;
  }
  throw new Error(`Fandom ${wiki}: gave up after ${MAX_PAGES} pages`);
}
