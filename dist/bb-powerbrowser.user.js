// ==UserScript==
// @name         Power Browser Navigator V2
// @description  Easier navigation to the playground, page-builder and backoffice. Feature flag setter and extra productivity scripts.
// @tag          Productivity
// @version      3.0.0
// @author       Enrique Bos, Menno Weijling (OG grondlegger), Sven Truschel, Hacker
// @match        https://*.betty.app/*
// @match        https://*.betty.services/*
// @match        https://*.bettyblocks.com/*
// @exclude      https://www.bettyblocks.com/*
// @exclude      https://bettyblocks.com/*
// @exclude      https://www*.bettyblocks.com/*
// @exclude      https://docs.bettyblocks.com/*
// @exclude      https://jobs.bettyblocks.com/*
// @exclude      https://status.bettyblocks.com/*
// @exclude      https://blog.bettyblocks.com/*
// @exclude      https://gitlab.betty.services/*
// @exclude      https://synapse.bettyblocks.com/*
// @exclude      https://academy.bettyblocks.com/*
// @exclude      https://assets.bettyblocks.com/*
// @exclude      https://assets.*.bettyblocks.com/*
// @exclude      https://content.bettyblocks.com/*
// @exclude      https://email.bettyblocks.com/*
// @exclude      https://hubspot.bettyblocks.com/*
// @exclude      https://id.bettyblocks.com/*
// @exclude      https://id.*.bettyblocks.com/*
// @exclude      https://jira.bettyblocks.com/*
// @exclude      https://l.bettyblocks.com/*
// @exclude      https://login.bettyblocks.com/*
// @exclude      https://login.*.bettyblocks.com/*
// @exclude      https://s3.*.bettyblocks.com/*
// @exclude      https://trial.bettyblocks.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bettyblocks.com
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @grant        GM_info
// @grant        unsafeWindow
// @grant        window.onurlchange
// @connect      *
// @noframes
// @run-at       document-start
// ==/UserScript==

/*
  Credits:
  PageUI remove uneditable layer: Sven Truschel
  Hotfix mode: Hacker
  Navigator bar & everything else: Enrique Bos

  If you want to updated it...
  Ensure CSS has a UUID to avoid conflicts
  Use jsdoc style function documentation for better readability

  HTML tag uses (To avoid conflicts)
  h1 -> header-1
  h2 -> header-2
  h3 -> header-3
  h4 -> header-4
  h5 -> header-5
  h6 -> header-6
  span -> spandoek
  div -> divider
  br -> breakline
*/

(async function () {
  "use strict";

  if (location.hostname === "my.bettyblocks.com") {
    return;
  }

  const pageWindow = globalThis.unsafeWindow || window;
  const INITIALIZED_ATTRIBUTE = "data-power-browser-v2-initialized";

  // The DOM marker is shared between userscript sandboxes and prevents duplicate
  // initialization when the same script is accidentally injected more than once.
  if (document.documentElement.hasAttribute(INITIALIZED_ATTRIBUTE)) {
    return;
  }

  document.documentElement.setAttribute(INITIALIZED_ATTRIBUTE, "");

  const SiteType = Object.freeze({
    RUNTIME: "runtime",
    NEXTGEN: "nextgen",
    BETTY5: "betty5",
    PLAYGROUND: "playground",
    UNKNOWN: "unknown",
  });

  const NAV_DISABLED_CLASS =
    "button-disabled-6b6a60d4-9e38-4279-84a5-5ef466dde62f";
  let bearerTokenWatchInterval = null;
  let bearerFeedbackTimeout = null;
  let modelSearchState = null;
  let modelSearchDebounce = null;
  let settingsState = null;
  let settingsSectionScrollFrame = null;
  let currentPowerBrowserContext = null;
  let betty5HighlightRetry = null;
  let betty5PasswordObserver = null;
  let betty5PasswordRetry = null;
  let betty5VariableSearchObserver = null;
  let betty5VariableSearchTimer = null;
  let betty5VariableSearchListenersAttached = false;
  let nextgenActionPlaygroundObserver = null;
  let nextgenActionPlaygroundTimer = null;
  let nextgenActionValidationTimer = null;
  let nextgenActionValidationSequence = 0;
  let nextgenLogDownloaderObserver = null;
  let nextgenLogDownloaderOriginalFetch = null;
  let nextgenLogDownloaderPatchedFetch = null;
  let capturedGroupedLogsFilter = null;
  const capturedGroupedLogsHeaders = {};
  const pendingReloadSettings = new Set();
  const betty5ReloadBaselines = new Map();
  const POWER_BROWSER_CACHE_TTL = 5 * 60 * 1000;
  const artifactRequestCache = new Map();
  const applicationFamilyRequestCache = new Map();
  const actionSettingsRequestCache = new Map();
  const powerBrowserNavigationSubscribers = new Set();
  let powerBrowserNavigationInitialized = false;
  let powerBrowserNavigationScheduled = false;
  let powerBrowserLastUrl = location.href;
  const powerBrowserDiagnostics = {
    artifact: {
      status: "idle",
      message: "Not requested yet.",
      updatedAt: null,
    },
    applicationFamily: {
      status: "idle",
      message: "Not requested yet.",
      updatedAt: null,
    },
    graphql: {
      status: "idle",
      message: "No GraphQL requests recorded.",
      updatedAt: null,
    },
    actionSettings: {
      status: "idle",
      message: "Not requested on this page.",
      updatedAt: null,
    },
    lastError: null,
  };

  /**
   * Updates a diagnostic data source and refreshes an open Info tab.
   *
   * @param {"artifact"|"applicationFamily"|"graphql"|"actionSettings"} source
   * @param {"idle"|"loading"|"success"|"warning"|"error"} status
   * @param {string} message
   * @param {Error|unknown} [error]
   * @returns {void}
   */
  function updatePowerBrowserDiagnostic(
    source,
    status,
    message,
    error,
  ) {
    powerBrowserDiagnostics[source] = {
      status,
      message,
      updatedAt: new Date().toISOString(),
    };
    if (error) {
      powerBrowserDiagnostics.lastError = {
        source,
        message:
          error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      };
    }

    if (
      settingsState?.activeTab === "info" &&
      settingsState.dialog.classList.contains("open") &&
      settingsState.navigator
    ) {
      renderSettingsTab(settingsState.navigator);
    }
  }

  /**
   * Returns a non-expired cached value or shares the active request.
   *
   * @template T
   * @param {Map<string, {value?: T, expiresAt?: number, cachedAt?: number, promise?: Promise<T>}>} cache
   * @param {string} key
   * @param {() => Promise<T>} loader
   * @param {boolean} force
   * @returns {Promise<T>}
   */
  async function getCachedPowerBrowserData(
    cache,
    key,
    loader,
    force = false,
  ) {
    const cached = cache.get(key);
    if (!force && cached?.value !== undefined && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    if (!force && cached?.promise) {
      return cached.promise;
    }

    const promise = loader();
    cache.set(key, { promise });
    try {
      const value = await promise;
      cache.set(key, {
        value,
        expiresAt: Date.now() + POWER_BROWSER_CACHE_TTL,
        cachedAt: Date.now(),
      });
      return value;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  }

  /**
   * Notifies all SPA-aware features once for each URL transition.
   *
   * @param {string} reason
   * @returns {void}
   */
  function schedulePowerBrowserNavigation(reason) {
    if (powerBrowserNavigationScheduled) {
      return;
    }

    powerBrowserNavigationScheduled = true;
    window.queueMicrotask(() => {
      powerBrowserNavigationScheduled = false;
      const previousUrl = powerBrowserLastUrl;
      const currentUrl = location.href;
      if (currentUrl === previousUrl) {
        return;
      }

      powerBrowserLastUrl = currentUrl;
      powerBrowserNavigationSubscribers.forEach((subscriber) => {
        try {
          subscriber({
            previousUrl,
            currentUrl,
            reason,
          });
        } catch (error) {
          console.warn(
            "[Power Browser v2] SPA navigation subscriber failed.",
            error,
          );
        }
      });
    });
  }

  /**
   * Initializes one URL-change source shared by every SPA-aware feature.
   *
   * @returns {void}
   */
  function initializePowerBrowserNavigation() {
    if (powerBrowserNavigationInitialized) {
      return;
    }

    powerBrowserNavigationInitialized = true;
    window.addEventListener("urlchange", () =>
      schedulePowerBrowserNavigation("urlchange"),
    );
    window.addEventListener("popstate", () =>
      schedulePowerBrowserNavigation("popstate"),
    );
    window.addEventListener("hashchange", () =>
      schedulePowerBrowserNavigation("hashchange"),
    );

    ["pushState", "replaceState"].forEach((methodName) => {
      const original = pageWindow.history?.[methodName];
      if (typeof original !== "function") {
        return;
      }

      try {
        pageWindow.history[methodName] = function (...args) {
          const result = Reflect.apply(original, this, args);
          schedulePowerBrowserNavigation(methodName);
          return result;
        };
      } catch (error) {
        console.debug(
          `[Power Browser v2] Unable to wrap history.${methodName}; urlchange events remain active.`,
          error,
        );
      }
    });
  }

  /**
   * Subscribes a feature to centralized SPA navigation.
   *
   * @param {(event: {previousUrl: string, currentUrl: string, reason: string}) => void} subscriber
   * @returns {() => void}
   */
  function subscribePowerBrowserNavigation(subscriber) {
    initializePowerBrowserNavigation();
    powerBrowserNavigationSubscribers.add(subscriber);
    return () => powerBrowserNavigationSubscribers.delete(subscriber);
  }

  const SvgIcons = Object.freeze({
    organization:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.43 10.58v-1.5H11.9v1.5h1.53zm0 2.93v-1.45H11.9v1.45h1.53zM8.77 4.66V3.21H7.23v1.45h1.54zm0 2.98V6.15H7.23v1.49h1.54zm0 2.94v-1.5H7.23v1.5h1.54zm0 2.93v-1.45H7.23v1.45h1.54zM4.1 7.64V6.15H2.57v1.49H4.1zm0 2.94v-1.5H2.57v1.5H4.1zm0 2.93v-1.45H2.57v1.45H4.1zm6.23-5.87H15V15H1V4.66h4.67V3.21L8 1l2.33 2.21v4.43z"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.1 1 12h3v9h7v-6h2v6h7v-9h3L12 2.1zm0 2.69 6 5.4V19h-3v-6H9v6H6v-8.81l6-5.4z"/></svg>',
    runtime:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h18v18H3V3zm2 4v12h14V7H5zm2-2h2v1H7V5zm4 0h2v1h-2V5zm4 0h2v1h-2V5z"/></svg>',
    page: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 2.5c0-.83.65-1.5 1.46-1.5h6.25v6c0 .83.65 1.5 1.46 1.5h5.83v9c0 .83-.65 1.5-1.46 1.5H3.96c-.8 0-1.46-.67-1.46-1.5v-15zm15 4.5h-5.83V1l5.83 6z"/></svg>',
    code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8.7 16.6-1.4 1.4-6-6 6-6 1.4 1.4L4.1 12l4.6 4.6zm6.6 0 4.6-4.6-4.6-4.6L16.7 6l6 6-6 6-1.4-1.4zM13.9 3 9.8 21h-2L11.9 3h2z"/></svg>',
    backoffice:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M18 11H2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1zM5 17a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM18 1H2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM5 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>',
    model:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 8.71c4.14 0 7.5-.89 7.5-2v2c0 1.1-3.36 2-7.5 2s-7.5-.9-7.5-2v-2c0 1.11 3.36 2 7.5 2zm0 3.86c4.14 0 7.5-.89 7.5-2v2c0 1.1-3.36 2-7.5 2s-7.5-.9-7.5-2v-2c0 1.11 3.36 2 7.5 2zm0 3.86c4.14 0 7.5-.89 7.5-2v2c0 1.1-3.36 2-7.5 2s-7.5-.9-7.5-2v-2c0 1.11 3.36 2 7.5 2zM10 1c4.14 0 7.5.89 7.5 2v2c0 1.1-3.36 2-7.5 2S2.5 6.1 2.5 5V3c0-1.11 3.36-2 7.5-2z"/></svg>',
    monitor:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 3h20v14H14v2h4v2H6v-2h4v-2H2V3zm2 2v10h16V5H4zm3 7V9h2v3H7zm4 0V7h2v5h-2zm4 0V8h2v4h-2z"/></svg>',
    playground:
      '<svg type="playground" viewBox="0 0 29.999 30" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M4.08 22.864l-1.1-.636L15.248.98l1.1.636z"/><path d="M2.727 20.53h24.538v1.272H2.727z"/><path d="M15.486 28.332L3.213 21.246l.636-1.1 12.273 7.086zm10.662-18.47L13.874 2.777l.636-1.1 12.273 7.086z"/><path d="M3.852 9.858l-.636-1.1L15.5 1.67l.636 1.1z"/><path d="M25.922 22.864l-12.27-21.25 1.1-.636 12.27 21.25zM3.7 7.914h1.272v14.172H3.7zm21.328 0H26.3v14.172h-1.272z"/><path d="M15.27 27.793l-.555-.962 10.675-6.163.555.962z"/><path d="M27.985 22.5a2.68 2.68 0 0 1-3.654.981 2.68 2.68 0 0 1-.981-3.654 2.68 2.68 0 0 1 3.654-.981c1.287.743 1.724 2.375.98 3.654M6.642 10.174a2.68 2.68 0 0 1-3.654.981A2.68 2.68 0 0 1 2.007 7.5a2.68 2.68 0 0 1 3.654-.981 2.68 2.68 0 0 1 .981 3.654M2.015 22.5a2.68 2.68 0 0 1 .981-3.654 2.68 2.68 0 0 1 3.654.981 2.68 2.68 0 0 1-.981 3.654c-1.287.735-2.92.3-3.654-.98m21.343-12.326a2.68 2.68 0 0 1 .981-3.654 2.68 2.68 0 0 1 3.654.981 2.68 2.68 0 0 1-.981 3.654 2.68 2.68 0 0 1-3.654-.981M15 30a2.674 2.674 0 1 1 2.674-2.673A2.68 2.68 0 0 1 15 30m0-24.652a2.67 2.67 0 0 1-2.674-2.674 2.67 2.67 0 1 1 5.347 0A2.67 2.67 0 0 1 15 5.347"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm4 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h12v14z"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2a8 8 0 1 0 4.9 14.32L20.59 22 22 20.59l-5.68-5.69A8 8 0 0 0 10 2zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12z"/></svg>',
    settings:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10.63A2.63 2.63 0 1 0 8 5.37a2.63 2.63 0 0 0 0 5.26zm5.35-1.94 1.51 1.15-1.38 2.89-1.78-.69c-.47.33-1.01.64-1.65.82L9.78 15H6.22l-.27-2.14a5.9 5.9 0 0 1-1.65-.82l-1.78.69-1.38-2.89 1.51-1.15A5.2 5.2 0 0 1 2.62 8c0-.31.01-.54.03-.69L1.14 6.16l1.38-2.89 1.78.69c.47-.33 1.01-.64 1.65-.82L6.22 1h3.56l.27 2.14c.64.18 1.18.49 1.65.82l1.78-.69 1.38 2.89-1.51 1.15c.02.15.03.38.03.69s-.01.54-.03.69z"/></svg>',
    switch:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 4-4v3h9v2h-9v3L7 7zm10 10-4 4v-3H4v-2h9v-3l4 4z"/></svg>',
  });

  const NavigatorItems = Object.freeze([
    { id: "organizationButton", label: "Organization", icon: SvgIcons.organization },
    { id: "homePageButton", label: "Home page", icon: SvgIcons.home },
    { id: "buttonRuntime", label: "Runtime", icon: SvgIcons.runtime, dynamic: true },
    { id: "buttonPagebuilder", label: "Page Builder", icon: SvgIcons.page, dynamic: true },
    { id: "buttonProcoderMode", label: "Pro-coder-mode", icon: SvgIcons.code, dynamic: true },
    { id: "backOfficeButton", label: "Backoffice", icon: SvgIcons.backoffice },
    { id: "b5Models", label: "B5 models", icon: SvgIcons.model },
    { id: "monitoringButton", label: "Monitoring", icon: SvgIcons.monitor },
    { id: "playgroundButton", label: "Playground", icon: SvgIcons.playground },
    { id: "buttonCopyBearer", label: "Bearer", icon: SvgIcons.copy, dynamic: true, button: true },
    { id: "buttonRuntimeModelSearch", label: "Search Models", icon: SvgIcons.search, dynamic: true, button: true },
  ]);

  const SettingsTabs = Object.freeze([
    { id: "info", label: "Info" },
    { id: "general", label: "General" },
    { id: "betty5", label: "Betty 5" },
    { id: "nextgen", label: "Next-gen" },
    { id: "uiBuilder", label: "UI builder" },
    { id: "runtime", label: "Runtime" },
    { id: "shortcuts", label: "Shortcuts" },
    { id: "settings", label: "Settings" },
  ]);

  const SettingsDefinitions = Object.freeze([
    {
      key: "themeMode",
      tab: "settings",
      section: "Appearance",
      label: "Theme",
      description: "Choose the visual style used across Power Browser surfaces.",
      type: "theme",
      defaultValue: "light",
    },
    {
      key: "iconOnlyMode",
      tab: "settings",
      section: "Appearance",
      label: "Icons only",
      description: "Hide labels in the navigation bar to keep it compact.",
      type: "toggle",
      defaultValue: true,
    },
    {
      key: "settingsSectionsExpandedByDefault",
      tab: "settings",
      section: "Appearance",
      label: "Expand settings sections",
      description:
        "Always show section shortcuts below every settings tab.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "settingsDialogSize",
      tab: "settings",
      section: "Appearance",
      label: "Dialog size",
      description:
        "Choose how much screen space the settings dialog uses.",
      type: "size",
      sizeKind: "dialog",
      defaultValue: "md",
    },
    {
      key: "settingsTextSize",
      tab: "settings",
      section: "Appearance",
      label: "Text size",
      description:
        "Adjust settings text and control sizes for comfortable reading.",
      type: "size",
      sizeKind: "text",
      defaultValue: "md",
    },
    {
      key: "buttonOrganizationHidden",
      tab: "general",
      section: "Navigation visibility",
      label: "Hide Organization",
      description: "Hide the My Betty Blocks application shortcut.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "sandboxSwitcherHidden",
      tab: "general",
      section: "Navigation visibility",
      label: "Hide sandbox switcher",
      description: "Hide the application-family sandbox selector.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "sandboxSwitcherShowApplicationName",
      tab: "general",
      section: "Navigation visibility",
      label: "Show application name in sandbox switcher",
      description:
        "Keep the current application name visible while Icons only is enabled.",
      type: "toggle",
      defaultValue: false,
      enabledWhenIconOnly: true,
    },
    {
      key: "buttonHomePageHidden",
      tab: "general",
      section: "Navigation visibility",
      label: "Hide Home page",
      description: "Hide the runtime home-page shortcut.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "buttonBackOfficeHidden",
      tab: "general",
      section: "Navigation visibility",
      label: "Hide Backoffice",
      description: "Hide the Betty 5 back-office shortcut.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "buttonB5Models",
      tab: "general",
      section: "Navigation visibility",
      label: "Hide B5 models",
      description: "Hide the legacy model overview shortcut.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "buttonB5Monitoring",
      tab: "general",
      section: "Navigation visibility",
      label: "Hide Monitoring",
      description: "Hide the application monitoring shortcut.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "buttonPlaygroundHidden",
      tab: "general",
      section: "Navigation visibility",
      label: "Hide Playground",
      description: "Hide the GraphQL playground shortcut.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "extraHotfix",
      tab: "betty5",
      label: "Hotfix mode",
      description: "Set overrideSandbox and reload Betty 5 when changed.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "extraAdvancedMode",
      tab: "betty5",
      label: "Always use advanced mode",
      description: "Set advancedOptions and reload Betty 5 when changed.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "extraB5Highlighting",
      tab: "betty5",
      label: "Better highlighting actions",
      description: "Keep the selected Betty 5 action clearly highlighted while navigating action stacks.",
      type: "toggle",
      defaultValue: true,
    },
    {
      key: "extraB5PasswordRevealer",
      tab: "betty5",
      label: "Reveal Passwords",
      description: "Reveal masked configuration passwords and blur them until hovered.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "extraB5VariableSearch",
      tab: "betty5",
      label: "Enhanced variable search",
      description:
        "Add reliable search fields and a wider layout to Betty 5 variable and model browsers.",
      type: "toggle",
      defaultValue: true,
    },
    {
      key: "featureFlagWorkflows",
      tab: "nextgen",
      section: "Action",
      badge: "Feature flag",
      label: "Workflows",
      description: "workflows",
      type: "toggle",
      defaultValue: false,
      flag: "workflows",
      siteTypes: [SiteType.NEXTGEN],
    },
    {
      key: "nextgenEditableActionPlayground",
      tab: "nextgen",
      section: "Action",
      label: "Editable action playground",
      description:
        "Make test-value playground fields editable and add runtime request headers.",
      type: "toggle",
      defaultValue: true,
    },
    {
      key: "buttonRuntimeHidden",
      tab: "nextgen",
      section: "Page builder",
      label: "Hide Runtime shortcut",
      description: "Hide the current Page Builder page’s runtime shortcut.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "buttonProcoderModeHidden",
      tab: "nextgen",
      section: "Page builder",
      label: "Hide Pro-coder-mode shortcut",
      description: "Hide the Page Builder to Pro-coder-mode shortcut.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "featureFlagTreeV1",
      tab: "nextgen",
      section: "Page builder",
      badge: "Feature flag",
      label: "Tree V1",
      description: "treeV1",
      type: "toggle",
      defaultValue: false,
      flag: "treeV1",
      siteTypes: [SiteType.NEXTGEN],
    },
    {
      key: "featureFlagPageScore",
      tab: "nextgen",
      section: "Page builder",
      badge: "Feature flag",
      label: "Page Score",
      description: "pageScore",
      type: "toggle",
      defaultValue: true,
      flag: "pageScore",
      siteTypes: [SiteType.NEXTGEN],
    },
    {
      key: "featureFlagV1FilterOption",
      tab: "nextgen",
      section: "Page builder",
      badge: "Feature flag",
      label: "Filter Option V1",
      description: "V1_FILTER_OPTION",
      type: "toggle",
      defaultValue: false,
      flag: "V1_FILTER_OPTION",
      siteTypes: [SiteType.NEXTGEN],
    },
    {
      key: "featureFlagDisplayLogicV1",
      tab: "nextgen",
      section: "Page builder",
      badge: "Feature flag",
      label: "Display Logic V1",
      description: "DISPLAY_LOGIC_V1",
      type: "toggle",
      defaultValue: false,
      flag: "DISPLAY_LOGIC_V1",
      siteTypes: [SiteType.NEXTGEN],
    },
    {
      key: "nextgenLogDumpDownloader",
      tab: "nextgen",
      section: "Logs",
      label: "Log dump downloader",
      description:
        "Add a CSV download button to grouped logs using the current filters.",
      type: "toggle",
      defaultValue: true,
    },
    {
      key: "extraPageUIRemoveUneditableLayer",
      tab: "uiBuilder",
      label: "Remove uneditable layer",
      description: "Remove the pretty-betty-mask overlay from the Betty 5 UI Builder preview.",
      type: "toggle",
      defaultValue: true,
    },
    {
      key: "buttonPagebuilderHidden",
      tab: "runtime",
      section: "Navigation",
      label: "Hide Page Builder shortcut",
      description: "Hide the runtime-to-Page-Builder shortcut.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "buttonCopyBearerHidden",
      tab: "runtime",
      section: "Navigation",
      label: "Hide Bearer shortcut",
      description: "Hide the runtime bearer-token copy button.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "featureFlagInteractionDebug",
      tab: "runtime",
      section: "Debugging",
      badge: "Feature flag",
      label: "Interactions debug",
      description: "INTERACTIONS_DEBUG",
      type: "toggle",
      defaultValue: true,
      flag: "INTERACTIONS_DEBUG",
      siteTypes: [SiteType.RUNTIME],
    },
    {
      key: "buttonRuntimeModelSearchHidden",
      tab: "general",
      section: "Model search",
      label: "Hide model search",
      description: "Hide the model and property command-palette button.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "runtimeSearchIncludeKind",
      tab: "general",
      section: "Model search",
      label: "Search property kinds",
      description: "Include kinds such as text, belongs_to and has_many in model search.",
      type: "toggle",
      defaultValue: true,
    },
    {
      key: "runtimeSearchExcludeRelations",
      tab: "general",
      section: "Model search",
      label: "Exclude relation properties",
      description: "Hide belongs-to, has-many and HABTM relations from model search.",
      type: "toggle",
      defaultValue: false,
    },
    {
      key: "extraMenuHideModifier",
      tab: "shortcuts",
      label: "Temporarily hide navigation",
      description: "Hide the navigation bar while this key or key combination is held.",
      type: "shortcut",
      defaultValue: "Shift",
    },
    {
      key: "extraModelSearchShortcut",
      tab: "shortcuts",
      label: "Model search",
      description: "Open or close model and property search.",
      type: "shortcut",
      defaultValue: "Ctrl+Shift+K",
    },
    {
      key: "extraDialogCloseShortcut",
      tab: "shortcuts",
      label: "Close dialogs",
      description: "Close Power Browser dialogs.",
      type: "shortcut",
      defaultValue: "Escape",
    },
    {
      key: "extraMenuToggleShortcut",
      tab: "shortcuts",
      label: "Toggle navigation",
      description: "Show or hide the Power Browser navigation bar.",
      type: "shortcut",
      defaultValue: "Ctrl+Shift+M",
    },
  ]);

  // Capture the page's initial grouped-logs request before the async Power
  // Browser initialization begins.
  initializeNextgenLogDownloader();

  GM_addStyle(`
    .power-browser-action-playground-dialog-v2 {
      top: 72px !important;
      width: min(900px, calc(100vw - 48px)) !important;
      max-width: min(900px, calc(100vw - 48px)) !important;
      height: min(880px, calc(100vh - 88px)) !important;
      min-height: min(720px, calc(100vh - 88px)) !important;
      max-height: calc(100vh - 88px) !important;
      grid-template-rows: auto minmax(0, 1fr) auto auto !important;
      overflow: hidden !important;
      transform: translateX(-50%) !important;
    }

    .power-browser-action-playground-dialog-v2
      > .box-border.overflow-auto {
      min-height: 0 !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      padding-right: 6px;
    }

    .power-browser-action-playground-dialog-v2
      > .flex.flex-row.justify-between.gap-2 {
      position: relative;
      z-index: 1;
      flex-shrink: 0;
      background: white;
    }

    .power-browser-action-playground-dialog-v2
      [data-power-browser-action-headers-v2] {
      padding-bottom: 4px;
    }

    .power-browser-action-playground-dialog-v2
      [data-power-browser-action-headers-v2]
      textarea {
      min-height: 112px;
    }

    .power-browser-action-playground-dialog-v2
      textarea[data-power-browser-action-variables-v2] {
      max-height: calc(12em + 16px) !important;
    }

    .power-browser-action-alert-v2 {
      display: none;
      margin: 4px 0 12px;
      padding: 10px 12px;
      color: #991b1b;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      font: 500 12px/1.4 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .power-browser-action-alert-v2.open {
      display: block;
    }

    .nav-container-1c7b2759-c793-4d17-b89b-1da6c5c5cf5b {
      position: fixed;
      margin: 0;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
      padding: 6px 2px 2px;
      width: 30%;
      min-width: 250px;
      z-index: 2147483647;
      background: transparent !important;
      box-shadow: none !important;
      font-family: Arial, sans-serif;
    }

    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translateX(-50%);
      display: flex !important;
      flex-direction: row;
      align-items: stretch;
      padding: 0;
      opacity: 1;
      white-space: nowrap;
      background: white;
      border-radius: 5px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 > a,
    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 > button,
    .power-browser-state-toggle-v2 {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 38px;
      padding: 10px 20px;
      border: 0;
      border-radius: 0;
      color: black;
      background: white;
      font: 14px Arial, sans-serif;
      text-decoration: none;
      cursor: pointer;
    }

    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 > a:hover,
    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 > button:hover,
    .power-browser-state-toggle-v2:hover {
      background: #f0f0f0;
    }

    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 > :first-child {
      border-radius: 5px 0 0 5px;
    }

    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 > :last-child {
      border-radius: 0 5px 5px 0;
    }

    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 svg {
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
      margin-bottom: 2px;
      vertical-align: middle;
      fill: currentColor;
    }

    .button-disabled-6b6a60d4-9e38-4279-84a5-5ef466dde62f {
      color: #777 !important;
      background-color: rgb(220, 220, 220) !important;
      cursor: not-allowed !important;
      pointer-events: none;
    }

    #buttonCopyBearer.button-disabled-6b6a60d4-9e38-4279-84a5-5ef466dde62f {
      pointer-events: auto;
    }

    .power-browser-hidden-v2 {
      display: none !important;
    }

    .power-browser-state-switcher-v2 {
      position: relative;
      display: inline-flex;
    }

    .power-browser-state-toggle-v2 {
      max-width: 210px;
    }

    .power-browser-state-toggle-label-v2 {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .power-browser-state-menu-v2 {
      position: absolute;
      top: calc(100% + 5px);
      left: 0;
      display: none;
      min-width: 240px;
      padding: 5px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 5px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
      z-index: 1;
    }

    .power-browser-state-switcher-v2.open .power-browser-state-menu-v2 {
      display: flex;
      flex-direction: column;
    }

    .power-browser-state-option-v2 {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 9px 12px;
      padding-left: calc(12px + var(--power-browser-depth, 0) * 16px);
      border: 0;
      border-radius: 3px;
      color: #222;
      background: white;
      font: 14px Arial, sans-serif;
      text-align: left;
      cursor: pointer;
    }

    .power-browser-state-option-v2:hover {
      background: #f0f0f0;
    }

    .power-browser-state-option-v2.current {
      color: #e9004c;
      font-weight: 600;
      cursor: default;
    }

    .power-browser-state-option-v2.no-access {
      color: #888;
      background: #e7e7e7;
      cursor: not-allowed;
      opacity: 0.7;
    }

    .power-browser-state-option-v2.no-access:hover {
      background: #e7e7e7;
    }

    .power-browser-state-option-v2 small {
      margin-left: auto;
      padding-left: 12px;
      color: #777;
      font-size: 11px;
    }

    .power-browser-bearer-copied-v2 {
      background: rgba(202, 240, 181, 0.95) !important;
    }

    .power-browser-bearer-error-v2 {
      background: rgba(255, 190, 190, 0.95) !important;
    }

    .power-browser-model-search-overlay-v2 {
      position: fixed;
      inset: 0;
      display: none;
      background: rgba(20, 24, 35, 0.45);
      backdrop-filter: blur(2px);
      z-index: 2147483646;
    }

    .power-browser-model-search-overlay-v2.open {
      display: block;
    }

    .power-browser-model-search-dialog-v2 {
      position: fixed;
      top: clamp(55px, 10vh, 120px);
      left: 50%;
      display: none;
      width: min(720px, calc(100vw - 32px));
      max-height: min(720px, 80vh);
      overflow: hidden;
      transform: translateX(-50%);
      color: #262a3a;
      background: #fff;
      border: 1px solid rgba(233, 0, 76, 0.2);
      border-radius: 14px;
      box-shadow: 0 28px 80px rgba(20, 24, 35, 0.28);
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      z-index: 2147483647;
    }

    .power-browser-model-search-dialog-v2.open {
      display: flex;
      flex-direction: column;
    }

    .power-browser-model-search-header-v2 {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid #e6e7eb;
    }

    .power-browser-model-search-header-v2 svg {
      width: 20px;
      height: 20px;
      fill: #e9004c;
    }

    .power-browser-model-search-input-v2 {
      flex: 1;
      min-width: 0;
      padding: 0;
      border: 0;
      outline: 0;
      color: #262a3a;
      background: transparent;
      font: 500 17px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .power-browser-model-search-shortcut-v2,
    .power-browser-model-search-count-v2 {
      color: #777d8c;
      font-size: 12px;
      white-space: nowrap;
    }

    .power-browser-model-search-results-v2 {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 8px;
      overflow-y: auto;
      list-style: none;
    }

    .power-browser-model-search-result-row-v2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: stretch;
      gap: 4px;
    }

    .power-browser-model-search-result-v2 {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 11px 12px;
      border: 0;
      border-radius: 8px;
      color: #262a3a;
      background: transparent;
      text-align: left;
      cursor: pointer;
    }

    .power-browser-model-search-result-v2:hover,
    .power-browser-model-search-result-v2.active {
      background: #fff0f5;
    }

    .power-browser-model-search-chip-v2 {
      min-width: 58px;
      padding: 4px 7px;
      border-radius: 999px;
      color: #6b2541;
      background: #ffdbe8;
      font-size: 10px;
      font-weight: 700;
      text-align: center;
      text-transform: uppercase;
    }

    .power-browser-model-search-chip-v2.property {
      color: #24546c;
      background: #dceff8;
    }

    .power-browser-model-search-chip-v2.relation {
      color: #614e13;
      background: #fff0b8;
    }

    .power-browser-model-search-copy-v2 {
      min-width: 0;
    }

    .power-browser-model-search-title-v2 {
      display: block;
      overflow: hidden;
      color: #262a3a;
      font-size: 14px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .power-browser-model-search-meta-v2 {
      display: block;
      margin-top: 3px;
      overflow: hidden;
      color: #777d8c;
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .power-browser-model-search-open-v2 {
      padding: 5px 8px;
      border: 1px solid #d9dbe2;
      border-radius: 6px;
      color: #4e5360;
      background: #fff;
      font-size: 11px;
    }

    .power-browser-model-search-backoffice-v2 {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 8px;
      color: #4e5360;
      background: transparent;
      cursor: pointer;
    }

    .power-browser-model-search-backoffice-v2:hover,
    .power-browser-model-search-backoffice-v2:focus-visible {
      color: #e9004c;
      background: #fff0f5;
      border-color: #ffd0df;
      outline: none;
    }

    .power-browser-model-search-backoffice-v2 svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }

    .power-browser-model-search-empty-v2 {
      padding: 32px 20px;
      color: #777d8c;
      font-size: 13px;
      text-align: center;
    }

    .power-browser-model-search-footer-v2 {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 16px;
      color: #777d8c;
      background: #f7f7f9;
      border-top: 1px solid #e6e7eb;
      font-size: 11px;
    }

    .power-browser-settings-overlay-v2 {
      position: fixed;
      inset: 0;
      display: none;
      background: rgba(19, 23, 34, 0.48);
      backdrop-filter: blur(4px);
      z-index: 2147483646;
    }

    .power-browser-settings-overlay-v2.open {
      display: block;
    }

    .power-browser-settings-dialog-v2 {
      --power-browser-settings-flash-rgb: 233, 0, 76;
      --pb-settings-font-micro: 9px;
      --pb-settings-font-small: 11px;
      --pb-settings-font-body: 13px;
      --pb-settings-font-input: 12px;
      --pb-settings-font-title: 20px;
      --pb-settings-font-large: 15px;
      position: fixed;
      top: 50%;
      left: 50%;
      display: none;
      grid-template-columns: 220px minmax(0, 1fr);
      width: min(1000px, calc(100vw - 32px));
      height: min(740px, calc(100vh - 32px));
      overflow: hidden;
      transform: translate(-50%, -50%);
      color: #282c3a;
      background: #fff;
      border: 1px solid rgba(233, 0, 76, 0.18);
      border-radius: 18px;
      box-shadow: 0 32px 100px rgba(15, 18, 28, 0.32);
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      z-index: 2147483647;
    }

    .power-browser-settings-dialog-v2.open {
      display: grid;
    }

    .power-browser-settings-sidebar-v2 {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      padding: 24px 14px 14px;
      color: #fff;
      background: linear-gradient(165deg, #262a3a 0%, #171a25 100%);
    }

    .power-browser-settings-brand-v2 {
      padding: 0 10px 22px;
    }

    .power-browser-settings-brand-v2 strong {
      display: block;
      font-size: 17px;
      letter-spacing: -0.02em;
    }

    .power-browser-settings-brand-v2 span {
      display: block;
      margin-top: 4px;
      color: #aeb3c2;
      font-size: 11px;
    }

    .power-browser-settings-tabs-v2 {
      display: flex;
      height: 0;
      flex: 1 1 0;
      flex-direction: column;
      gap: 4px;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: none;
      touch-action: pan-y;
    }

    .power-browser-settings-tabs-v2::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }

    .power-browser-settings-tabs-v2
      > .power-browser-settings-tab-v2,
    .power-browser-settings-tabs-v2
      > .power-browser-settings-section-links-v2 {
      flex: 0 0 auto;
    }

    .power-browser-settings-tab-v2 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      padding: 10px 12px;
      border: 0;
      border-radius: 8px;
      color: #c7cad4;
      background: transparent;
      font: 500 13px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: left;
      cursor: pointer;
    }

    .power-browser-settings-tab-v2.has-sections::after {
      content: "›";
      font-size: 17px;
      line-height: 1;
      transform: rotate(0deg);
      transition: transform 120ms ease;
    }

    .power-browser-settings-tab-v2.has-sections[aria-expanded="true"]::after {
      transform: rotate(90deg);
    }

    .power-browser-settings-tab-v2:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.07);
    }

    .power-browser-settings-tab-v2.active {
      color: #fff;
      background: #e9004c;
      box-shadow: 0 6px 18px rgba(233, 0, 76, 0.28);
    }

    .power-browser-settings-section-links-v2 {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 2px 0 4px 13px;
    }

    .power-browser-settings-section-link-v2 {
      padding: 6px 10px;
      border: 0;
      border-left: 1px solid rgba(255, 255, 255, 0.16);
      color: #969cac;
      background: transparent;
      font: 500 11px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: left;
      cursor: pointer;
    }

    .power-browser-settings-section-link-v2:hover,
    .power-browser-settings-section-link-v2.active {
      color: #fff;
      border-left-color: #e9004c;
    }

    .power-browser-settings-version-v2 {
      padding: 12px 10px 2px;
      color: #777d8c;
      font-size: 10px;
    }

    .power-browser-settings-main-v2 {
      display: flex;
      min-width: 0;
      flex-direction: column;
      overflow: hidden;
      background: #f7f7f9;
    }

    .power-browser-settings-header-v2 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 22px 26px 18px;
      background: #fff;
      border-bottom: 1px solid #e8e9ed;
    }

    .power-browser-settings-heading-v2 h2 {
      margin: 0;
      color: #262a3a;
      font-size: 20px;
      letter-spacing: -0.02em;
    }

    .power-browser-settings-heading-v2 p {
      margin: 5px 0 0;
      color: #777d8c;
      font-size: 12px;
    }

    .power-browser-settings-close-v2 {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 8px;
      color: #646977;
      background: #f1f2f5;
      font-size: 21px;
      cursor: pointer;
    }

    .power-browser-settings-close-v2:hover {
      color: #e9004c;
      background: #fff0f5;
    }

    .power-browser-settings-alert-v2 {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 12px 26px;
      color: #6e1836;
      background: #ffe4ed;
      border-bottom: 1px solid #ffc1d5;
      font-size: 12px;
      line-height: 1.4;
    }

    .power-browser-settings-alert-v2.open {
      display: flex;
    }

    .power-browser-settings-search-v2 {
      padding: 12px 26px;
      background: #fff;
      border-bottom: 1px solid #e8e9ed;
    }

    .power-browser-settings-search-v2 input {
      box-sizing: border-box;
      width: 100%;
      padding: 9px 12px;
      color: #303442;
      background: #f7f7f9;
      border: 1px solid #d9dbe1;
      border-radius: 8px;
      font-size: 12px;
      outline: none;
    }

    .power-browser-settings-search-v2 input:focus {
      background: #fff;
      border-color: #e9004c;
      box-shadow: 0 0 0 3px rgba(233, 0, 76, 0.1);
    }

    .power-browser-settings-search-result-v2 {
      width: 100%;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }

    .power-browser-settings-search-result-v2
      .power-browser-settings-info-status-v2 {
      color: #344bc1;
      background: #edf1ff;
      border-color: #ccd5ff;
    }

    .power-browser-settings-alert-v2 strong {
      display: block;
      margin-bottom: 2px;
      color: #4f1027;
      font-size: 12px;
    }

    .power-browser-settings-reload-v2 {
      flex: 0 0 auto;
      padding: 8px 12px;
      border: 0;
      border-radius: 7px;
      color: #fff;
      background: #e9004c;
      font-size: 11px;
      font-weight: 650;
      cursor: pointer;
    }

    .power-browser-settings-reload-v2:hover {
      background: #c90042;
    }

    .power-browser-settings-content-v2 {
      flex: 1;
      padding: 20px 26px 28px;
      overflow-y: auto;
    }

    .power-browser-settings-list-v2 {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .power-browser-settings-section-v2 {
      margin: 12px 4px 0;
      color: #656b79;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .power-browser-settings-section-v2:first-child {
      margin-top: 0;
    }

    .power-browser-settings-card-v2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 18px;
      padding: 16px 18px;
      background: #fff;
      border: 1px solid #e4e5ea;
      border-radius: 11px;
      box-shadow: 0 2px 7px rgba(25, 29, 42, 0.03);
    }

    .power-browser-settings-card-v2:hover {
      border-color: #d4d6dd;
    }

    .power-browser-settings-card-v2.setting-flash {
      animation: power-browser-settings-flash-v2 1.65s ease;
    }

    @keyframes power-browser-settings-flash-v2 {
      0%,
      100% {
        box-shadow: 0 2px 7px rgba(25, 29, 42, 0.03);
        transform: translateY(0);
      }

      18%,
      55% {
        border-color: rgb(var(--power-browser-settings-flash-rgb));
        box-shadow:
          0 0 0 4px
            rgba(var(--power-browser-settings-flash-rgb), 0.22),
          0 8px 22px rgba(25, 29, 42, 0.12);
        transform: translateY(-1px);
      }
    }

    .power-browser-settings-card-v2.setting-disabled {
      opacity: 0.55;
    }

    .power-browser-settings-info-card-v2 {
      display: block;
    }

    .power-browser-settings-data-v2
      .power-browser-settings-info-title-v2 {
      margin-bottom: 0;
    }

    .power-browser-settings-data-v2
      .power-browser-settings-actions-v2 {
      margin-top: 14px;
    }

    .power-browser-settings-info-title-v2 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
      color: #303442;
      font-size: 13px;
      font-weight: 700;
    }

    .power-browser-settings-info-status-v2 {
      display: inline-flex;
      align-items: center;
      padding: 3px 7px;
      color: #23603e;
      background: #e8f7ef;
      border: 1px solid #bde8cf;
      border-radius: 999px;
      font-size: 9px;
      font-weight: 750;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .power-browser-settings-info-grid-v2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 20px;
      margin: 0;
    }

    .power-browser-settings-info-item-v2 {
      min-width: 0;
    }

    .power-browser-settings-info-item-v2 dt {
      margin: 0 0 3px;
      color: #8a8f9d;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .power-browser-settings-info-item-v2 dd {
      margin: 0;
      overflow-wrap: anywhere;
      color: #303442;
      font: 11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
    }

    .power-browser-settings-info-value-v2 {
      display: flex;
      align-items: flex-start;
      gap: 6px;
    }

    .power-browser-settings-info-value-v2 dd {
      min-width: 0;
      flex: 1;
    }

    .power-browser-settings-copy-value-v2 {
      flex: 0 0 auto;
      padding: 2px 5px;
      color: #656b79;
      background: #f3f4f7;
      border: 1px solid #dfe1e7;
      border-radius: 5px;
      font-size: 8px;
      font-weight: 700;
      cursor: pointer;
    }

    .power-browser-settings-copy-value-v2:hover {
      color: #e9004c;
      background: #fff;
      border-color: #ef9db9;
    }

    .power-browser-settings-diagnostics-v2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .power-browser-settings-diagnostic-v2 {
      padding: 13px 14px;
      background: #fff;
      border: 1px solid #e4e5ea;
      border-left: 4px solid #8a8f9d;
      border-radius: 9px;
    }

    .power-browser-settings-diagnostic-v2[data-status="loading"] {
      border-left-color: #395afc;
    }

    .power-browser-settings-diagnostic-v2[data-status="success"] {
      border-left-color: #22935c;
    }

    .power-browser-settings-diagnostic-v2[data-status="warning"] {
      border-left-color: #d78b14;
    }

    .power-browser-settings-diagnostic-v2[data-status="error"] {
      border-left-color: #d02d3d;
    }

    .power-browser-settings-diagnostic-v2 strong {
      display: block;
      margin-bottom: 4px;
      color: #303442;
      font-size: 11px;
    }

    .power-browser-settings-diagnostic-v2 span {
      display: block;
      color: #777d8c;
      font-size: 10px;
      line-height: 1.45;
    }

    .power-browser-settings-actions-v2 {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .power-browser-settings-action-v2 {
      padding: 8px 11px;
      color: #3f4554;
      background: #fff;
      border: 1px solid #d4d6dd;
      border-radius: 7px;
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
    }

    .power-browser-settings-action-v2:hover {
      color: #e9004c;
      border-color: #ef9db9;
    }

    .power-browser-settings-action-v2:disabled {
      color: #989dab;
      background: #f1f2f5;
      cursor: wait;
    }

    .power-browser-settings-operation-status-v2 {
      color: #656b79;
      font-size: 10px;
    }

    .power-browser-settings-operation-status-v2[data-status="success"] {
      color: #167346;
    }

    .power-browser-settings-operation-status-v2[data-status="error"] {
      color: #c52a3a;
    }

    .power-browser-settings-info-empty-v2 {
      padding: 22px;
      color: #777d8c;
      background: #fff;
      border: 1px dashed #d5d7de;
      border-radius: 11px;
      font-size: 12px;
      line-height: 1.5;
      text-align: center;
    }

    .power-browser-settings-danger-v2 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 18px;
      background: #fff7f7;
      border: 1px solid #f3b8b8;
      border-radius: 11px;
    }

    .power-browser-settings-danger-v2 strong {
      display: block;
      margin-bottom: 4px;
      color: #8f1d1d;
      font-size: 13px;
    }

    .power-browser-settings-danger-v2 span {
      display: block;
      color: #9b4a4a;
      font-size: 11px;
      line-height: 1.45;
    }

    .power-browser-settings-danger-button-v2 {
      flex: 0 0 auto;
      padding: 9px 12px;
      color: #fff;
      background: #c62828;
      border: 1px solid #a91f1f;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
    }

    .power-browser-settings-danger-button-v2:hover {
      background: #a91f1f;
    }

    .power-browser-settings-copy-v2 strong {
      display: block;
      color: #303442;
      font-size: 13px;
      font-weight: 650;
    }

    .power-browser-settings-label-row-v2 {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 7px;
    }

    .power-browser-settings-badge-v2 {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      color: #6d3bd1;
      background: #f0eaff;
      border: 1px solid #ded0ff;
      border-radius: 999px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.03em;
      line-height: 1.2;
      text-transform: uppercase;
    }

    .power-browser-settings-description-v2 {
      display: block;
      margin-top: 4px;
      color: #777d8c;
      font-size: 11px;
      line-height: 1.45;
    }

    .power-browser-settings-theme-picker-v2 {
      display: grid;
      grid-template-columns: repeat(3, minmax(76px, 1fr));
      gap: 8px;
      width: min(310px, 100%);
    }

    .power-browser-settings-theme-option-v2 {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 7px;
      padding: 7px;
      color: #555a68;
      background: #fff;
      border: 1px solid #d9dbe1;
      border-radius: 9px;
      font: 650 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: left;
      cursor: pointer;
    }

    .power-browser-settings-theme-option-v2:hover {
      border-color: #aeb2bf;
    }

    .power-browser-settings-theme-option-v2.active {
      color: #262a3a;
      border-color: #e9004c;
      box-shadow: 0 0 0 2px rgba(233, 0, 76, 0.12);
    }

    .power-browser-settings-size-picker-v2 {
      display: grid;
      grid-template-columns: repeat(5, minmax(52px, 1fr));
      gap: 6px;
      width: min(430px, 100%);
    }

    .power-browser-settings-size-option-v2 {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
      color: #555a68;
      background: #fff;
      border: 1px solid #d9dbe1;
      border-radius: 9px;
      font: 650 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
      cursor: pointer;
    }

    .power-browser-settings-size-option-v2:hover {
      border-color: #aeb2bf;
    }

    .power-browser-settings-size-option-v2.active {
      color: #262a3a;
      border-color: #e9004c;
      box-shadow: 0 0 0 2px rgba(233, 0, 76, 0.12);
    }

    .power-browser-settings-size-preview-v2 {
      position: relative;
      display: grid;
      height: 38px;
      place-items: center;
      overflow: hidden;
      color: #444957;
      background: #f4f5f8;
      border: 1px solid rgba(31, 35, 48, 0.12);
      border-radius: 6px;
    }

    .power-browser-settings-size-option-v2[data-size-kind="dialog"]
      .power-browser-settings-size-preview-v2::before {
      width: 68%;
      height: 62%;
      content: "";
      background: #fff;
      border: 1px solid #b9bdc8;
      border-radius: 3px;
      box-shadow: inset 7px 0 0 #333847;
    }

    .power-browser-settings-size-option-v2[data-size-kind="dialog"][data-size="xs"]
      .power-browser-settings-size-preview-v2::before {
      width: 42%;
      height: 42%;
    }

    .power-browser-settings-size-option-v2[data-size-kind="dialog"][data-size="sm"]
      .power-browser-settings-size-preview-v2::before {
      width: 55%;
      height: 52%;
    }

    .power-browser-settings-size-option-v2[data-size-kind="dialog"][data-size="lg"]
      .power-browser-settings-size-preview-v2::before {
      width: 82%;
      height: 72%;
    }

    .power-browser-settings-size-option-v2[data-size-kind="dialog"][data-size="xl"]
      .power-browser-settings-size-preview-v2::before {
      width: 94%;
      height: 82%;
    }

    .power-browser-settings-size-option-v2[data-size-kind="text"]
      .power-browser-settings-size-preview-v2::before {
      content: "Aa";
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
    }

    .power-browser-settings-size-option-v2[data-size-kind="text"][data-size="xs"]
      .power-browser-settings-size-preview-v2::before {
      font-size: 9px;
    }

    .power-browser-settings-size-option-v2[data-size-kind="text"][data-size="sm"]
      .power-browser-settings-size-preview-v2::before {
      font-size: 11px;
    }

    .power-browser-settings-size-option-v2[data-size-kind="text"][data-size="lg"]
      .power-browser-settings-size-preview-v2::before {
      font-size: 17px;
    }

    .power-browser-settings-size-option-v2[data-size-kind="text"][data-size="xl"]
      .power-browser-settings-size-preview-v2::before {
      font-size: 20px;
    }

    .power-browser-settings-theme-preview-v2 {
      position: relative;
      display: block;
      height: 34px;
      overflow: hidden;
      background: #f7f7f9;
      border: 1px solid rgba(31, 35, 48, 0.12);
      border-radius: 6px;
    }

    .power-browser-settings-theme-preview-v2::before {
      position: absolute;
      top: 7px;
      right: 7px;
      left: 7px;
      height: 7px;
      content: "";
      background: #fff;
      border-radius: 4px;
      box-shadow:
        0 9px 0 #e4e5ea,
        0 18px 0 #f0f1f4;
    }

    .power-browser-settings-theme-option-v2[data-theme="dark"]
      .power-browser-settings-theme-preview-v2 {
      background: #1f2330;
      border-color: #494f60;
    }

    .power-browser-settings-theme-option-v2[data-theme="dark"]
      .power-browser-settings-theme-preview-v2::before {
      background: #343949;
      box-shadow:
        0 9px 0 #282d3b,
        0 18px 0 #404657;
    }

    .power-browser-settings-theme-option-v2[data-theme="betty"]
      .power-browser-settings-theme-preview-v2 {
      background:
        linear-gradient(
          259deg,
          rgb(233, 0, 76) 0%,
          rgb(57, 90, 252) 51.9162%,
          rgb(17, 171, 209) 100%
        );
      border-color: transparent;
    }

    .power-browser-settings-theme-option-v2[data-theme="betty"]
      .power-browser-settings-theme-preview-v2::before {
      background: rgba(255, 255, 255, 0.94);
      box-shadow:
        0 9px 0 rgba(255, 255, 255, 0.68),
        0 18px 0 rgba(255, 255, 255, 0.4);
    }

    .power-browser-settings-toggle-v2 {
      position: relative;
      display: inline-flex;
      width: 42px;
      height: 24px;
      flex: 0 0 42px;
    }

    .power-browser-settings-toggle-v2 input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .power-browser-settings-toggle-track-v2 {
      width: 100%;
      border-radius: 999px;
      background: #c8cbd3;
      cursor: pointer;
      transition: background 0.18s ease;
    }

    .power-browser-settings-toggle-track-v2::after {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 18px;
      height: 18px;
      content: "";
      background: #fff;
      border-radius: 50%;
      box-shadow: 0 2px 5px rgba(20, 24, 35, 0.22);
      transition: transform 0.18s ease;
    }

    .power-browser-settings-toggle-v2 input:checked + .power-browser-settings-toggle-track-v2 {
      background: #e9004c;
    }

    .power-browser-settings-toggle-v2 input:checked + .power-browser-settings-toggle-track-v2::after {
      transform: translateX(18px);
    }

    .power-browser-settings-toggle-v2 input:focus-visible + .power-browser-settings-toggle-track-v2 {
      outline: 3px solid rgba(233, 0, 76, 0.22);
      outline-offset: 2px;
    }

    .power-browser-settings-toggle-v2
      input:disabled
      + .power-browser-settings-toggle-track-v2 {
      cursor: not-allowed;
    }

    .power-browser-settings-shortcut-v2 {
      width: 170px;
      padding: 8px 10px;
      border: 1px solid #d4d6dd;
      border-radius: 7px;
      color: #303442;
      background: #fbfbfc;
      font: 12px ui-monospace, SFMono-Regular, Consolas, monospace;
    }

    .power-browser-settings-shortcut-v2:focus {
      border-color: #e9004c;
      outline: 3px solid rgba(233, 0, 76, 0.12);
    }

    .power-browser-settings-footer-v2 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 26px;
      color: #777d8c;
      background: #fff;
      border-top: 1px solid #e8e9ed;
      font-size: 11px;
    }

    .power-browser-settings-reset-v2 {
      padding: 7px 10px;
      border: 1px solid #d9dbe1;
      border-radius: 7px;
      color: #555a68;
      background: #fff;
      font-size: 11px;
      cursor: pointer;
    }

    .power-browser-settings-reset-v2:hover {
      color: #e9004c;
      border-color: #f0a0ba;
      background: #fff5f8;
    }

    .power-browser-icon-only-v2 #dropdownMenu > a span,
    .power-browser-icon-only-v2 #dropdownMenu > button span,
    .power-browser-icon-only-v2 .power-browser-state-toggle-label-v2 {
      display: none;
    }

    .power-browser-icon-only-v2.power-browser-show-sandbox-name-v2
      .power-browser-state-toggle-label-v2 {
      display: inline;
    }

    .power-browser-setting-hidden-v2 {
      display: none !important;
    }

    .power-browser-dark-v2 .dropdown-1aaab757-b16d-413a-9499-a72197bb1732,
    .power-browser-dark-v2 .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 > a,
    .power-browser-dark-v2 .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 > button,
    .power-browser-dark-v2 .power-browser-state-toggle-v2 {
      color: #f4f5f7;
      background: #262a3a;
    }

    .power-browser-dark-v2 .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 > a:hover,
    .power-browser-dark-v2 .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 > button:hover,
    .power-browser-dark-v2 .power-browser-state-toggle-v2:hover {
      background: #343949;
    }

    .power-browser-dark-v2 .button-disabled-6b6a60d4-9e38-4279-84a5-5ef466dde62f,
    .power-browser-dark-v2 .button-disabled-6b6a60d4-9e38-4279-84a5-5ef466dde62f:hover {
      color: #858b9b !important;
      background: #343947 !important;
    }

    .power-browser-dark-v2 .power-browser-state-menu-v2,
    .power-browser-dark-v2 .power-browser-state-option-v2 {
      color: #f4f5f7;
      background: #262a3a;
      border-color: #444a5b;
    }

    .power-browser-dark-v2 .power-browser-state-option-v2:hover {
      background: #343949;
    }

    .power-browser-dark-v2 .power-browser-state-option-v2.no-access,
    .power-browser-dark-v2 .power-browser-state-option-v2.no-access:hover {
      color: #858b9b;
      background: #343947;
    }

    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732.power-browser-hotfix-active-v2,
    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732.power-browser-hotfix-active-v2 > a,
    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732.power-browser-hotfix-active-v2 > button,
    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732.power-browser-hotfix-active-v2 > .power-browser-state-switcher-v2 > .power-browser-state-toggle-v2 {
      color: #4a111b !important;
      background: #ff9c9c !important;
    }

    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732.power-browser-hotfix-active-v2 > a:hover,
    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732.power-browser-hotfix-active-v2 > button:hover,
    .dropdown-1aaab757-b16d-413a-9499-a72197bb1732.power-browser-hotfix-active-v2 > .power-browser-state-switcher-v2 > .power-browser-state-toggle-v2:hover {
      background: #ffd1d1 !important;
    }

    .power-browser-shift-hidden-v2 {
      visibility: hidden !important;
      pointer-events: none !important;
    }

    .power-browser-b5-highlighting-v2 .pane .body .action_diagram .event.active .symbol {
      box-shadow: 0 0 15px 2px rgba(255, 126, 117, 1);
    }

    .power-browser-b5-password-v2 {
      filter: blur(3px);
      transition: filter 0.25s ease;
    }

    .power-browser-b5-password-v2:hover,
    .power-browser-b5-password-v2:focus {
      filter: blur(0);
    }

    .power-browser-dark-v2.power-browser-model-search-dialog-v2 {
      color: #f4f5f7;
      background: #242836;
      border-color: #494f60;
    }

    .power-browser-dark-v2 .power-browser-model-search-header-v2,
    .power-browser-dark-v2 .power-browser-model-search-footer-v2 {
      background: #242836;
      border-color: #444a5b;
    }

    .power-browser-dark-v2 .power-browser-model-search-input-v2,
    .power-browser-dark-v2 .power-browser-model-search-title-v2 {
      color: #f4f5f7;
    }

    .power-browser-dark-v2 .power-browser-model-search-result-v2:hover,
    .power-browser-dark-v2 .power-browser-model-search-result-v2.active,
    .power-browser-dark-v2 .power-browser-model-search-backoffice-v2:hover {
      background: #343949;
    }

    .power-browser-dark-v2.power-browser-settings-dialog-v2 .power-browser-settings-main-v2,
    .power-browser-dark-v2.power-browser-settings-dialog-v2 .power-browser-settings-content-v2 {
      background: #1f2330;
    }

    .power-browser-dark-v2.power-browser-settings-dialog-v2 {
      --power-browser-settings-flash-rgb: 255, 92, 145;
    }

    .power-browser-dark-v2 .power-browser-settings-header-v2,
    .power-browser-dark-v2 .power-browser-settings-search-v2,
    .power-browser-dark-v2 .power-browser-settings-footer-v2,
    .power-browser-dark-v2 .power-browser-settings-card-v2 {
      background: #282d3b;
      border-color: #404657;
    }

    .power-browser-dark-v2
      .power-browser-settings-search-v2 input {
      color: #f4f5f7;
      background: #202431;
      border-color: #4a5061;
    }

    .power-browser-dark-v2 .power-browser-settings-heading-v2 h2,
    .power-browser-dark-v2 .power-browser-settings-copy-v2 strong,
    .power-browser-dark-v2 .power-browser-settings-info-title-v2,
    .power-browser-dark-v2 .power-browser-settings-info-item-v2 dd {
      color: #f4f5f7;
    }

    .power-browser-dark-v2 .power-browser-settings-info-empty-v2 {
      color: #aeb4c2;
      background: #282d3b;
      border-color: #4a5061;
    }

    .power-browser-dark-v2
      .power-browser-settings-diagnostic-v2,
    .power-browser-dark-v2
      .power-browser-settings-action-v2 {
      color: #d5d8e0;
      background: #282d3b;
      border-color: #4a5061;
    }

    .power-browser-dark-v2
      .power-browser-settings-diagnostic-v2 strong {
      color: #f4f5f7;
    }

    .power-browser-dark-v2
      .power-browser-settings-copy-value-v2 {
      color: #c8ccd6;
      background: #343949;
      border-color: #4a5061;
    }

    .power-browser-dark-v2 .power-browser-settings-danger-v2 {
      background: #421f25;
      border-color: #75404a;
    }

    .power-browser-dark-v2 .power-browser-settings-danger-v2 strong {
      color: #ffccd3;
    }

    .power-browser-dark-v2 .power-browser-settings-danger-v2 span {
      color: #e7aab4;
    }

    .power-browser-dark-v2 .power-browser-settings-close-v2 {
      color: #c8ccd6;
      background: #363b4b;
    }

    .power-browser-dark-v2 .power-browser-settings-close-v2:hover {
      color: #ff8eb3;
      background: #472938;
    }

    .power-browser-dark-v2 .power-browser-settings-reset-v2 {
      color: #d5d8e0;
      background: #282d3b;
      border-color: #4a5061;
    }

    .power-browser-dark-v2 .power-browser-settings-reset-v2:hover {
      color: #ff9cbd;
      background: #3d2834;
      border-color: #8d5268;
    }

    .power-browser-dark-v2 .power-browser-settings-section-v2 {
      color: #aeb4c2;
    }

    .power-browser-dark-v2 .power-browser-settings-badge-v2 {
      color: #d8c7ff;
      background: #3b3155;
      border-color: #574876;
    }

    .power-browser-dark-v2 .power-browser-settings-shortcut-v2 {
      color: #f4f5f7;
      background: #202431;
      border-color: #4a5061;
    }

    .power-browser-dark-v2
      .power-browser-settings-theme-option-v2 {
      color: #c8ccd6;
      background: #202431;
      border-color: #4a5061;
    }

    .power-browser-dark-v2
      .power-browser-settings-size-option-v2 {
      color: #c8ccd6;
      background: #202431;
      border-color: #4a5061;
    }

    .power-browser-dark-v2
      .power-browser-settings-size-preview-v2 {
      color: #e5e8ef;
      background: #292e3c;
      border-color: #4a5061;
    }

    .power-browser-dark-v2
      .power-browser-settings-size-option-v2[data-size-kind="dialog"]
      .power-browser-settings-size-preview-v2::before {
      background: #343949;
      border-color: #737b91;
      box-shadow: inset 7px 0 0 #171a24;
    }

    .power-browser-dark-v2
      .power-browser-settings-theme-option-v2:hover {
      border-color: #737b91;
    }

    .power-browser-dark-v2
      .power-browser-settings-size-option-v2:hover {
      border-color: #737b91;
    }

    .power-browser-dark-v2
      .power-browser-settings-theme-option-v2.active {
      color: #fff;
      border-color: #ff5c91;
      box-shadow: 0 0 0 2px rgba(255, 92, 145, 0.14);
    }

    .power-browser-dark-v2
      .power-browser-settings-size-option-v2.active {
      color: #fff;
      border-color: #ff5c91;
      box-shadow: 0 0 0 2px rgba(255, 92, 145, 0.14);
    }

    .power-browser-dark-v2 .power-browser-settings-alert-v2 {
      color: #ffc4d7;
      background: #552134;
      border-color: #733047;
    }

    .power-browser-dark-v2 .power-browser-settings-alert-v2 strong {
      color: #ffe4ed;
    }

    .power-browser-betty-theme-v2
      .dropdown-1aaab757-b16d-413a-9499-a72197bb1732 {
      overflow: visible;
      background:
        linear-gradient(
          259deg,
          rgb(233, 0, 76) 0%,
          rgb(57, 90, 252) 51.9162%,
          rgb(17, 171, 209) 100%
        )
        transparent;
      border-radius: 12px;
      box-shadow: none;
    }

    .power-browser-betty-theme-v2
      .dropdown-1aaab757-b16d-413a-9499-a72197bb1732
      > a,
    .power-browser-betty-theme-v2
      .dropdown-1aaab757-b16d-413a-9499-a72197bb1732
      > button,
    .power-browser-betty-theme-v2 .power-browser-state-toggle-v2 {
      color: #fff;
      background: transparent;
    }

    .power-browser-betty-theme-v2
      .dropdown-1aaab757-b16d-413a-9499-a72197bb1732
      > a:hover,
    .power-browser-betty-theme-v2
      .dropdown-1aaab757-b16d-413a-9499-a72197bb1732
      > button:hover,
    .power-browser-betty-theme-v2
      .power-browser-state-toggle-v2:hover {
      background: rgba(255, 255, 255, 0.16);
    }

    .power-browser-betty-theme-v2
      .button-disabled-6b6a60d4-9e38-4279-84a5-5ef466dde62f,
    .power-browser-betty-theme-v2
      .button-disabled-6b6a60d4-9e38-4279-84a5-5ef466dde62f:hover {
      color: rgba(255, 255, 255, 0.56) !important;
      background: rgba(25, 30, 72, 0.16) !important;
    }

    .power-browser-betty-theme-v2 .power-browser-state-menu-v2,
    .power-browser-betty-theme-v2 .power-browser-state-option-v2 {
      color: #29304a;
      background: #fff;
      border-color: #cad3ff;
    }

    .power-browser-betty-theme-v2
      .power-browser-state-option-v2:hover {
      color: #233fc4;
      background: #eef2ff;
    }

    .power-browser-betty-theme-v2
      .power-browser-state-option-v2.no-access,
    .power-browser-betty-theme-v2
      .power-browser-state-option-v2.no-access:hover {
      color: #9499aa;
      background: #f1f2f5;
    }

    .power-browser-betty-theme-v2.power-browser-model-search-dialog-v2 {
      border-color: #7189ff;
      box-shadow: 0 26px 80px rgba(57, 90, 252, 0.25);
    }

    .power-browser-betty-theme-v2
      .power-browser-model-search-result-v2:hover,
    .power-browser-betty-theme-v2
      .power-browser-model-search-result-v2.active,
    .power-browser-betty-theme-v2
      .power-browser-model-search-backoffice-v2:hover {
      background: linear-gradient(
        90deg,
        rgba(233, 0, 76, 0.08),
        rgba(57, 90, 252, 0.12),
        rgba(17, 171, 209, 0.1)
      );
    }

    .power-browser-betty-theme-v2.power-browser-settings-dialog-v2 {
      --power-browser-settings-flash-rgb: 57, 90, 252;
      border-color: rgba(57, 90, 252, 0.35);
      box-shadow: 0 32px 100px rgba(42, 61, 160, 0.32);
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-sidebar-v2 {
      background:
        linear-gradient(
          259deg,
          rgb(233, 0, 76) 0%,
          rgb(57, 90, 252) 51.9162%,
          rgb(17, 171, 209) 100%
        )
        transparent;
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-tab-v2,
    .power-browser-betty-theme-v2
      .power-browser-settings-section-link-v2 {
      color: rgba(255, 255, 255, 0.8);
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-tab-v2:hover,
    .power-browser-betty-theme-v2
      .power-browser-settings-tab-v2.active {
      color: #fff;
      background: rgba(255, 255, 255, 0.18);
      box-shadow: none;
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-section-link-v2:hover,
    .power-browser-betty-theme-v2
      .power-browser-settings-section-link-v2.active {
      color: #fff;
      border-left-color: #fff;
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-main-v2,
    .power-browser-betty-theme-v2
      .power-browser-settings-content-v2 {
      background: #f3f6ff;
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-header-v2,
    .power-browser-betty-theme-v2
      .power-browser-settings-search-v2,
    .power-browser-betty-theme-v2
      .power-browser-settings-footer-v2,
    .power-browser-betty-theme-v2
      .power-browser-settings-card-v2 {
      background: #fff;
      border-color: #dce2ff;
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-close-v2 {
      color: #395afc;
      background: #edf1ff;
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-close-v2:hover {
      color: #e9004c;
      background: #fff0f5;
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-reset-v2 {
      color: #395afc;
      background: #fff;
      border-color: #aebcff;
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-reset-v2:hover {
      color: #e9004c;
      background: #fff4f8;
      border-color: #ed8aad;
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-theme-option-v2.active {
      border-color: #395afc;
      box-shadow: 0 0 0 2px rgba(57, 90, 252, 0.14);
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-size-option-v2.active {
      border-color: #395afc;
      box-shadow: 0 0 0 2px rgba(57, 90, 252, 0.14);
    }

    .power-browser-betty-theme-v2
      .power-browser-settings-version-v2 {
      color: #fff;
    }

    .power-browser-settings-dialog-v2[data-dialog-size="xs"] {
      grid-template-columns: 190px minmax(0, 1fr);
      width: min(780px, calc(100vw - 32px));
      height: min(580px, calc(100vh - 32px));
    }

    .power-browser-settings-dialog-v2[data-dialog-size="sm"] {
      grid-template-columns: 205px minmax(0, 1fr);
      width: min(900px, calc(100vw - 32px));
      height: min(660px, calc(100vh - 32px));
    }

    .power-browser-settings-dialog-v2[data-dialog-size="md"] {
      grid-template-columns: 220px minmax(0, 1fr);
      width: min(1000px, calc(100vw - 32px));
      height: min(740px, calc(100vh - 32px));
    }

    .power-browser-settings-dialog-v2[data-dialog-size="lg"] {
      grid-template-columns: 235px minmax(0, 1fr);
      width: min(1100px, calc(100vw - 24px));
      height: min(790px, calc(100vh - 24px));
    }

    .power-browser-settings-dialog-v2[data-dialog-size="xl"] {
      grid-template-columns: 250px minmax(0, 1fr);
      width: min(1200px, calc(100vw - 20px));
      height: min(860px, calc(100vh - 20px));
    }

    .power-browser-settings-dialog-v2[data-text-size="xs"] {
      --pb-settings-font-micro: 7.5px;
      --pb-settings-font-small: 9px;
      --pb-settings-font-body: 11px;
      --pb-settings-font-input: 10px;
      --pb-settings-font-title: 17px;
      --pb-settings-font-large: 12px;
    }

    .power-browser-settings-dialog-v2[data-text-size="sm"] {
      --pb-settings-font-micro: 8px;
      --pb-settings-font-small: 10px;
      --pb-settings-font-body: 12px;
      --pb-settings-font-input: 11px;
      --pb-settings-font-title: 18px;
      --pb-settings-font-large: 13.5px;
    }

    .power-browser-settings-dialog-v2[data-text-size="lg"] {
      --pb-settings-font-micro: 10px;
      --pb-settings-font-small: 12.5px;
      --pb-settings-font-body: 15px;
      --pb-settings-font-input: 14px;
      --pb-settings-font-title: 23px;
      --pb-settings-font-large: 17px;
    }

    .power-browser-settings-dialog-v2[data-text-size="xl"] {
      --pb-settings-font-micro: 11px;
      --pb-settings-font-small: 14px;
      --pb-settings-font-body: 17px;
      --pb-settings-font-input: 16px;
      --pb-settings-font-title: 26px;
      --pb-settings-font-large: 19px;
    }

    .power-browser-settings-dialog-v2 .power-browser-settings-tab-v2,
    .power-browser-settings-dialog-v2 .power-browser-settings-footer-v2,
    .power-browser-settings-dialog-v2
      .power-browser-settings-diagnostic-v2 strong {
      font-size: var(--pb-settings-font-body);
    }

    .power-browser-settings-dialog-v2
      .power-browser-settings-brand-v2 strong {
      font-size: var(--pb-settings-font-large);
    }

    .power-browser-settings-dialog-v2
      .power-browser-settings-heading-v2 h2 {
      font-size: var(--pb-settings-font-title);
    }

    .power-browser-settings-dialog-v2
      .power-browser-settings-copy-v2 strong,
    .power-browser-settings-dialog-v2
      .power-browser-settings-info-title-v2 {
      font-size: var(--pb-settings-font-large);
    }

    .power-browser-settings-dialog-v2
      .power-browser-settings-section-link-v2,
    .power-browser-settings-dialog-v2
      .power-browser-settings-description-v2,
    .power-browser-settings-dialog-v2
      .power-browser-settings-info-item-v2 dd,
    .power-browser-settings-dialog-v2
      .power-browser-settings-diagnostic-v2 span,
    .power-browser-settings-dialog-v2
      .power-browser-settings-operation-status-v2,
    .power-browser-settings-dialog-v2
      .power-browser-settings-brand-v2 span,
    .power-browser-settings-dialog-v2
      .power-browser-settings-version-v2,
    .power-browser-settings-dialog-v2
      .power-browser-settings-theme-option-v2,
    .power-browser-settings-dialog-v2
      .power-browser-settings-size-option-v2 {
      font-size: var(--pb-settings-font-small);
    }

    .power-browser-settings-dialog-v2
      .power-browser-settings-heading-v2 p,
    .power-browser-settings-dialog-v2
      .power-browser-settings-search-v2 input,
    .power-browser-settings-dialog-v2
      .power-browser-settings-section-v2,
    .power-browser-settings-dialog-v2
      .power-browser-settings-shortcut-v2,
    .power-browser-settings-dialog-v2
      .power-browser-settings-action-v2,
    .power-browser-settings-dialog-v2
      .power-browser-settings-reset-v2,
    .power-browser-settings-dialog-v2
      .power-browser-settings-danger-button-v2 {
      font-size: var(--pb-settings-font-input);
    }

    .power-browser-settings-dialog-v2
      .power-browser-settings-info-item-v2 dt {
      font-size: var(--pb-settings-font-micro);
    }

    .power-browser-settings-dialog-v2
      .power-browser-settings-badge-v2 {
      font-size: var(--pb-settings-font-micro);
    }

    @media (max-width: 720px) {
      .power-browser-settings-dialog-v2,
      .power-browser-settings-dialog-v2.open {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(0, 1fr);
      }

      .power-browser-settings-sidebar-v2 {
        padding: 14px;
      }

      .power-browser-settings-brand-v2,
      .power-browser-settings-version-v2 {
        display: none;
      }

      .power-browser-settings-tabs-v2 {
        height: auto;
        flex: none;
        flex-direction: row;
        overflow-x: auto;
        overflow-y: hidden;
        touch-action: pan-x;
      }

      .power-browser-settings-tab-v2 {
        width: auto;
        white-space: nowrap;
      }

      .power-browser-settings-section-links-v2 {
        flex: none;
        flex-direction: row;
        padding: 0;
      }

      .power-browser-settings-section-link-v2 {
        border-left: 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.16);
        white-space: nowrap;
      }

      .power-browser-settings-card-v2 {
        grid-template-columns: minmax(0, 1fr);
      }

      .power-browser-settings-shortcut-v2 {
        width: 100%;
        box-sizing: border-box;
      }

      .power-browser-settings-info-grid-v2 {
        grid-template-columns: minmax(0, 1fr);
      }

      .power-browser-settings-diagnostics-v2 {
        grid-template-columns: minmax(0, 1fr);
      }

      .power-browser-settings-danger-v2 {
        align-items: stretch;
        flex-direction: column;
      }

      .power-browser-settings-theme-picker-v2 {
        width: 100%;
      }

      .power-browser-settings-size-picker-v2 {
        width: 100%;
      }
    }
  `);

  const APPLICATION_FAMILY_QUERY = `
    query applicationFamily($identifier: String!) {
        applicationFamily(identifier: $identifier) {
            ... on Application {
                id
                appUuid
                parentId
                identifier
                name
                isBranch
                url
                insertedAt
                launchDate
                initials
                pdmDaysRemaining
                lastMerge {
                    insertedAt
                }
                lastRollback {
                    insertedAt
                }
                permissions {
                    isBuilder
                    isMember
                }
                organization {
                    name
                    id
                }
                applicationZone {
                    id
                    label
                    name
                    skipSandboxName
                }
                parent {
                    id
                    name
                    identifier
                }
            }
        }
    }
  `;

  /**
   * Read a cookie from the current document.
   * @param {string} name
   * @return {string|null}
   */
  function getCookieValue(name) {
    const cookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${name}=`));

    if (!cookie) {
      return null;
    }

    return decodeURIComponent(cookie.slice(name.length + 1));
  }

  /**
   * Find the CSRF token used by Betty Blocks APIs.
   * @return {string|null}
   */
  function getCsrfToken() {
    return (
      document.querySelector('meta[name="csrf-token"]')?.content ||
      getCookieValue("x-csrf-token") ||
      getCookieValue("ide_csrf_token") ||
      getCookieValue("csrf_token") ||
      getCookieValue("_csrf_token")
    );
  }

  /**
   * Perform an authenticated GraphQL request through the userscript manager.
   * @param {object} request
   * @param {string} request.url
   * @param {string} request.query
   * @param {object} [request.variables]
   * @param {string} [request.operationName]
   * @param {string} [request.csrfToken]
   * @param {object} [request.headers]
   * @param {number} [request.timeout]
   * @param {string} [request.cookie]
   * @return {Promise<object>}
   */
  function requestGraphQL({
    url,
    query,
    variables = {},
    operationName,
    csrfToken = getCsrfToken(),
    headers = {},
    timeout = 10000,
    cookie = "",
  }) {
    const rejectImmediately = (error) => {
      updatePowerBrowserDiagnostic(
        "graphql",
        "error",
        error.message,
        error,
      );
      return Promise.reject(error);
    };
    if (typeof GM_xmlhttpRequest !== "function") {
      return rejectImmediately(
        new Error("GM_xmlhttpRequest is unavailable."),
      );
    }

    if (!url || !query) {
      return rejectImmediately(
        new Error("A GraphQL URL and query are required."),
      );
    }

    if (!csrfToken) {
      return rejectImmediately(
        new Error("No CSRF token is available."),
      );
    }

    updatePowerBrowserDiagnostic(
      "graphql",
      "loading",
      `${operationName || "GraphQL"} request in progress…`,
    );
    return new Promise((resolve, reject) => {
      const fail = (error) => {
        updatePowerBrowserDiagnostic(
          "graphql",
          "error",
          error.message,
          error,
        );
        reject(error);
      };
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: {
          Accept: "*/*",
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          ...headers,
        },
        data: JSON.stringify({
          operationName,
          variables,
          query,
        }),
        timeout,
        anonymous: false,
        ...(cookie ? { cookie } : {}),
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            const requestError = new Error(
              `GraphQL request failed with status ${response.status}.`,
            );
            requestError.status = response.status;
            requestError.finalUrl = response.finalUrl;
            fail(requestError);
            return;
          }

          try {
            const payload = JSON.parse(response.responseText);

            if (payload.errors?.length) {
              fail(
                new Error(
                  payload.errors.map((error) => error.message).join("; "),
                ),
              );
              return;
            }

            updatePowerBrowserDiagnostic(
              "graphql",
              "success",
              `${operationName || "GraphQL"} request completed.`,
            );
            resolve(payload.data);
          } catch (error) {
            fail(
              new Error("Unable to parse the GraphQL response.", {
                cause: error,
              }),
            );
          }
        },
        onerror: () =>
          fail(new Error("GraphQL network request failed.")),
        ontimeout: () =>
          fail(new Error("GraphQL request timed out.")),
      });
    });
  }

  /**
   * Read cookies belonging to the My Betty Blocks GraphQL endpoint.
   * @return {Promise<{csrfToken: string|null, cookieHeader: string, cookieNames: string[]}>}
   */
  function getMyBettyCookieContext() {
    if (
      typeof GM_cookie === "undefined" ||
      typeof GM_cookie.list !== "function"
    ) {
      return Promise.resolve({
        csrfToken: null,
        cookieHeader: "",
        cookieNames: [],
      });
    }

    return new Promise((resolve) => {
      GM_cookie.list(
        {
          url: "https://my.bettyblocks.com/api/graphql",
        },
        (cookies, error) => {
          if (error) {
            console.warn(
              "[Power Browser v2] Unable to read My Betty Blocks cookies.",
              error,
            );
            resolve({
              csrfToken: null,
              cookieHeader: "",
              cookieNames: [],
            });
            return;
          }

          const sortedCookies = [...cookies].sort(
            (left, right) =>
              String(right.path || "").length -
              String(left.path || "").length,
          );
          const preferredCookieNames = [
            "csrf_token",
            "_csrf_token",
            "CSRF-TOKEN",
            "XSRF-TOKEN",
            "xsrf-token",
          ];
          const csrfCookie =
            preferredCookieNames
              .map((name) =>
                sortedCookies.find((cookie) => cookie.name === name),
              )
              .find(Boolean) ||
            sortedCookies.find((cookie) =>
              /(?:csrf|xsrf)/i.test(cookie.name),
            );

          resolve({
            csrfToken: csrfCookie?.value
              ? decodeURIComponent(csrfCookie.value)
              : null,
            cookieHeader: sortedCookies
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; "),
            cookieNames: sortedCookies.map((cookie) => cookie.name),
          });
        },
      );
    });
  }

  /**
   * Retrieve authentication data belonging to the My Betty Blocks session.
   * @param {string} identifier
   * @param {boolean} [forceRefresh]
   * @return {Promise<{csrfToken: string, cookieHeader: string}>}
   */
  async function fetchMyBettyAuthContext(identifier, forceRefresh = false) {
    const initialContext = await getMyBettyCookieContext();

    if (
      !forceRefresh &&
      initialContext.csrfToken &&
      initialContext.cookieHeader
    ) {
      return initialContext;
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://my.bettyblocks.com/applications/${encodeURIComponent(identifier)}`,
        headers: {
          Accept: "text/html",
        },
        timeout: 10000,
        anonymous: false,
        ...(initialContext.cookieHeader
          ? { cookie: initialContext.cookieHeader }
          : {}),
        onload: async (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(
              new Error(
                `Unable to open My Betty Blocks (status ${response.status}).`,
              ),
            );
            return;
          }

          if (
            /(?:sign[_-]?in|login)/i.test(response.finalUrl || "")
          ) {
            reject(
              new Error(
                "Your My Betty Blocks session has expired. Sign in at my.bettyblocks.com and reload this page.",
              ),
            );
            return;
          }

          const page = new DOMParser().parseFromString(
            response.responseText,
            "text/html",
          );
          const refreshedContext = await getMyBettyCookieContext();
          const csrfToken =
            page.querySelector('meta[name="csrf-token"]')?.content ||
            refreshedContext.csrfToken ||
            initialContext.csrfToken;
          const cookieHeader =
            refreshedContext.cookieHeader ||
            initialContext.cookieHeader;

          if (!csrfToken || !cookieHeader) {
            reject(
              new Error(
                "My Betty Blocks authentication cookies are unavailable. Sign in at my.bettyblocks.com and reload this page.",
              ),
            );
            return;
          }

          resolve({
            csrfToken,
            cookieHeader,
          });
        },
        onerror: () =>
          reject(new Error("Unable to connect to My Betty Blocks.")),
        ontimeout: () =>
          reject(new Error("My Betty Blocks token request timed out.")),
      });
    });
  }

  /**
   * Fetch application-family information from My Betty Blocks.
   * @param {string} identifier
   * @param {boolean} [force]
   * @return {Promise<object|null>}
   */
  async function fetchApplicationFamily(identifier, force = false) {
    if (!identifier) {
      return null;
    }

    try {
      return await getCachedPowerBrowserData(
        applicationFamilyRequestCache,
        identifier,
        async () => {
          updatePowerBrowserDiagnostic(
            "applicationFamily",
            "loading",
            "Loading application-family data…",
          );
          const requestApplicationFamily = (authContext) =>
            requestGraphQL({
              url: "https://my.bettyblocks.com/api/graphql",
              operationName: "applicationFamily",
              variables: { identifier },
              query: APPLICATION_FAMILY_QUERY,
              csrfToken: authContext.csrfToken,
              cookie: authContext.cookieHeader,
              headers: {
                Referer: `https://my.bettyblocks.com/applications/${encodeURIComponent(identifier)}`,
              },
            });
          let authContext =
            await fetchMyBettyAuthContext(identifier);
          let data;

          try {
            data = await requestApplicationFamily(authContext);
          } catch (error) {
            if (error?.status !== 401) {
              throw error;
            }

            authContext = await fetchMyBettyAuthContext(
              identifier,
              true,
            );

            try {
              data = await requestApplicationFamily(authContext);
            } catch (retryError) {
              if (retryError?.status === 401) {
                throw new Error(
                  "My Betty Blocks rejected the authenticated session. Sign in at https://my.bettyblocks.com and reload this page.",
                  { cause: retryError },
                );
              }

              throw retryError;
            }
          }

          const applicationFamily =
            data?.applicationFamily || null;
          updatePowerBrowserDiagnostic(
            "applicationFamily",
            applicationFamily ? "success" : "warning",
            applicationFamily
              ? `Loaded ${Array.isArray(applicationFamily) ? applicationFamily.length : 1} application-family entries.`
              : "No application-family data was returned.",
          );
          return applicationFamily;
        },
        force,
      );
    } catch (error) {
      updatePowerBrowserDiagnostic(
        "applicationFamily",
        "error",
        error instanceof Error
          ? error.message
          : "Unable to retrieve application-family data.",
        error,
      );
      console.warn(
        "[Power Browser v2] Unable to retrieve application-family data.",
        {
          identifier,
          error,
        },
      );
      return null;
    }
  }

  /**
   * Resolve the static artifact location for the current host.
   * Runtime artifacts for bettyblocks.com hosts are served from betty.app.
   * @return {string}
   */
  function resolveArtifactUrl() {
    const artifactHost = location.hostname.replace(
      /\.bettyblocks\.com$/i,
      ".betty.app",
    );
    return new URL(
      "/static/artifact.json",
      `${location.protocol}//${artifactHost}`,
    ).href;
  }

  /**
   * Retrieve and parse the current application's static artifact.
   * @param {boolean} [force]
   * @return {Promise<object|null>}
   */
  async function fetchArtifact(force = false) {
    const artifactUrl = resolveArtifactUrl();

    try {
      return await getCachedPowerBrowserData(
        artifactRequestCache,
        artifactUrl,
        async () => {
          updatePowerBrowserDiagnostic(
            "artifact",
            "loading",
            "Loading runtime artifact…",
          );
          const response = await fetch(artifactUrl, {
            // The betty.app artifact endpoint allows cross-origin requests with
            // a wildcard origin, which cannot be combined with credentials.
            credentials: "omit",
            cache: force ? "no-store" : "default",
          });

          if (!response.ok) {
            throw new Error(
              `Artifact request failed with status ${response.status}`,
            );
          }

          const artifactData = await response.json();
          updatePowerBrowserDiagnostic(
            "artifact",
            "success",
            "Runtime artifact loaded.",
          );
          return artifactData;
        },
        force,
      );
    } catch (error) {
      updatePowerBrowserDiagnostic(
        "artifact",
        "error",
        error instanceof Error
          ? error.message
          : "Unable to retrieve the artifact.",
        error,
      );
      console.warn("[Power Browser v2] Unable to retrieve the artifact.", {
        artifactUrl,
        error,
      });
      return null;
    }
  }

  /**
   * Refreshes the artifact when a family merge is newer than its cache entry.
   *
   * @param {object|null} artifactData
   * @param {object|object[]|null} applicationFamily
   * @returns {Promise<object|null>}
   */
  async function ensureArtifactFreshAfterFamilyMerge(
    artifactData,
    applicationFamily,
  ) {
    const applications = Array.isArray(applicationFamily)
      ? applicationFamily
      : applicationFamily
        ? [applicationFamily]
        : [];
    const latestMergeTimestamp = Math.max(
      0,
      ...applications.map((application) => {
        const timestamp = Date.parse(
          application?.lastMerge?.insertedAt || "",
        );
        return Number.isNaN(timestamp) ? 0 : timestamp;
      }),
    );
    if (!latestMergeTimestamp) {
      return artifactData;
    }

    const artifactUrl = resolveArtifactUrl();
    const cacheEntry = artifactRequestCache.get(artifactUrl);
    const artifactCachedAt = cacheEntry?.cachedAt || 0;
    if (
      artifactCachedAt &&
      latestMergeTimestamp <= artifactCachedAt
    ) {
      return artifactData;
    }

    updatePowerBrowserDiagnostic(
      "artifact",
      "loading",
      "A newer sandbox merge was detected; refreshing the artifact…",
    );
    const refreshedArtifact = await fetchArtifact(true);
    if (!refreshedArtifact) {
      return artifactData;
    }

    const refreshedCacheEntry =
      artifactRequestCache.get(artifactUrl);
    if (refreshedCacheEntry) {
      // A merge timestamp can be slightly ahead of the browser clock. Since
      // this fetch happened after observing it, treat that merge as covered.
      refreshedCacheEntry.cachedAt = Math.max(
        refreshedCacheEntry.cachedAt || 0,
        latestMergeTimestamp,
      );
    }
    updatePowerBrowserDiagnostic(
      "artifact",
      "success",
      "Artifact refreshed after a newer merge to parent.",
    );
    return refreshedArtifact;
  }

  /**
   * Detect the Betty Blocks site type using the current URL and page globals.
   * @param {object|null} artifactData
   * @return {string}
   */
  function detectSiteType(artifactData) {
    if (location.pathname.includes("/api/runtime/")) {
      return SiteType.PLAYGROUND;
    }

    if (
      location.hostname.endsWith(".bettyblocks.com") &&
      location.pathname.startsWith("/app/")
    ) {
      return SiteType.NEXTGEN;
    }

    if (location.hostname.endsWith(".bettyblocks.com")) {
      return SiteType.BETTY5;
    }

    if (pageWindow.Betty) {
      return SiteType.BETTY5;
    }

    if (pageWindow.artifact || artifactData) {
      return SiteType.RUNTIME;
    }

    return SiteType.UNKNOWN;
  }

  /**
   * Resolve the application identifier from the artifact, Betty 5, or hostname.
   * @param {object|null} artifactData
   * @return {string|null}
   */
  function resolveApplicationIdentifier(artifactData) {
    if (artifactData?.applicationIdentifier || artifactData?.appIdentifier) {
      return artifactData.applicationIdentifier || artifactData.appIdentifier;
    }

    if (pageWindow.Betty?.application_identifier) {
      return pageWindow.Betty.application_identifier;
    }

    const [subdomain] = location.hostname.split(".");
    return subdomain && subdomain !== "www" ? subdomain : null;
  }

  /**
   * Create the navigator immediately in its loading state.
   * @return {object}
   */
  function initializeNavigator() {
    const navigatorBar = document.createElement("divider");
    navigatorBar.id = "navigatorBar";
    navigatorBar.className =
      "nav-container-1c7b2759-c793-4d17-b89b-1da6c5c5cf5b";
    navigatorBar.setAttribute("aria-busy", "true");

    const dropdown = document.createElement("divider");
    dropdown.id = "dropdownMenu";
    dropdown.className =
      "dropdown-1aaab757-b16d-413a-9499-a72197bb1732";

    const controls = new Map();
    let stateSwitcher;
    let stateToggle;
    let stateToggleLabel;
    let stateMenu;

    NavigatorItems.forEach((item) => {
      const control = document.createElement(item.button ? "button" : "a");
      control.id = item.id;
      control.innerHTML = `${item.icon}<span>${item.label}</span>`;
      control.classList.add(NAV_DISABLED_CLASS);
      control.setAttribute("aria-disabled", "true");

      if (item.button) {
        control.type = "button";
        control.disabled = true;
      }

      if (item.dynamic) {
        control.classList.add("power-browser-hidden-v2");
      }

      dropdown.appendChild(control);
      controls.set(item.id, control);

      if (item.id === "organizationButton") {
        stateSwitcher = document.createElement("div");
        stateSwitcher.className = "power-browser-state-switcher-v2";

        stateToggle = document.createElement("button");
        stateToggle.type = "button";
        stateToggle.className = `power-browser-state-toggle-v2 ${NAV_DISABLED_CLASS}`;
        stateToggle.disabled = true;
        stateToggle.setAttribute("aria-expanded", "false");
        stateToggle.setAttribute("aria-label", "Sandbox switcher");
        stateToggle.title = "Switch sandbox";
        stateToggle.innerHTML = `${SvgIcons.switch}<span class="power-browser-state-toggle-label-v2">Sandbox switcher</span>`;
        stateToggleLabel = stateToggle.querySelector(
          ".power-browser-state-toggle-label-v2",
        );

        stateMenu = document.createElement("div");
        stateMenu.className = "power-browser-state-menu-v2";

        stateToggle.addEventListener("click", () => {
          const isOpen = stateSwitcher.classList.toggle("open");
          stateToggle.setAttribute("aria-expanded", String(isOpen));
        });

        stateSwitcher.appendChild(stateToggle);
        stateSwitcher.appendChild(stateMenu);
        dropdown.appendChild(stateSwitcher);
      }
    });

    const settingsButton = document.createElement("button");
    settingsButton.id = "settingsButton";
    settingsButton.type = "button";
    settingsButton.disabled = true;
    settingsButton.className = NAV_DISABLED_CLASS;
    settingsButton.innerHTML = `${SvgIcons.settings}<span>Settings</span>`;
    settingsButton.title = "Settings will be added in a later v2 step.";
    dropdown.appendChild(settingsButton);

    navigatorBar.appendChild(dropdown);
    (document.body || document.documentElement).appendChild(navigatorBar);

    document.addEventListener("click", (event) => {
      if (stateSwitcher && !stateSwitcher.contains(event.target)) {
        stateSwitcher.classList.remove("open");
        stateToggle.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && stateSwitcher?.classList.contains("open")) {
        stateSwitcher.classList.remove("open");
        stateToggle.setAttribute("aria-expanded", "false");
        stateToggle.focus();
      }
    });

    return {
      navigatorBar,
      controls,
      stateSwitcher,
      stateToggle,
      stateToggleLabel,
      stateMenu,
    };
  }

  function getSettingDefinition(key) {
    return SettingsDefinitions.find((setting) => setting.key === key) || null;
  }

  function getSettingValue(key) {
    const definition = getSettingDefinition(key);
    return GM_getValue(key, definition?.defaultValue);
  }

  /**
   * Returns the selected theme and migrates the former dark-mode toggle.
   *
   * @returns {"light"|"dark"|"betty"}
   */
  function getPowerBrowserTheme() {
    const storedTheme = GM_getValue("themeMode", null);
    if (["light", "dark", "betty"].includes(storedTheme)) {
      return storedTheme;
    }

    const legacyDarkMode = GM_getValue("themeDarkMode", null);
    const migratedTheme =
      legacyDarkMode === true ? "dark" : "light";
    if (legacyDarkMode !== null) {
      GM_setValue("themeMode", migratedTheme);
      GM_deleteValue("themeDarkMode");
    }
    return migratedTheme;
  }

  const SETTINGS_SIZE_VALUES = Object.freeze([
    "xs",
    "sm",
    "md",
    "lg",
    "xl",
  ]);

  function migrateLegacySeniorDeveloperMode() {
    const legacyValue = GM_getValue("seniorDeveloperMode", null);
    if (legacyValue === null) {
      return;
    }

    if (legacyValue === true) {
      if (GM_getValue("settingsDialogSize", null) === null) {
        GM_setValue("settingsDialogSize", "lg");
      }
      if (GM_getValue("settingsTextSize", null) === null) {
        GM_setValue("settingsTextSize", "lg");
      }
    }
    GM_deleteValue("seniorDeveloperMode");
  }

  function getSettingsSize(key) {
    const value = getSettingValue(key);
    return SETTINGS_SIZE_VALUES.includes(value) ? value : "md";
  }

  function applyAppearanceSettings(navigator) {
    migrateLegacySeniorDeveloperMode();
    const theme = getPowerBrowserTheme();
    const iconOnly = Boolean(getSettingValue("iconOnlyMode"));
    const dialogSize = getSettingsSize("settingsDialogSize");
    const textSize = getSettingsSize("settingsTextSize");
    const showSandboxName =
      iconOnly &&
      Boolean(
        getSettingValue(
          "sandboxSwitcherShowApplicationName",
        ),
      );
    const themedSurfaces = [
      navigator.navigatorBar,
      modelSearchState?.dialog,
      settingsState?.dialog,
    ].filter(Boolean);

    themedSurfaces.forEach((surface) => {
      surface.classList.toggle(
        "power-browser-dark-v2",
        theme === "dark",
      );
      surface.classList.toggle(
        "power-browser-betty-theme-v2",
        theme === "betty",
      );
    });
    navigator.navigatorBar.classList.toggle(
      "power-browser-icon-only-v2",
      iconOnly,
    );
    navigator.navigatorBar.classList.toggle(
      "power-browser-show-sandbox-name-v2",
      showSandboxName,
    );
    if (settingsState?.dialog) {
      settingsState.dialog.dataset.dialogSize = dialogSize;
      settingsState.dialog.dataset.textSize = textSize;
    }
  }

  function applyNavigatorVisibilitySettings(navigator) {
    const controlSettings = {
      buttonOrganizationHidden: "organizationButton",
      buttonHomePageHidden: "homePageButton",
      buttonBackOfficeHidden: "backOfficeButton",
      buttonB5Models: "b5Models",
      buttonB5Monitoring: "monitoringButton",
      buttonPlaygroundHidden: "playgroundButton",
      buttonRuntimeHidden: "buttonRuntime",
      buttonPagebuilderHidden: "buttonPagebuilder",
      buttonProcoderModeHidden: "buttonProcoderMode",
      buttonCopyBearerHidden: "buttonCopyBearer",
      buttonRuntimeModelSearchHidden: "buttonRuntimeModelSearch",
    };

    Object.entries(controlSettings).forEach(([settingKey, controlId]) => {
      navigator.controls
        .get(controlId)
        ?.classList.toggle(
          "power-browser-setting-hidden-v2",
          Boolean(getSettingValue(settingKey)),
        );
    });
    navigator.stateSwitcher.classList.toggle(
      "power-browser-setting-hidden-v2",
      Boolean(getSettingValue("sandboxSwitcherHidden")),
    );
  }

  function applyFeatureFlagSettings(siteType) {
    SettingsDefinitions.filter(
      (definition) =>
        definition.flag && definition.siteTypes?.includes(siteType),
    ).forEach((definition) => {
      if (getSettingValue(definition.key)) {
        localStorage.setItem(definition.flag, "true");
      } else {
        localStorage.removeItem(definition.flag);
      }
    });
  }

  function setBooleanCookie(name, enabled) {
    if (enabled) {
      document.cookie = `${name}=true;path=/;SameSite=Lax`;
    } else {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  }

  function updateSettingsReloadNotice() {
    if (!settingsState?.reloadAlert) {
      return;
    }

    const labels = {
      extraHotfix: "Hotfix mode",
      extraAdvancedMode: "Always advanced mode",
    };
    const changedSettings = [...pendingReloadSettings].map(
      (key) => labels[key] || key,
    );
    const hasPendingReload = changedSettings.length > 0;

    settingsState.reloadAlert.classList.toggle(
      "open",
      hasPendingReload,
    );
    settingsState.reloadText.textContent = hasPendingReload
      ? `${changedSettings.join(" and ")} changed. Reload the page when you are ready to apply the new state.`
      : "";
  }

  function applyHotfixMenuState() {
    const hotfixEnabled =
      currentPowerBrowserContext?.siteType === SiteType.BETTY5 &&
      Boolean(getSettingValue("extraHotfix"));
    document
      .getElementById("dropdownMenu")
      ?.classList.toggle(
        "power-browser-hotfix-active-v2",
        hotfixEnabled,
      );
  }

  function applyBetty5Setting(key, value) {
    if (currentPowerBrowserContext?.siteType !== SiteType.BETTY5) {
      return;
    }

    const cookieName =
      key === "extraHotfix"
        ? "overrideSandbox"
        : key === "extraAdvancedMode"
          ? "advancedOptions"
          : null;

    if (!cookieName) {
      return;
    }

    const currentlyEnabled = Boolean(getCookieValue(cookieName));
    const desiredValue = Boolean(value);

    if (!betty5ReloadBaselines.has(key)) {
      betty5ReloadBaselines.set(key, currentlyEnabled);
    }

    if (currentlyEnabled !== desiredValue) {
      setBooleanCookie(cookieName, desiredValue);
    }

    if (desiredValue !== betty5ReloadBaselines.get(key)) {
      pendingReloadSettings.add(key);
    } else {
      pendingReloadSettings.delete(key);
    }

    updateSettingsReloadNotice();
  }

  function refreshBetty5ActionHighlighting() {
    const stackedViews = Object.values(
      pageWindow.Betty?.trail_view?.children?._views || {},
    );

    if (!stackedViews.length) {
      clearTimeout(betty5HighlightRetry);
      betty5HighlightRetry = setTimeout(() => {
        if (getSettingValue("extraB5Highlighting")) {
          refreshBetty5ActionHighlighting();
        }
      }, 250);
      return;
    }

    const actionIds = stackedViews.map(
      (view) => view.model?.attributes?.action_id,
    );
    const selectedRecordIds = stackedViews.map(
      (view) => view.model?.attributes?.selected_record_id,
    );

    actionIds.forEach((actionId, index) => {
      if (actionId === undefined) {
        return;
      }

      const actionView = stackedViews[index];
      const nextView = stackedViews[index + 1];
      const actionElements = [
        ...(actionView?.body?.el?.getElementsByClassName("event") || []),
      ];

      if (!nextView) {
        actionElements
          .find((element) => element.classList.contains("active"))
          ?.classList.remove("active");
        return;
      }

      const selectedAction = actionElements.find(
        (element) =>
          element.dataset.id === String(selectedRecordIds[index + 1]),
      );

      if (!selectedAction) {
        return;
      }

      actionElements
        .find((element) => element.classList.contains("active"))
        ?.classList.remove("active");
      selectedAction.classList.add("active");
    });
  }

  function applyBetty5ActionHighlighting() {
    const enabled =
      currentPowerBrowserContext?.siteType === SiteType.BETTY5 &&
      !location.hash.startsWith("#pages_overview") &&
      Boolean(getSettingValue("extraB5Highlighting"));

    document.documentElement.classList.toggle(
      "power-browser-b5-highlighting-v2",
      enabled,
    );
    clearTimeout(betty5HighlightRetry);

    if (!enabled) {
      document
        .querySelectorAll("div.event.active")
        .forEach((element) => element.classList.remove("active"));
      return;
    }

    refreshBetty5ActionHighlighting();

  }

  function getCurrentBetty5ConfigurationPassword() {
    const configurations = pageWindow.Betty?.Cache?.configurations?.models;

    if (!Array.isArray(configurations)) {
      return null;
    }

    const possibleIds = [
      location.hash.split("/").filter(Boolean).at(-1),
      location.pathname.split("/").filter(Boolean).at(-1),
      document.URL.split("/").filter(Boolean).at(-1),
    ].filter(Boolean);
    const configuration = configurations.find((model) =>
      possibleIds.includes(String(model?.attributes?.id)),
    );
    const settings = configuration?.attributes?.settings;

    if (!settings || typeof settings !== "object") {
      return null;
    }

    const passwordKey = Object.keys(settings).find((key) =>
      key.toLowerCase().includes("password"),
    );
    const password = passwordKey ? settings[passwordKey] : null;
    return password == null ? null : String(password);
  }

  function revealCurrentBetty5Password() {
    const password = getCurrentBetty5ConfigurationPassword();

    if (password == null) {
      return false;
    }

    let revealed = false;
    document
      .querySelectorAll(".form-control-static.input-label")
      .forEach((element) => {
        if (element.textContent.trim() !== "***") {
          return;
        }

        element.textContent = password;
        element.classList.add("power-browser-b5-password-v2");
        element.dataset.powerBrowserPasswordRevealed = "true";
        revealed = true;
      });
    document.querySelectorAll("input.form-control").forEach((input) => {
      if (input.value !== "***") {
        return;
      }

      input.dataset.powerBrowserOriginalType = input.type;
      input.dataset.powerBrowserPasswordRevealed = "true";
      input.value = password;
      input.type = "text";
      input.classList.add("power-browser-b5-password-v2");
      revealed = true;
    });
    return revealed;
  }

  function remaskBetty5Passwords() {
    document
      .querySelectorAll('[data-power-browser-password-revealed="true"]')
      .forEach((element) => {
        if (element instanceof window.HTMLInputElement) {
          element.value = "***";
          element.type =
            element.dataset.powerBrowserOriginalType || "password";
          delete element.dataset.powerBrowserOriginalType;
        } else {
          element.textContent = "***";
        }

        element.classList.remove("power-browser-b5-password-v2");
        delete element.dataset.powerBrowserPasswordRevealed;
      });
  }

  function applyBetty5PasswordRevealer() {
    const enabled =
      currentPowerBrowserContext?.siteType === SiteType.BETTY5 &&
      !location.hash.startsWith("#pages_overview") &&
      Boolean(getSettingValue("extraB5PasswordRevealer"));

    clearTimeout(betty5PasswordRetry);

    if (!enabled) {
      betty5PasswordObserver?.disconnect();
      betty5PasswordObserver = null;
      remaskBetty5Passwords();
      return;
    }

    if (!pageWindow.Betty?.Cache?.configurations?.models) {
      betty5PasswordRetry = setTimeout(
        applyBetty5PasswordRevealer,
        250,
      );
      return;
    }

    revealCurrentBetty5Password();

    if (!betty5PasswordObserver) {
      betty5PasswordObserver = new MutationObserver(() => {
        revealCurrentBetty5Password();
      });
      betty5PasswordObserver.observe(document, {
        childList: true,
        subtree: true,
      });
    }

  }

  /**
   * Adds the layout rules used by enhanced Betty 5 variable browsers.
   *
   * @returns {void}
   */
  function ensureBetty5VariableSearchStyles() {
    if (document.getElementById("power-browser-b5-variable-search-style-v2")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "power-browser-b5-variable-search-style-v2";
    style.textContent = `
      .power-browser-b5-variable-dialog-v2 {
        width: min(1400px, calc(100vw - 48px)) !important;
        max-width: calc(100vw - 48px) !important;
      }

      .power-browser-b5-variable-content-v2 .modal-body {
        height: min(76vh, 820px) !important;
        max-height: calc(100vh - 190px) !important;
      }

      .power-browser-b5-variable-content-v2 .variables_browser,
      .power-browser-b5-variable-content-v2 .model_browser {
        width: 100% !important;
        max-width: 100% !important;
      }

      .power-browser-b5-variable-content-v2 .variables_browser > .raumer > .variables,
      .power-browser-b5-variable-content-v2 .model_browser > .raumer > .variables,
      .power-browser-b5-variable-content-v2 .variables_browser > .raumer > .variables > ul.variables,
      .power-browser-b5-variable-content-v2 .model_browser > .raumer > .variables > ul.variables,
      .power-browser-b5-variable-content-v2 .variables_browser > .raumer > .variables > ul.variables > li,
      .power-browser-b5-variable-content-v2 .model_browser > .raumer > .variables > ul.variables > li {
        width: 282px !important;
      }

      .power-browser-b5-variable-content-v2 .variables_browser > .raumer > .path,
      .power-browser-b5-variable-content-v2 .model_browser > .raumer > .path {
        width: 100% !important;
      }

      .power-browser-b5-variable-content-v2 .variables_browser .path > ul.path,
      .power-browser-b5-variable-content-v2 .model_browser .path > ul.path {
        display: flex !important;
        left: 282px !important;
        width: calc(100% - 282px) !important;
      }

      .power-browser-b5-variable-content-v2.power-browser-b5-variable-no-arrowbox-v2 .variables_browser .path > ul.path,
      .power-browser-b5-variable-content-v2.power-browser-b5-variable-no-arrowbox-v2 .model_browser .path > ul.path {
        left: 248px !important;
        width: 100% !important;
        max-width: 1150px !important;
      }

      .power-browser-b5-variable-content-v2 .variables_browser .path > ul.path > li,
      .power-browser-b5-variable-content-v2 .model_browser .path > ul.path > li {
        flex: 1 1 0 !important;
        min-width: 300px !important;
        max-width: none !important;
      }

      [data-power-browser-b5-variable-enhanced-v2] .variables li > h4,
      [data-power-browser-b5-variable-enhanced-v2] .path li > h4 {
        position: relative !important;
        box-sizing: border-box !important;
        min-height: 82px !important;
        height: 82px !important;
        line-height: 32px !important;
        padding-right: 50px !important;
        padding-bottom: 42px !important;
      }

      [data-power-browser-b5-variable-enhanced-v2] div.properties,
      [data-power-browser-b5-variable-enhanced-v2] div.categories {
        top: 82px !important;
      }

      [data-power-browser-b5-variable-search-v2] {
        position: absolute !important;
        top: 42px !important;
        left: 10px !important;
        right: 50px !important;
        display: block !important;
        width: auto !important;
        max-width: none !important;
        min-width: 0 !important;
        height: 34px !important;
        z-index: 2 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * Marks the containing Betty 5 modal so its browser can use more space.
   *
   * @param {Element} browser
   * @returns {void}
   */
  function markBetty5VariableBrowserModal(browser) {
    browser
      .closest(".modal-dialog")
      ?.classList.add("power-browser-b5-variable-dialog-v2");

    const modalContent = browser.closest(".modal-content");
    if (!modalContent) {
      return;
    }

    modalContent.classList.add("power-browser-b5-variable-content-v2");
    modalContent.classList.toggle(
      "power-browser-b5-variable-no-arrowbox-v2",
      !modalContent.querySelector(".arrowbox"),
    );
  }

  /**
   * Restores the display value an item had before filtering.
   *
   * @param {HTMLElement} item
   * @returns {void}
   */
  function restoreBetty5VariableItemDisplay(item) {
    if (!item.hasAttribute("data-power-browser-b5-original-display-v2")) {
      return;
    }

    item.style.display = item.getAttribute(
      "data-power-browser-b5-original-display-v2",
    );
    item.removeAttribute("data-power-browser-b5-original-display-v2");
  }

  /**
   * Applies one column's current variable-search query.
   *
   * @param {Element} column
   * @returns {void}
   */
  function filterBetty5VariableColumn(column) {
    const input = column.querySelector(
      ':scope > h4 [data-power-browser-b5-variable-search-v2]',
    );
    if (!input) {
      return;
    }

    const query = input.value.trim().toLocaleLowerCase();
    column
      .querySelectorAll(
        ".properties .list-group-item, .categories .list-group-item",
      )
      .forEach((item) => {
        if (
          !item.hasAttribute("data-power-browser-b5-original-display-v2")
        ) {
          item.setAttribute(
            "data-power-browser-b5-original-display-v2",
            item.style.display,
          );
        }

        const title = item.getAttribute("title");
        const directText = Array.from(item.childNodes)
          .filter((node) => node.nodeType === window.Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join(" ")
          .trim();
        const searchableText = (
          title ||
          directText ||
          item.textContent ||
          ""
        ).toLocaleLowerCase();
        const originalDisplay = item.getAttribute(
          "data-power-browser-b5-original-display-v2",
        );
        item.style.display =
          !query || searchableText.includes(query)
            ? originalDisplay
            : "none";
      });
  }

  /**
   * Adds a search field to a Betty 5 variable-browser column.
   *
   * @param {Element} column
   * @returns {void}
   */
  function addBetty5VariableSearchInput(column) {
    const heading = column.querySelector(":scope > h4");
    if (
      !heading ||
      heading.querySelector("[data-power-browser-b5-variable-search-v2]")
    ) {
      return;
    }

    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search...";
    input.className = "form-control";
    input.setAttribute("data-power-browser-b5-variable-search-v2", "");
    input.setAttribute("aria-label", "Search variables");
    input.autocomplete = "off";
    input.spellcheck = false;

    const label = heading.querySelector("span");
    if (label) {
      heading.insertBefore(input, label);
    } else {
      heading.appendChild(input);
    }
  }

  /**
   * Enhances all variable and model browsers currently mounted by Betty 5.
   *
   * @returns {void}
   */
  function enhanceBetty5VariableBrowsers() {
    if (
      currentPowerBrowserContext?.siteType !== SiteType.BETTY5 ||
      !Boolean(getSettingValue("extraB5VariableSearch"))
    ) {
      return;
    }

    ensureBetty5VariableSearchStyles();
    document
      .querySelectorAll(".variables_browser, .model_browser")
      .forEach((browser) => {
        browser.setAttribute(
          "data-power-browser-b5-variable-enhanced-v2",
          "",
        );
        markBetty5VariableBrowserModal(browser);
        browser
          .querySelectorAll(
            ".variables ul.variables > li, .path ul.path > li",
          )
          .forEach((column) => {
            addBetty5VariableSearchInput(column);
            filterBetty5VariableColumn(column);
          });
      });
  }

  /**
   * Debounces enhancement after Betty 5 adds another variable path column.
   *
   * @returns {void}
   */
  function scheduleBetty5VariableSearchEnhancement() {
    clearTimeout(betty5VariableSearchTimer);
    betty5VariableSearchTimer = setTimeout(
      enhanceBetty5VariableBrowsers,
      80,
    );
  }

  /**
   * Handles input without allowing Betty 5's modal shortcuts to consume it.
   *
   * @param {Event} event
   * @returns {void}
   */
  function handleBetty5VariableSearchInput(event) {
    const input = event.target?.closest?.(
      "[data-power-browser-b5-variable-search-v2]",
    );
    if (!input) {
      return;
    }

    const column = input.closest(
      ".variables ul.variables > li, .path ul.path > li",
    );
    if (column) {
      filterBetty5VariableColumn(column);
    }
  }

  /**
   * Prevents Betty 5 browser click and keyboard handlers from consuming input
   * interactions.
   *
   * @param {Event} event
   * @returns {void}
   */
  function stopBetty5VariableSearchPropagation(event) {
    if (
      event.target?.closest?.(
        "[data-power-browser-b5-variable-search-v2]",
      )
    ) {
      event.stopPropagation();
    }
  }

  /**
   * Schedules enhancement when a nested browser column is opened.
   *
   * @param {Event} event
   * @returns {void}
   */
  function handleBetty5VariableBrowserClick(event) {
    const item = event.target?.closest?.(".list-group-item.has-children");
    if (
      item?.closest(".variables_browser, .model_browser")
    ) {
      scheduleBetty5VariableSearchEnhancement();
    }
  }

  /**
   * Removes all DOM changes made by enhanced variable search.
   *
   * @returns {void}
   */
  function cleanupBetty5VariableSearch() {
    clearTimeout(betty5VariableSearchTimer);
    betty5VariableSearchTimer = null;
    betty5VariableSearchObserver?.disconnect();
    betty5VariableSearchObserver = null;

    document
      .querySelectorAll("[data-power-browser-b5-variable-search-v2]")
      .forEach((input) => input.remove());
    document
      .querySelectorAll("[data-power-browser-b5-original-display-v2]")
      .forEach(restoreBetty5VariableItemDisplay);
    document
      .querySelectorAll("[data-power-browser-b5-variable-enhanced-v2]")
      .forEach((browser) =>
        browser.removeAttribute(
          "data-power-browser-b5-variable-enhanced-v2",
        ),
      );
    document
      .querySelectorAll(".power-browser-b5-variable-dialog-v2")
      .forEach((dialog) =>
        dialog.classList.remove("power-browser-b5-variable-dialog-v2"),
      );
    document
      .querySelectorAll(".power-browser-b5-variable-content-v2")
      .forEach((content) => {
        content.classList.remove(
          "power-browser-b5-variable-content-v2",
          "power-browser-b5-variable-no-arrowbox-v2",
        );
      });
    document
      .getElementById("power-browser-b5-variable-search-style-v2")
      ?.remove();

    if (betty5VariableSearchListenersAttached) {
      document.removeEventListener(
        "input",
        handleBetty5VariableSearchInput,
        true,
      );
      ["click", "mousedown", "keydown"].forEach((eventName) => {
        document.removeEventListener(
          eventName,
          stopBetty5VariableSearchPropagation,
          true,
        );
      });
      document.removeEventListener(
        "click",
        handleBetty5VariableBrowserClick,
        true,
      );
      betty5VariableSearchListenersAttached = false;
    }
  }

  /**
   * Applies the enhanced variable-search setting to Betty 5.
   *
   * @returns {void}
   */
  function applyBetty5VariableSearch() {
    const enabled =
      currentPowerBrowserContext?.siteType === SiteType.BETTY5 &&
      Boolean(getSettingValue("extraB5VariableSearch"));

    if (!enabled) {
      cleanupBetty5VariableSearch();
      return;
    }

    if (!betty5VariableSearchListenersAttached) {
      document.addEventListener(
        "input",
        handleBetty5VariableSearchInput,
        true,
      );
      ["click", "mousedown", "keydown"].forEach((eventName) => {
        document.addEventListener(
          eventName,
          stopBetty5VariableSearchPropagation,
          true,
        );
      });
      document.addEventListener(
        "click",
        handleBetty5VariableBrowserClick,
        true,
      );
      betty5VariableSearchListenersAttached = true;
    }

    enhanceBetty5VariableBrowsers();
    if (!betty5VariableSearchObserver) {
      betty5VariableSearchObserver = new MutationObserver((mutations) => {
        const browserSelector = ".variables_browser, .model_browser";
        const columnSelector =
          ".variables ul.variables > li, .path ul.path > li";
        const shouldEnhance = mutations.some((mutation) =>
          Array.from(mutation.addedNodes).some(
            (node) =>
              node.nodeType === window.Node.ELEMENT_NODE &&
              (node.matches?.(browserSelector) ||
                node.matches?.(columnSelector) ||
                node.querySelector?.(
                  `${browserSelector}, ${columnSelector}`,
                )),
          ),
        );

        if (shouldEnhance) {
          scheduleBetty5VariableSearchEnhancement();
        }
      });
      betty5VariableSearchObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  function applyUiBuilderMaskSetting() {
    if (
      currentPowerBrowserContext?.siteType !== SiteType.BETTY5 ||
      !location.hash.startsWith("#pages_overview")
    ) {
      return;
    }

    const shouldRemove = Boolean(
      getSettingValue("extraPageUIRemoveUneditableLayer"),
    );
    let attempts = 0;
    const updateMask = () => {
      attempts += 1;
      const iframe = document.getElementById("endpoint_preview");
      const iframeDocument =
        iframe?.contentDocument || iframe?.contentWindow?.document;
      const container = iframeDocument?.getElementById("container");
      const mask = iframeDocument?.getElementById("pretty-betty-mask");

      if (shouldRemove && mask) {
        mask.remove();
        return;
      }

      if (!shouldRemove && container && !mask) {
        const replacementMask = iframeDocument.createElement("div");
        replacementMask.id = "pretty-betty-mask";
        container.appendChild(replacementMask);
        return;
      }

      if ((!iframeDocument || (shouldRemove && !mask)) && attempts < 20) {
        setTimeout(updateMask, 250);
      }
    };

    updateMask();
  }

  /**
   * Returns whether the current Next-gen route is an action editor.
   *
   * @returns {boolean}
   */
  function isNextgenActionPage() {
    return (
      location.pathname === "/app/actions" ||
      location.pathname.includes("/app/actions/")
    );
  }

  /**
   * Locates the active "Enter test values" dialog and verifies its complete
   * Playground signature. Radix reuses dialog containers, so the title, tabs,
   * selected tab, active panel and expected fields must all match.
   *
   * @returns {{dialog: Element, panel: Element}|null}
   */
  function getActiveActionPlaygroundDialog() {
    if (!isNextgenActionPage()) {
      return null;
    }

    const dialogs = Array.from(
      document.querySelectorAll(
        '[role="dialog"][data-state="open"]',
      ),
    );

    for (const dialog of dialogs) {
      const title = dialog.querySelector("h2");
      if (title?.textContent.trim() !== "Enter test values") {
        continue;
      }

      const tabs = Array.from(
        dialog.querySelectorAll('[role="tab"]'),
      );
      const tabNames = new Set(
        tabs.map((tab) => tab.textContent.trim()),
      );
      if (
        !["Basic", "Advanced", "Playground"].every((name) =>
          tabNames.has(name),
        )
      ) {
        continue;
      }

      const playgroundTab = tabs.find(
        (tab) =>
          tab.textContent.trim() === "Playground" &&
          tab.getAttribute("aria-selected") === "true" &&
          tab.dataset.state === "active",
      );
      const panelId = playgroundTab?.getAttribute("aria-controls");
      const panel = Array.from(
        dialog.querySelectorAll('[role="tabpanel"]'),
      ).find(
        (candidate) =>
          candidate.id === panelId &&
          candidate.dataset.state === "active" &&
          !candidate.hidden,
      );
      if (!panel) {
        continue;
      }

      const fieldNames = new Set(
        Array.from(panel.querySelectorAll("label")).map((label) =>
          label.textContent.trim(),
        ),
      );
      if (
        !fieldNames.has("Mutation") ||
        !fieldNames.has("Variables") ||
        panel.querySelectorAll("textarea").length < 2
      ) {
        continue;
      }

      return { dialog, panel };
    }

    return null;
  }

  /**
   * Checks whether the current action is marked as public by Betty Blocks.
   *
   * @returns {boolean}
   */
  function isCurrentActionPublic() {
    return Boolean(
      document.querySelector(
        '[data-testid="icon_publicaction"]',
      ),
    );
  }

  /**
   * Creates the editable JSON shown in the injected Headers field.
   *
   * @returns {string}
   */
  function getActionPlaygroundHeadersJson() {
    if (isCurrentActionPublic()) {
      return JSON.stringify({}, null, 2);
    }

    const token = getBearerToken();
    const authorization = token
      ? token.toLowerCase().startsWith("bearer ")
        ? token
        : `Bearer ${token}`
      : "Bearer ";

    return JSON.stringify(
      {
        Authorization: authorization,
      },
      null,
      2,
    );
  }

  /**
   * Extracts an Authorization value from a case-insensitive headers object.
   *
   * @param {Record<string, unknown>} headers
   * @returns {string}
   */
  function getAuthorizationHeader(headers) {
    const entry = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === "authorization",
    );
    return entry?.[1] == null ? "" : String(entry[1]).trim();
  }

  /**
   * Decodes a JWT payload without attempting to verify its signature.
   *
   * @param {string} authorization
   * @returns {Record<string, unknown>}
   */
  function decodeActionPlaygroundJwt(authorization) {
    const token = authorization
      .replace(/^Bearer\s+/i, "")
      .trim();
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Authorization does not contain a valid JWT.");
    }

    try {
      const base64 = parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
      const binary = window.atob(base64);
      const bytes = Uint8Array.from(
        binary,
        (character) => character.charCodeAt(0),
      );
      const payload = JSON.parse(
        new window.TextDecoder().decode(bytes),
      );

      if (!payload || typeof payload !== "object") {
        throw new Error("JWT payload is not an object.");
      }

      return payload;
    } catch (error) {
      throw new Error("Unable to decode the Authorization JWT.", {
        cause: error,
      });
    }
  }

  /**
   * Finds a textarea by its field label inside the active Playground panel.
   *
   * @param {Element} panel
   * @param {string} fieldName
   * @returns {HTMLTextAreaElement|null}
   */
  function getActionPlaygroundTextarea(panel, fieldName) {
    const label = Array.from(panel.querySelectorAll("label")).find(
      (candidate) => candidate.textContent.trim() === fieldName,
    );
    return label?.parentElement?.querySelector("textarea") || null;
  }

  /**
   * Resolves the current application's runtime request context.
   *
   * @returns {Promise<{url: string, identifier: string, applicationId: string}>}
   */
  async function getActionPlaygroundRuntimeContext() {
    let artifactData =
      currentPowerBrowserContext?.artifactData || (await fetchArtifact());
    const identifier =
      currentPowerBrowserContext?.identifier ||
      resolveApplicationIdentifier(artifactData);
    let applicationFamily =
      currentPowerBrowserContext?.applicationFamily || null;
    artifactData = await ensureArtifactFreshAfterFamilyMerge(
      artifactData,
      applicationFamily,
    );
    if (currentPowerBrowserContext) {
      currentPowerBrowserContext.artifactData = artifactData;
    }
    let applicationId = getApplicationId(
      artifactData,
      applicationFamily,
      identifier,
    );

    if (!applicationId && identifier) {
      applicationFamily = await fetchApplicationFamily(identifier);
      if (currentPowerBrowserContext) {
        currentPowerBrowserContext.applicationFamily =
          applicationFamily;
      }
      artifactData = await ensureArtifactFreshAfterFamilyMerge(
        artifactData,
        applicationFamily,
      );
      if (currentPowerBrowserContext) {
        currentPowerBrowserContext.artifactData = artifactData;
      }
      applicationId = getApplicationId(
        artifactData,
        applicationFamily,
        identifier,
      );
    }

    if (!identifier || !applicationId) {
      throw new Error(
        "The application identifier or runtime UUID is unavailable.",
      );
    }

    const environmentPrefix = getEnvironmentPrefix();
    return {
      url: `https://${identifier}.${environmentPrefix}betty.app/api/runtime/${applicationId}`,
      identifier,
      applicationId: String(applicationId),
    };
  }

  /**
   * Returns the applications belonging to the current application family.
   *
   * @param {string} identifier
   * @returns {Promise<object[]>}
   */
  async function getActionPlaygroundApplicationFamily(identifier) {
    let applicationFamily =
      currentPowerBrowserContext?.applicationFamily || null;

    if (!applicationFamily && identifier) {
      applicationFamily = await fetchApplicationFamily(identifier);
      if (currentPowerBrowserContext) {
        currentPowerBrowserContext.applicationFamily =
          applicationFamily;
      }
    }

    if (!applicationFamily) {
      return [];
    }

    if (currentPowerBrowserContext) {
      currentPowerBrowserContext.artifactData =
        await ensureArtifactFreshAfterFamilyMerge(
          currentPowerBrowserContext.artifactData,
          applicationFamily,
        );
    }

    return Array.isArray(applicationFamily)
      ? applicationFamily
      : [applicationFamily];
  }

  /**
   * Describes which family application a mismatched bearer belongs to.
   *
   * @param {string} bearerApplicationId
   * @param {{identifier: string, applicationId: string}} runtimeContext
   * @returns {Promise<string>}
   */
  async function getActionBearerApplicationMismatchMessage(
    bearerApplicationId,
    runtimeContext,
  ) {
    const applicationFamily =
      await getActionPlaygroundApplicationFamily(
        runtimeContext.identifier,
      );
    const bearerApplication = applicationFamily.find(
      (application) =>
        String(application?.appUuid || "") ===
        bearerApplicationId,
    );
    const currentApplication = applicationFamily.find(
      (application) =>
        String(application?.appUuid || "") ===
          runtimeContext.applicationId ||
        application?.identifier === runtimeContext.identifier,
    );
    const currentApplicationName =
      currentApplication?.name ||
      currentApplication?.identifier ||
      runtimeContext.identifier;

    if (bearerApplication) {
      const bearerApplicationName =
        bearerApplication.name ||
        bearerApplication.identifier ||
        "Unknown application";
      return `Bearer belongs to ${bearerApplicationName} (${bearerApplicationId}), but the current application is ${currentApplicationName} (${runtimeContext.applicationId}).`;
    }

    const bearerApplicationLabel =
      bearerApplicationId || "missing";
    return `Bearer app_uuid ${bearerApplicationLabel} does not match the current application ${currentApplicationName} (${runtimeContext.applicationId}).`;
  }

  /**
   * Retrieves only the action settings needed for Authorization validation.
   *
   * @param {string} identifier
   * @param {boolean} [force]
   * @returns {Promise<{public: boolean, authenticationProfile: string}>}
   */
  async function fetchActionAuthorizationSettings(
    identifier,
    force = false,
  ) {
    const actionId = location.pathname.match(
      /\/app\/actions\/([^/?#]+)/i,
    )?.[1];
    if (!actionId) {
      throw new Error(
        "Unable to determine the current action identifier.",
      );
    }

    const cacheKey = `${location.origin}:${identifier}:${actionId}`;
    try {
      return await getCachedPowerBrowserData(
        actionSettingsRequestCache,
        cacheKey,
        async () => {
          updatePowerBrowserDiagnostic(
            "actionSettings",
            "loading",
            "Loading action authorization settings…",
          );
          const csrfToken =
            getCsrfToken() || getNextgenLogCsrfToken();
          if (!csrfToken) {
            throw new Error(
              "Unable to retrieve the action settings because no CSRF token is available.",
            );
          }

          const response = await fetch(
            `${location.origin}/api/meta/graphql`,
            {
              headers: {
                Accept: "*/*",
                "application-identifier": identifier,
                "content-type": "application/json",
                "x-csrf-token": csrfToken,
              },
              referrer: location.href,
              body: JSON.stringify({
                operationName: "Action",
                variables: {
                  input: {
                    id: actionId,
                  },
                },
                query: `query Action($input: ActionInput!) {
                  action(input: $input) {
                    public
                    options {
                      authenticationProfile
                    }
                  }
                }`,
              }),
              method: "POST",
              mode: "cors",
              credentials: "include",
            },
          );

          if (!response.ok) {
            throw new Error(
              `Action-settings request failed with status ${response.status}.`,
            );
          }

          const payload = await response.json();
          if (payload.errors?.length) {
            throw new Error(
              payload.errors
                .map((error) => error.message)
                .join("; "),
            );
          }

          const action = payload.data?.action;
          if (!action) {
            throw new Error(
              "Betty Blocks did not return the current action settings.",
            );
          }

          const settings = {
            public: Boolean(action.public),
            authenticationProfile: String(
              action.options?.authenticationProfile || "",
            ),
          };
          updatePowerBrowserDiagnostic(
            "actionSettings",
            "success",
            settings.public
              ? "Public action; Authorization is optional."
              : settings.authenticationProfile
                ? "Protected action settings loaded."
                : "Action has no authentication profile.",
          );
          return settings;
        },
        force,
      );
    } catch (error) {
      updatePowerBrowserDiagnostic(
        "actionSettings",
        "error",
        error instanceof Error
          ? error.message
          : "Unable to retrieve action settings.",
        error,
      );
      throw error;
    }
  }

  /**
   * Creates the non-blocking alert shown inside the action dialog.
   *
   * @param {Element} dialog
   * @returns {HTMLElement|null}
   */
  function ensureActionPlaygroundAlert(dialog) {
    const existing = dialog.querySelector(
      "[data-power-browser-action-alert-v2]",
    );
    if (existing) {
      return existing;
    }

    const playgroundButton = Array.from(
      dialog.querySelectorAll("button"),
    ).find(
      (button) => button.textContent.trim() === "Go to playground",
    );
    const footer = playgroundButton?.parentElement;
    if (!footer) {
      return null;
    }

    const alert = document.createElement("div");
    alert.className = "power-browser-action-alert-v2";
    alert.setAttribute("data-power-browser-action-alert-v2", "");
    alert.setAttribute("role", "alert");
    footer.before(alert);
    return alert;
  }

  /**
   * Shows or clears the action dialog's inline alert.
   *
   * @param {Element} dialog
   * @param {string} [message]
   * @returns {void}
   */
  function showActionPlaygroundAlert(dialog, message = "") {
    const alert = ensureActionPlaygroundAlert(dialog);
    if (!alert) {
      return;
    }

    alert.textContent = message;
    alert.classList.toggle("open", Boolean(message));
  }

  /**
   * Updates the Headers field and Run button for authorization validation.
   *
   * @param {Element} dialog
   * @param {Element} panel
   * @param {{state: "checking"|"valid"|"invalid", message?: string, required?: boolean}} validation
   * @returns {void}
   */
  function setActionAuthorizationValidation(
    dialog,
    panel,
    validation,
  ) {
    const headersField = panel.querySelector(
      "[data-power-browser-action-headers-v2]",
    );
    const textarea = headersField?.querySelector("textarea");
    const helper = headersField?.querySelector(
      "div[color] span, span[color]",
    );
    const runButton = dialog.querySelector(
      "[data-power-browser-action-run-request-v2]",
    );
    if (!textarea) {
      return;
    }

    const isInvalid = validation.state === "invalid";
    const isChecking = validation.state === "checking";
    textarea.dataset.authorizationValidationState = validation.state;
    textarea.dataset.error = String(isInvalid);
    textarea.setAttribute("aria-invalid", String(isInvalid));
    textarea.required = Boolean(validation.required);
    textarea.setAttribute(
      "aria-required",
      String(Boolean(validation.required)),
    );

    if (helper) {
      helper.textContent =
        validation.message ||
        "Paste JSON request headers here. Authorization is validated automatically.";
      helper.style.color = isInvalid ? "#dc2626" : "";
    }

    if (runButton && runButton.dataset.requestRunning !== "true") {
      runButton.disabled = isChecking || isInvalid;
      runButton.title = isChecking
        ? "Checking Authorization…"
        : validation.message || "";
    }
  }

  /**
   * Validates the Headers Authorization before the request can be run.
   *
   * @param {Element} dialog
   * @param {Element} panel
   * @returns {Promise<boolean>}
   */
  async function validateActionPlaygroundAuthorization(
    dialog,
    panel,
  ) {
    const sequence = ++nextgenActionValidationSequence;
    const textarea = getActionPlaygroundTextarea(
      panel,
      "Headers",
    );
    if (!textarea) {
      return false;
    }

    const headersValue = textarea.value;
    setActionAuthorizationValidation(dialog, panel, {
      state: "checking",
      message: "Checking Authorization…",
    });

    try {
      const parsedHeaders = JSON.parse(
        headersValue.trim() || "{}",
      );
      if (
        !parsedHeaders ||
        Array.isArray(parsedHeaders) ||
        typeof parsedHeaders !== "object"
      ) {
        throw new Error("Headers must be a JSON object.");
      }

      if (isCurrentActionPublic()) {
        if (sequence !== nextgenActionValidationSequence) {
          return false;
        }

        panel.dataset.authorizationRequiredV2 = "false";
        textarea.dataset.authorizationValidatedValue = headersValue;
        setActionAuthorizationValidation(dialog, panel, {
          state: "valid",
          required: false,
          message:
            "This is a public action; Authorization is not required.",
        });
        return true;
      }

      const runtimeContext =
        await getActionPlaygroundRuntimeContext();
      const actionSettings =
        await fetchActionAuthorizationSettings(
          runtimeContext.identifier,
        );
      if (sequence !== nextgenActionValidationSequence) {
        return false;
      }

      if (actionSettings.public) {
        panel.dataset.authorizationRequiredV2 = "false";
        textarea.dataset.authorizationValidatedValue = headersValue;
        setActionAuthorizationValidation(dialog, panel, {
          state: "valid",
          required: false,
          message:
            "This is a public action; Authorization is not required.",
        });
        return true;
      }

      const requiredAuthenticationProfile =
        actionSettings.authenticationProfile;
      if (!requiredAuthenticationProfile) {
        panel.dataset.authorizationRequiredV2 = "false";
        textarea.dataset.authorizationValidatedValue = headersValue;
        setActionAuthorizationValidation(dialog, panel, {
          state: "valid",
          required: false,
          message:
            "This action has no authentication profile; Authorization is optional.",
        });
        return true;
      }

      const authorization = getAuthorizationHeader(parsedHeaders);
      if (!authorization) {
        throw new Error(
          `Authorization is required for authentication profile ${requiredAuthenticationProfile}.`,
        );
      }

      const jwtPayload = decodeActionPlaygroundJwt(authorization);
      const bearerApplicationId = String(
        jwtPayload.app_uuid || "",
      );
      if (
        !bearerApplicationId ||
        bearerApplicationId !== runtimeContext.applicationId
      ) {
        throw new Error(
          await getActionBearerApplicationMismatchMessage(
            bearerApplicationId,
            runtimeContext,
          ),
        );
      }

      if (
        String(jwtPayload.auth_profile || "") !==
        requiredAuthenticationProfile
      ) {
        throw new Error(
          `Bearer auth_profile ${jwtPayload.auth_profile || "is missing"} does not match this action's authentication profile (${requiredAuthenticationProfile}).`,
        );
      }

      if (sequence !== nextgenActionValidationSequence) {
        return false;
      }

      panel.dataset.authorizationRequiredV2 = "true";
      textarea.dataset.authorizationValidatedValue = headersValue;
      setActionAuthorizationValidation(dialog, panel, {
        state: "valid",
        required: true,
        message: `Authorization verified for authentication profile ${requiredAuthenticationProfile}.`,
      });
      return true;
    } catch (error) {
      if (sequence !== nextgenActionValidationSequence) {
        return false;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Unable to validate Authorization.";
      textarea.dataset.authorizationValidatedValue = headersValue;
      setActionAuthorizationValidation(dialog, panel, {
        state: "invalid",
        message,
        required:
          panel.dataset.authorizationRequiredV2 === "true",
      });
      return false;
    }
  }

  /**
   * Debounces validation while the user edits Headers.
   *
   * @param {Element} dialog
   * @param {Element} panel
   * @param {number} [delay]
   * @returns {void}
   */
  function scheduleActionAuthorizationValidation(
    dialog,
    panel,
    delay = 180,
  ) {
    clearTimeout(nextgenActionValidationTimer);
    setActionAuthorizationValidation(dialog, panel, {
      state: "checking",
      message: "Checking Authorization…",
    });
    nextgenActionValidationTimer = setTimeout(() => {
      validateActionPlaygroundAuthorization(dialog, panel);
    }, delay);
  }

  /**
   * Sends the edited Playground request through Tampermonkey so the builder
   * can reach the cross-origin runtime endpoint reliably.
   *
   * @param {string} url
   * @param {Record<string, string>} headers
   * @param {Record<string, unknown>} body
   * @returns {Promise<{status: number, payload: unknown}>}
   */
  function sendActionPlaygroundRequest(url, headers, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: {
          Accept: "application/json, multipart/mixed",
          "Content-Type": "application/json",
          ...headers,
          Referer: url,
        },
        data: JSON.stringify(body),
        anonymous: false,
        timeout: 30000,
        onload: (response) => {
          let payload = response.responseText;
          try {
            payload = JSON.parse(response.responseText);
          } catch (_error) {
            // Multipart or empty successful responses may not be JSON.
          }

          if (response.status < 200 || response.status >= 300) {
            const message =
              payload?.errors
                ?.map((error) => error.message)
                .filter(Boolean)
                .join("; ") ||
              `Runtime request failed with status ${response.status}.`;
            reject(new Error(message));
            return;
          }

          if (payload?.errors?.length) {
            reject(
              new Error(
                payload.errors
                  .map((error) => error.message)
                  .join("; "),
              ),
            );
            return;
          }

          resolve({
            status: response.status,
            payload,
          });
        },
        onerror: () =>
          reject(new Error("Runtime network request failed.")),
        ontimeout: () =>
          reject(new Error("Runtime request timed out.")),
      });
    });
  }

  /**
   * Reads the editable fields and executes their runtime GraphQL request.
   *
   * @param {Element} panel
   * @param {HTMLButtonElement} button
   * @returns {Promise<void>}
   */
  async function runActionPlaygroundRequest(panel, button) {
    const dialog = panel.closest('[role="dialog"]');
    const mutationTextarea = getActionPlaygroundTextarea(
      panel,
      "Mutation",
    );
    const variablesTextarea = getActionPlaygroundTextarea(
      panel,
      "Variables",
    );
    const headersTextarea = getActionPlaygroundTextarea(
      panel,
      "Headers",
    );

    if (
      !dialog ||
      headersTextarea?.dataset.authorizationValidationState !==
        "valid"
    ) {
      if (dialog) {
        scheduleActionAuthorizationValidation(dialog, panel, 0);
      }
      return;
    }

    button.dataset.requestRunning = "true";
    button.disabled = true;
    button.textContent = "Running…";
    button.title = "";
    showActionPlaygroundAlert(dialog);

    try {
      if (!mutationTextarea?.value.trim()) {
        throw new Error("Mutation cannot be empty.");
      }

      const variablesText = variablesTextarea?.value.trim() || "";
      const headersText = headersTextarea?.value.trim() || "{}";
      const variables = variablesText
        ? JSON.parse(variablesText)
        : undefined;
      const parsedHeaders = JSON.parse(headersText);
      if (
        !parsedHeaders ||
        Array.isArray(parsedHeaders) ||
        typeof parsedHeaders !== "object"
      ) {
        throw new Error("Headers must be a JSON object.");
      }

      const headers = Object.fromEntries(
        Object.entries(parsedHeaders).map(([key, value]) => [
          key,
          String(value),
        ]),
      );
      const runtimeContext =
        await getActionPlaygroundRuntimeContext();
      const body = {
        query: mutationTextarea.value,
        ...(variables === undefined ? {} : { variables }),
      };
      const response = await sendActionPlaygroundRequest(
        runtimeContext.url,
        headers,
        body,
      );

      button.textContent = `Success (${response.status})`;
      console.info("[Power Browser v2] Action request completed.", {
        url: runtimeContext.url,
        response: response.payload,
      });
    } catch (error) {
      button.textContent = "Request failed";
      const message =
        error instanceof Error
          ? error.message
          : "An unknown request error occurred.";
      button.title = message;
      showActionPlaygroundAlert(dialog, message);
      console.error(
        "[Power Browser v2] Unable to run the action request.",
        { error },
      );
    } finally {
      delete button.dataset.requestRunning;
      setTimeout(() => {
        if (button.isConnected) {
          button.disabled =
            headersTextarea?.dataset
              .authorizationValidationState !== "valid";
          button.textContent = "Run request";
        }
      }, 2500);
    }
  }

  /**
   * Adds a request button beside the dialog's existing Playground button.
   *
   * @param {Element} dialog
   * @param {Element} panel
   * @returns {void}
   */
  function ensureActionPlaygroundRunButton(dialog, panel) {
    if (
      dialog.querySelector(
        "[data-power-browser-action-run-request-v2]",
      )
    ) {
      return;
    }

    const playgroundButton = Array.from(
      dialog.querySelectorAll("button"),
    ).find(
      (button) => button.textContent.trim() === "Go to playground",
    );
    if (!playgroundButton) {
      return;
    }

    const runButton = playgroundButton.cloneNode(true);
    runButton.setAttribute(
      "data-power-browser-action-run-request-v2",
      "",
    );
    runButton.removeAttribute("aria-label");
    runButton.textContent = "Run request";
    runButton.style.marginLeft = "auto";
    runButton.disabled = true;
    runButton.title = "Checking Authorization…";
    runButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runActionPlaygroundRequest(panel, runButton);
    });
    playgroundButton.before(runButton);
    ensureActionPlaygroundAlert(dialog);
  }

  /**
   * Restores enhanced textareas and removes injected fields. When a matching
   * dialog is supplied, only stale enhancements outside that dialog are reset.
   *
   * @param {Element|null} [activeDialog]
   * @returns {void}
   */
  function cleanupActionPlaygroundEnhancements(activeDialog = null) {
    if (!activeDialog) {
      clearTimeout(nextgenActionValidationTimer);
      nextgenActionValidationSequence += 1;
    }
    document
      .querySelectorAll(
        "[data-power-browser-action-alert-v2]",
      )
      .forEach((alert) => {
        if (!activeDialog?.contains(alert)) {
          alert.remove();
        }
      });
    document
      .querySelectorAll(
        "[data-power-browser-action-run-request-v2]",
      )
      .forEach((button) => {
        if (!activeDialog?.contains(button)) {
          button.remove();
        }
      });
    document
      .querySelectorAll(
        ".power-browser-action-playground-dialog-v2",
      )
      .forEach((dialog) => {
        if (dialog !== activeDialog) {
          dialog.classList.remove(
            "power-browser-action-playground-dialog-v2",
          );
        }
      });
    document
      .querySelectorAll("[data-power-browser-action-headers-v2]")
      .forEach((field) => {
        if (!activeDialog?.contains(field)) {
          field.remove();
        }
      });
    document
      .querySelectorAll(
        "textarea[data-power-browser-action-original-readonly-v2]",
      )
      .forEach((textarea) => {
        if (activeDialog?.contains(textarea)) {
          return;
        }

        textarea.readOnly =
          textarea.dataset.powerBrowserActionOriginalReadonlyV2 ===
          "true";
        textarea.removeAttribute(
          "data-power-browser-action-original-readonly-v2",
        );
      });
    document
      .querySelectorAll(
        "textarea[data-power-browser-action-original-rows-v2]",
      )
      .forEach((textarea) => {
        if (activeDialog?.contains(textarea)) {
          return;
        }

        textarea.rows = Number.parseInt(
          textarea.dataset.powerBrowserActionOriginalRowsV2,
          10,
        );
        textarea.removeAttribute(
          "data-power-browser-action-original-rows-v2",
        );
        textarea.removeAttribute(
          "data-power-browser-action-variables-v2",
        );
      });
  }

  /**
   * Adds a Headers field by cloning the dialog's own Variables field.
   *
   * @param {Element} panel
   * @returns {HTMLTextAreaElement|null}
   */
  function ensureActionPlaygroundHeadersField(panel) {
    const existingField = panel.querySelector(
      "[data-power-browser-action-headers-v2]",
    );
    const existingTextarea = existingField?.querySelector("textarea");
    const generatedHeaders = getActionPlaygroundHeadersJson();

    if (existingTextarea) {
      const previousGeneratedValue =
        existingTextarea.dataset.powerBrowserGeneratedHeadersV2;
      if (
        !previousGeneratedValue ||
        existingTextarea.value === previousGeneratedValue
      ) {
        existingTextarea.value = generatedHeaders;
      }
      existingTextarea.dataset.powerBrowserGeneratedHeadersV2 =
        generatedHeaders;
      return existingTextarea;
    }

    const variablesLabel = Array.from(
      panel.querySelectorAll("label"),
    ).find((label) => label.textContent.trim() === "Variables");
    const variablesField = variablesLabel?.parentElement;
    if (!variablesField) {
      return null;
    }

    const headersField = variablesField.cloneNode(true);
    headersField.setAttribute(
      "data-power-browser-action-headers-v2",
      "",
    );
    const label = headersField.querySelector("label");
    const textarea = headersField.querySelector("textarea");
    if (!label || !textarea) {
      return null;
    }

    label.textContent = "Headers";
    textarea.rows = 5;
    textarea.value = generatedHeaders;
    textarea.readOnly = false;
    textarea.removeAttribute("readonly");
    textarea.dataset.powerBrowserGeneratedHeadersV2 =
      generatedHeaders;

    const helper = headersField.querySelector(
      "div[color] span, span[color]",
    );
    if (helper) {
      helper.textContent =
        "Paste these JSON headers into the playground request headers field.";
    }

    variablesField.after(headersField);
    return textarea;
  }

  /**
   * Makes every Playground textarea editable and injects request headers.
   *
   * @returns {void}
   */
  function enhanceActionPlaygroundDialog() {
    const match = getActiveActionPlaygroundDialog();
    if (!match) {
      cleanupActionPlaygroundEnhancements();
      return;
    }

    cleanupActionPlaygroundEnhancements(match.dialog);
    const headersTextarea =
      ensureActionPlaygroundHeadersField(match.panel);
    const variablesTextarea = getActionPlaygroundTextarea(
      match.panel,
      "Variables",
    );
    if (variablesTextarea) {
      if (
        !variablesTextarea.hasAttribute(
          "data-power-browser-action-original-rows-v2",
        )
      ) {
        variablesTextarea.dataset.powerBrowserActionOriginalRowsV2 =
          String(variablesTextarea.rows);
      }
      variablesTextarea.rows = Math.min(
        Math.max(variablesTextarea.rows || 1, 1),
        8,
      );
      variablesTextarea.setAttribute(
        "data-power-browser-action-variables-v2",
        "",
      );
    }
    match.dialog.classList.add(
      "power-browser-action-playground-dialog-v2",
    );
    ensureActionPlaygroundRunButton(match.dialog, match.panel);
    if (
      headersTextarea &&
      headersTextarea.dataset.authorizationListenerAttachedV2 !==
        "true"
    ) {
      headersTextarea.dataset.authorizationListenerAttachedV2 =
        "true";
      headersTextarea.addEventListener("input", () => {
        delete headersTextarea.dataset.authorizationValidatedValue;
        scheduleActionAuthorizationValidation(
          match.dialog,
          match.panel,
        );
      });
    }
    if (
      headersTextarea &&
      headersTextarea.dataset.authorizationValidatedValue !==
        headersTextarea.value &&
      headersTextarea.dataset.authorizationValidationState !==
        "checking"
    ) {
      scheduleActionAuthorizationValidation(
        match.dialog,
        match.panel,
        0,
      );
    }
    match.panel.querySelectorAll("textarea").forEach((textarea) => {
      if (
        !textarea.hasAttribute(
          "data-power-browser-action-original-readonly-v2",
        )
      ) {
        textarea.dataset.powerBrowserActionOriginalReadonlyV2 = String(
          textarea.readOnly,
        );
      }
      textarea.readOnly = false;
      textarea.removeAttribute("readonly");
    });
  }

  /**
   * Debounces action-dialog work during Radix tab and dialog transitions.
   *
   * @returns {void}
   */
  function scheduleActionPlaygroundEnhancement() {
    clearTimeout(nextgenActionPlaygroundTimer);
    nextgenActionPlaygroundTimer = setTimeout(
      enhanceActionPlaygroundDialog,
      0,
    );
  }

  /**
   * Applies the editable Action Playground setting and observes reused dialogs.
   *
   * @returns {void}
   */
  function applyNextgenActionPlaygroundSetting() {
    const enabled =
      location.hostname.endsWith(".bettyblocks.com") &&
      isNextgenActionPage() &&
      Boolean(getSettingValue("nextgenEditableActionPlayground"));

    clearTimeout(nextgenActionPlaygroundTimer);
    if (!enabled) {
      nextgenActionPlaygroundObserver?.disconnect();
      nextgenActionPlaygroundObserver = null;
      cleanupActionPlaygroundEnhancements();
      return;
    }

    enhanceActionPlaygroundDialog();
    if (!nextgenActionPlaygroundObserver) {
      nextgenActionPlaygroundObserver = new MutationObserver(
        scheduleActionPlaygroundEnhancement,
      );
      nextgenActionPlaygroundObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "aria-selected",
          "data-state",
          "readonly",
        ],
      });
    }
  }

  /**
   * Returns whether the current page is the Next-gen grouped-logs screen.
   *
   * @returns {boolean}
   */
  function isNextgenLogsPage() {
    return (
      location.hostname.endsWith(".bettyblocks.com") &&
      /^\/app\/logs(?:\/|$)/.test(location.pathname)
    );
  }

  /**
   * Stores authentication headers and the active grouped-logs filter from a
   * page-level GraphQL request.
   *
   * @param {Request|string|URL} input
   * @param {RequestInit|undefined} init
   * @returns {void}
   */
  function rememberNextgenLogGraphqlRequest(input, init) {
    const url =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input?.url;

    if (!url?.includes("/api/meta/graphql")) {
      return;
    }

    copyNextgenLogHeaders(input?.headers);
    copyNextgenLogHeaders(init?.headers);

    const body = init?.body;
    if (typeof body !== "string") {
      return;
    }

    try {
      const payload = JSON.parse(body);
      if (payload.operationName === "groupedLogs") {
        capturedGroupedLogsFilter = payload.variables?.filter || {};
      }
    } catch (_error) {
      // Other GraphQL payloads do not affect the log downloader.
    }
  }

  /**
   * Copies the request headers needed to repeat the grouped-logs query.
   *
   * @param {Headers|Array<Array<string>>|Record<string, string>|undefined} headers
   * @returns {void}
   */
  function copyNextgenLogHeaders(headers) {
    if (!headers) {
      return;
    }

    const rememberHeader = (value, key) => {
      const normalizedKey = String(key).toLowerCase();
      if (
        normalizedKey === "x-csrf-token" ||
        normalizedKey === "application-identifier"
      ) {
        capturedGroupedLogsHeaders[normalizedKey] = String(value);
      }
    };

    if (typeof headers.forEach === "function") {
      headers.forEach(rememberHeader);
      return;
    }

    if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => rememberHeader(value, key));
      return;
    }

    Object.entries(headers).forEach(([key, value]) =>
      rememberHeader(value, key),
    );
  }

  /**
   * Hooks the page's fetch implementation so filters selected in the log UI
   * can be reused by the CSV request.
   *
   * @returns {void}
   */
  function captureNextgenLogGraphqlRequests() {
    if (
      nextgenLogDownloaderPatchedFetch ||
      typeof pageWindow.fetch !== "function"
    ) {
      return;
    }

    nextgenLogDownloaderOriginalFetch = pageWindow.fetch;
    nextgenLogDownloaderPatchedFetch = function patchedFetch(input, init) {
      rememberNextgenLogGraphqlRequest(input, init);
      return nextgenLogDownloaderOriginalFetch.apply(this, arguments);
    };
    pageWindow.fetch = nextgenLogDownloaderPatchedFetch;
  }

  /**
   * Restores the page's fetch implementation if Power Browser still owns it.
   *
   * @returns {void}
   */
  function releaseNextgenLogGraphqlCapture() {
    if (
      nextgenLogDownloaderPatchedFetch &&
      pageWindow.fetch === nextgenLogDownloaderPatchedFetch
    ) {
      pageWindow.fetch = nextgenLogDownloaderOriginalFetch;
    }

    nextgenLogDownloaderOriginalFetch = null;
    nextgenLogDownloaderPatchedFetch = null;
  }

  /**
   * Finds a CSRF token exposed by the current Next-gen application.
   *
   * @returns {string}
   */
  function getNextgenLogCsrfToken() {
    const capturedToken = capturedGroupedLogsHeaders["x-csrf-token"];
    if (capturedToken) {
      return capturedToken;
    }

    const metaToken = document.querySelector(
      'meta[name="csrf-token"]',
    )?.content;
    if (metaToken) {
      return metaToken;
    }

    const tokenPattern = /^[A-Za-z0-9_\-+/=]{20,}$/;
    for (const storage of [
      pageWindow.localStorage,
      pageWindow.sessionStorage,
    ]) {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          const value = key ? storage.getItem(key) : "";
          if (/csrf/i.test(key || "") && value && tokenPattern.test(value)) {
            return value;
          }
        }
      } catch (_error) {
        // Storage access may be blocked in embedded or private contexts.
      }
    }

    return "";
  }

  /**
   * Combines the captured GraphQL filter with filters represented in the URL.
   *
   * @returns {Record<string, unknown>}
   */
  function getCurrentNextgenLogFilter() {
    const params = new URLSearchParams(location.search);
    const urlFilter = {};

    if (params.has("status")) {
      urlFilter.logLevel = params.get("status");
    }
    if (params.has("type")) {
      urlFilter.service = params.get("type");
    }

    return {
      ...(capturedGroupedLogsFilter || {}),
      ...urlFilter,
    };
  }

  /**
   * Requests all grouped logs for the active filter.
   *
   * @param {Record<string, unknown>} filter
   * @returns {Promise<{results?: Array<Record<string, unknown>>}>}
   */
  async function fetchNextgenGroupedLogs(filter) {
    const csrfToken = getNextgenLogCsrfToken();
    const identifier =
      capturedGroupedLogsHeaders["application-identifier"] ||
      currentPowerBrowserContext?.identifier ||
      location.hostname.split(".")[0];
    const apiUrl = new URL("/api/meta/graphql", location.origin);
    apiUrl.searchParams.set("applicationId", identifier);
    const headers = {
      accept: "*/*",
      "application-identifier": identifier,
      "content-type": "application/json",
    };

    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }

    const query = `query groupedLogs($page: Int!, $perPage: Int, $filter: GroupedLogsFilter!) {
      groupedLogs(page: $page, perPage: $perPage, filter: $filter) {
        pageInfo {
          currentPage
          totalCount
          hasNextPage
          lastPage
          __typename
        }
        results {
          logId
          service
          maxTimestamp
          minTimestamp
          level
          action {
            id
            name
            __typename
          }
          message {
            summary
            __typename
          }
          __typename
        }
        __typename
      }
    }`;
    const fetchImplementation =
      nextgenLogDownloaderOriginalFetch || pageWindow.fetch;
    const response = await fetchImplementation.call(pageWindow, apiUrl.href, {
      headers,
      referrer: location.href,
      body: JSON.stringify({
        ...(csrfToken ? { _csrf_token: csrfToken } : {}),
        operationName: "groupedLogs",
        variables: {
          page: 1,
          perPage: 1000000,
          filter,
        },
        query,
      }),
      method: "POST",
      mode: "cors",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(
        `Grouped-logs request failed with HTTP ${response.status}.`,
      );
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(
        payload.errors.map((error) => error.message).join("; "),
      );
    }

    return payload.data?.groupedLogs || { results: [] };
  }

  /**
   * Escapes a value for the semicolon-delimited CSV file.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function nextgenLogCsvCell(value) {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  /**
   * Creates a descriptive filename for the current log filter.
   *
   * @param {Record<string, unknown>} filter
   * @returns {string}
   */
  function createNextgenLogFilename(filter) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = Object.entries(filter)
      .filter(([, value]) => value != null && value !== "")
      .map(([key, value]) => `${key}-${value}`)
      .join("_")
      .replace(/[^a-z0-9_-]+/gi, "-");

    return suffix
      ? `betty-blocks-logs_${suffix}_${timestamp}.csv`
      : `betty-blocks-logs_${timestamp}.csv`;
  }

  /**
   * Downloads grouped logs as an Excel-friendly UTF-8 CSV file.
   *
   * @param {Array<Record<string, any>>} logs
   * @param {Record<string, unknown>} filter
   * @returns {void}
   */
  function downloadNextgenLogsCsv(logs, filter) {
    const rows = [
      [
        "logId",
        "service",
        "maxTimestamp",
        "minTimestamp",
        "level",
        "actionId",
        "actionName",
        "summary",
      ],
      ...logs.map((log) => [
        log.logId,
        log.service,
        log.maxTimestamp,
        log.minTimestamp,
        log.level,
        log.action?.id || "",
        log.action?.name || "",
        log.message?.summary || "",
      ]),
    ];
    const csv = rows
      .map((row) => row.map(nextgenLogCsvCell).join(";"))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = createNextgenLogFilename(filter);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  /**
   * Adds the downloader's small, page-native visual treatment once.
   *
   * @returns {void}
   */
  function ensureNextgenLogDownloaderStyle() {
    if (document.getElementById("power-browser-log-downloader-style-v2")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "power-browser-log-downloader-style-v2";
    style.textContent = `
      .power-browser-log-downloader-v2 {
        align-items: center;
        display: inline-flex;
        gap: 6px;
      }

      .power-browser-log-downloader-button-v2 {
        align-items: center;
        background: #fff;
        border: 0.666667px solid rgb(204, 208, 221);
        border-radius: 4px;
        color: rgb(38, 42, 58);
        cursor: pointer;
        display: inline-flex;
        font-family: Fustat, sans-serif;
        font-size: 14px;
        height: 40px;
        padding: 8px 12px;
        white-space: nowrap;
      }

      .power-browser-log-downloader-button-v2:hover {
        background: rgb(247, 247, 249);
      }

      .power-browser-log-downloader-button-v2:disabled {
        cursor: default;
        opacity: 0.65;
      }

      .power-browser-log-downloader-status-v2 {
        color: #475569;
        font-family: Fustat, sans-serif;
        font-size: 12px;
        white-space: nowrap;
      }

      .power-browser-log-downloader-status-v2[data-status="success"] {
        color: #167346;
      }

      .power-browser-log-downloader-status-v2[data-status="error"] {
        color: #c52a3a;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * Creates the grouped-log CSV control.
   *
   * @returns {HTMLDivElement}
   */
  function createNextgenLogDownloader() {
    const root = document.createElement("div");
    root.id = "power-browser-log-downloader-v2";
    root.className = "power-browser-log-downloader-v2";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "power-browser-log-downloader-button-v2";
    button.textContent = "Download CSV";

    const status = document.createElement("span");
    status.className = "power-browser-log-downloader-status-v2";

    button.addEventListener("click", async () => {
      button.disabled = true;
      status.dataset.status = "loading";
      status.textContent = "Preparing…";

      try {
        const filter = getCurrentNextgenLogFilter();
        const groupedLogs = await fetchNextgenGroupedLogs(filter);
        const logs = groupedLogs.results || [];
        downloadNextgenLogsCsv(logs, filter);
        status.dataset.status = "success";
        status.textContent = `${logs.length} rows`;
        setTimeout(() => {
          status.textContent = "";
          delete status.dataset.status;
        }, 2500);
      } catch (error) {
        status.dataset.status = "error";
        status.textContent = "Download failed";
        console.error("[Power Browser v2] Unable to download logs.", {
          error,
        });
      } finally {
        button.disabled = false;
      }
    });

    root.append(button, status);
    return root;
  }

  /**
   * Inserts the downloader into the grouped-logs toolbar when it is available.
   *
   * @returns {void}
   */
  function installNextgenLogDownloader() {
    const existing = document.getElementById(
      "power-browser-log-downloader-v2",
    );

    if (!isNextgenLogsPage()) {
      existing?.remove();
      return;
    }

    if (existing) {
      return;
    }

    const target = document.evaluate(
      "/html/body/div[2]/div/div[3]/div/div/div/div[2]/div[2]/div[1]/div[1]",
      document,
      null,
      window.XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;

    if (!target) {
      return;
    }

    ensureNextgenLogDownloaderStyle();
    target.appendChild(createNextgenLogDownloader());
  }

  /**
   * Enables or disables the Next-gen grouped-log downloader.
   *
   * @returns {void}
   */
  function syncNextgenLogDownloader() {
    const shouldEnable =
      Boolean(getSettingValue("nextgenLogDumpDownloader")) &&
      isNextgenLogsPage();

    if (!shouldEnable) {
      nextgenLogDownloaderObserver?.disconnect();
      nextgenLogDownloaderObserver = null;
      document.getElementById("power-browser-log-downloader-v2")?.remove();
      releaseNextgenLogGraphqlCapture();
      return;
    }

    captureNextgenLogGraphqlRequests();

    const startInstaller = () => {
      if (
        !Boolean(getSettingValue("nextgenLogDumpDownloader")) ||
        !isNextgenLogsPage() ||
        !document.body
      ) {
        return;
      }

      installNextgenLogDownloader();
      if (!nextgenLogDownloaderObserver) {
        nextgenLogDownloaderObserver = new MutationObserver(
          installNextgenLogDownloader,
        );
        nextgenLogDownloaderObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }
    };

    if (document.body) {
      startInstaller();
    } else {
      document.addEventListener("DOMContentLoaded", startInstaller, {
        once: true,
      });
    }
  }

  /**
   * Starts early capture and keeps the downloader aligned with SPA navigation.
   *
   * @returns {void}
   */
  function initializeNextgenLogDownloader() {
    syncNextgenLogDownloader();
  }

  function applySettingChange(navigator, definition, value) {
    if (
      [
        "themeMode",
        "iconOnlyMode",
        "settingsDialogSize",
        "settingsTextSize",
        "sandboxSwitcherShowApplicationName",
      ].includes(definition.key)
    ) {
      applyAppearanceSettings(navigator);
    }

    if (definition.key === "settingsSectionsExpandedByDefault") {
      if (settingsState) {
        settingsState.sectionsExpanded = true;
        renderSettingsTab(navigator);
      }
    }

    if (
      definition.key.endsWith("Hidden") ||
      definition.key === "buttonB5Models" ||
      definition.key === "buttonB5Monitoring" ||
      definition.key === "sandboxSwitcherHidden"
    ) {
      applyNavigatorVisibilitySettings(navigator);
    }

    if (definition.flag && currentPowerBrowserContext?.siteType) {
      applyFeatureFlagSettings(currentPowerBrowserContext.siteType);
    }

    if (["extraHotfix", "extraAdvancedMode"].includes(definition.key)) {
      applyBetty5Setting(definition.key, value);
    }

    if (definition.key === "extraHotfix") {
      applyHotfixMenuState();
    }

    if (definition.key === "extraB5Highlighting") {
      applyBetty5ActionHighlighting();
    }

    if (definition.key === "extraB5PasswordRevealer") {
      applyBetty5PasswordRevealer();
    }

    if (definition.key === "extraB5VariableSearch") {
      applyBetty5VariableSearch();
    }

    if (definition.key === "extraPageUIRemoveUneditableLayer") {
      applyUiBuilderMaskSetting();
    }

    if (definition.key === "nextgenLogDumpDownloader") {
      syncNextgenLogDownloader();
    }

    if (definition.key === "nextgenEditableActionPlayground") {
      applyNextgenActionPlaygroundSetting();
    }

    if (
      ["runtimeSearchIncludeKind", "runtimeSearchExcludeRelations"].includes(
        definition.key,
      ) &&
      modelSearchState?.dialog.classList.contains("open")
    ) {
      renderModelSearchResults();
    }

    if (definition.key === "extraModelSearchShortcut") {
      if (modelSearchState) {
        modelSearchState.shortcut.textContent = String(value || "");
      }
      const searchButton = navigator.controls.get(
        "buttonRuntimeModelSearch",
      );
      if (searchButton) {
        searchButton.title = `Search models and properties (${value || "No shortcut"})`;
      }
    }
  }

  function formatShortcutEvent(event) {
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
      return null;
    }

    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.metaKey) parts.push("Meta");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
    return parts.join("+");
  }

  /**
   * Adds a section heading that participates in settings navigation.
   *
   * @param {HTMLElement} container
   * @param {string} tabId
   * @param {string} sectionName
   * @param {number} index
   * @returns {void}
   */
  function appendSettingsSectionHeading(
    container,
    tabId,
    sectionName,
    index,
  ) {
    const section = document.createElement("h3");
    section.className = "power-browser-settings-section-v2";
    section.textContent = sectionName;
    section.dataset.settingsSection = sectionName;
    section.id =
      `power-browser-settings-section-${tabId}-${index}`;
    container.appendChild(section);
  }

  /**
   * Creates a read-only information card.
   *
   * @param {string} title
   * @param {Array<[string, unknown]>} entries
   * @param {string} [status]
   * @returns {HTMLElement}
   */
  function createSettingsInfoCard(title, entries, status = "") {
    const card = document.createElement("div");
    card.className =
      "power-browser-settings-card-v2 power-browser-settings-info-card-v2";
    const heading = document.createElement("div");
    heading.className = "power-browser-settings-info-title-v2";
    const headingText = document.createElement("span");
    headingText.textContent = title;
    heading.appendChild(headingText);
    if (status) {
      const badge = document.createElement("span");
      badge.className =
        "power-browser-settings-info-status-v2";
      badge.textContent = status;
      heading.appendChild(badge);
    }

    const grid = document.createElement("dl");
    grid.className = "power-browser-settings-info-grid-v2";
    entries.forEach(([label, rawValue]) => {
      const item = document.createElement("div");
      item.className = "power-browser-settings-info-item-v2";
      const term = document.createElement("dt");
      term.textContent = label;
      const valueRow = document.createElement("div");
      valueRow.className =
        "power-browser-settings-info-value-v2";
      const value = document.createElement("dd");
      const hasValue =
        rawValue !== null &&
        rawValue !== undefined &&
        rawValue !== "";
      const displayValue = hasValue
        ? String(rawValue)
        : "Unavailable";
      value.textContent = displayValue;
      valueRow.appendChild(value);
      if (hasValue) {
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className =
          "power-browser-settings-copy-value-v2";
        copyButton.textContent = "Copy";
        copyButton.setAttribute(
          "aria-label",
          `Copy ${label}`,
        );
        copyButton.addEventListener("click", () => {
          GM_setClipboard(String(rawValue));
          copyButton.textContent = "Copied";
          setTimeout(() => {
            if (copyButton.isConnected) {
              copyButton.textContent = "Copy";
            }
          }, 1400);
        });
        valueRow.appendChild(copyButton);
      }
      item.appendChild(term);
      item.appendChild(valueRow);
      grid.appendChild(item);
    });
    card.appendChild(heading);
    card.appendChild(grid);
    return card;
  }

  /**
   * Formats a timestamp without failing on incomplete family data.
   *
   * @param {string|null|undefined} value
   * @returns {string}
   */
  function formatSettingsInfoDate(value) {
    if (!value) {
      return "Never";
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleString();
  }

  /**
   * Returns bearer availability, expiry and application-match diagnostics.
   *
   * @returns {{status: string, message: string, details: object}}
   */
  function getBearerDiagnostic() {
    const token = getBearerToken();
    if (!token) {
      return {
        status: "warning",
        message: "No runtime bearer is available.",
        details: {
          available: false,
        },
      };
    }

    try {
      const payload = decodeActionPlaygroundJwt(token);
      const expiresAt = payload.exp
        ? new Date(Number(payload.exp) * 1000)
        : null;
      const expired =
        expiresAt && expiresAt.getTime() <= Date.now();
      const currentApplicationId = String(
        getApplicationId(
          currentPowerBrowserContext?.artifactData,
          currentPowerBrowserContext?.applicationFamily,
          currentPowerBrowserContext?.identifier,
        ) || "",
      );
      const applicationMatches =
        !currentApplicationId ||
        String(payload.app_uuid || "") === currentApplicationId;
      const status =
        expired || !applicationMatches ? "error" : "success";
      const parts = [
        expired
          ? `Expired ${expiresAt.toLocaleString()}`
          : expiresAt
            ? `Expires ${expiresAt.toLocaleString()}`
            : "No expiry claim",
        applicationMatches
          ? "application UUID matches"
          : "application UUID does not match",
      ];
      return {
        status,
        message: parts.join("; "),
        details: {
          available: true,
          expiresAt: expiresAt?.toISOString() || null,
          expired: Boolean(expired),
          appUuid: payload.app_uuid || null,
          currentApplicationId: currentApplicationId || null,
          applicationMatches,
        },
      };
    } catch (error) {
      return {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to inspect the runtime bearer.",
        details: {
          available: true,
          validJwt: false,
        },
      };
    }
  }

  /**
   * Creates a compact diagnostic status card.
   *
   * @param {string} title
   * @param {{status?: string, message?: string, updatedAt?: string|null}} diagnostic
   * @returns {HTMLElement}
   */
  function createSettingsDiagnosticCard(title, diagnostic) {
    const card = document.createElement("div");
    card.className = "power-browser-settings-diagnostic-v2";
    card.dataset.status = diagnostic.status || "idle";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const message = document.createElement("span");
    message.textContent = diagnostic.message || "No status available.";
    card.appendChild(heading);
    card.appendChild(message);
    if (diagnostic.updatedAt) {
      const updated = document.createElement("span");
      updated.textContent =
        `Updated ${formatSettingsInfoDate(diagnostic.updatedAt)}`;
      card.appendChild(updated);
    }
    return card;
  }

  /**
   * Builds a token-free diagnostic snapshot suitable for support requests.
   *
   * @returns {object}
   */
  function buildPowerBrowserDiagnosticSummary() {
    const context = currentPowerBrowserContext;
    const bearer = getBearerDiagnostic();
    const applicationFamily = Array.isArray(context?.applicationFamily)
      ? context.applicationFamily
      : context?.applicationFamily
        ? [context.applicationFamily]
        : [];

    return {
      generatedAt: new Date().toISOString(),
      scriptVersion:
        globalThis.GM_info?.script?.version || null,
      page: {
        origin: location.origin,
        pathname: location.pathname,
        siteType: context?.siteType || SiteType.UNKNOWN,
      },
      application: {
        identifier: context?.identifier || null,
        applicationId:
          getApplicationId(
            context?.artifactData,
            context?.applicationFamily,
            context?.identifier,
          ) || null,
        familySize: applicationFamily.length,
      },
      dataSources: JSON.parse(
        JSON.stringify(powerBrowserDiagnostics),
      ),
      csrfAvailable: Boolean(
        getCsrfToken() || getNextgenLogCsrfToken(),
      ),
      bearer: bearer.details,
    };
  }

  /**
   * Bypasses caches and reloads artifact and application-family data.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {Promise<void>}
   */
  async function refreshPowerBrowserData(navigator) {
    actionSettingsRequestCache.clear();
    let artifactData = await fetchArtifact(true);
    const identifier = resolveApplicationIdentifier(artifactData);
    const siteType = detectSiteType(artifactData);
    const applicationFamily =
      await fetchApplicationFamily(identifier, true);
    artifactData = await ensureArtifactFreshAfterFamilyMerge(
      artifactData,
      applicationFamily,
    );

    currentPowerBrowserContext = {
      artifactData,
      siteType,
      identifier,
      applicationFamily,
    };
    configureNavigator(navigator, {
      artifactData,
      siteType,
      identifier,
      applicationFamily,
    });
    configureApplicationSwitcher(
      navigator,
      applicationFamily,
      identifier,
      siteType,
    );
    configureModelSearch(navigator, artifactData, identifier);
    if (
      powerBrowserDiagnostics.artifact.status === "error" ||
      powerBrowserDiagnostics.applicationFamily.status === "error"
    ) {
      throw new Error(
        "Refresh completed, but one or more data sources failed.",
      );
    }
  }

  /**
   * Renders health checks and data-management actions on Info.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function renderSettingsDiagnostics(navigator) {
    appendSettingsSectionHeading(
      settingsState.list,
      "info",
      "Diagnostics",
      3,
    );
    const diagnostics = document.createElement("div");
    diagnostics.className =
      "power-browser-settings-diagnostics-v2";
    const csrfAvailable = Boolean(
      getCsrfToken() || getNextgenLogCsrfToken(),
    );
    [
      ["Artifact", powerBrowserDiagnostics.artifact],
      [
        "Application family",
        powerBrowserDiagnostics.applicationFamily,
      ],
      ["GraphQL", powerBrowserDiagnostics.graphql],
      [
        "Action settings",
        powerBrowserDiagnostics.actionSettings,
      ],
      [
        "CSRF token",
        {
          status: csrfAvailable ? "success" : "warning",
          message: csrfAvailable
            ? "A CSRF token is available."
            : "No CSRF token is currently available.",
        },
      ],
      ["Runtime bearer", getBearerDiagnostic()],
    ].forEach(([title, diagnostic]) => {
      diagnostics.appendChild(
        createSettingsDiagnosticCard(title, diagnostic),
      );
    });
    if (powerBrowserDiagnostics.lastError) {
      diagnostics.appendChild(
        createSettingsDiagnosticCard("Last request error", {
          status: "error",
          message: `${powerBrowserDiagnostics.lastError.source}: ${powerBrowserDiagnostics.lastError.message}`,
          updatedAt: powerBrowserDiagnostics.lastError.updatedAt,
        }),
      );
    }
    settingsState.list.appendChild(diagnostics);

    const actions = document.createElement("div");
    actions.className = "power-browser-settings-actions-v2";
    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "power-browser-settings-action-v2";
    refreshButton.textContent = "Refresh data";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "power-browser-settings-action-v2";
    copyButton.textContent = "Copy diagnostics";
    const status = document.createElement("span");
    status.className =
      "power-browser-settings-operation-status-v2";
    if (settingsState.infoOperationStatus) {
      status.dataset.status =
        settingsState.infoOperationStatus.status;
      status.textContent =
        settingsState.infoOperationStatus.message;
    }
    refreshButton.disabled =
      settingsState.infoOperationStatus?.status === "loading";
    refreshButton.addEventListener("click", async () => {
      settingsState.infoOperationStatus = {
        status: "loading",
        message: "Refreshing data…",
      };
      refreshButton.disabled = true;
      status.dataset.status = "loading";
      status.textContent = "Refreshing data…";
      try {
        await refreshPowerBrowserData(navigator);
        settingsState.infoOperationStatus = {
          status: "success",
          message: "Data refreshed.",
        };
        status.dataset.status = "success";
        status.textContent = "Data refreshed.";
        renderSettingsTab(navigator);
      } catch (error) {
        settingsState.infoOperationStatus = {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to refresh data.",
        };
        status.dataset.status = "error";
        status.textContent =
          settingsState.infoOperationStatus.message;
        refreshButton.disabled = false;
      }
    });
    copyButton.addEventListener("click", () => {
      GM_setClipboard(
        JSON.stringify(
          buildPowerBrowserDiagnosticSummary(),
          null,
          2,
        ),
      );
      settingsState.infoOperationStatus = {
        status: "success",
        message: "Diagnostics copied.",
      };
      status.dataset.status = "success";
      status.textContent = "Diagnostics copied.";
    });
    actions.append(refreshButton, copyButton, status);
    settingsState.list.appendChild(actions);
  }

  /**
   * Renders application-family and artifact information.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function renderSettingsInfoTab(navigator) {
    const context = currentPowerBrowserContext;
    const artifactData = context?.artifactData || null;
    const identifier =
      context?.identifier ||
      resolveApplicationIdentifier(artifactData);
    const applications = sortApplicationFamily(
      context?.applicationFamily,
    );
    const currentApplication =
      applications.find(
        ({ application }) =>
          application.identifier === identifier,
      )?.application || null;

    appendSettingsSectionHeading(
      settingsState.list,
      "info",
      "Current application",
      0,
    );
    settingsState.list.appendChild(
      createSettingsInfoCard(
        currentApplication?.name || identifier || "Current application",
        [
          ["Identifier", identifier],
          [
            "Application UUID",
            getApplicationId(
              artifactData,
              context?.applicationFamily,
              identifier,
            ),
          ],
          ["Application ID", currentApplication?.id],
          ["Site type", context?.siteType || SiteType.UNKNOWN],
          [
            "Environment",
            currentApplication
              ? currentApplication.parentId ||
                currentApplication.parent
                ? currentApplication.isBranch
                  ? "Branch"
                  : "Sandbox"
                : "Production"
              : "Unavailable",
          ],
          [
            "Organization",
            currentApplication?.organization
              ? `${currentApplication.organization.name} (${currentApplication.organization.id})`
              : null,
          ],
          [
            "Application zone",
            currentApplication?.applicationZone
              ? `${currentApplication.applicationZone.label} (${currentApplication.applicationZone.name})`
              : null,
          ],
          ["Application URL", currentApplication?.url || location.origin],
        ],
        "Current",
      ),
    );

    appendSettingsSectionHeading(
      settingsState.list,
      "info",
      "Sandboxes",
      1,
    );
    if (!applications.length) {
      const empty = document.createElement("div");
      empty.className = "power-browser-settings-info-empty-v2";
      empty.textContent =
        "Application-family information is unavailable. Sign in to My Betty Blocks and reload the page.";
      settingsState.list.appendChild(empty);
    } else {
      applications.forEach(({ application, depth }) => {
        const permissions = application.permissions || {};
        const access = permissions.isBuilder
          ? "Builder"
          : permissions.isMember
            ? "Member"
            : "No access";
        const environment =
          application.parentId || application.parent
            ? application.isBranch
              ? "Branch"
              : "Sandbox"
            : "Production";
        settingsState.list.appendChild(
          createSettingsInfoCard(
            `${depth ? `${"↳ ".repeat(depth)}` : ""}${application.name || application.identifier}`,
            [
              ["Identifier", application.identifier],
              ["Application UUID", application.appUuid],
              ["Environment", environment],
              ["Parent", application.parent?.name || "None"],
              [
                "Application zone",
                application.applicationZone
                  ? `${application.applicationZone.label} (${application.applicationZone.name})`
                  : null,
              ],
              ["Access", access],
              [
                "Last merge to parent",
                formatSettingsInfoDate(
                  application.lastMerge?.insertedAt,
                ),
              ],
              ["Application URL", application.url],
            ],
            application.identifier === identifier ? "Current" : "",
          ),
        );
      });
    }

    appendSettingsSectionHeading(
      settingsState.list,
      "info",
      "Artifact",
      2,
    );
    if (!artifactData) {
      const empty = document.createElement("div");
      empty.className = "power-browser-settings-info-empty-v2";
      empty.textContent =
        "No artifact was retrieved for this application.";
      settingsState.list.appendChild(empty);
    } else {
      const currentEndpoint = getCurrentEndpoint(artifactData);
      settingsState.list.appendChild(
        createSettingsInfoCard("Runtime artifact", [
          ["Artifact URL", resolveArtifactUrl()],
          [
            "Application identifier",
            artifactData.applicationIdentifier ||
              artifactData.appIdentifier ||
              identifier,
          ],
          [
            "Application UUID",
            artifactData.applicationId || artifactData.appId,
          ],
          [
            "Models",
            normalizeArtifactCollection(artifactData.models).length,
          ],
          [
            "Properties",
            normalizeArtifactCollection(artifactData.properties).length,
          ],
          ["Endpoints", normalizeEndpoints(artifactData.endpoints).length],
          [
            "Current endpoint",
            currentEndpoint?.name ||
              currentEndpoint?.label ||
              currentEndpoint?.url ||
              "None",
          ],
        ]),
      );
    }

    renderSettingsDiagnostics(navigator);
  }

  /**
   * Deletes every stored setting override and reapplies current defaults.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function resetAllPowerBrowserSettings(navigator) {
    if (
      !window.confirm(
        "Reset all Power Browser settings to their defaults?",
      )
    ) {
      return;
    }

    SettingsDefinitions.forEach((definition) => {
      GM_deleteValue(definition.key);
      applySettingChange(
        navigator,
        definition,
        definition.defaultValue,
      );
    });
    renderSettingsTab(navigator);
  }

  /**
   * Returns a portable snapshot of every Power Browser setting.
   *
   * @returns {object}
   */
  function createPowerBrowserSettingsExport() {
    return {
      format: "power-browser-settings",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      scriptVersion:
        globalThis.GM_info?.script?.version || null,
      settings: Object.fromEntries(
        SettingsDefinitions.map((definition) => [
          definition.key,
          getSettingValue(definition.key),
        ]),
      ),
    };
  }

  /**
   * Downloads text using a temporary object URL.
   *
   * @param {string} filename
   * @param {string} text
   * @param {string} mimeType
   * @returns {void}
   */
  function downloadPowerBrowserTextFile(
    filename,
    text,
    mimeType,
  ) {
    const blob = new Blob([text], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  /**
   * Validates and applies an imported settings document.
   *
   * @param {unknown} payload
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {{applied: number, ignored: number}}
   */
  function importPowerBrowserSettings(payload, navigator) {
    if (!payload || typeof payload !== "object") {
      throw new Error("The imported file must contain a JSON object.");
    }

    if (
      payload.format &&
      payload.format !== "power-browser-settings"
    ) {
      throw new Error("This is not a Power Browser settings export.");
    }

    const importedSettings =
      payload.settings &&
      typeof payload.settings === "object" &&
      !Array.isArray(payload.settings)
        ? payload.settings
        : payload;
    let ignored = 0;
    const validatedSettings = [];

    Object.entries(importedSettings).forEach(([key, value]) => {
      const definition = getSettingDefinition(key);
      if (!definition) {
        ignored += 1;
        return;
      }

      const valid =
        (definition.type === "toggle" &&
          typeof value === "boolean") ||
        (definition.type === "shortcut" &&
          typeof value === "string") ||
        (definition.type === "theme" &&
          ["light", "dark", "betty"].includes(value)) ||
        (definition.type === "size" &&
          SETTINGS_SIZE_VALUES.includes(value));
      if (!valid) {
        throw new Error(
          `Setting “${definition.label}” has an invalid value.`,
        );
      }

      validatedSettings.push({
        definition,
        value,
      });
    });

    if (!validatedSettings.length) {
      throw new Error(
        "The imported file contains no recognized settings.",
      );
    }

    validatedSettings.forEach(({ definition, value }) => {
      GM_setValue(definition.key, value);
      applySettingChange(navigator, definition, value);
    });

    return {
      applied: validatedSettings.length,
      ignored,
    };
  }

  /**
   * Renders settings backup and restore actions.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function renderSettingsDataControls(navigator) {
    appendSettingsSectionHeading(
      settingsState.list,
      "settings",
      "Data",
      1,
    );
    const card = document.createElement("div");
    card.className =
      "power-browser-settings-card-v2 power-browser-settings-info-card-v2 power-browser-settings-data-v2";
    const heading = document.createElement("div");
    heading.className = "power-browser-settings-info-title-v2";
    heading.textContent = "Backup and restore";
    const description = document.createElement("span");
    description.className =
      "power-browser-settings-description-v2";
    description.textContent =
      "Export your preferences as JSON or restore a validated Power Browser settings file.";
    const actions = document.createElement("div");
    actions.className = "power-browser-settings-actions-v2";
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "power-browser-settings-action-v2";
    exportButton.textContent = "Export file";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "power-browser-settings-action-v2";
    copyButton.textContent = "Copy JSON";
    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "power-browser-settings-action-v2";
    importButton.textContent = "Import file";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json,.json";
    fileInput.hidden = true;
    const status = document.createElement("span");
    status.className =
      "power-browser-settings-operation-status-v2";
    if (settingsState.operationStatus) {
      status.dataset.status =
        settingsState.operationStatus.status;
      status.textContent =
        settingsState.operationStatus.message;
    }

    const getJson = () =>
      JSON.stringify(createPowerBrowserSettingsExport(), null, 2);
    exportButton.addEventListener("click", () => {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-");
      downloadPowerBrowserTextFile(
        `power-browser-settings_${timestamp}.json`,
        getJson(),
        "application/json;charset=utf-8",
      );
      status.dataset.status = "success";
      status.textContent = "Settings exported.";
    });
    copyButton.addEventListener("click", () => {
      GM_setClipboard(getJson());
      status.dataset.status = "success";
      status.textContent = "Settings JSON copied.";
    });
    importButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        return;
      }

      importButton.disabled = true;
      status.dataset.status = "loading";
      status.textContent = "Validating settings…";
      try {
        const payload = JSON.parse(await file.text());
        const result = importPowerBrowserSettings(
          payload,
          navigator,
        );
        settingsState.operationStatus = {
          status: "success",
          message:
            `Imported ${result.applied} setting${result.applied === 1 ? "" : "s"}` +
            (result.ignored
              ? `; ignored ${result.ignored} unknown key${result.ignored === 1 ? "" : "s"}.`
              : "."),
        };
        renderSettingsTab(navigator);
      } catch (error) {
        status.dataset.status = "error";
        status.textContent =
          error instanceof Error
            ? error.message
            : "Unable to import settings.";
        importButton.disabled = false;
        fileInput.value = "";
      }
    });

    actions.append(
      exportButton,
      copyButton,
      importButton,
      fileInput,
      status,
    );
    card.append(heading, description, actions);
    settingsState.list.appendChild(card);
  }

  /**
   * Renders the destructive reset control at the end of Settings.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function renderSettingsDangerZone(navigator) {
    appendSettingsSectionHeading(
      settingsState.list,
      "settings",
      "Danger zone",
      2,
    );
    const danger = document.createElement("div");
    danger.className = "power-browser-settings-danger-v2";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "Reset all settings";
    const description = document.createElement("span");
    description.textContent =
      "Delete every saved Power Browser preference and restore the current defaults.";
    copy.appendChild(title);
    copy.appendChild(description);
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "power-browser-settings-danger-button-v2";
    button.textContent = "Reset all settings";
    button.addEventListener("click", () =>
      resetAllPowerBrowserSettings(navigator),
    );
    danger.appendChild(copy);
    danger.appendChild(button);
    settingsState.list.appendChild(danger);
  }

  /**
   * Returns the unique section names in their displayed order.
   *
   * @param {string} tabId
   * @returns {string[]}
   */
  function getSettingsTabSections(tabId) {
    if (tabId === "info") {
      return [
        "Current application",
        "Sandboxes",
        "Artifact",
        "Diagnostics",
      ];
    }

    if (tabId === "settings") {
      return ["Appearance", "Data", "Danger zone"];
    }

    return [
      ...new Set(
        SettingsDefinitions.filter(
          (definition) => definition.tab === tabId,
        )
          .map((definition) => definition.section)
          .filter(Boolean),
      ),
    ];
  }

  /**
   * Updates the visual state of all subsection shortcuts.
   *
   * @returns {void}
   */
  function updateSettingsSectionLinkState() {
    if (!settingsState) {
      return;
    }

    settingsState.tabs
      .querySelectorAll(".power-browser-settings-section-link-v2")
      .forEach((button) => {
        button.classList.toggle(
          "active",
          button.dataset.tab === settingsState.activeTab &&
            button.dataset.section === settingsState.activeSection,
        );
      });
  }

  /**
   * Updates the highlighted subsection to match the content scroll position.
   *
   * @returns {void}
   */
  function updateVisibleSettingsSection() {
    if (!settingsState) {
      return;
    }

    const headings = Array.from(
      settingsState.list.querySelectorAll("[data-settings-section]"),
    );
    if (!headings.length) {
      settingsState.activeSection = "";
      updateSettingsSectionLinkState();
      return;
    }

    const contentTop =
      settingsState.content.getBoundingClientRect().top + 20;
    let visibleHeading = headings[0];
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top <= contentTop) {
        visibleHeading = heading;
      }
    });

    const atBottom =
      settingsState.content.scrollHeight -
        settingsState.content.scrollTop -
        settingsState.content.clientHeight <
      4;
    if (atBottom) {
      visibleHeading = headings.at(-1);
    }

    settingsState.activeSection =
      visibleHeading.dataset.settingsSection || "";
    updateSettingsSectionLinkState();
  }

  /**
   * Switches tabs when needed and scrolls to a settings subsection.
   *
   * @param {string} tabId
   * @param {string} sectionName
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function navigateToSettingsSection(tabId, sectionName, navigator) {
    if (!settingsState) {
      return;
    }

    if (settingsState.activeTab !== tabId) {
      settingsState.activeTab = tabId;
      settingsState.sectionsExpanded = true;
      GM_setValue("powerBrowserSettingsActiveTab", tabId);
      renderSettingsTab(navigator);
    }

    settingsState.activeSection = sectionName;
    updateSettingsSectionLinkState();
    window.requestAnimationFrame(() => {
      Array.from(
        settingsState.list.querySelectorAll("[data-settings-section]"),
      )
        .find(
          (heading) =>
            heading.dataset.settingsSection === sectionName,
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    });
  }

  /**
   * Renders shortcuts for the active tab, or every tab when configured.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function renderSettingsSectionNavigation(navigator) {
    if (!settingsState) {
      return;
    }

    settingsState.tabs
      .querySelectorAll(".power-browser-settings-section-links-v2")
      .forEach((navigation) => navigation.remove());

    const alwaysShowSections = Boolean(
      getSettingValue("settingsSectionsExpandedByDefault"),
    );
    settingsState.tabs
      .querySelectorAll(".power-browser-settings-tab-v2")
      .forEach((tabButton) => {
        const tabId = tabButton.dataset.tab;
        const sections = getSettingsTabSections(tabId);
        const shouldShow =
          sections.length > 0 &&
          (alwaysShowSections ||
            (tabId === settingsState.activeTab &&
              settingsState.sectionsExpanded));

        if (!shouldShow) {
          return;
        }

        const navigation = document.createElement("div");
        navigation.className =
          "power-browser-settings-section-links-v2";
        navigation.setAttribute(
          "aria-label",
          `${tabButton.textContent} sections`,
        );
        sections.forEach((sectionName) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className =
            "power-browser-settings-section-link-v2";
          button.dataset.tab = tabId;
          button.dataset.section = sectionName;
          button.textContent = sectionName;
          button.addEventListener("click", () =>
            navigateToSettingsSection(
              tabId,
              sectionName,
              navigator,
            ),
          );
          navigation.appendChild(button);
        });
        tabButton.after(navigation);
      });

    updateSettingsSectionLinkState();
  }

  /**
   * Scrolls to and briefly highlights a setting selected through search.
   *
   * @param {string} settingKey
   * @returns {void}
   */
  function flashSettingsDefinition(settingKey) {
    window.requestAnimationFrame(() => {
      const card = Array.from(
        settingsState.list.querySelectorAll("[data-setting-key]"),
      ).find(
        (candidate) =>
          candidate.dataset.settingKey === settingKey,
      );
      if (!card) {
        return;
      }

      card.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setTimeout(() => {
        if (!card.isConnected) {
          return;
        }

        card.classList.remove("setting-flash");
        void card.offsetWidth;
        card.classList.add("setting-flash");
        setTimeout(() => {
          card.classList.remove("setting-flash");
        }, 1700);
      }, 140);
    });
  }

  /**
   * Renders matching settings from every tab.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @param {string} query
   * @returns {void}
   */
  function renderSettingsSearchResults(navigator, query) {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = SettingsDefinitions.filter((definition) => {
      const tabLabel =
        SettingsTabs.find(({ id }) => id === definition.tab)
          ?.label || definition.tab;
      return [
        definition.label,
        definition.description,
        definition.section,
        definition.badge,
        tabLabel,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(normalizedQuery),
        );
    });

    settingsState.heading.textContent = "Search settings";
    settingsState.description.textContent =
      `${matches.length} result${matches.length === 1 ? "" : "s"} across all settings tabs.`;
    settingsState.reset.hidden = true;

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "power-browser-settings-info-empty-v2";
      empty.textContent =
        `No settings match “${query.trim()}”.`;
      settingsState.list.appendChild(empty);
      return;
    }

    matches.forEach((definition) => {
      const tab =
        SettingsTabs.find(({ id }) => id === definition.tab);
      const result = document.createElement("button");
      result.type = "button";
      result.className =
        "power-browser-settings-card-v2 power-browser-settings-search-result-v2";
      const copy = document.createElement("div");
      copy.className = "power-browser-settings-copy-v2";
      const labelRow = document.createElement("div");
      labelRow.className =
        "power-browser-settings-label-row-v2";
      const label = document.createElement("strong");
      label.textContent = definition.label;
      const locationBadge = document.createElement("span");
      locationBadge.className =
        "power-browser-settings-info-status-v2";
      locationBadge.textContent = [
        tab?.label || definition.tab,
        definition.section,
      ]
        .filter(Boolean)
        .join(" · ");
      const description = document.createElement("span");
      description.className =
        "power-browser-settings-description-v2";
      description.textContent = definition.description;
      labelRow.append(label, locationBadge);
      copy.append(labelRow, description);
      result.appendChild(copy);
      result.addEventListener("click", () => {
        settingsState.searchQuery = "";
        settingsState.searchInput.value = "";
        settingsState.activeTab = definition.tab;
        settingsState.activeSection =
          definition.section || "";
        settingsState.sectionsExpanded = true;
        GM_setValue(
          "powerBrowserSettingsActiveTab",
          definition.tab,
        );
        renderSettingsTab(navigator);
        updateSettingsSectionLinkState();
        flashSettingsDefinition(definition.key);
      });
      settingsState.list.appendChild(result);
    });
  }

  function renderSettingsTab(navigator) {
    if (!settingsState) {
      return;
    }

    const tab =
      SettingsTabs.find(({ id }) => id === settingsState.activeTab) ||
      SettingsTabs[0];
    const descriptions = {
      info: "Application, sandbox and runtime artifact details for the current page.",
      general: "Choose which navigation tools are visible and how model search behaves.",
      betty5: "Legacy Betty 5 behavior and editor preferences.",
      nextgen: "Action, Page Builder and log tooling for Next-gen applications.",
      uiBuilder: "Tools for the Betty 5 UI Builder preview.",
      runtime: "Runtime navigation, authentication and search behavior.",
      shortcuts: "Capture the keyboard combinations that fit your workflow.",
      settings: "Power Browser appearance, settings behavior and reset controls.",
    };

    settingsState.heading.textContent = tab.label;
    settingsState.description.textContent = descriptions[tab.id];
    settingsState.list.replaceChildren();
    const searchQuery = settingsState.searchQuery || "";
    if (searchQuery.trim()) {
      renderSettingsSearchResults(navigator, searchQuery);
      settingsState.tabs
        .querySelectorAll(
          ".power-browser-settings-section-links-v2",
        )
        .forEach((navigation) => navigation.remove());
      return;
    }
    settingsState.reset.hidden = !SettingsDefinitions.some(
      (definition) => definition.tab === tab.id,
    );
    const sections = getSettingsTabSections(tab.id);
    if (!sections.includes(settingsState.activeSection)) {
      settingsState.activeSection = sections[0] || "";
    }
    const alwaysShowSections = Boolean(
      getSettingValue("settingsSectionsExpandedByDefault"),
    );
    settingsState.tabs
      .querySelectorAll(".power-browser-settings-tab-v2")
      .forEach((button) => {
        const isActive = button.dataset.tab === tab.id;
        const buttonSections = getSettingsTabSections(button.dataset.tab);
        button.classList.toggle("active", isActive);
        button.classList.toggle(
          "has-sections",
          buttonSections.length > 0,
        );
        button.setAttribute("aria-selected", String(isActive));
        button.setAttribute(
          "aria-expanded",
          String(
            buttonSections.length > 0 &&
              (alwaysShowSections ||
                (isActive && settingsState.sectionsExpanded)),
          ),
        );
      });

    if (tab.id === "info") {
      renderSettingsInfoTab(navigator);
      renderSettingsSectionNavigation(navigator);
      return;
    }

    let currentSection = "";
    let sectionIndex = 0;
    SettingsDefinitions.filter(
      (definition) => definition.tab === tab.id,
    ).forEach((definition) => {
      if (definition.section && definition.section !== currentSection) {
        currentSection = definition.section;
        const section = document.createElement("h3");
        section.className = "power-browser-settings-section-v2";
        section.textContent = definition.section;
        section.dataset.settingsSection = definition.section;
        section.id = `power-browser-settings-section-${tab.id}-${sectionIndex}`;
        sectionIndex += 1;
        settingsState.list.appendChild(section);
      }

      const card = document.createElement("div");
      card.className = "power-browser-settings-card-v2";
      card.dataset.settingKey = definition.key;
      const settingDisabled = Boolean(
        definition.enabledWhenIconOnly &&
          !getSettingValue("iconOnlyMode"),
      );
      card.classList.toggle(
        "setting-disabled",
        settingDisabled,
      );

      const copy = document.createElement("div");
      copy.className = "power-browser-settings-copy-v2";
      const labelRow = document.createElement("div");
      labelRow.className = "power-browser-settings-label-row-v2";
      const label = document.createElement("strong");
      label.textContent = definition.label;
      const description = document.createElement("span");
      description.className = "power-browser-settings-description-v2";
      description.textContent = definition.description;
      labelRow.appendChild(label);
      if (definition.badge) {
        const badge = document.createElement("span");
        badge.className = "power-browser-settings-badge-v2";
        badge.textContent = definition.badge;
        labelRow.appendChild(badge);
      }
      copy.appendChild(labelRow);
      copy.appendChild(description);
      card.appendChild(copy);

      if (definition.type === "theme") {
        const picker = document.createElement("div");
        picker.className =
          "power-browser-settings-theme-picker-v2";
        picker.setAttribute("role", "radiogroup");
        picker.setAttribute("aria-label", definition.label);
        const selectedTheme = getPowerBrowserTheme();
        [
          ["light", "Light"],
          ["dark", "Dark"],
          ["betty", "Betty Blocks"],
        ].forEach(([themeId, themeLabel]) => {
          const option = document.createElement("button");
          option.type = "button";
          option.className =
            "power-browser-settings-theme-option-v2";
          option.dataset.theme = themeId;
          option.classList.toggle(
            "active",
            themeId === selectedTheme,
          );
          option.setAttribute("role", "radio");
          option.setAttribute(
            "aria-checked",
            String(themeId === selectedTheme),
          );
          const preview = document.createElement("span");
          preview.className =
            "power-browser-settings-theme-preview-v2";
          preview.setAttribute("aria-hidden", "true");
          const optionLabel = document.createElement("span");
          optionLabel.textContent = themeLabel;
          option.appendChild(preview);
          option.appendChild(optionLabel);
          option.addEventListener("click", () => {
            GM_setValue(definition.key, themeId);
            applySettingChange(
              navigator,
              definition,
              themeId,
            );
            renderSettingsTab(navigator);
          });
          picker.appendChild(option);
        });
        card.appendChild(picker);
      } else if (definition.type === "size") {
        const picker = document.createElement("div");
        picker.className =
          "power-browser-settings-size-picker-v2";
        picker.setAttribute("role", "radiogroup");
        picker.setAttribute("aria-label", definition.label);
        const selectedSize = getSettingsSize(definition.key);
        const sizeNames =
          definition.sizeKind === "dialog"
            ? [
                ["xs", "Compact"],
                ["sm", "Small"],
                ["md", "Default"],
                ["lg", "Large"],
                ["xl", "Maximum"],
              ]
            : [
                ["xs", "Smallest"],
                ["sm", "Small"],
                ["md", "Default"],
                ["lg", "Large"],
                ["xl", "Largest"],
              ];
        const sizeLabels = {
          xs: "XS",
          sm: "S",
          md: "M",
          lg: "L",
          xl: "XL",
        };
        sizeNames.forEach(([sizeId, sizeName]) => {
          const option = document.createElement("button");
          option.type = "button";
          option.className =
            "power-browser-settings-size-option-v2";
          option.dataset.size = sizeId;
          option.dataset.sizeKind = definition.sizeKind;
          option.title = sizeName;
          option.setAttribute(
            "aria-label",
            `${definition.label}: ${sizeName}`,
          );
          option.classList.toggle(
            "active",
            sizeId === selectedSize,
          );
          option.setAttribute("role", "radio");
          option.setAttribute(
            "aria-checked",
            String(sizeId === selectedSize),
          );
          const preview = document.createElement("span");
          preview.className =
            "power-browser-settings-size-preview-v2";
          preview.setAttribute("aria-hidden", "true");
          const optionLabel = document.createElement("span");
          optionLabel.textContent = sizeLabels[sizeId];
          option.appendChild(preview);
          option.appendChild(optionLabel);
          option.addEventListener("click", () => {
            GM_setValue(definition.key, sizeId);
            applySettingChange(navigator, definition, sizeId);
            renderSettingsTab(navigator);
          });
          picker.appendChild(option);
        });
        card.appendChild(picker);
      } else if (definition.type === "toggle") {
        const wrapper = document.createElement("label");
        wrapper.className = "power-browser-settings-toggle-v2";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(getSettingValue(definition.key));
        input.disabled = settingDisabled;
        input.setAttribute("aria-label", definition.label);
        const track = document.createElement("span");
        track.className = "power-browser-settings-toggle-track-v2";
        if (settingDisabled) {
          wrapper.title =
            "Enable Icons only to use this setting.";
        }
        input.addEventListener("change", () => {
          GM_setValue(definition.key, input.checked);
          applySettingChange(
            navigator,
            definition,
            input.checked,
          );
        });
        wrapper.appendChild(input);
        wrapper.appendChild(track);
        card.appendChild(wrapper);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        input.className = "power-browser-settings-shortcut-v2";
        input.value = String(getSettingValue(definition.key) || "");
        input.placeholder = "Click and press a shortcut";
        input.setAttribute("aria-label", definition.label);
        input.addEventListener("keydown", (event) => {
          if (event.key === "Tab") {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          if (event.key === "Backspace" || event.key === "Delete") {
            input.value = "";
            GM_setValue(definition.key, "");
            applySettingChange(navigator, definition, "");
            return;
          }

          const shortcut = formatShortcutEvent(event);
          if (!shortcut) {
            return;
          }

          input.value = shortcut;
          GM_setValue(definition.key, shortcut);
          applySettingChange(navigator, definition, shortcut);
        });
        card.appendChild(input);
      }

      settingsState.list.appendChild(card);
    });
    if (tab.id === "settings") {
      renderSettingsDataControls(navigator);
      renderSettingsDangerZone(navigator);
    }
    renderSettingsSectionNavigation(navigator);
  }

  function ensureSettingsDialog(navigator) {
    if (settingsState) {
      return settingsState;
    }

    const overlay = document.createElement("div");
    overlay.className = "power-browser-settings-overlay-v2";

    const dialog = document.createElement("section");
    dialog.className = "power-browser-settings-dialog-v2";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Power Browser settings");

    const sidebar = document.createElement("aside");
    sidebar.className = "power-browser-settings-sidebar-v2";
    const brand = document.createElement("div");
    brand.className = "power-browser-settings-brand-v2";
    brand.innerHTML =
      "<strong>Power Browser</strong><span>Services developer workspace</span>";
    const tabs = document.createElement("div");
    tabs.className = "power-browser-settings-tabs-v2";
    tabs.setAttribute("role", "tablist");

    SettingsTabs.forEach((tab) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "power-browser-settings-tab-v2";
      button.dataset.tab = tab.id;
      button.textContent = tab.label;
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => {
        settingsState.searchQuery = "";
        settingsState.searchInput.value = "";
        const sections = getSettingsTabSections(tab.id);
        const alwaysShowSections = Boolean(
          getSettingValue("settingsSectionsExpandedByDefault"),
        );
        if (
          settingsState.activeTab === tab.id &&
          sections.length &&
          !alwaysShowSections
        ) {
          settingsState.sectionsExpanded =
            !settingsState.sectionsExpanded;
          renderSettingsTab(navigator);
          return;
        }

        settingsState.activeTab = tab.id;
        settingsState.activeSection = sections[0] || "";
        settingsState.sectionsExpanded = true;
        settingsState.content.scrollTop = 0;
        GM_setValue("powerBrowserSettingsActiveTab", tab.id);
        renderSettingsTab(navigator);
      });
      tabs.appendChild(button);
    });

    const version = document.createElement("div");
    version.className = "power-browser-settings-version-v2";
    const scriptVersion = globalThis.GM_info?.script?.version;
    version.textContent = scriptVersion
      ? `Power Browser v${scriptVersion}`
      : "Power Browser";
    sidebar.appendChild(brand);
    sidebar.appendChild(tabs);  
    sidebar.appendChild(version);

    const main = document.createElement("main");
    main.className = "power-browser-settings-main-v2";
    const header = document.createElement("header");
    header.className = "power-browser-settings-header-v2";
    const headingWrapper = document.createElement("div");
    headingWrapper.className = "power-browser-settings-heading-v2";
    const heading = document.createElement("h2");
    const description = document.createElement("p");
    headingWrapper.appendChild(heading);
    headingWrapper.appendChild(description);
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "power-browser-settings-close-v2";
    closeButton.innerHTML = "&times;";
    closeButton.setAttribute("aria-label", "Close settings");
    header.appendChild(headingWrapper);
    header.appendChild(closeButton);

    const reloadAlert = document.createElement("div");
    reloadAlert.className = "power-browser-settings-alert-v2";
    reloadAlert.setAttribute("role", "status");
    const reloadCopy = document.createElement("div");
    const reloadTitle = document.createElement("strong");
    reloadTitle.textContent = "Reload required";
    const reloadText = document.createElement("span");
    reloadCopy.appendChild(reloadTitle);
    reloadCopy.appendChild(reloadText);
    const reloadButton = document.createElement("button");
    reloadButton.type = "button";
    reloadButton.className = "power-browser-settings-reload-v2";
    reloadButton.textContent = "Reload page";
    reloadButton.addEventListener("click", () => location.reload());
    reloadAlert.appendChild(reloadCopy);
    reloadAlert.appendChild(reloadButton);

    const searchBar = document.createElement("div");
    searchBar.className = "power-browser-settings-search-v2";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "Search all settings…";
    searchInput.setAttribute(
      "aria-label",
      "Search all Power Browser settings",
    );
    searchBar.appendChild(searchInput);

    const content = document.createElement("div");
    content.className = "power-browser-settings-content-v2";
    const list = document.createElement("div");
    list.className = "power-browser-settings-list-v2";
    content.appendChild(list);

    const footer = document.createElement("footer");
    footer.className = "power-browser-settings-footer-v2";
    const saved = document.createElement("span");
    saved.textContent = "Changes are applied on all tabs";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "power-browser-settings-reset-v2";
    reset.textContent = "Reset this tab";
    reset.addEventListener("click", () => {
      const tabDefinitions = SettingsDefinitions.filter(
        (definition) => definition.tab === settingsState.activeTab,
      );
      tabDefinitions.forEach((definition) => {
        GM_setValue(definition.key, definition.defaultValue);
      });
      tabDefinitions.forEach((definition) => {
        applySettingChange(
          navigator,
          definition,
          definition.defaultValue,
        );
      });
      renderSettingsTab(navigator);
    });
    footer.appendChild(saved);
    footer.appendChild(reset);
    main.appendChild(header);
    main.appendChild(reloadAlert);
    main.appendChild(searchBar);
    main.appendChild(content);
    main.appendChild(footer);
    dialog.appendChild(sidebar);
    dialog.appendChild(main);
    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

    const storedTab = GM_getValue(
      "powerBrowserSettingsActiveTab",
      "general",
    );
    const normalizedStoredTab =
      storedTab === "appearance" ? "settings" : storedTab;
    settingsState = {
      navigator,
      overlay,
      dialog,
      tabs,
      heading,
      description,
      searchInput,
      searchQuery: "",
      operationStatus: null,
      infoOperationStatus: null,
      content,
      list,
      reset,
      reloadAlert,
      reloadText,
      activeTab: SettingsTabs.some(
        ({ id }) => id === normalizedStoredTab,
      )
        ? normalizedStoredTab
        : "general",
      activeSection: "",
      sectionsExpanded: true,
      lastFocusedElement: null,
    };

    overlay.addEventListener("click", closeSettings);
    closeButton.addEventListener("click", closeSettings);
    searchInput.addEventListener("input", () => {
      settingsState.searchQuery = searchInput.value;
      settingsState.content.scrollTop = 0;
      renderSettingsTab(navigator);
    });
    content.addEventListener("scroll", () => {
      if (settingsSectionScrollFrame !== null) {
        return;
      }

      settingsSectionScrollFrame = window.requestAnimationFrame(() => {
        settingsSectionScrollFrame = null;
        updateVisibleSettingsSection();
      });
    });
    applyAppearanceSettings(navigator);
    updateSettingsReloadNotice();
    renderSettingsTab(navigator);
    return settingsState;
  }

  function openSettings(navigator) {
    const state = ensureSettingsDialog(navigator);
    state.lastFocusedElement = document.activeElement;
    state.sectionsExpanded = true;
    renderSettingsTab(navigator);
    state.overlay.classList.add("open");
    state.dialog.classList.add("open");
    state.tabs.querySelector(".active")?.focus();
  }

  function closeSettings() {
    if (!settingsState?.dialog.classList.contains("open")) {
      return;
    }

    settingsState.overlay.classList.remove("open");
    settingsState.dialog.classList.remove("open");
    settingsState.lastFocusedElement?.focus?.();
  }

  function handleSettingsGlobalShortcut(event, navigator) {
    const settingsOpen = settingsState?.dialog.classList.contains("open");
    const modelSearchOpen =
      modelSearchState?.dialog.classList.contains("open");
    const closeShortcut = String(
      getSettingValue("extraDialogCloseShortcut") || "",
    );

    if (
      (settingsOpen || modelSearchOpen) &&
      shortcutMatchesEvent(closeShortcut, event)
    ) {
      event.preventDefault();
      closeSettings();
      closeModelSearch();
      return;
    }

    const tagName = event.target?.tagName;
    if (
      ["INPUT", "TEXTAREA", "SELECT"].includes(tagName) ||
      event.target?.isContentEditable
    ) {
      return;
    }

    if (
      shortcutMatchesEvent(
        String(getSettingValue("extraMenuToggleShortcut") || ""),
        event,
      )
    ) {
      event.preventDefault();
      navigator.navigatorBar.classList.toggle(
        "power-browser-setting-hidden-v2",
      );
    }
  }

  /**
   * Applies settings changed by another Power Browser tab to this page.
   *
   * Local changes are already applied by the settings controls and are ignored
   * here to prevent duplicate work.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function initializeSettingSynchronization(navigator) {
    if (typeof globalThis.GM_addValueChangeListener !== "function") {
      return;
    }

    SettingsDefinitions.forEach((definition) => {
      globalThis.GM_addValueChangeListener(
        definition.key,
        (_key, _oldValue, newValue, remote) => {
          if (!remote) {
            return;
          }

          const value =
            newValue === undefined
              ? definition.defaultValue
              : newValue;
          applySettingChange(navigator, definition, value);

          if (
            settingsState?.dialog.classList.contains("open")
          ) {
            renderSettingsTab(navigator);
          }
        },
      );
    });
  }

  function initializeSettings(navigator) {
    const button = document.getElementById("settingsButton");

    if (!button) {
      return;
    }

    button.disabled = false;
    button.classList.remove(NAV_DISABLED_CLASS);
    button.setAttribute("aria-disabled", "false");
    button.title = "Power Browser settings";
    button.addEventListener("click", () => openSettings(navigator));

    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("Open Power Browser settings", () =>
        openSettings(navigator),
      );
    }

    document.addEventListener("keydown", (event) =>
      handleSettingsGlobalShortcut(event, navigator),
    );
    initializeSettingSynchronization(navigator);
    applyAppearanceSettings(navigator);
    applyNavigatorVisibilitySettings(navigator);
  }

  function initializeHoldToHideMenu(navigator) {
    let hideActive = false;

    const showMenu = () => {
      navigator.navigatorBar.classList.remove(
        "power-browser-shift-hidden-v2",
      );
      hideActive = false;
    };

    document.addEventListener("keydown", (event) => {
      const shortcut = String(
        getSettingValue("extraMenuHideModifier") || "",
      );

      if (
        !hideActive &&
        shortcutMatchesEvent(shortcut, event)
      ) {
        navigator.navigatorBar.classList.add(
          "power-browser-shift-hidden-v2",
        );
        hideActive = true;
      }
    });

    document.addEventListener("keyup", (event) => {
      if (!hideActive) {
        return;
      }

      const shortcutParts = String(
        getSettingValue("extraMenuHideModifier") || "",
      )
        .split("+")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
      const releasedKeyAliases = {
        control: ["control", "ctrl"],
        meta: ["meta", "cmd", "command"],
        alt: ["alt", "option"],
        shift: ["shift"],
      };
      const releasedKey = event.key.toLowerCase();
      const aliases = releasedKeyAliases[releasedKey] || [releasedKey];

      if (aliases.some((key) => shortcutParts.includes(key))) {
        showMenu();
      }
    });
    window.addEventListener("blur", showMenu);
  }

  /**
   * Enable a navigator link after its destination is known.
   * @param {object} navigator
   * @param {string} id
   * @param {string|null} href
   * @param {boolean} [visible]
   */
  function updateNavigatorLink(navigator, id, href, visible = true) {
    const control = navigator.controls.get(id);

    if (!control) {
      return;
    }

    control.classList.toggle("power-browser-hidden-v2", !visible);

    if (!href) {
      control.removeAttribute("href");
      control.classList.add(NAV_DISABLED_CLASS);
      control.setAttribute("aria-disabled", "true");
      return;
    }

    control.href = href;
    control.classList.remove(NAV_DISABLED_CLASS);
    control.setAttribute("aria-disabled", "false");
  }

  function getEnvironmentPrefix() {
    const environment = ["edge", "acceptance", "bench"].find((name) =>
      location.hostname.includes(`.${name}.`),
    );
    return environment ? `${environment}.` : "";
  }

  function normalizeEndpoints(endpoints) {
    if (Array.isArray(endpoints)) {
      return endpoints;
    }

    return endpoints && typeof endpoints === "object"
      ? Object.values(endpoints)
      : [];
  }

  function getCurrentEndpoint(artifactData) {
    const endpoints = normalizeEndpoints(artifactData?.endpoints);
    const pathname = location.pathname;

    return (
      endpoints.find((endpoint) => {
        if (!endpoint?.url) {
          return false;
        }

        const pattern = endpoint.url
          .split("/")
          .map((part) => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
          .join("/");

        return new RegExp(`^${pattern}/?$`).test(pathname);
      }) || null
    );
  }

  function getBuilderPageId() {
    return (
      location.pathname.match(
        /\/(?:page-builder|pro-coder-mode)\/([a-f0-9-]+)/i,
      )?.[1] || null
    );
  }

  function getApplicationId(artifactData, applicationFamily, identifier) {
    const applications = Array.isArray(applicationFamily)
      ? applicationFamily
      : applicationFamily
        ? [applicationFamily]
        : [];
    const currentApplication = applications.find(
      (application) => application.identifier === identifier,
    );

    return (
      artifactData?.applicationId ||
      artifactData?.appId ||
      pageWindow.Betty?.application_id ||
      currentApplication?.appUuid ||
      null
    );
  }

  function getBearerToken() {
    const token = localStorage.getItem("TOKEN");
    return typeof token === "string" && token.trim() ? token.trim() : null;
  }

  function updateBearerButtonState(button) {
    const tokenAvailable = Boolean(getBearerToken());

    button.disabled = !tokenAvailable;
    button.classList.toggle(NAV_DISABLED_CLASS, !tokenAvailable);
    button.setAttribute("aria-disabled", String(!tokenAvailable));
    button.title = tokenAvailable
      ? "Copy the runtime bearer token"
      : "Bearer token unavailable. Are you logged in? Betty Auth is not supported.";
  }

  function showBearerFeedback(button, succeeded) {
    const label = button.querySelector("span");

    clearTimeout(bearerFeedbackTimeout);
    button.classList.remove(
      "power-browser-bearer-copied-v2",
      "power-browser-bearer-error-v2",
    );
    button.classList.add(
      succeeded
        ? "power-browser-bearer-copied-v2"
        : "power-browser-bearer-error-v2",
    );

    if (label) {
      label.textContent = succeeded ? "Copied" : "Copy failed";
    }

    bearerFeedbackTimeout = setTimeout(() => {
      button.classList.remove(
        "power-browser-bearer-copied-v2",
        "power-browser-bearer-error-v2",
      );

      if (label) {
        label.textContent = "Bearer";
      }
    }, 1200);
  }

  async function copyBearerToken(button) {
    const token = getBearerToken();

    if (!token) {
      updateBearerButtonState(button);
      showBearerFeedback(button, false);
      return;
    }

    const payload = `{\n    "Authorization": "Bearer ${token}"\n}`;

    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(payload, "text");
      } else {
        await window.navigator.clipboard.writeText(payload);
      }

      showBearerFeedback(button, true);
    } catch (error) {
      console.warn("[Power Browser v2] Unable to copy the bearer token.", error);
      showBearerFeedback(button, false);
    }
  }

  function configureBearerButton(navigator, visible) {
    const button = navigator.controls.get("buttonCopyBearer");

    if (!button) {
      return;
    }

    button.classList.toggle("power-browser-hidden-v2", !visible);

    if (!visible) {
      clearInterval(bearerTokenWatchInterval);
      bearerTokenWatchInterval = null;
      return;
    }

    if (!button.dataset.powerBrowserListener) {
      button.dataset.powerBrowserListener = "true";
      button.addEventListener("click", () => {
        void copyBearerToken(button);
      });
    }

    updateBearerButtonState(button);

    if (!bearerTokenWatchInterval) {
      let previousToken = getBearerToken();
      bearerTokenWatchInterval = setInterval(() => {
        const currentToken = getBearerToken();

        if (currentToken !== previousToken) {
          previousToken = currentToken;
          updateBearerButtonState(button);
        }
      }, 500);
    }
  }

  function normalizeArtifactCollection(collection) {
    if (Array.isArray(collection)) {
      return collection.filter(Boolean);
    }

    return collection && typeof collection === "object"
      ? Object.values(collection).filter(Boolean)
      : [];
  }

  function getSearchDisplayName(item, fallback) {
    return item?.label || item?.name || item?.id || fallback;
  }

  function buildModelSearchEntries(artifactData) {
    const models = normalizeArtifactCollection(artifactData?.models);
    const properties = normalizeArtifactCollection(artifactData?.properties);
    const modelsById = new Map(
      models
        .filter((model) => model?.id)
        .map((model) => [String(model.id), model]),
    );
    const entries = [];

    models.forEach((model) => {
      if (!model?.id) {
        return;
      }

      const title = getSearchDisplayName(model, "Unnamed model");
      entries.push({
        type: "model",
        id: String(model.id),
        modelId: String(model.id),
        title,
        meta: String(model.id),
        searchText: [model.id, model.name, model.label]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        searchTextWithoutKind: [model.id, model.name, model.label]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    });

    properties.forEach((property) => {
      if (!property?.id) {
        return;
      }

      const modelId =
        property.modelId || property.model?.id || property.model_id || null;
      const model = modelId ? modelsById.get(String(modelId)) : null;
      const modelName = getSearchDisplayName(model, modelId || "Unknown model");
      const title = getSearchDisplayName(property, "Unnamed property");
      const kind = String(property.kind || "Unknown type").replaceAll("_", " ");
      const normalizedKind = String(property.kind || "").toLowerCase();
      const isRelation = [
        "belongs_to",
        "has_many",
        "has_and_belongs_to_many",
      ].includes(normalizedKind);

      entries.push({
        type: isRelation ? "relation" : "property",
        id: String(property.id),
        modelId: modelId ? String(modelId) : null,
        title,
        meta: `${modelName} · ${kind} · ${property.id}`,
        searchText: [
          property.id,
          property.name,
          property.label,
          property.kind,
          modelId,
          modelName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        searchTextWithoutKind: [
          property.id,
          property.name,
          property.label,
          modelId,
          modelName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    });

    return entries.sort((left, right) =>
      left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      }),
    );
  }

  function searchModelEntries(entries, query, limit = 75) {
    const normalizedQuery = query.trim().toLowerCase();
    const includeKind = Boolean(getSettingValue("runtimeSearchIncludeKind"));
    const excludeRelations = Boolean(
      getSettingValue("runtimeSearchExcludeRelations"),
    );
    const availableEntries = excludeRelations
      ? entries.filter((entry) => entry.type !== "relation")
      : entries;

    if (!normalizedQuery) {
      return availableEntries.slice(0, limit);
    }

    const terms = normalizedQuery.split(/\s+/).filter(Boolean);

    return availableEntries
      .filter((entry) =>
        terms.every((term) =>
          (includeKind
            ? entry.searchText
            : entry.searchTextWithoutKind
          ).includes(term),
        ),
      )
      .map((entry) => {
        const normalizedTitle = entry.title.toLowerCase();
        let score = 4;

        if (entry.id.toLowerCase() === normalizedQuery) {
          score = 0;
        } else if (normalizedTitle === normalizedQuery) {
          score = 1;
        } else if (normalizedTitle.startsWith(normalizedQuery)) {
          score = 2;
        } else if (normalizedTitle.includes(normalizedQuery)) {
          score = 3;
        }

        return { entry, score };
      })
      .sort(
        (left, right) =>
          left.score - right.score ||
          left.entry.title.localeCompare(right.entry.title, undefined, {
            sensitivity: "base",
          }),
      )
      .slice(0, limit)
      .map(({ entry }) => entry);
  }

  function getModelSearchShortcut() {
    const shortcut = GM_getValue(
      "extraModelSearchShortcut",
      "Ctrl+Shift+K",
    );
    return typeof shortcut === "string" ? shortcut.trim() : "";
  }

  function shortcutMatchesEvent(shortcutValue, event) {
    if (!shortcutValue) {
      return false;
    }

    const parts = shortcutValue
      .split("+")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    const key = parts.find(
      (part) =>
        !["ctrl", "control", "shift", "alt", "option", "meta", "cmd", "command"].includes(
          part,
        ),
    );
    const isMac = window.navigator.platform.toLowerCase().includes("mac");
    const expectsCtrl = parts.includes("ctrl") || parts.includes("control");
    const expectsMeta =
      parts.includes("meta") ||
      parts.includes("cmd") ||
      parts.includes("command");
    const ctrlActive =
      event.ctrlKey || (isMac && expectsCtrl && event.metaKey && !expectsMeta);
    const metaActive =
      event.metaKey && !(isMac && expectsCtrl && !expectsMeta);

    return (
      (!key || event.key.toLowerCase() === key) &&
      (expectsCtrl ? ctrlActive : !ctrlActive) &&
      (parts.includes("shift") ? event.shiftKey : !event.shiftKey) &&
      (parts.includes("alt") || parts.includes("option")
        ? event.altKey
        : !event.altKey) &&
      (expectsMeta ? metaActive : !metaActive)
    );
  }

  function ensureModelSearchDialog() {
    if (modelSearchState) {
      return modelSearchState;
    }

    const overlay = document.createElement("div");
    overlay.className = "power-browser-model-search-overlay-v2";

    const dialog = document.createElement("section");
    dialog.className = "power-browser-model-search-dialog-v2";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Search models and properties");

    const header = document.createElement("div");
    header.className = "power-browser-model-search-header-v2";
    header.innerHTML = SvgIcons.search;

    const input = document.createElement("input");
    input.type = "search";
    input.className = "power-browser-model-search-input-v2";
    input.placeholder = "Search models, properties, kinds or IDs…";
    input.autocomplete = "off";
    input.spellcheck = false;

    const shortcut = document.createElement("span");
    shortcut.className = "power-browser-model-search-shortcut-v2";
    shortcut.textContent = getModelSearchShortcut();

    const results = document.createElement("div");
    results.className = "power-browser-model-search-results-v2";
    results.setAttribute("role", "listbox");

    const footer = document.createElement("div");
    footer.className = "power-browser-model-search-footer-v2";
    footer.innerHTML =
      "<span>↑↓ Navigate · Enter Open · Esc Close</span><span class=\"power-browser-model-search-count-v2\">0 results</span>";
    const count = footer.querySelector(
      ".power-browser-model-search-count-v2",
    );

    header.appendChild(input);
    header.appendChild(shortcut);
    dialog.appendChild(header);
    dialog.appendChild(results);
    dialog.appendChild(footer);
    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

    modelSearchState = {
      overlay,
      dialog,
      input,
      results,
      count,
      shortcut,
      entries: [],
      filteredEntries: [],
      activeIndex: -1,
      identifier: null,
      lastFocusedElement: null,
    };
    const theme = getPowerBrowserTheme();
    modelSearchState.dialog.classList.toggle(
      "power-browser-dark-v2",
      theme === "dark",
    );
    modelSearchState.dialog.classList.toggle(
      "power-browser-betty-theme-v2",
      theme === "betty",
    );

    overlay.addEventListener("click", closeModelSearch);
    input.addEventListener("input", () => {
      clearTimeout(modelSearchDebounce);
      modelSearchDebounce = setTimeout(renderModelSearchResults, 80);
    });

    return modelSearchState;
  }

  function getModelIdeUrl(entry) {
    if (!modelSearchState?.identifier || !entry?.modelId) {
      return null;
    }

    const environmentPrefix = getEnvironmentPrefix();
    const propertyPath =
      entry.type === "property" || entry.type === "relation"
        ? `/properties/${entry.id}`
        : "";
    return `https://${modelSearchState.identifier}.${environmentPrefix}bettyblocks.com/app/models/${entry.modelId}${propertyPath}`;
  }

  function getModelBackofficeUrl(entry) {
    if (!modelSearchState?.identifier || !entry?.modelId) {
      return null;
    }

    const environmentPrefix = getEnvironmentPrefix();
    const propertyPath =
      entry.type === "property" || entry.type === "relation"
        ? `/properties/show/${entry.id}`
        : "";
    return `https://${modelSearchState.identifier}.${environmentPrefix}bettyblocks.com/#models/show/${entry.modelId}${propertyPath}`;
  }

  /**
   * Opens a Power Browser destination in a related foreground tab.
   *
   * @param {string} url
   * @returns {unknown}
   */
  function openPowerBrowserTab(url) {
    if (typeof globalThis.GM_openInTab === "function") {
      return globalThis.GM_openInTab(url, {
        active: true,
        setParent: true,
      });
    }

    return window.open(url, "_blank", "noopener");
  }

  function openModelSearchEntry(entry) {
    const url = getModelIdeUrl(entry);

    if (!url) {
      return;
    }

    openPowerBrowserTab(url);
  }

  function setActiveModelSearchResult(index) {
    if (!modelSearchState?.filteredEntries.length) {
      return;
    }

    const resultCount = modelSearchState.filteredEntries.length;
    modelSearchState.activeIndex =
      ((index % resultCount) + resultCount) % resultCount;

    modelSearchState.results
      .querySelectorAll(".power-browser-model-search-result-v2")
      .forEach((button, buttonIndex) => {
        const isActive = buttonIndex === modelSearchState.activeIndex;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));

        if (isActive) {
          button.scrollIntoView({ block: "nearest" });
        }
      });
  }

  function renderModelSearchResults() {
    if (!modelSearchState) {
      return;
    }

    const matches = searchModelEntries(
      modelSearchState.entries,
      modelSearchState.input.value,
    );
    modelSearchState.filteredEntries = matches;
    modelSearchState.activeIndex = matches.length ? 0 : -1;
    modelSearchState.results.replaceChildren();
    modelSearchState.count.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"}`;

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "power-browser-model-search-empty-v2";
      empty.textContent = `No models or properties found for “${modelSearchState.input.value.trim()}”.`;
      modelSearchState.results.appendChild(empty);
      return;
    }

    matches.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = "power-browser-model-search-result-row-v2";

      const result = document.createElement("button");
      result.type = "button";
      result.className = `power-browser-model-search-result-v2${index === 0 ? " active" : ""}`;
      result.setAttribute("role", "option");
      result.setAttribute("aria-selected", String(index === 0));

      const chip = document.createElement("span");
      chip.className = `power-browser-model-search-chip-v2 ${entry.type}`;
      chip.textContent =
        entry.type === "relation"
          ? "Relation"
          : entry.type === "property"
            ? "Property"
            : "Model";

      const copy = document.createElement("span");
      copy.className = "power-browser-model-search-copy-v2";

      const title = document.createElement("span");
      title.className = "power-browser-model-search-title-v2";
      title.textContent = entry.title;

      const meta = document.createElement("span");
      meta.className = "power-browser-model-search-meta-v2";
      meta.textContent = entry.meta;

      const open = document.createElement("span");
      open.className = "power-browser-model-search-open-v2";
      open.textContent = "Open IDE";

      copy.appendChild(title);
      copy.appendChild(meta);
      result.appendChild(chip);
      result.appendChild(copy);
      result.appendChild(open);
      row.addEventListener("mouseenter", () => {
        setActiveModelSearchResult(index);
      });
      result.addEventListener("click", () => openModelSearchEntry(entry));

      const backofficeUrl = getModelBackofficeUrl(entry);
      const backofficeButton = document.createElement("button");
      backofficeButton.type = "button";
      backofficeButton.className =
        "power-browser-model-search-backoffice-v2";
      backofficeButton.innerHTML = SvgIcons.backoffice;
      backofficeButton.title = "Open in Betty 5 back office";
      backofficeButton.setAttribute(
        "aria-label",
        `Open ${entry.title} in Betty 5 back office`,
      );
      backofficeButton.disabled = !backofficeUrl;
      backofficeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (backofficeUrl) {
          openPowerBrowserTab(backofficeUrl);
        }
      });

      row.appendChild(result);
      row.appendChild(backofficeButton);
      modelSearchState.results.appendChild(row);
    });
  }

  function openModelSearch() {
    if (!modelSearchState?.entries.length) {
      return;
    }

    modelSearchState.lastFocusedElement = document.activeElement;
    modelSearchState.input.value = "";
    modelSearchState.shortcut.textContent = getModelSearchShortcut();
    modelSearchState.overlay.classList.add("open");
    modelSearchState.dialog.classList.add("open");
    renderModelSearchResults();
    setTimeout(() => modelSearchState?.input.focus(), 0);
  }

  function closeModelSearch() {
    if (!modelSearchState?.dialog.classList.contains("open")) {
      return;
    }

    modelSearchState.overlay.classList.remove("open");
    modelSearchState.dialog.classList.remove("open");

    if (modelSearchState.lastFocusedElement instanceof window.HTMLElement) {
      modelSearchState.lastFocusedElement.focus();
    }
  }

  function handleModelSearchKeydown(event) {
    const isOpen = modelSearchState?.dialog.classList.contains("open");
    const target = event.target;
    const targetIsEditable =
      ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) ||
      target?.isContentEditable;

    if (shortcutMatchesEvent(getModelSearchShortcut(), event)) {
      if (!isOpen && targetIsEditable) {
        return;
      }

      event.preventDefault();
      isOpen ? closeModelSearch() : openModelSearch();
      return;
    }

    if (!isOpen) {
      return;
    }

    if (
      shortcutMatchesEvent(
        String(getSettingValue("extraDialogCloseShortcut") || ""),
        event,
      )
    ) {
      event.preventDefault();
      closeModelSearch();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveModelSearchResult(modelSearchState.activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveModelSearchResult(modelSearchState.activeIndex - 1);
    } else if (event.key === "Enter" && modelSearchState.activeIndex >= 0) {
      event.preventDefault();
      openModelSearchEntry(
        modelSearchState.filteredEntries[modelSearchState.activeIndex],
      );
    }
  }

  function configureModelSearch(navigator, artifactData, identifier) {
    const button = navigator.controls.get("buttonRuntimeModelSearch");
    const entries = buildModelSearchEntries(artifactData);

    if (!button || !entries.length || !identifier) {
      button?.classList.add("power-browser-hidden-v2");
      return;
    }

    const state = ensureModelSearchDialog();
    state.entries = entries;
    state.identifier = identifier;
    button.classList.remove("power-browser-hidden-v2", NAV_DISABLED_CLASS);
    button.disabled = false;
    button.setAttribute("aria-disabled", "false");
    button.title = `Search models and properties (${getModelSearchShortcut()})`;

    if (!button.dataset.powerBrowserListener) {
      button.dataset.powerBrowserListener = "true";
      button.addEventListener("click", openModelSearch);
    }

    if (!document.documentElement.dataset.powerBrowserModelSearchShortcut) {
      document.documentElement.dataset.powerBrowserModelSearchShortcut = "true";
      document.addEventListener("keydown", handleModelSearchKeydown);
    }
  }

  /**
   * Populate the standard shortcuts while retaining the original bar order.
   */
  function configureNavigator(
    navigator,
    { artifactData, siteType, identifier, applicationFamily = null },
  ) {
    if (!identifier) {
      return;
    }

    const environmentPrefix = getEnvironmentPrefix();
    const builderHost = `${identifier}.${environmentPrefix}bettyblocks.com`;
    const runtimeHost = `${identifier}.${environmentPrefix}betty.app`;
    const applicationId = getApplicationId(
      artifactData,
      applicationFamily,
      identifier,
    );

    updateNavigatorLink(
      navigator,
      "organizationButton",
      `https://my.${environmentPrefix}bettyblocks.com/applications/${identifier}`,
    );
    updateNavigatorLink(
      navigator,
      "homePageButton",
      `https://${runtimeHost}/`,
    );
    updateNavigatorLink(
      navigator,
      "backOfficeButton",
      `https://${builderHost}/`,
    );
    updateNavigatorLink(
      navigator,
      "b5Models",
      `https://${builderHost}/#models`,
    );
    updateNavigatorLink(
      navigator,
      "monitoringButton",
      `https://${builderHost}/monitoring`,
    );
    updateNavigatorLink(
      navigator,
      "playgroundButton",
      applicationId
        ? `https://${runtimeHost}/api/runtime/${applicationId}`
        : null,
    );

    ["buttonRuntime", "buttonPagebuilder", "buttonProcoderMode"].forEach(
      (id) => updateNavigatorLink(navigator, id, null, false),
    );

    const builderPageId = getBuilderPageId();

    if (siteType === SiteType.NEXTGEN && builderPageId) {
      const endpoint = normalizeEndpoints(artifactData?.endpoints).find(
        (candidate) =>
          candidate?.id === builderPageId ||
          candidate?.pageId === builderPageId,
      );
      const runtimeHref = endpoint?.url
        ? `https://${runtimeHost}${endpoint.url}`
        : null;

      updateNavigatorLink(
        navigator,
        "buttonRuntime",
        runtimeHref,
        true,
      );

      if (location.pathname.includes("/page-builder/")) {
        updateNavigatorLink(
          navigator,
          "buttonProcoderMode",
          location.href.replace("/page-builder/", "/pro-coder-mode/"),
          true,
        );
      } else {
        updateNavigatorLink(
          navigator,
          "buttonPagebuilder",
          location.href.replace("/pro-coder-mode/", "/page-builder/"),
          true,
        );
      }
    }

    if (siteType === SiteType.RUNTIME) {
      const endpoint = getCurrentEndpoint(artifactData);
      const pageBuilderId = endpoint?.id || endpoint?.pageId;
      updateNavigatorLink(
        navigator,
        "buttonPagebuilder",
        pageBuilderId
          ? `https://${builderHost}/app/page-builder/${pageBuilderId}`
          : null,
        true,
      );
      configureBearerButton(navigator, true);
    } else {
      configureBearerButton(navigator, false);
    }

    navigator.navigatorBar.setAttribute("aria-busy", "false");
  }

  function sortApplicationFamily(applicationFamily) {
    const applications = (Array.isArray(applicationFamily)
      ? applicationFamily
      : applicationFamily
        ? [applicationFamily]
        : []
    ).filter((application) => application?.id && application?.identifier);
    const applicationsById = new Map(
      applications.map((application) => [String(application.id), application]),
    );
    const childrenByParentId = new Map();
    const roots = [];
    const compareApplications = (left, right) =>
      String(left.insertedAt || "").localeCompare(
        String(right.insertedAt || ""),
      ) || String(left.name || left.identifier).localeCompare(
        String(right.name || right.identifier),
      );

    applications.forEach((application) => {
      const parentId = application.parentId ?? application.parent?.id;
      const parentKey = parentId == null ? null : String(parentId);

      if (!parentKey || !applicationsById.has(parentKey)) {
        roots.push(application);
        return;
      }

      const children = childrenByParentId.get(parentKey) || [];
      children.push(application);
      childrenByParentId.set(parentKey, children);
    });

    roots.sort(compareApplications);
    childrenByParentId.forEach((children) =>
      children.sort(compareApplications),
    );

    const ordered = [];
    const visited = new Set();
    const visit = (application, depth) => {
      const key = String(application.id);

      if (visited.has(key)) {
        return;
      }

      visited.add(key);
      ordered.push({ application, depth });
      (childrenByParentId.get(key) || []).forEach((child) =>
        visit(child, depth + 1),
      );
    };

    roots.forEach((root) => visit(root, 0));
    applications
      .filter((application) => !visited.has(String(application.id)))
      .sort(compareApplications)
      .forEach((application) => visit(application, 0));

    return ordered;
  }

  function switchApplication(
    currentIdentifier,
    selectedApplication,
    siteType,
  ) {
    const selectedIdentifier = selectedApplication?.identifier;

    if (
      !currentIdentifier ||
      !selectedIdentifier ||
      currentIdentifier === selectedIdentifier
    ) {
      return;
    }

    const targetUrl = new URL(location.href);
    const currentPrefix = `${currentIdentifier}.`;

    if (!targetUrl.hostname.startsWith(currentPrefix)) {
      console.warn(
        "[Power Browser v2] The current application identifier was not found at the start of the hostname.",
        { currentIdentifier, hostname: targetUrl.hostname },
      );
      return;
    }

    targetUrl.hostname =
      selectedIdentifier + targetUrl.hostname.slice(currentIdentifier.length);

    if (siteType === SiteType.PLAYGROUND) {
      if (!selectedApplication.appUuid) {
        console.warn(
          "[Power Browser v2] The selected sandbox has no application UUID.",
          selectedApplication,
        );
        return;
      }

      const runtimePathPattern = /(\/api\/runtime\/)[^/]+/;

      if (!runtimePathPattern.test(targetUrl.pathname)) {
        console.warn(
          "[Power Browser v2] The Playground runtime UUID was not found in the URL.",
          { pathname: targetUrl.pathname },
        );
        return;
      }

      targetUrl.pathname = targetUrl.pathname.replace(
        runtimePathPattern,
        `$1${selectedApplication.appUuid}`,
      );
    }

    location.assign(targetUrl.href);
  }

  function configureApplicationSwitcher(
    navigator,
    applicationFamily,
    currentIdentifier,
    siteType,
  ) {
    const orderedApplications = sortApplicationFamily(applicationFamily);

    if (!orderedApplications.length) {
      return;
    }

    const currentApplication =
      orderedApplications.find(
        ({ application }) =>
          application.identifier === currentIdentifier,
      )?.application || null;

    const currentSandboxName =
      currentApplication?.name || currentIdentifier || "Unknown";
    navigator.stateToggleLabel.textContent = currentSandboxName;
    navigator.stateToggle.setAttribute(
      "aria-label",
      `Sandbox switcher. Current sandbox: ${currentSandboxName}`,
    );
    navigator.stateToggle.title = "Switch sandbox";
    navigator.stateMenu.replaceChildren();

    orderedApplications.forEach(({ application, depth }) => {
      const option = document.createElement("button");
      const isCurrent = application.identifier === currentIdentifier;
      const hasNoAccess =
        application.permissions?.isBuilder === false &&
        application.permissions?.isMember === false;
      option.type = "button";
      option.className = [
        "power-browser-state-option-v2",
        isCurrent ? "current" : "",
        hasNoAccess ? "no-access" : "",
      ]
        .filter(Boolean)
        .join(" ");
      option.style.setProperty("--power-browser-depth", depth);
      option.disabled = isCurrent || hasNoAccess;
      option.setAttribute("aria-disabled", String(isCurrent || hasNoAccess));

      if (hasNoAccess) {
        option.title = "You are not a builder or member of this application.";
      }

      const label = document.createElement("span");
      label.textContent = application.name || application.identifier;
      option.appendChild(label);

      const state = document.createElement("small");
      state.textContent =
        hasNoAccess
          ? "No access"
          : depth === 0
          ? "Production"
          : application.parent?.name || application.parent?.identifier || "";
      option.appendChild(state);

      if (!isCurrent && !hasNoAccess) {
        option.addEventListener("click", () =>
          switchApplication(currentIdentifier, application, siteType),
        );
      }

      navigator.stateMenu.appendChild(option);
    });

    navigator.stateToggle.disabled = false;
    navigator.stateToggle.classList.remove(NAV_DISABLED_CLASS);
  }

  /**
   * Keeps every route-sensitive feature aligned with SPA navigation.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function synchronizePowerBrowserRoute(navigator) {
    if (!currentPowerBrowserContext) {
      return;
    }

    const artifactData = currentPowerBrowserContext.artifactData;
    const applicationFamily =
      currentPowerBrowserContext.applicationFamily;
    const identifier =
      resolveApplicationIdentifier(artifactData) ||
      currentPowerBrowserContext.identifier;
    const siteType = detectSiteType(artifactData);
    currentPowerBrowserContext.identifier = identifier;
    currentPowerBrowserContext.siteType = siteType;

    applyFeatureFlagSettings(siteType);
    clearTimeout(betty5HighlightRetry);
    betty5HighlightRetry = setTimeout(
      applyBetty5ActionHighlighting,
      200,
    );
    remaskBetty5Passwords();
    clearTimeout(betty5PasswordRetry);
    betty5PasswordRetry = setTimeout(
      applyBetty5PasswordRevealer,
      200,
    );
    applyBetty5VariableSearch();
    applyUiBuilderMaskSetting();
    applyNextgenActionPlaygroundSetting();
    syncNextgenLogDownloader();
    configureNavigator(navigator, {
      artifactData,
      siteType,
      identifier,
      applicationFamily,
    });
    configureApplicationSwitcher(
      navigator,
      applicationFamily,
      identifier,
      siteType,
    );

    if (settingsState?.activeTab === "info") {
      renderSettingsTab(navigator);
    }
  }

  if (!document.body) {
    await new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", resolve, { once: true });
    });
  }

  // This dialog can open before artifact and application-family requests have
  // finished, so its observer must start independently of main initialization.
  applyNextgenActionPlaygroundSetting();

  const navigator = initializeNavigator();
  initializeSettings(navigator);
  initializeHoldToHideMenu(navigator);
  let artifactData = await fetchArtifact();
  const siteType = detectSiteType(artifactData);
  const applicationIdentifier = resolveApplicationIdentifier(artifactData);
  currentPowerBrowserContext = {
    artifactData,
    siteType,
    identifier: applicationIdentifier,
  };
  applyFeatureFlagSettings(siteType);
  applyBetty5Setting(
    "extraHotfix",
    getSettingValue("extraHotfix"),
  );
  applyBetty5Setting(
    "extraAdvancedMode",
    getSettingValue("extraAdvancedMode"),
  );
  applyHotfixMenuState();
  applyBetty5ActionHighlighting();
  applyBetty5PasswordRevealer();
  applyBetty5VariableSearch();
  applyUiBuilderMaskSetting();
  configureNavigator(navigator, {
    artifactData,
    siteType,
    identifier: applicationIdentifier,
  });
  configureModelSearch(navigator, artifactData, applicationIdentifier);

  const applicationFamily = await fetchApplicationFamily(applicationIdentifier);
  artifactData = await ensureArtifactFreshAfterFamilyMerge(
    artifactData,
    applicationFamily,
  );
  currentPowerBrowserContext.artifactData = artifactData;
  currentPowerBrowserContext.applicationFamily = applicationFamily;
  if (settingsState?.activeTab === "info") {
    renderSettingsTab(navigator);
  }
  configureModelSearch(
    navigator,
    artifactData,
    applicationIdentifier,
  );
  configureNavigator(navigator, {
    artifactData,
    siteType,
    identifier: applicationIdentifier,
    applicationFamily,
  });
  configureApplicationSwitcher(
    navigator,
    applicationFamily,
    applicationIdentifier,
    siteType,
  );
  subscribePowerBrowserNavigation(() =>
    synchronizePowerBrowserRoute(navigator),
  );

  // Keep this result easy to inspect and reuse while v2 is being developed.
  const powerBrowser = Object.freeze({
    get artifact() {
      return currentPowerBrowserContext?.artifactData || null;
    },
    get siteType() {
      return currentPowerBrowserContext?.siteType || SiteType.UNKNOWN;
    },
    get applicationFamily() {
      return currentPowerBrowserContext?.applicationFamily || null;
    },
    requestGraphQL,
    refreshData: () => refreshPowerBrowserData(navigator),
  });

  window.powerBrowserV2 = powerBrowser;
  console.info("[Power Browser v2] Initialized.", powerBrowser);
})();
