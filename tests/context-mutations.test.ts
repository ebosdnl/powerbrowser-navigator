import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("application context usage", () => {
  it("does not mutate frozen playground context snapshots", async () => {
    const source = await readFile(
      "src/features/nextgen/action-playground/context.js",
      "utf8",
    );

    expect(source).not.toMatch(
      /currentPowerBrowserContext\??\.[A-Za-z_$][\w$]*\s*=/,
    );
  });
});
