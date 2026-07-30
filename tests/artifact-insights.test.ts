import { describe, expect, it } from "vitest";
import {
  auditArtifact,
  buildArtifactSearchEntries,
  createArtifactSnapshot,
  diffArtifactSnapshots,
  getArtifactRelationships,
  searchArtifactEntries,
} from "../src/core/artifact-insights.js";

const artifact = {
  applicationIdentifier: "example-app",
  application: {
    identifier: "example-app",
    notFoundPageId: "page-missing",
  },
  models: {
    customer: {
      id: "model-customer",
      name: "Customer",
      labelPropertyId: "property-name",
    },
    order: {
      id: "model-order",
      name: "Order",
    },
  },
  properties: {
    name: {
      id: "property-name",
      name: "name",
      label: "Name",
      kind: "STRING",
      modelId: "model-customer",
    },
    customer: {
      id: "property-customer",
      name: "customer",
      kind: "BELONGS_TO",
      modelId: "model-order",
      referenceModelId: "model-customer",
    },
  },
  endpoints: {
    home: { id: "endpoint-home", url: "/" },
    duplicate: { id: "endpoint-duplicate", url: "/" },
  },
  pages: {
    home: {
      id: "page-home",
      name: "Home",
      endpointId: "endpoint-home",
      variables: ["variable-customer"],
    },
  },
  variables: {
    customer: {
      id: "variable-customer",
      name: "Current customer",
    },
  },
  actions: {
    submit: {
      id: "action-submit",
      apiVersion: "v1",
      mutation: "mutation Submit { submit }",
    },
  },
};

describe("artifact insights", () => {
  it("indexes and searches all supported artifact entities", () => {
    const entries = buildArtifactSearchEntries(artifact);
    expect(entries).toHaveLength(9);
    expect(searchArtifactEntries(entries, "customer belongs_to")).toEqual([
      expect.objectContaining({
        id: "property-customer",
        collection: "properties",
      }),
    ]);
  });

  it("finds incoming and outgoing ID relationships", () => {
    const entries = buildArtifactSearchEntries(artifact);
    const property = entries.find((entry) => entry.id === "property-customer");
    if (!property) throw new Error("Expected property fixture entry.");
    const relationships = getArtifactRelationships(entries, property);
    expect(relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "outgoing",
          field: "modelId",
          entry: expect.objectContaining({ id: "model-order" }),
        }),
        expect.objectContaining({
          direction: "outgoing",
          field: "referenceModelId",
          entry: expect.objectContaining({ id: "model-customer" }),
        }),
      ]),
    );
    const page = entries.find((entry) => entry.id === "page-home");
    if (!page) throw new Error("Expected page fixture entry.");
    expect(getArtifactRelationships(entries, page)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "outgoing",
          field: "variables",
          entry: expect.objectContaining({ id: "variable-customer" }),
        }),
      ]),
    );
  });

  it("reports broken references and duplicate routes", () => {
    const issues = auditArtifact(artifact);
    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "The configured not-found page does not exist.",
        "Duplicate endpoint URL /.",
      ]),
    );
  });

  it("creates compact snapshots and reports collection changes", () => {
    const previous = createArtifactSnapshot(
      artifact,
      "2026-01-01T00:00:00.000Z",
    );
    const current = createArtifactSnapshot(
      {
        ...artifact,
        models: {
          ...artifact.models,
          customer: {
            ...artifact.models.customer,
            name: "Client",
          },
          invoice: { id: "model-invoice", name: "Invoice" },
        },
      },
      "2026-01-02T00:00:00.000Z",
    );
    expect(diffArtifactSnapshots(previous, current)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: "models",
          added: [expect.objectContaining({ id: "model-invoice" })],
          changed: [expect.objectContaining({ id: "model-customer" })],
        }),
      ]),
    );
  });
});
