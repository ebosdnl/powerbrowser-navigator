import { describe, expect, it, vi } from "vitest";
import { createAuthStateMachine } from "../src/core/auth-state.js";

describe("authentication state machine", () => {
  it("publishes immutable transitions", () => {
    const listener = vi.fn();
    const machine = createAuthStateMachine({
      clock: () => "2026-07-30T00:00:00.000Z",
    });
    machine.subscribe(listener);

    const state = machine.transition(
      "reauthenticating",
      "Trying automatic authentication.",
    );

    expect(state).toEqual({
      status: "reauthenticating",
      message: "Trying automatic authentication.",
      updatedAt: "2026-07-30T00:00:00.000Z",
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
