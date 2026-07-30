import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { validateSettingsDefinitions } from "../src/core/settings-validation.js";
import type { SettingDefinition, SettingsTab } from "../src/core/types.js";

const source = (await readFile("src/config/definitions.js", "utf8")).replace(
  /\binitializeNextgenLogDownloader\(\);\s*$/,
  "",
);
const context = vm.createContext({
  SiteType: Object.freeze({
    RUNTIME: "runtime",
    NEXTGEN: "nextgen",
    BETTY5: "betty5",
    PLAYGROUND: "playground",
    UNKNOWN: "unknown",
  }),
});
vm.runInContext(source, context, {
  filename: "src/config/definitions.js",
});
const [tabs, definitions] = vm.runInContext(
  "[SettingsTabs, SettingsDefinitions]",
  context,
) as [SettingsTab[], SettingDefinition[]];
const errors = validateSettingsDefinitions(
  Array.from(tabs, (tab) => ({ ...tab })),
  Array.from(definitions, (definition) => ({ ...definition })),
);

if (errors.length) {
  throw new Error(`Invalid settings configuration:\n- ${errors.join("\n- ")}`);
}

console.log(
  `Validated ${definitions.length} settings across ${tabs.length} tabs.`,
);
