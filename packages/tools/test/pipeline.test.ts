import { describe, expect, it } from "vitest";
import { npmMapping, runPipeline, type SparqlBinding, type WikidataClient } from "../src/index.js";

const row = (v: string, qid: string): SparqlBinding => ({
  v: { type: "literal", value: v },
  item: { type: "uri", value: `http://www.wikidata.org/entity/${qid}` },
});

describe("runPipeline (regression: batch #67228)", () => {
  it("never emits a dependency whose resolved item was deleted; reports it instead", async () => {
    // a exists as Q10. Its dependency "gone" still resolves to Q99 in the (stale) Query Service,
    // but Q99 has been deleted, so wbgetentities has no entity for it.
    const client: WikidataClient = {
      async sparql(q) {
        if (q.includes('"gone"')) return [row("gone", "Q99")];
        return [row("a", "Q10")];
      },
      async getEntities(ids) {
        return ids.includes("Q10") ? [{ id: "Q10", claims: { P8262: [{ mainsnak: { snaktype: "value", datatype: "external-id", datavalue: { type: "string", value: "a" } } }] } }] : [];
      },
    };
    const run = await runPipeline({
      tool: "npm",
      client,
      mapping: npmMapping,
      runDate: "2026-11-12",
      entries: [{ key: { property: "P8262", value: "a" }, fields: { name: "a", dependencies: ["gone"] } }],
    });
    expect(run.text).not.toContain("Q99");
    expect(run.text).not.toContain("P1547");
    expect(run.plan.report.unresolved).toEqual([{ key: { property: "P8262", value: "a" }, property: "P1547", via: "P8262", raw: "gone" }]);
    expect(run.notes).toEqual(["Q99: matched an identifier but the item no longer exists (deleted or redirected), not used"]);
  });
});
