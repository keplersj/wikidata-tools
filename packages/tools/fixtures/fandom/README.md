# Fixtures

- `real-allpages-sample.json` is a **real recording** of one `api.php?action=query&list=allpages` response from
  `starwars.fandom.com`, made 2026-11-11 (HTTP 200, JSON, `access-control-allow-origin: *`).
- Everything else here is **SYNTHETIC**: hand-written in that same response shape, with a made-up wiki
  (`examplewiki`). QIDs such as Q100 and Q555 are test-only placeholders, not real items.

Fandom's own `/api/v1/Articles/List` sits behind a Cloudflare challenge (HTTP 403), which is why the tools use
MediaWiki's `api.php` instead.
