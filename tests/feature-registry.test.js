import { describe, expect, it, vi } from "vitest";
import { createFeatureRegistry } from "../src/core/feature-registry.js";

describe("createFeatureRegistry", () => {
  it("starts in registration order and stops in reverse order", async () => {
    const calls = [];
    const registry = createFeatureRegistry();
    registry.register({
      name: "first",
      start: () => calls.push("start:first"),
      stop: () => calls.push("stop:first"),
    });
    registry.register({
      name: "second",
      start: () => calls.push("start:second"),
      stop: () => calls.push("stop:second"),
    });

    await registry.start({});
    await registry.stop({});

    expect(calls).toEqual([
      "start:first",
      "start:second",
      "stop:second",
      "stop:first",
    ]);
  });

  it("isolates feature failures and reports them", async () => {
    const logger = { error: vi.fn() };
    const registry = createFeatureRegistry(logger);
    registry.register({
      name: "broken",
      sync: () => {
        throw new Error("broken");
      },
    });

    await registry.sync({});

    expect(logger.error).toHaveBeenCalledOnce();
  });
});
