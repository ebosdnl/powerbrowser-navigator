import { describe, expect, it } from "vitest";
import {
  getQuickSwitcherViewCachePolicy,
  isQuickSwitcherViewCacheFresh,
} from "../src/core/view-cache-policy.js";

const family = [
  { id: "production", identifier: "app", parentId: null },
  {
    id: "acceptance",
    identifier: "app-acceptance",
    parentId: "production",
    lastMerge: { insertedAt: "2026-08-10T10:00:00Z" },
  },
  {
    id: "development",
    identifier: "app-development",
    parentId: "acceptance",
    lastMerge: { insertedAt: "2026-08-11T10:00:00Z" },
  },
  {
    id: "branch",
    identifier: "app-branch",
    parentId: "development",
    isBranch: true,
    lastMerge: { insertedAt: "2026-08-12T10:00:00Z" },
  },
];

describe("Quick switcher view-cache policy", () => {
  it("uses five-minute freshness for the lowest non-branch environment", () => {
    const policy = getQuickSwitcherViewCachePolicy("app-development", family);
    const now = Date.parse("2026-08-12T12:00:00Z");

    expect(policy.kind).toBe("development");
    expect(
      isQuickSwitcherViewCacheFresh(
        { environmentKind: "development", savedAt: now - 299_999 },
        policy,
        now,
      ),
    ).toBe(true);
    expect(
      isQuickSwitcherViewCacheFresh(
        { environmentKind: "development", savedAt: now - 300_001 },
        policy,
        now,
      ),
    ).toBe(false);
  });

  it("invalidates a parent cache only when a direct lower sandbox merged", () => {
    const policy = getQuickSwitcherViewCachePolicy("app-acceptance", family);
    const currentMerge = Date.parse("2026-08-11T10:00:00Z");

    expect(policy.kind).toBe("merge-aware");
    expect(policy.lowerMergeVersions).toEqual({
      development: currentMerge,
    });
    expect(
      isQuickSwitcherViewCacheFresh(
        {
          environmentKind: "merge-aware",
          lowerMergeVersions: { development: currentMerge },
        },
        policy,
      ),
    ).toBe(true);
    expect(
      isQuickSwitcherViewCacheFresh(
        {
          environmentKind: "merge-aware",
          lowerMergeVersions: { development: currentMerge - 1 },
        },
        policy,
      ),
    ).toBe(false);
  });
});
