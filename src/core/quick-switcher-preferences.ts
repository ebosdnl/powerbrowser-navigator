export const QUICK_SWITCHER_RESULT_TYPES = Object.freeze([
  Object.freeze({ id: "navigation", label: "Navigation" }),
  Object.freeze({ id: "view", label: "View" }),
  Object.freeze({ id: "page", label: "Page" }),
  Object.freeze({ id: "action", label: "Action" }),
  Object.freeze({ id: "model", label: "Model" }),
  Object.freeze({ id: "property", label: "Property" }),
  Object.freeze({ id: "relation", label: "Relation" }),
]);

export interface QuickSwitcherResultPreference {
  id: string;
  enabled: boolean;
}

export function normalizeQuickSwitcherResultPreferences(
  value: unknown,
): QuickSwitcherResultPreference[] {
  const knownIds = new Set<string>(
    QUICK_SWITCHER_RESULT_TYPES.map(({ id }) => id),
  );
  const seen = new Set<string>();
  const normalized: QuickSwitcherResultPreference[] = [];

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const id = String((item as { id?: unknown }).id || "");
      if (!knownIds.has(id) || seen.has(id)) return;
      seen.add(id);
      normalized.push({
        id,
        enabled: (item as { enabled?: unknown }).enabled !== false,
      });
    });
  }

  QUICK_SWITCHER_RESULT_TYPES.forEach(({ id }) => {
    if (!seen.has(id)) normalized.push({ id, enabled: true });
  });
  return normalized;
}

export function isQuickSwitcherResultPreferences(value: unknown): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== QUICK_SWITCHER_RESULT_TYPES.length
  ) {
    return false;
  }
  const normalized = normalizeQuickSwitcherResultPreferences(value);
  return normalized.every(
    (item, index) =>
      item.id === (value[index] as { id?: unknown })?.id &&
      typeof (value[index] as { enabled?: unknown })?.enabled === "boolean",
  );
}

export function normalizeUrlWithoutQuery(
  value: string,
  base = "https://power-browser.invalid/",
): string {
  try {
    const url = new URL(value, base);
    url.search = "";
    return url.toString();
  } catch {
    return String(value || "").split("?", 1)[0];
  }
}

export function emptyJsonLeafValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(emptyJsonLeafValues);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        emptyJsonLeafValues(child),
      ]),
    );
  }
  return "";
}
