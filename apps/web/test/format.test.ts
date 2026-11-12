import { describe, expect, it } from "vitest";
import { barHtml, batchFileName, coverageHtml, esc, pct, snapshotFileName } from "../src/format.js";

describe("format", () => {
  it("escapes HTML", () => expect(esc(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;"));
  it("formats percentages and tolerates empty denominators", () => {
    expect(pct(0.5)).toBe("50.0%");
    expect(barHtml("linked", "Linked", 0, 0)).toContain("0.0%");
  });
  it("renders the three bars", () => {
    const html = coverageHtml({ entries: 4, linked: 1, wanted: 10, wantedLinked: 5, presentLinked: 4, blocked: 2 });
    expect(html).toContain("25.0%");
    expect(html).toContain("80.0%");
    expect(html).toContain("20.0%");
  });
  it("names files", () => {
    expect(snapshotFileName({ tool: "npm", date: "2026-11-11" })).toBe("snapshot-npm-2026-11-11.json");
    expect(batchFileName("npm", "2026-11-11")).toBe("quickstatements-npm-2026-11-11.txt");
  });
});
