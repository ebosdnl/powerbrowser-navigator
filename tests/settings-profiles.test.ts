import { describe, expect, it } from "vitest";
import {
  hasApplicationOverride,
  removeApplicationOverride,
  resolveEditableSetting,
  resolveEffectiveSetting,
  setApplicationOverride,
} from "../src/core/settings-profiles.js";

describe("application settings profiles", () => {
  it("inherits globals until an application override is created", () => {
    const profiles = {};
    expect(resolveEffectiveSetting(true, profiles, "app-one", "hidden")).toBe(
      true,
    );
    expect(
      resolveEditableSetting(
        "application",
        true,
        profiles,
        "app-one",
        "hidden",
      ),
    ).toBe(true);
  });

  it("keeps the effective override while allowing the global layer to be edited", () => {
    const profiles = setApplicationOverride({}, "app-one", "hidden", false);
    expect(hasApplicationOverride(profiles, "app-one", "hidden")).toBe(true);
    expect(resolveEffectiveSetting(true, profiles, "app-one", "hidden")).toBe(
      false,
    );
    expect(
      resolveEditableSetting("global", true, profiles, "app-one", "hidden"),
    ).toBe(true);
  });

  it("falls back to global after removing the final override", () => {
    const profiles = removeApplicationOverride(
      { "app-one": { hidden: false } },
      "app-one",
      "hidden",
    );
    expect(profiles).toEqual({});
    expect(resolveEffectiveSetting(true, profiles, "app-one", "hidden")).toBe(
      true,
    );
  });
});
