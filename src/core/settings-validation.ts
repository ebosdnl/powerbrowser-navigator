import type { SettingDefinition, SettingsTab, SettingType } from "./types.js";

const VALID_TYPES = new Set<SettingType>([
  "toggle",
  "shortcut",
  "theme",
  "size",
  "choice",
  "number",
  "sortable-list",
]);

export function validateSettingsDefinitions(
  tabs: readonly Partial<SettingsTab>[],
  definitions: readonly Partial<SettingDefinition>[],
): string[] {
  const errors: string[] = [];
  const tabIds = new Set<string | undefined>();
  const keys = new Set<string | undefined>();

  for (const tab of tabs) {
    if (!tab?.id || !tab?.label)
      errors.push("Every settings tab needs an id and label.");
    if (tabIds.has(tab?.id)) errors.push(`Duplicate settings tab "${tab.id}".`);
    tabIds.add(tab?.id);
  }

  for (const definition of definitions) {
    if (!definition?.key) errors.push("Every setting needs a key.");
    else if (keys.has(definition.key))
      errors.push(`Duplicate setting key "${definition.key}".`);
    keys.add(definition?.key);
    if (!tabIds.has(definition?.tab)) {
      errors.push(
        `Setting "${definition?.key}" references unknown tab "${definition?.tab}".`,
      );
    }
    if (!definition?.label || !definition?.description) {
      errors.push(
        `Setting "${definition?.key}" needs a label and description.`,
      );
    }
    if (!definition?.type || !VALID_TYPES.has(definition.type)) {
      errors.push(
        `Setting "${definition?.key}" has unsupported type "${definition?.type}".`,
      );
    }
    if (
      definition?.type === "toggle" &&
      typeof definition.defaultValue !== "boolean"
    ) {
      errors.push(`Toggle "${definition.key}" must have a boolean default.`);
    }
    if (definition?.type === "choice") {
      const options = Array.isArray(definition.options)
        ? definition.options
        : [];
      const values = options.map((option) =>
        option && typeof option === "object" && "value" in option
          ? option.value
          : undefined,
      );
      if (
        options.length < 2 ||
        options.some(
          (option) =>
            !option ||
            typeof option !== "object" ||
            !("value" in option) ||
            !("label" in option) ||
            typeof option.label !== "string" ||
            !option.label,
        ) ||
        !values.includes(definition.defaultValue)
      ) {
        errors.push(
          `Choice "${definition.key}" needs labelled options containing its default.`,
        );
      }
    }
    if (definition?.type === "number") {
      const min = Number(definition.min);
      const max = Number(definition.max);
      const defaultValue = Number(definition.defaultValue);
      if (
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        !Number.isInteger(min) ||
        !Number.isInteger(max) ||
        min > max ||
        !Number.isFinite(defaultValue) ||
        !Number.isInteger(defaultValue) ||
        defaultValue < min ||
        defaultValue > max
      ) {
        errors.push(
          `Number setting "${definition.key}" needs a default between its min and max.`,
        );
      }
    }
    if (
      definition?.type === "sortable-list" &&
      (!Array.isArray(definition.defaultValue) ||
        !Array.isArray(definition.items))
    ) {
      errors.push(
        `Sortable list "${definition.key}" needs item and default-value arrays.`,
      );
    }
  }

  return errors;
}
