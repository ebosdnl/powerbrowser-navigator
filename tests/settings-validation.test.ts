import { describe, expect, it } from "vitest";
import { validateSettingsDefinitions } from "../src/core/settings-validation.js";
import type { SettingDefinition } from "../src/core/types.js";

describe("settings validation", () => {
  it("accepts a valid setting and rejects schema mistakes", () => {
    const tabs = [{ id: "general", label: "General" }];
    const valid: SettingDefinition[] = [
      {
        key: "enabled",
        tab: "general",
        label: "Enabled",
        description: "Enable the feature.",
        type: "toggle",
        defaultValue: false,
      },
    ];
    expect(validateSettingsDefinitions(tabs, valid)).toEqual([]);
    expect(
      validateSettingsDefinitions(tabs, [
        ...valid,
        { ...valid[0], tab: "missing", defaultValue: "yes" },
      ]),
    ).toEqual(
      expect.arrayContaining([
        'Duplicate setting key "enabled".',
        'Setting "enabled" references unknown tab "missing".',
        'Toggle "enabled" must have a boolean default.',
      ]),
    );
  });

  it("validates bounded integer settings", () => {
    const tabs = [{ id: "nextgen", label: "Next-gen" }];
    const numberSetting: SettingDefinition = {
      key: "historyLength",
      tab: "nextgen",
      label: "History length",
      description: "Maximum retained entries.",
      type: "number",
      defaultValue: 20,
      min: 1,
      max: 50,
    };
    expect(validateSettingsDefinitions(tabs, [numberSetting])).toEqual([]);
    expect(
      validateSettingsDefinitions(tabs, [
        { ...numberSetting, defaultValue: 50.5 },
      ]),
    ).toContain(
      'Number setting "historyLength" needs a default between its min and max.',
    );
  });
});
