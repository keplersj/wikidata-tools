import type { Mapping } from "@wdt/engine";

/** Bump when rows change; recorded in coverage snapshots. */
export const NPM_MAPPING_VERSION = "npm-1";

export const P = {
  npmPackage: "P8262",
  softwareVersion: "P348",
  publicationDate: "P577",
  officialWebsite: "P856",
  bugTracker: "P1401",
  sourceRepository: "P1324",
  license: "P275",
  spdxId: "P2479",
  dependsOn: "P1547",
  referenceUrl: "P854",
  retrieved: "P813",
} as const;

export const npmMapping: Mapping = {
  version: NPM_MAPPING_VERSION,
  rows: [
    { id: "label", field: "name", target: "label" },
    { id: "description", field: "description", target: "description" },
    { id: "key", field: "name", property: P.npmPackage, value: { as: "string" } },
    {
      id: "versions",
      field: "versions",
      property: P.softwareVersion,
      value: { as: "string", path: "version" },
      qualifiers: [{ property: P.publicationDate, value: { as: "time-day", path: "time" } }],
    },
    { id: "homepage", field: "homepage", property: P.officialWebsite, value: { as: "url" } },
    { id: "bugs", field: "bugs.url", property: P.bugTracker, value: { as: "url" } },
    { id: "repository", field: "repository", property: P.sourceRepository, value: { as: "normalized-url" } },
    { id: "license", field: "license", property: P.license, value: { as: "item", via: P.spdxId } },
    { id: "dependencies", field: "dependencies", property: P.dependsOn, value: { as: "item", via: P.npmPackage } },
  ],
  references: [
    { property: P.referenceUrl, kind: "url-template", template: "https://registry.npmjs.org/{key}" },
    { property: P.retrieved, kind: "run-date" },
  ],
  // Bookkeeping fields from the registry that carry no statements.
  ignore: ["_id", "_rev", "dist-tags", "readme", "readmeFilename", "time", "users"],
};
