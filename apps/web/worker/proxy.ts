/**
 * The one proxy route: /api/proxy/fandom/<wiki>/api/v1/Articles/List?...
 *
 * Fandom's API sends no CORS headers (and challenges non-browser clients), so
 * the browser can't call it directly. This is deliberately NOT an open proxy:
 * one allow-listed upstream pattern, GET only, one allow-listed path, a
 * validated subdomain, no cookies or auth forwarded, no redirects followed.
 */

export const PROXY_USER_AGENT =
  "KeplersWikiDataTools/0.1.0 (https://wikidata.keplersj.com; kepler@stickajones.org)";

const WIKI_RE = /^[a-z0-9-]{1,63}$/;
const ALLOWED_PATH = "api/v1/Articles/List";
const ALLOWED_PARAMS = new Set(["limit", "offset", "category", "expand", "namespaces"]);
const MAX_QUERY = 1000;

type Upstream = (url: string, init: { headers: Record<string, string>; redirect: "manual" }) => Promise<Response>;

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function handleProxy(request: Request, upstream: Upstream): Promise<Response> {
  if (request.method !== "GET") return text(405, "Method not allowed");
  const url = new URL(request.url);
  const m = /^\/api\/proxy\/([a-z]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
  if (!m || m[1] !== "fandom") return text(404, "Unknown proxy source");
  const [, , wiki = "", path = ""] = m;
  if (!WIKI_RE.test(wiki) || path !== ALLOWED_PATH) return text(403, "Not an allowed upstream");
  if (url.search.length > MAX_QUERY) return text(414, "Query too long");

  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (!ALLOWED_PARAMS.has(k)) return text(400, `Parameter not allowed: ${k}`);
    params.append(k, v);
  }

  const target = `https://${wiki}.fandom.com/${ALLOWED_PATH}?${params.toString()}`;
  let res: Response;
  try {
    res = await upstream(target, { headers: { "user-agent": PROXY_USER_AGENT, accept: "application/json" }, redirect: "manual" });
  } catch {
    return text(502, "Upstream unreachable");
  }
  if (res.status >= 300 && res.status < 400) return text(502, "Upstream redirected; not followed");
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    // Typically Fandom's bot challenge page (HTTP 403 HTML).
    return text(502, `Upstream answered HTTP ${res.status} with ${type || "no content type"}, not JSON`);
  }
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
