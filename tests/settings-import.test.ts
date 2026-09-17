import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import * as core from "../src/core/index.js";

async function setup() {
  const values = new Map<string, unknown>();
  const apply = vi.fn();
  const context = vm.createContext({
    ...core,
    SiteType: {},
    initializeNextgenLogDownloader: () => {},
    currentPowerBrowserContext: { identifier: "demo" },
    GM_getValue: (key: string, fallback: unknown) =>
      values.has(key) ? values.get(key) : fallback,
    GM_setValue: (key: string, value: unknown) => values.set(key, value),
    applyEffectiveSettings: apply,
  });
  for (const file of [
    "src/config/definitions.js",
    "src/features/betty5/settings.js",
    "src/ui/settings/data.js",
  ]) {
    vm.runInContext(await readFile(file, "utf8"), context);
  }
  return { values, apply, context };
}

describe("settings import", () => {
  it("round trips a full export in either editor scope", async () => {
    for (const scope of ["global", "application"]) {
      const { values, context, apply } = await setup();
      values.set("themeMode", "dark");
      values.set("navigationBarStyle", "auto-hide");
      values.set("powerBrowserApplicationProfiles", {
        demo: { themeMode: "betty" },
      });
      const backup = context.createPowerBrowserSettingsExport();
      values.clear();
      values.set("powerBrowserSettingsWriteScope", scope);
      context.importPowerBrowserSettings(backup, {});
      expect(context.createPowerBrowserSettingsExport().settings).toEqual(
        backup.settings,
      );
      expect(values.get("powerBrowserApplicationProfiles")).toEqual(
        backup.applicationProfiles,
      );
      expect(context.getSettingValue("themeMode")).toBe("betty");
      expect(apply).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects unsupported choices", async () => {
    const { context } = await setup();
    expect(() =>
      context.importPowerBrowserSettings({ navigationBarStyle: "invalid" }, {}),
    ).toThrow("invalid value");
  });

  it.each([
    null,
    [],
    { demo: null },
    { demo: [] },
    {
      demo: { extraB5PasswordRevealer: "false" },
    },
    { demo: { navigationBarStyle: "invalid" } },
  ])(
    "rejects invalid profiles before applying any changes: %j",
    async (applicationProfiles) => {
      const { values, context, apply } = await setup();
      values.set("themeMode", "light");
      const original = new Map(values);
      expect(() =>
        context.importPowerBrowserSettings(
          {
            format: "power-browser-settings",
            settings: { themeMode: "dark" },
            applicationProfiles,
          },
          {},
        ),
      ).toThrow();
      expect(values).toEqual(original);
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it("ignores unknown profile settings and preserves valid overrides", async () => {
    const { context, values } = await setup();
    const result = context.importPowerBrowserSettings(
      {
        settings: { themeMode: "dark" },
        applicationProfiles: {
          demo: { extraB5PasswordRevealer: false, futureSetting: true },
        },
      },
      {},
    );
    expect(result.ignored).toBe(1);
    expect(values.get("powerBrowserApplicationProfiles")).toEqual({
      demo: { extraB5PasswordRevealer: false },
    });
  });

  it("imports a standalone profile without changing global preferences", async () => {
    const { context, values } = await setup();
    values.set("themeMode", "light");
    context.importPowerBrowserSettings(
      {
        format: "power-browser-application-profile",
        identifier: "demo",
        settings: { navigationBarStyle: "auto-hide" },
      },
      {},
    );
    expect(values.get("themeMode")).toBe("light");
    expect(context.getSettingValue("navigationBarStyle")).toBe("auto-hide");
  });
});
