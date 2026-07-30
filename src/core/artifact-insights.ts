export const ARTIFACT_COLLECTIONS = [
  "models",
  "properties",
  "pages",
  "endpoints",
  "actions",
  "actionVariables",
  "forms",
  "variables",
  "partials",
  "fileAssets",
  "customModelAttributes",
] as const;

export type ArtifactCollection = (typeof ARTIFACT_COLLECTIONS)[number];
export type ArtifactRecord = Record<string, unknown>;

export interface ArtifactSearchEntry {
  collection: ArtifactCollection;
  kind: string;
  id: string;
  label: string;
  meta: string;
  searchText: string;
  record: ArtifactRecord;
}

export interface ArtifactRelationship {
  direction: "incoming" | "outgoing";
  field: string;
  entry: ArtifactSearchEntry;
}

export interface ArtifactHealthIssue {
  severity: "error" | "warning" | "info";
  collection: string;
  id: string;
  message: string;
}

export interface ArtifactSnapshotItem {
  id: string;
  label: string;
  fingerprint: string;
}

export interface ArtifactSnapshot {
  formatVersion: 1;
  applicationIdentifier: string;
  capturedAt: string;
  collections: Record<string, ArtifactSnapshotItem[]>;
}

export interface ArtifactDiffCollection {
  collection: string;
  added: ArtifactSnapshotItem[];
  removed: ArtifactSnapshotItem[];
  changed: ArtifactSnapshotItem[];
}

const KIND_BY_COLLECTION: Record<ArtifactCollection, string> = {
  models: "model",
  properties: "property",
  pages: "page",
  endpoints: "endpoint",
  actions: "action",
  actionVariables: "action variable",
  forms: "form",
  variables: "variable",
  partials: "partial",
  fileAssets: "file asset",
  customModelAttributes: "model validation",
};

function isRecord(value: unknown): value is ArtifactRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function collectionRecords(
  collection: unknown,
): Array<{ key: string; record: ArtifactRecord }> {
  if (Array.isArray(collection)) {
    return collection
      .map((record, index) => ({ key: String(index), record }))
      .filter((entry): entry is { key: string; record: ArtifactRecord } =>
        isRecord(entry.record),
      );
  }
  if (!isRecord(collection)) return [];
  return Object.entries(collection)
    .map(([key, record]) => ({ key, record }))
    .filter((entry): entry is { key: string; record: ArtifactRecord } =>
      isRecord(entry.record),
    );
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function recordId(record: ArtifactRecord, key: string): string {
  return text(record.id || record.uuid || record.identifier || key);
}

function recordLabel(
  collection: ArtifactCollection,
  record: ArtifactRecord,
  key: string,
): string {
  const preferred =
    record.name ||
    record.label ||
    record.title ||
    record.filename ||
    record.url ||
    record.id ||
    key;
  const label = text(preferred);
  return collection === "properties" && record.label && record.name
    ? `${text(record.label)} (${text(record.name)})`
    : label;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprint(value: unknown): string {
  const source = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildArtifactSearchEntries(
  artifact: unknown,
): ArtifactSearchEntry[] {
  if (!isRecord(artifact)) return [];
  const entries: ArtifactSearchEntry[] = [];
  const modelNames = new Map(
    collectionRecords(artifact.models).map(({ key, record }) => [
      recordId(record, key),
      recordLabel("models", record, key),
    ]),
  );

  for (const collection of ARTIFACT_COLLECTIONS) {
    for (const { key, record } of collectionRecords(artifact[collection])) {
      const id = recordId(record, key);
      const label = recordLabel(collection, record, key);
      const details = [
        record.kind,
        record.apiVersion,
        record.url,
        record.modelId ? modelNames.get(text(record.modelId)) : "",
      ]
        .filter(Boolean)
        .map(text);
      const meta = [KIND_BY_COLLECTION[collection], ...details].join(" · ");
      entries.push({
        collection,
        kind: KIND_BY_COLLECTION[collection],
        id,
        label,
        meta,
        searchText: [
          collection,
          KIND_BY_COLLECTION[collection],
          id,
          label,
          ...details,
          record.mutation,
        ]
          .join(" ")
          .toLowerCase(),
        record,
      });
    }
  }
  return entries.sort(
    (left, right) =>
      left.label.localeCompare(right.label, undefined, {
        sensitivity: "base",
      }) || left.kind.localeCompare(right.kind),
  );
}

export function searchArtifactEntries(
  entries: readonly ArtifactSearchEntry[],
  query: string,
  limit = 100,
): ArtifactSearchEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return entries.slice(0, limit);
  const terms = normalized.split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => terms.every((term) => entry.searchText.includes(term)))
    .map((entry) => {
      const label = entry.label.toLowerCase();
      const id = entry.id.toLowerCase();
      const score =
        id === normalized
          ? 0
          : label === normalized
            ? 1
            : label.startsWith(normalized)
              ? 2
              : label.includes(normalized)
                ? 3
                : 4;
      return { entry, score };
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.entry.label.localeCompare(right.entry.label),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}

function collectReferences(
  value: unknown,
  path = "",
  output: Array<{ field: string; id: string }> = [],
): Array<{ field: string; id: string }> {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      collectReferences(item, path, output);
    });
    return output;
  }
  if (!isRecord(value)) return output;
  for (const [key, nested] of Object.entries(value)) {
    const field = path ? `${path}.${key}` : key;
    if (
      /Ids?$/i.test(key) ||
      /^(variables|properties|fields|actions|endpoints|pages|models|partials)$/i.test(
        key,
      )
    ) {
      const values = Array.isArray(nested) ? nested : [nested];
      values
        .filter(
          (candidate) =>
            typeof candidate === "string" || typeof candidate === "number",
        )
        .forEach((candidate) => {
          output.push({ field, id: String(candidate) });
        });
    } else if (isRecord(nested) || Array.isArray(nested)) {
      collectReferences(nested, field, output);
    }
  }
  return output;
}

export function getArtifactRelationships(
  entries: readonly ArtifactSearchEntry[],
  selected: ArtifactSearchEntry,
): ArtifactRelationship[] {
  const byId = new Map<string, ArtifactSearchEntry[]>();
  entries.forEach((entry) => {
    byId.set(entry.id, [...(byId.get(entry.id) || []), entry]);
  });
  const relationships: ArtifactRelationship[] = [];
  const seen = new Set<string>();
  const add = (
    direction: "incoming" | "outgoing",
    field: string,
    entry: ArtifactSearchEntry,
  ) => {
    if (entry === selected) return;
    const key = `${direction}:${field}:${entry.collection}:${entry.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    relationships.push({ direction, field, entry });
  };

  collectReferences(selected.record).forEach(({ field, id }) => {
    (byId.get(id) || []).forEach((entry) => {
      add("outgoing", field, entry);
    });
  });
  entries.forEach((entry) => {
    if (entry === selected) return;
    collectReferences(entry.record).forEach(({ field, id }) => {
      if (id === selected.id) add("incoming", field, entry);
    });
  });
  return relationships.sort(
    (left, right) =>
      left.direction.localeCompare(right.direction) ||
      left.entry.kind.localeCompare(right.entry.kind) ||
      left.entry.label.localeCompare(right.entry.label),
  );
}

export function auditArtifact(artifact: unknown): ArtifactHealthIssue[] {
  if (!isRecord(artifact)) {
    return [
      {
        severity: "error",
        collection: "artifact",
        id: "",
        message: "The artifact is unavailable or invalid.",
      },
    ];
  }
  const issues: ArtifactHealthIssue[] = [];
  const models = collectionRecords(artifact.models);
  const properties = collectionRecords(artifact.properties);
  const pages = collectionRecords(artifact.pages);
  const endpoints = collectionRecords(artifact.endpoints);
  const modelIds = new Set(
    models.map(({ key, record }) => recordId(record, key)),
  );
  const propertyById = new Map(
    properties.map(({ key, record }) => [recordId(record, key), record]),
  );
  const pageIds = new Set(
    pages.map(({ key, record }) => recordId(record, key)),
  );
  const endpointIds = new Set(
    endpoints.map(({ key, record }) => recordId(record, key)),
  );

  models.forEach(({ key, record }) => {
    const id = recordId(record, key);
    const labelPropertyId = text(record.labelPropertyId);
    if (
      labelPropertyId &&
      (!propertyById.has(labelPropertyId) ||
        text(propertyById.get(labelPropertyId)?.modelId) !== id)
    ) {
      issues.push({
        severity: "error",
        collection: "models",
        id,
        message: `Label property ${labelPropertyId} is missing or belongs to another model.`,
      });
    }
  });
  properties.forEach(({ key, record }) => {
    const id = recordId(record, key);
    const modelId = text(record.modelId);
    const referenceModelId = text(record.referenceModelId);
    if (modelId && !modelIds.has(modelId)) {
      issues.push({
        severity: "error",
        collection: "properties",
        id,
        message: `Model ${modelId} does not exist.`,
      });
    }
    if (referenceModelId && !modelIds.has(referenceModelId)) {
      issues.push({
        severity: "error",
        collection: "properties",
        id,
        message: `Referenced model ${referenceModelId} does not exist.`,
      });
    }
  });
  pages.forEach(({ key, record }) => {
    const id = recordId(record, key);
    const endpointId = text(record.endpointId);
    if (endpointId && !endpointIds.has(endpointId)) {
      issues.push({
        severity: "error",
        collection: "pages",
        id,
        message: `Endpoint ${endpointId} does not exist.`,
      });
    }
  });
  const endpointsByUrl = new Map<string, string[]>();
  endpoints.forEach(({ key, record }) => {
    const id = recordId(record, key);
    const url = text(record.url);
    if (!url) {
      issues.push({
        severity: "warning",
        collection: "endpoints",
        id,
        message: "Endpoint has no URL.",
      });
      return;
    }
    endpointsByUrl.set(url, [...(endpointsByUrl.get(url) || []), id]);
  });
  endpointsByUrl.forEach((ids, url) => {
    if (ids.length > 1) {
      issues.push({
        severity: "warning",
        collection: "endpoints",
        id: ids.join(", "),
        message: `Duplicate endpoint URL ${url}.`,
      });
    }
  });
  const application = isRecord(artifact.application)
    ? artifact.application
    : {};
  const notFoundPageId = text(
    artifact.notFoundPageId || application.notFoundPageId,
  );
  if (notFoundPageId && !pageIds.has(notFoundPageId)) {
    issues.push({
      severity: "error",
      collection: "application",
      id: notFoundPageId,
      message: "The configured not-found page does not exist.",
    });
  }
  collectionRecords(artifact.fileAssets).forEach(({ key, record }) => {
    if (!record.url) {
      issues.push({
        severity: "warning",
        collection: "fileAssets",
        id: recordId(record, key),
        message: "File asset has no URL.",
      });
    }
  });
  collectionRecords(artifact.actions).forEach(({ key, record }) => {
    if (!record.mutation) {
      issues.push({
        severity: "warning",
        collection: "actions",
        id: recordId(record, key),
        message: "Action has no mutation.",
      });
    }
  });
  return issues.sort(
    (left, right) =>
      ["error", "warning", "info"].indexOf(left.severity) -
        ["error", "warning", "info"].indexOf(right.severity) ||
      left.collection.localeCompare(right.collection) ||
      left.id.localeCompare(right.id),
  );
}

export function createArtifactSnapshot(
  artifact: unknown,
  capturedAt = new Date().toISOString(),
): ArtifactSnapshot {
  const source = isRecord(artifact) ? artifact : {};
  const application = isRecord(source.application) ? source.application : {};
  const applicationIdentifier = text(
    source.applicationIdentifier || application.identifier,
  );
  const collections: Record<string, ArtifactSnapshotItem[]> = {};
  for (const collection of ARTIFACT_COLLECTIONS) {
    collections[collection] = collectionRecords(source[collection])
      .map(({ key, record }) => ({
        id: recordId(record, key),
        label: recordLabel(collection, record, key),
        fingerprint: fingerprint(record),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
  return {
    formatVersion: 1,
    applicationIdentifier,
    capturedAt,
    collections,
  };
}

export function diffArtifactSnapshots(
  previous: ArtifactSnapshot,
  current: ArtifactSnapshot,
): ArtifactDiffCollection[] {
  const collectionNames = new Set([
    ...Object.keys(previous.collections || {}),
    ...Object.keys(current.collections || {}),
  ]);
  return [...collectionNames]
    .sort()
    .map((collection) => {
      const before = new Map(
        (previous.collections?.[collection] || []).map((item) => [
          item.id,
          item,
        ]),
      );
      const after = new Map(
        (current.collections?.[collection] || []).map((item) => [
          item.id,
          item,
        ]),
      );
      return {
        collection,
        added: [...after.values()].filter((item) => !before.has(item.id)),
        removed: [...before.values()].filter((item) => !after.has(item.id)),
        changed: [...after.values()].filter(
          (item) =>
            before.has(item.id) &&
            before.get(item.id)?.fingerprint !== item.fingerprint,
        ),
      };
    })
    .filter(
      ({ added, removed, changed }) =>
        added.length || removed.length || changed.length,
    );
}
