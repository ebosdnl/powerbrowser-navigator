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
  const NEXTGEN_RUNTIME_BRIDGE_KEY = "__POWER_BROWSER_NEXTGEN_RUNTIME__";

  function installNextgenRuntimeBridge() {
    const bridge =
      pageWindow[NEXTGEN_RUNTIME_BRIDGE_KEY] ||
      (pageWindow[NEXTGEN_RUNTIME_BRIDGE_KEY] = {
        apolloClients: [],
        reduxStores: [],
        actionMutationHooks: [],
        suppressActionHistory: 0,
      });
    bridge.actionMutationHooks ||= [];
    bridge.suppressActionHistory ||= 0;
    bridge.apolloActionHistoryDepth ||= 0;
    const getActionMutationDetails = (mutation, variables = {}) => {
      const operation = mutation?.definitions?.find(
        (definition) => definition?.kind === "OperationDefinition",
      );
      if (operation?.operation !== "mutation") return null;
      const fieldNames = new Set(
        (operation.selectionSet?.selections || []).map(
          (selection) => selection?.name?.value,
        ),
      );
      const mutationType = fieldNames.has("createActionStep")
        ? "create"
        : fieldNames.has("updateActionStep")
          ? "update"
          : fieldNames.has("deleteActionStep")
            ? "delete"
            : null;
      return mutationType
        ? {
            mutationType,
            operationName: operation.name?.value || "",
            query: "",
            variables,
          }
        : null;
    };
    const runActionMutationHooks = async (phase, details, captures = []) =>
      Promise.all(
        (bridge.actionMutationHooks || []).map(async (hook, index) => {
          try {
            return phase === "before"
              ? await hook.before?.(details)
              : await hook.after?.(details, captures[index]);
          } catch (error) {
            console.error(
              `[Power Browser] Unable to capture action history ${phase} mutation.`,
              error,
            );
            return null;
          }
        }),
      );
    const hookApolloClient = (client) => {
      if (
        typeof client?.mutate !== "function" ||
        client.mutate.powerBrowserActionHistoryBridge
      ) {
        return;
      }
      const originalMutate = client.mutate;
      async function powerBrowserApolloMutate(options) {
        const details = getActionMutationDetails(
          options?.mutation,
          options?.variables || {},
        );
        if (
          !details ||
          bridge.suppressActionHistory > 0 ||
          !bridge.actionMutationHooks.length
        ) {
          return Reflect.apply(originalMutate, this, [options]);
        }
        const captures = await runActionMutationHooks("before", details);
        bridge.apolloActionHistoryDepth += 1;
        try {
          const result = await Reflect.apply(originalMutate, this, [options]);
          if (!result?.errors?.length) {
            await runActionMutationHooks("after", details, captures);
          }
          return result;
        } finally {
          bridge.apolloActionHistoryDepth = Math.max(
            0,
            bridge.apolloActionHistoryDepth - 1,
          );
        }
      }
      powerBrowserApolloMutate.powerBrowserActionHistoryBridge = true;
      powerBrowserApolloMutate.powerBrowserOriginal = originalMutate;
      client.mutate = powerBrowserApolloMutate;
      bridge.apolloHistoryHookCount =
        (bridge.apolloHistoryHookCount || 0) + 1;
      if (bridge.apolloHistoryHookCount === 1) {
        console.info(
          "[Power Browser] Action history Apollo mutation hook installed.",
        );
      } else {
        console.debug(
          "[Power Browser] Additional Apollo client connected to action history.",
          { clientCount: bridge.apolloHistoryHookCount },
        );
      }
    };
    const captureProviderProps = (props) => {
      const client = props?.client;
      if (
        client?.cache &&
        typeof client.refetchQueries === "function" &&
        !bridge.apolloClients.includes(client)
      ) {
        bridge.apolloClients.push(client);
      }
      hookApolloClient(client);
      const store = props?.store;
      if (
        typeof store?.dispatch === "function" &&
        typeof store?.getState === "function" &&
        !bridge.reduxStores.includes(store)
      ) {
        try {
          if ("action" in (store.getState() || {})) {
            bridge.reduxStores.push(store);
          }
        } catch {
          // Ignore provider stores that are not ready yet.
        }
      }
    };
    const hookReact = () => {
      const react = pageWindow.React;
      if (
        typeof react?.createElement !== "function" ||
        react.createElement.powerBrowserRuntimeBridge
      ) {
        return Boolean(react?.createElement?.powerBrowserRuntimeBridge);
      }
      const originalCreateElement = react.createElement;
      function powerBrowserCreateElement(type, props, ...children) {
        captureProviderProps(props);
        return Reflect.apply(originalCreateElement, this, [
          type,
          props,
          ...children,
        ]);
      }
      powerBrowserCreateElement.powerBrowserRuntimeBridge = true;
      powerBrowserCreateElement.powerBrowserOriginal = originalCreateElement;
      react.createElement = powerBrowserCreateElement;
      return true;
    };
    const hookFetch = () => {
      const currentFetch = pageWindow.fetch;
      if (
        typeof currentFetch !== "function" ||
        currentFetch.powerBrowserActionHistoryBridge
      ) {
        return;
      }
      const originalFetch = currentFetch;
      async function powerBrowserFetch(input, init) {
        const hooks = bridge.actionMutationHooks || [];
        const url =
          typeof input === "string" || input instanceof URL
            ? String(input)
            : input?.url || "";
        if (
          !hooks.length ||
          bridge.suppressActionHistory > 0 ||
          bridge.apolloActionHistoryDepth > 0 ||
          !url.includes("/api/meta/graphql")
        ) {
          return Reflect.apply(originalFetch, this, [input, init]);
        }
        let payload = null;
        try {
          const body =
            typeof init?.body === "string"
              ? init.body
              : typeof input?.clone === "function"
                ? await input.clone().text()
                : "";
          payload = body ? JSON.parse(body) : null;
        } catch {
          // Non-JSON GraphQL traffic is not part of action-step history.
        }
        const query = payload?.query || "";
        const mutationType = query.includes("createActionStep(input:")
          ? "create"
          : query.includes("updateActionStep(input:")
            ? "update"
            : query.includes("deleteActionStep(input:")
              ? "delete"
              : null;
        if (!mutationType) {
          return Reflect.apply(originalFetch, this, [input, init]);
        }
        const details = {
          mutationType,
          operationName: payload.operationName || "",
          query,
          variables: payload.variables || {},
        };
        const captures = await Promise.all(
          hooks.map(async (hook) => {
            try {
              return await hook.before?.(details);
            } catch (error) {
              console.error(
                "[Power Browser] Unable to capture action history before mutation.",
                error,
              );
              return null;
            }
          }),
        );
        const response = await Reflect.apply(originalFetch, this, [input, init]);
        let succeeded = response.ok;
        try {
          const result = await response.clone().json();
          succeeded = succeeded && !result.errors?.length;
        } catch {
          // Preserve the HTTP success result when the response is not JSON.
        }
        if (succeeded) {
          await Promise.all(
            hooks.map(async (hook, index) => {
              try {
                await hook.after?.(details, captures[index]);
              } catch (error) {
                console.error(
                  "[Power Browser] Unable to capture action history after mutation.",
                  error,
                );
              }
            }),
          );
        }
        return response;
      }
      powerBrowserFetch.powerBrowserActionHistoryBridge = true;
      powerBrowserFetch.powerBrowserOriginal = originalFetch;
      pageWindow.fetch = powerBrowserFetch;
    };
    hookFetch();
    if (hookReact()) return;
    const startedAt = Date.now();
    const timer = pageWindow.setInterval(() => {
      if (hookReact() || Date.now() - startedAt > 30000) {
        pageWindow.clearInterval(timer);
      }
    }, 10);
  }

  installNextgenRuntimeBridge();
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
  let nextgenActionTypeIconsObserver = null;
  let nextgenActionTypeIconsTimer = null;
  let nextgenActionTypeIconsRequest = 0;
  let nextgenActionTypeIconsRoute = "";
  let nextgenActionTypeIconsById = new Map();
  let nextgenDuplicateActionStepObserver = null;
  let nextgenActionHistoryObserver = null;
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

