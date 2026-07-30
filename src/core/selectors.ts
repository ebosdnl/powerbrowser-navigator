export const selectors = Object.freeze({
  csrfMeta: 'meta[name="csrf-token"]',
  actionPlaygroundDialog: '[role="dialog"][data-state="open"]',
  actionPlaygroundPublicIcon: '[data-testid="icon_publicaction"]',
  actionPlaygroundTab: '[role="tab"]',
  actionPlaygroundPanel: '[role="tabpanel"]',
  betty5VariableBrowser: ".variables_browser, .model_browser",
  settingsDialog: ".power-browser-settings-dialog-v2",
} as const);

export type SelectorName = keyof typeof selectors;

export function query(
  root: ParentNode,
  selectorName: SelectorName,
): Element | null {
  const selector = selectors[selectorName];
  if (!selector) throw new Error(`Unknown selector "${selectorName}".`);
  return root.querySelector(selector);
}
