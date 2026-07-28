import { describe, expect, it, vi } from "vitest";
import { createApplicationContext } from "../src/core/context.js";

describe("createApplicationContext", () => {
  it("publishes immutable snapshots and previous state", () => {
    const context = createApplicationContext({ identifier: "one" });
    const subscriber = vi.fn();
    context.subscribe(subscriber);

    const next = context.update({ siteType: "nextgen" });

    expect(next).toEqual({ identifier: "one", siteType: "nextgen" });
    expect(Object.isFrozen(next)).toBe(true);
    expect(subscriber).toHaveBeenCalledWith(next, { identifier: "one" });
  });
});
