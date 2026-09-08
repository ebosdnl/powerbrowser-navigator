import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("navigation visibility", () => {
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
});
