import { describe, expect, it } from "vitest";
import {
  QUICK_SWITCHER_RESULT_TYPES,
  emptyJsonLeafValues,
  isQuickSwitcherResultPreferences,
  normalizeQuickSwitcherResultPreferences,
  normalizeUrlWithoutQuery,
} from "../src/core/quick-switcher-preferences.js";

describe("Quick switcher preferences", () => {
  it("preserves valid ordering and fills in missing result types", () => {
    const result = normalizeQuickSwitcherResultPreferences([
      { id: "view", enabled: false },
      { id: "navigation", enabled: true },
      { id: "view", enabled: true },
      { id: "unknown", enabled: true },
    ]);

    expect(result.slice(0, 2)).toEqual([
      { id: "view", enabled: false },
      { id: "navigation", enabled: true },
    ]);
    expect(result).toHaveLength(QUICK_SWITCHER_RESULT_TYPES.length);
    expect(new Set(result.map(({ id }) => id)).size).toBe(result.length);
  });

  it("validates complete persisted result preferences", () => {
    const value = normalizeQuickSwitcherResultPreferences(null);
    expect(isQuickSwitcherResultPreferences(value)).toBe(true);
    expect(isQuickSwitcherResultPreferences(value.slice(1))).toBe(false);
  });

  it("removes query parameters while retaining hashes", () => {
    expect(
      normalizeUrlWithoutQuery(
        "https://example.test/app/pages?tab=details#section",
      ),
    ).toBe("https://example.test/app/pages#section");
  });

  it("keeps view-state hash suffixes distinct from searchable destinations", () => {
    const searchableUrl = normalizeUrlWithoutQuery(
      "https://example.test/#54f53568adc943a0863d27d9272c7194",
    );
    const statefulUrl = normalizeUrlWithoutQuery(
      "https://example.test/#54f53568adc943a0863d27d9272c7194:o=0b02dc3fbc854359b75a5086e13bf632:asc",
    );

    expect(statefulUrl).not.toBe(searchableUrl);
  });
});

describe("Playground variable defaults", () => {
  it("replaces every generated leaf value with an empty string", () => {
    expect(
      emptyJsonLeafValues({
        input: {
          from_date_time: "Text",
          ignore_this_log: "Checkbox",
          page: "Number",
        },
      }),
    ).toEqual({
      input: {
        from_date_time: "",
        ignore_this_log: "",
        page: "",
      },
    });
  });
});
