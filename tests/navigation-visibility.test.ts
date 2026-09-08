import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("navigation visibility", () => {
  it("uses a forgiving proximity boundary around the navigation", async () => {
    const source = await readFile("src/ui/navigator-shell.js", "utf8");
    const context = vm.createContext({});
    vm.runInContext(
      `${source}\n;globalThis.isNear = isPointNearNavigationElement;`,
      context,
    );
    const element = {
      getBoundingClientRect: () => ({
        left: 100,
        right: 200,
        top: 10,
        bottom: 50,
      }),
    };

    expect(context.isNear(90, 30, element)).toBe(true);
    expect(context.isNear(210, 60, element)).toBe(true);
    expect(context.isNear(80, 30, element)).toBe(false);
  });

  it("keeps the current navigation style as the default", async () => {
    const source = await readFile("src/config/definitions.js", "utf8");
    expect(source).toContain('key: "navigationBarStyle"');
    expect(source).toContain('defaultValue: "default"');
  });

  it("persists toggles and reapplies the saved state", async () => {
    const source = await readFile("src/features/betty5/settings.js", "utf8");
    const values = new Map<string, unknown>();
    const context = vm.createContext({
      GM_getValue: (key: string, fallback: unknown) =>
        values.has(key) ? values.get(key) : fallback,
      GM_setValue: (key: string, value: unknown) => values.set(key, value),
    });
    vm.runInContext(
      `${source}\n;globalThis.visibility = { applyPersistentNavigatorVisibility, togglePersistentNavigatorVisibility };`,
      context,
    );
    const classes = new Set<string>();
    const navigator = {
      navigatorBar: {
        classList: {
          toggle: (name: string, enabled: boolean) =>
            enabled ? classes.add(name) : classes.delete(name),
        },
      },
    };

    context.visibility.togglePersistentNavigatorVisibility(navigator);

    expect(values.get("powerBrowserNavigationHidden")).toBe(true);
    expect(classes.has("power-browser-setting-hidden-v2")).toBe(true);

    classes.clear();
    context.visibility.applyPersistentNavigatorVisibility(
      navigator,
      values.get("powerBrowserNavigationHidden"),
    );
    expect(classes.has("power-browser-setting-hidden-v2")).toBe(true);
  });

  it("applies navigation visibility changes received from another tab", async () => {
    const source = await readFile("src/ui/settings/dialog.js", "utf8");
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const applied: unknown[] = [];
    const context = vm.createContext({
      SettingsDefinitions: [],
      settingsState: null,
      globalThis: {
        GM_addValueChangeListener: (
          key: string,
          listener: (...args: unknown[]) => void,
        ) => listeners.set(key, listener),
      },
      POWER_BROWSER_NAVIGATION_HIDDEN_KEY: "powerBrowserNavigationHidden",
      applyPersistentNavigatorVisibility: (
        _navigator: unknown,
        hidden: unknown,
      ) => applied.push(hidden),
    });
    vm.runInContext(
      `${source}\n;globalThis.initializeSettingSynchronization = initializeSettingSynchronization;`,
      context,
    );
    context.globalThis.initializeSettingSynchronization({});

    listeners.get("powerBrowserNavigationHidden")?.(
      "powerBrowserNavigationHidden",
      false,
      true,
      true,
    );

    expect(applied).toEqual([true]);
  });

  it("applies and clears the auto-hide appearance without duplicating navigation", async () => {
    const source = await readFile("src/features/betty5/settings.js", "utf8");
    const context = vm.createContext({});
    vm.runInContext(
      `${source}\n;globalThis.visibility = { applyNavigatorAppearanceMode };`,
      context,
    );
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    const navigator = {
      navigatorBar: {
        classList: {
          contains: (name: string) => classes.has(name),
          remove: (name: string) => classes.delete(name),
          toggle: (name: string, enabled: boolean) =>
            enabled ? classes.add(name) : classes.delete(name),
        },
      },
      autoHideHandle: {
        hidden: true,
        title: "",
        setAttribute: (name: string, value: string) =>
          attributes.set(name, value),
      },
    };

    context.visibility.applyNavigatorAppearanceMode(navigator, "auto-hide");
    expect(classes.has("power-browser-navigation-auto-hide-v2")).toBe(true);
    expect(navigator.autoHideHandle.hidden).toBe(false);
    expect(attributes.get("aria-expanded")).toBe("false");

    context.visibility.applyNavigatorAppearanceMode(navigator, "default");
    expect(classes.has("power-browser-navigation-auto-hide-v2")).toBe(false);
    expect(navigator.autoHideHandle.hidden).toBe(true);
  });

  it("applies hotfix styling to both the navigation and its handle shell", async () => {
    const source = await readFile("src/features/betty5/settings.js", "utf8");
    const toggledElements: string[] = [];
    const context = vm.createContext({
      currentPowerBrowserContext: {
        siteType: "betty5",
        identifier: null,
      },
      SiteType: { BETTY5: "betty5" },
      SettingsDefinitions: [{ key: "extraHotfix", defaultValue: false }],
      GM_getValue: (key: string, fallback: unknown) =>
        key === "extraHotfix" ? true : fallback,
      resolveEffectiveSetting: (value: unknown) => value,
      document: {
        getElementById: (id: string) => ({
          classList: {
            toggle: (_name: string, enabled: boolean) => {
              if (enabled) toggledElements.push(id);
            },
          },
        }),
      },
    });
    vm.runInContext(
      `${source}\n;globalThis.applyHotfix = applyHotfixMenuState;`,
      context,
    );

    context.applyHotfix();

    expect(toggledElements).toEqual(["navigatorBar", "dropdownMenu"]);
  });

  it("does not restore navbar focus after pointer-closing settings", async () => {
    const source = await readFile("src/ui/settings/dialog.js", "utf8");

    expect(source).toContain(
      "closeSettings({ restoreFocus: event.detail === 0 })",
    );
    expect(source).toContain(
      "closePowerBrowserModal(settingsState.dialog, { restoreFocus })",
    );
  });
});
