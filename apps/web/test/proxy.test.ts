import { describe, expect, it } from "vitest";
import { handleProxy, PROXY_USER_AGENT } from "../worker/proxy.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const req = (path: string, method = "GET") => new Request(`https://wikidata.keplersj.com${path}`, { method });

function upstream(res: Response) {
  const calls: { url: string; headers: Record<string, string>; redirect: string }[] = [];
  return { calls, fn: async (url: string, init: { headers: Record<string, string>; redirect: "manual" }) => (calls.push({ url, ...init }), res) };
}

describe("fandom proxy", () => {
  it("forwards an allowed request with an honest UA, no cookies, short cache", async () => {
    const u = upstream(json({ items: [] }));
    const res = await handleProxy(req("/api/proxy/fandom/starwars/api/v1/Articles/List?limit=1000&offset=&category=Droids"), u.fn);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(u.calls).toHaveLength(1);
    expect(u.calls[0]?.url).toBe("https://starwars.fandom.com/api/v1/Articles/List?limit=1000&offset=&category=Droids");
    expect(u.calls[0]?.headers["user-agent"]).toBe(PROXY_USER_AGENT);
    expect(Object.keys(u.calls[0]?.headers ?? {})).not.toContain("cookie");
    expect(u.calls[0]?.redirect).toBe("manual");
  });

  it.each([
    ["/api/proxy/other/starwars/api/v1/Articles/List", 404],
    ["/api/proxy/fandom/evil.com/api/v1/Articles/List", 403],
    ["/api/proxy/fandom/star..wars/api/v1/Articles/List", 403],
    ["/api/proxy/fandom/starwars/api.php", 403],
    ["/api/proxy/fandom/starwars/api/v1/Articles/List/../../x", 403],
    ["/api/proxy/fandom/starwars/api/v1/Articles/List?url=http://evil", 400],
    [`/api/proxy/fandom/starwars/api/v1/Articles/List?category=${"a".repeat(1100)}`, 414],
  ])("rejects %s with %i and never contacts upstream", async (path, status) => {
    const u = upstream(json({}));
    expect((await handleProxy(req(path), u.fn)).status).toBe(status);
    expect(u.calls).toHaveLength(0);
  });

  it("is GET only", async () => {
    const u = upstream(json({}));
    expect((await handleProxy(req("/api/proxy/fandom/starwars/api/v1/Articles/List", "POST"), u.fn)).status).toBe(405);
    expect(u.calls).toHaveLength(0);
  });

  it("does not follow redirects and refuses non-JSON upstream answers (bot challenge)", async () => {
    const redirect = upstream(new Response(null, { status: 302, headers: { location: "https://evil.example" } }));
    expect((await handleProxy(req("/api/proxy/fandom/starwars/api/v1/Articles/List"), redirect.fn)).status).toBe(502);
    const challenge = upstream(new Response("<html>Just a moment...</html>", { status: 403, headers: { "content-type": "text/html" } }));
    const res = await handleProxy(req("/api/proxy/fandom/starwars/api/v1/Articles/List"), challenge.fn);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("not JSON");
  });

  it("reports an unreachable upstream", async () => {
    const res = await handleProxy(req("/api/proxy/fandom/starwars/api/v1/Articles/List"), async () => {
      throw new Error("boom");
    });
    expect(res.status).toBe(502);
  });
});
