import { describe, expect, it } from "vitest";
import {
  createDiagnosticTimeline,
  redactDiagnosticValue,
} from "../src/core/diagnostic-timeline.js";

describe("diagnostic timeline", () => {
  it("redacts secret-bearing keys and bearer values", () => {
    expect(
      redactDiagnosticValue({
        authorization: "Bearer abc.def.ghi",
        nested: { csrfToken: "secret", message: "Bearer abc.def.ghi" },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { csrfToken: "[REDACTED]", message: "[REDACTED]" },
    });
  });

  it("keeps only the configured number of entries", () => {
    const timeline = createDiagnosticTimeline({ limit: 2 });
    timeline.add({ source: "one", message: "1" });
    timeline.add({ source: "two", message: "2" });
    timeline.add({ source: "three", message: "3" });
    expect(timeline.entries().map((entry) => entry.source)).toEqual([
      "two",
      "three",
    ]);
  });
});
