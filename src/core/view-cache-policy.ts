export interface ApplicationFamilyEntry {
  id?: string | number | null;
  identifier?: string | null;
  isBranch?: boolean | null;
  parentId?: string | number | null;
  parent?: { id?: string | number | null } | null;
  lastMerge?: { insertedAt?: string | null } | null;
}

export interface ViewCachePolicy {
  kind: "unknown" | "development" | "merge-aware";
  cacheKey: string;
  lowerMergeVersions: Record<string, number>;
}

export interface StoredViewCacheMetadata {
  savedAt?: number | null;
  environmentKind?: string | null;
  lowerMergeVersions?: Record<string, number> | null;
}

const parseTimestamp = (value?: string | null): number => {
  const timestamp = Date.parse(value || "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export function getQuickSwitcherViewCachePolicy(
  identifier: string,
  applicationFamily:
    ApplicationFamilyEntry | ApplicationFamilyEntry[] | null | undefined,
): ViewCachePolicy {
  const applications = (
    Array.isArray(applicationFamily)
      ? applicationFamily
      : applicationFamily
        ? [applicationFamily]
        : []
  ).filter((application) => application?.id && application?.identifier);
  const currentApplication = applications.find(
    (application) => application.identifier === identifier,
  );
  if (!currentApplication) {
    return {
      kind: "unknown",
      cacheKey: "unknown",
      lowerMergeVersions: {},
    };
  }

  const currentId = String(currentApplication.id);
  const lowerApplications = applications.filter((application) => {
    const parentId = application.parentId ?? application.parent?.id;
    return !application.isBranch && String(parentId || "") === currentId;
  });
  if (currentApplication.isBranch || !lowerApplications.length) {
    return {
      kind: "development",
      cacheKey: "development",
      lowerMergeVersions: {},
    };
  }

  const lowerMergeVersions = Object.fromEntries(
    lowerApplications
      .map(
        (application) =>
          [
            String(application.id),
            parseTimestamp(application.lastMerge?.insertedAt),
          ] as const,
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    kind: "merge-aware",
    cacheKey: `merge:${Object.entries(lowerMergeVersions)
      .map(([id, timestamp]) => `${id}:${timestamp}`)
      .join(",")}`,
    lowerMergeVersions,
  };
}

export function isQuickSwitcherViewCacheFresh(
  entry: StoredViewCacheMetadata,
  policy: ViewCachePolicy,
  now = Date.now(),
  developmentTtl = 5 * 60 * 1000,
): boolean {
  if (entry.environmentKind !== policy.kind) {
    return false;
  }
  if (policy.kind === "merge-aware") {
    const cachedMergeVersions = entry.lowerMergeVersions || {};
    return Object.entries(policy.lowerMergeVersions).every(
      ([applicationId, timestamp]) =>
        Number(cachedMergeVersions[applicationId] || 0) >= timestamp,
    );
  }

  return now - Number(entry.savedAt || 0) <= developmentTtl;
}
