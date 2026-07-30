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

  const {
    auditArtifact,
    buildArtifactSearchEntries,
    createApplicationContext,
    createArtifactSnapshot,
    createAuthStateMachine,
    createDiagnosticTimeline,
    createFeatureRegistry,
    createLogger,
    csvCell: powerBrowserCsvCell,
    diffArtifactSnapshots,
    getArtifactRelationships,
    hasApplicationOverride,
    isAuthenticationError: isPowerBrowserAuthenticationError,
    isVersionNewer,
    normalizeEndpoints: normalizePowerBrowserEndpoints,
    removeApplicationOverride,
    removeApplicationProfile,
    resolveEditableSetting,
    resolveEffectiveSetting,
    searchArtifactEntries,
    selectors: PowerBrowserSelectors,
    setApplicationOverride,
  } = globalThis.PowerBrowserCore;
  const logger = createLogger("runtime");
  const diagnosticTimeline = createDiagnosticTimeline();
  const applicationAuthState = createAuthStateMachine({
    onTransition(snapshot) {
      diagnosticTimeline.add({
        source: "authentication",
        status: snapshot.status,
        message: snapshot.message,
      });
      if (activePowerBrowserNavigator) {
        renderApplicationSwitcherStatus(
          activePowerBrowserNavigator,
          snapshot,
        );
      }
      if (
        settingsState?.activeTab === "info" &&
        settingsState.dialog.classList.contains("open") &&
        settingsState.navigator
      ) {
        renderSettingsTab(settingsState.navigator);
      }
    },
  });

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
  let commandPaletteState = null;
  let artifactExplorerState = null;
  let powerBrowserUpdateState = null;
  let settingsSectionScrollFrame = null;
  let currentPowerBrowserContext = null;
  let activePowerBrowserNavigator = null;
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
  let nextgenActionClipboardSequence = 0;
  let nextgenActionClipboardFocusAttached = false;
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
    health: {
      status: "success",
      message: "No extension health issues detected.",
      updatedAt: null,
    },
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
  const powerBrowserHealthIssues = [];

  function reportPowerBrowserHealthIssue(source, message, error) {
    const issue = {
      source,
      message,
      updatedAt: new Date().toISOString(),
    };
    powerBrowserHealthIssues.push(issue);
    powerBrowserHealthIssues.splice(
      0,
      Math.max(0, powerBrowserHealthIssues.length - 25),
    );
    powerBrowserDiagnostics.health = {
      status: "error",
      message: `${powerBrowserHealthIssues.length} extension health issue${powerBrowserHealthIssues.length === 1 ? "" : "s"} detected.`,
      updatedAt: issue.updatedAt,
    };
    diagnosticTimeline.add({
      source: `health:${source}`,
      status: "error",
      message,
      details: error
        ? {
            error: error instanceof Error ? error.message : String(error),
          }
        : undefined,
    });
    logger.warn(`[${source}] ${message}`, error);
  }

  function updateApplicationSwitcherStatus(status, message) {
    applicationAuthState.transition(status, message);
  }

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
    diagnosticTimeline.add({
      source,
      status,
      message,
      ...(error
        ? {
            details: {
              error:
                error instanceof Error ? error.message : String(error),
            },
          }
        : {}),
    });
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

