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
    return normalizePowerBrowserEndpoints(endpoints);
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

  const QUICK_SWITCHER_NAVIGATION_ITEMS = Object.freeze([
    { testId: "builderbar-dashboard", title: "Dashboard", path: "/app" },
    { testId: "builderbar-modules", title: "Modules", path: "/app/modules" },
    {
      testId: "builderbar-appblueprint",
      title: "App Blueprint",
      path: "/app/app-blueprint",
    },
    { testId: "builderbar-pages", title: "Pages", path: "/app/pages" },
    { testId: "builderbar-models", title: "Models", path: "/app/models" },
    { testId: "builderbar-actions", title: "Actions", path: "/app/actions" },
    {
      testId: "builderbar-blockstore",
      title: "Block Store",
      externalDestination: "block-store",
    },
    { testId: "builderbar-logs", title: "Logs", path: "/app/logs" },
    {
      testId: "builderbar-themebuilder",
      title: "Theme Builder",
      path: "/app/theme-builder",
    },
    {
      testId: "builderbar-rolesand permissions",
      title: "Roles and permissions",
      path: "/app/roles",
    },
    {
      testId: "builderbar-configurations",
      title: "Configurations",
      path: "/app/configurations",
    },
    {
      testId: "builderbar-publicfiles",
      title: "Public files",
      path: "/app/files",
    },
    {
      testId: "builderbar-authenticationprofiles",
      title: "Authentication profiles",
      path: "/app/authentication-profiles",
    },
    {
      testId: "builderbar-translations",
      title: "Translations",
      path: "/app/translations",
    },
    {
      testId: "builderbar-applicationsettings",
      title: "Application settings",
      path: "/app/settings",
    },
  ]);

  const QUICK_SWITCHER_ACTIONS_QUERY = `query Actions($perPage: Int, $page: Int, $filter: ActionFilter, $order: [ActionOrder], $visibility: ActionVisibility) {
    actions(perPage: $perPage, page: $page, filter: $filter, order: $order, visibility: $visibility) {
      results {
        id name description
        folder { id name }
      }
      pageInfo { currentPage hasNextPage lastPage totalCount }
    }
  }`;

  const QUICK_SWITCHER_VIEW_BRIDGE_REQUEST =
    "power-browser:betty5-references:request";
  const QUICK_SWITCHER_VIEW_BRIDGE_RESPONSE =
    "power-browser:betty5-references:response";
  const QUICK_SWITCHER_VIEW_STORAGE_KEY = "powerBrowserQuickSwitcherViews";
  const QUICK_SWITCHER_VISITS_STORAGE_KEY =
    "powerBrowserQuickSwitcherVisits";
  const QUICK_SWITCHER_VISIT_LIMIT = 100;
  const QUICK_SWITCHER_FREQUENT_RESULT_LIMIT = 10;
  const QUICK_SWITCHER_VIEW_CACHE_VERSION = 2;
  const QUICK_SWITCHER_DEVELOPMENT_CACHE_TTL = 5 * 60 * 1000;
  let quickSwitcherViewBridgeInstalled = false;

  function buildQuickSwitcherNavigationEntries() {
    const renderedNavigation = new Map(
      Array.from(
        document.querySelectorAll('nav [data-testid^="builderbar-"]'),
      ).map((element) => [element.getAttribute("data-testid"), element]),
    );
    return QUICK_SWITCHER_NAVIGATION_ITEMS.map((item, order) => {
        const element = renderedNavigation.get(item.testId);
        const href = element?.getAttribute("href") || item.path || "";
        return {
          type: "navigation",
          id: item.testId,
          navigationTestId: item.testId,
          navigationPath: item.path || null,
          externalDestination: item.externalDestination || null,
          title: item.title,
          meta: element ? "Current navigation" : "Navigation",
          order,
          searchText: ["navigation", "nav", item.title, item.testId, href]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
          searchTextWithoutKind: [
            "navigation",
            "nav",
            item.title,
            item.testId,
            href,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        };
      });
  }

  function buildActionSearchEntries(actions) {
    return actions
      .filter((action) => action?.id)
      .map((action) => {
        const title = getSearchDisplayName(action, "Unnamed action");
        const folderName = action.folder?.name || "No folder";
        return {
          type: "action",
          id: String(action.id),
          title,
          meta: `${folderName} · ${action.id}`,
          searchText: [
            "action",
            action.id,
            action.name,
            action.description,
            folderName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
          searchTextWithoutKind: [
            "action",
            action.id,
            action.name,
            action.description,
            folderName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        };
      })
      .sort((left, right) =>
        left.title.localeCompare(right.title, undefined, {
          sensitivity: "base",
        }),
      );
  }

  async function fetchQuickSwitcherActions(identifier) {
    const actions = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage && page <= 100) {
      const data = await requestNextgenActionStepGraphql(
        "Actions",
        QUICK_SWITCHER_ACTIONS_QUERY,
        {
          perPage: 50,
          page,
          filter: { field: { name: { like: "" } } },
          order: [{ field: "name", direction: "ASC" }],
          visibility: "all",
        },
      );
      const connection = data?.actions;
      actions.push(...(connection?.results || []));
      hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
      page += 1;
    }

    console.info("[Power Browser] Quick switcher+ actions loaded.", {
      identifier,
      count: actions.length,
      operationName: "Actions",
    });
    return buildActionSearchEntries(actions);
  }

  function sanitizeBetty5Reference(reference) {
    if (!reference || typeof reference !== "object") {
      return null;
    }

    return {
      id: reference.id || null,
      name: reference.name || null,
      label: reference.label || null,
      form_id: Object.hasOwn(reference, "form_id")
        ? reference.form_id
        : reference.formId,
      model_id: reference.model_id || reference.modelId || null,
      section: reference.section || null,
    };
  }

  function getDirectBetty5CachedReferences() {
    const betty = pageWindow.Betty;
    const references = betty?.Cache?.references;
    if (betty?.loaded !== true || !Array.isArray(references?.models)) {
      return null;
    }

    return references.models
      .map((reference) =>
        sanitizeBetty5Reference(reference?.attributes || reference),
      )
      .filter(Boolean);
  }

  function installQuickSwitcherViewBridge() {
    if (quickSwitcherViewBridgeInstalled) {
      return;
    }
    quickSwitcherViewBridgeInstalled = true;

    const script = document.createElement("script");
    script.dataset.powerBrowserBetty5ReferenceBridge = "true";
    script.textContent = `(() => {
      if (window.__powerBrowserBetty5ReferenceBridge) return;
      window.__powerBrowserBetty5ReferenceBridge = true;
      document.addEventListener(${JSON.stringify(QUICK_SWITCHER_VIEW_BRIDGE_REQUEST)}, (event) => {
        const requestId = typeof event.detail === "string" ? event.detail : "";
        const collection = window.Betty?.Cache?.references;
        const models = window.Betty?.loaded === true && Array.isArray(collection?.models)
          ? collection.models
          : null;
        const references = models?.map((model) => {
          const reference = model?.attributes || model || {};
          return {
            id: reference.id || null,
            name: reference.name || null,
            label: reference.label || null,
            form_id: Object.prototype.hasOwnProperty.call(reference, "form_id")
              ? reference.form_id
              : reference.formId,
            model_id: reference.model_id || reference.modelId || null,
            section: reference.section || null,
          };
        }).filter((reference) => reference.id) || null;
        document.dispatchEvent(new CustomEvent(
          ${JSON.stringify(QUICK_SWITCHER_VIEW_BRIDGE_RESPONSE)},
          { detail: JSON.stringify({ requestId, references }) },
        ));
      });
    })();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  function requestBetty5CachedReferencesFromPage() {
    installQuickSwitcherViewBridge();
    const requestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve) => {
      let settled = false;
      const finish = (references) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        document.removeEventListener(
          QUICK_SWITCHER_VIEW_BRIDGE_RESPONSE,
          handleResponse,
        );
        resolve(references);
      };
      const handleResponse = (event) => {
        try {
          const payload = JSON.parse(event.detail || "{}");
          if (payload.requestId !== requestId) {
            return;
          }
          finish(
            Array.isArray(payload.references)
              ? payload.references
                  .map(sanitizeBetty5Reference)
                  .filter(Boolean)
              : null,
          );
        } catch (_error) {
          finish(null);
        }
      };
      const timeout = window.setTimeout(() => finish(null), 1000);
      document.addEventListener(
        QUICK_SWITCHER_VIEW_BRIDGE_RESPONSE,
        handleResponse,
      );
      document.dispatchEvent(
        new CustomEvent(QUICK_SWITCHER_VIEW_BRIDGE_REQUEST, {
          detail: requestId,
        }),
      );
    });
  }

  function getStoredQuickSwitcherViews(identifier, applicationFamily) {
    const stored = GM_getValue(QUICK_SWITCHER_VIEW_STORAGE_KEY, {});
    const entry = stored?.[identifier];
    if (!entry || !Array.isArray(entry.references)) {
      return null;
    }
    const policy = getQuickSwitcherViewCachePolicy(
      identifier,
      applicationFamily,
    );
    const cacheVersionMatches =
      entry.cacheVersion === QUICK_SWITCHER_VIEW_CACHE_VERSION;
    const isFresh =
      cacheVersionMatches &&
      isQuickSwitcherViewCacheFresh(
        entry,
        policy,
        Date.now(),
        QUICK_SWITCHER_DEVELOPMENT_CACHE_TTL,
      );

    return {
      references: entry.references
        .map(sanitizeBetty5Reference)
        .filter(Boolean),
      isFresh,
      policy,
    };
  }

  function storeQuickSwitcherViews(
    identifier,
    references,
    applicationFamily,
  ) {
    if (!identifier || !Array.isArray(references)) {
      return;
    }
    const policy = getQuickSwitcherViewCachePolicy(
      identifier,
      applicationFamily,
    );
    const stored = GM_getValue(QUICK_SWITCHER_VIEW_STORAGE_KEY, {});
    GM_setValue(QUICK_SWITCHER_VIEW_STORAGE_KEY, {
      ...(stored && typeof stored === "object" ? stored : {}),
      [identifier]: {
        cacheVersion: QUICK_SWITCHER_VIEW_CACHE_VERSION,
        savedAt: Date.now(),
        environmentKind: policy.kind,
        lowerMergeVersions: policy.lowerMergeVersions,
        references: references
          .map(sanitizeBetty5Reference)
          .filter(Boolean),
      },
    });
  }

  async function getBetty5CachedReferences(identifier, applicationFamily) {
    const directReferences = getDirectBetty5CachedReferences();
    if (directReferences) {
      storeQuickSwitcherViews(
        identifier,
        directReferences,
        applicationFamily,
      );
      return {
        references: directReferences,
        source: "Betty.Cache.references",
        needsRefresh: false,
      };
    }

    const bridgedReferences = await requestBetty5CachedReferencesFromPage();
    if (bridgedReferences) {
      storeQuickSwitcherViews(
        identifier,
        bridgedReferences,
        applicationFamily,
      );
      return {
        references: bridgedReferences,
        source: "Betty page-context bridge",
        needsRefresh: false,
      };
    }

    const storedCache = getStoredQuickSwitcherViews(
      identifier,
      applicationFamily,
    );
    return storedCache
      ? {
          references: storedCache.references,
          source: "application view cache",
          needsRefresh: !storedCache.isFresh,
          policy: storedCache.policy,
        }
      : null;
  }

  function mergeQuickSwitcherViewReferences(
    identifier,
    references,
    applicationFamily,
  ) {
    const storedCache = getStoredQuickSwitcherViews(
      identifier,
      applicationFamily,
    );
    const merged = new Map(
      (storedCache?.isFresh ? storedCache.references : []).map(
        (reference) => [String(reference.id), reference],
      ),
    );
    references.forEach((reference) => {
      const normalized = sanitizeBetty5Reference(reference);
      if (normalized?.id) {
        merged.set(String(normalized.id), normalized);
      }
    });
    const result = [...merged.values()];
    storeQuickSwitcherViews(identifier, result, applicationFamily);
    return result;
  }

  async function syncNativeBetty5ViewResults(state, query) {
    const normalizedQuery = query.trim().replace(/^view\s+/i, "");
    if (
      !normalizedQuery ||
      !state?.identifier ||
      !state.dialog.classList.contains("open") ||
      !document.querySelector('[data-nav="search"]')
    ) {
      return;
    }

    const sequence = (state.nativeViewSearchSequence || 0) + 1;
    state.nativeViewSearchSequence = sequence;
    document.documentElement.dataset.powerBrowserNativeSearchProxy = "true";
    let searchbox = document.querySelector("#searchbox");
    if (!searchbox) {
      state.nativeSearchOpenedByQuickSwitcher = true;
      document.querySelector('[data-nav="search"]')?.click();
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      searchbox = document.querySelector("#searchbox");
    }
    if (!searchbox || sequence !== state.nativeViewSearchSequence) {
      return;
    }

    searchbox.dataset.powerBrowserQuickSwitcherProxy = "true";
    searchbox.setAttribute("aria-hidden", "true");
    const nativeInput = searchbox.querySelector("input");
    if (!nativeInput) {
      return;
    }

    nativeInput.value = normalizedQuery;
    nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    if (
      sequence !== state.nativeViewSearchSequence ||
      state.input.value.trim() !== query.trim()
    ) {
      return;
    }

    const references = Array.from(
      searchbox.querySelectorAll('li[data-kind="reference"][data-id]'),
    ).map((row) => ({
      id: row.dataset.id,
      name: row.textContent.trim(),
      form_id: null,
      model_id: null,
      section: "Betty 5",
    }));
    if (references.length) {
      const mergedReferences = mergeQuickSwitcherViewReferences(
        state.identifier,
        references,
        state.applicationFamily,
      );
      state.viewEntries = buildBetty5ViewSearchEntries(
        mergedReferences,
        state.artifactData,
      );
      state.viewsLoaded = true;
      refreshQuickSwitcherEntries();
      renderModelSearchResults();
      console.info(
        "[Power Browser] Quick switcher+ model views loaded from Betty's native search.",
        {
          identifier: state.identifier,
          query: normalizedQuery,
          count: references.length,
        },
      );
    }
    state.input.focus({ preventScroll: true });
  }

  function closeNativeBetty5SearchProxy(state) {
    if (!state) {
      return;
    }
    document.documentElement.removeAttribute(
      "data-power-browser-native-search-proxy",
    );
    state.nativeViewSearchSequence =
      (state.nativeViewSearchSequence || 0) + 1;
    const searchbox = document.querySelector(
      '#searchbox[data-power-browser-quick-switcher-proxy="true"]',
    );
    if (!searchbox) {
      state.nativeSearchOpenedByQuickSwitcher = false;
      return;
    }

    if (state.nativeSearchOpenedByQuickSwitcher) {
      searchbox.querySelector(".close-popup")?.click();
    } else {
      searchbox.removeAttribute("data-power-browser-quick-switcher-proxy");
      searchbox.removeAttribute("aria-hidden");
    }
    state.nativeSearchOpenedByQuickSwitcher = false;
  }

  function requestBetty5ReferencesWithUserscript(url, headers) {
    if (typeof globalThis.GM_xmlhttpRequest !== "function") {
      throw new Error("No authenticated request method is available.");
    }

    return new Promise((resolve, reject) => {
      globalThis.GM_xmlhttpRequest({
        method: "GET",
        url,
        headers,
        timeout: 10000,
        anonymous: false,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(
              new Error(`Betty 5 returned status ${response.status}.`),
            );
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch (_error) {
            reject(new Error("Betty 5 returned invalid reference data."));
          }
        },
        onerror: () =>
          reject(new Error("The Betty 5 reference request failed.")),
        ontimeout: () =>
          reject(new Error("The Betty 5 reference request timed out.")),
      });
    });
  }

  async function requestBetty5References(identifier) {
    const editorOrigin = `https://${identifier}.${getEnvironmentPrefix()}bettyblocks.com`;
    const url = `${editorOrigin}/api/v2/bootstrap/references`;
    const csrfToken =
      pageWindow.Betty?.CSRF ||
      getCsrfToken() ||
      getNextgenLogCsrfToken();
    const headers = {
      Accept: "application/json",
      "application-identifier": identifier,
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...(getBearerToken()
        ? { Authorization: `Bearer ${getBearerToken()}` }
        : {}),
    };

    if (
      location.origin === editorOrigin &&
      typeof pageWindow.fetch === "function"
    ) {
      try {
        const response = await pageWindow.fetch(url, {
          method: "GET",
          credentials: "include",
          headers,
        });
        if (!response.ok) {
          throw new Error(`Betty 5 returned status ${response.status}.`);
        }
        return response.json();
      } catch (error) {
        if (typeof globalThis.GM_xmlhttpRequest !== "function") {
          throw error;
        }
        console.debug(
          "[Power Browser] Betty 5 page request failed; retrying through the userscript request API.",
          error,
        );
      }
    }

    return requestBetty5ReferencesWithUserscript(url, headers);
  }

  function normalizeBetty5References(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload?.references)) {
      return payload.references;
    }
    if (Array.isArray(payload?.data?.references)) {
      return payload.data.references;
    }
    if (Array.isArray(payload?.data)) {
      return payload.data;
    }
    return [];
  }

  function buildBetty5ViewSearchEntries(references, artifactData) {
    const models = normalizeArtifactCollection(artifactData?.models);
    const modelsById = new Map(
      models
        .filter((model) => model?.id)
        .map((model) => [String(model.id), model]),
    );

    return references
      .filter((reference) => {
        const formId = Object.hasOwn(reference || {}, "form_id")
          ? reference.form_id
          : reference?.formId;
        return (
          reference?.id &&
          formId === null &&
          (reference.name || reference.label)
        );
      })
      .map((reference) => {
        const id = String(reference.id);
        const modelId = reference.model_id
          ? String(reference.model_id)
          : null;
        const model = modelId ? modelsById.get(modelId) : null;
        const modelName = getSearchDisplayName(model, modelId || "");
        const title = getSearchDisplayName(
          reference,
          "Unnamed model view",
        );
        const section = reference.section || "Back office";
        return {
          type: "view",
          id,
          modelId,
          title,
          meta: [section, modelName, id].filter(Boolean).join(" · "),
          searchText: [
            "view",
            "model view",
            "back office",
            id,
            title,
            section,
            modelId,
            modelName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
          searchTextWithoutKind: [
            id,
            title,
            section,
            modelId,
            modelName,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        };
      })
      .sort((left, right) =>
        left.title.localeCompare(right.title, undefined, {
          sensitivity: "base",
        }),
      );
  }

  async function fetchQuickSwitcherViews(
    identifier,
    artifactData,
    applicationFamily,
  ) {
    const cachedResult = await getBetty5CachedReferences(
      identifier,
      applicationFamily,
    );
    const nativeSearchAvailable = Boolean(
      document.querySelector('[data-nav="search"]'),
    );
    let payload = cachedResult?.references || null;
    let source = cachedResult?.source || null;

    if (!cachedResult || cachedResult.needsRefresh) {
      if (!nativeSearchAvailable && getBearerToken()) {
        try {
          payload = await requestBetty5References(identifier);
          source = "/api/v2/bootstrap/references";
        } catch (error) {
          if (!cachedResult) {
            throw error;
          }
          console.warn(
            "[Power Browser] Quick switcher+ could not refresh its stale model-view cache; retaining cached views.",
            { identifier, error },
          );
        }
      } else {
        console.info(
          nativeSearchAvailable
            ? "[Power Browser] Quick switcher+ will refresh model views through Betty's native search."
            : "[Power Browser] Quick switcher+ is retaining cached model views until an authenticated refresh is available.",
          {
            identifier,
            cachePolicy:
              cachedResult?.policy?.kind ||
              getQuickSwitcherViewCachePolicy(identifier, applicationFamily)
                .kind,
          },
        );
      }
    }

    if (!payload) {
      return [];
    }
    const references = normalizeBetty5References(payload);
    if (source === "/api/v2/bootstrap/references") {
      storeQuickSwitcherViews(identifier, references, applicationFamily);
    }
    const entries = buildBetty5ViewSearchEntries(
      references,
      artifactData,
    );
    console.info("[Power Browser] Quick switcher+ model views loaded.", {
      identifier,
      count: entries.length,
      source,
      cachePolicy: getQuickSwitcherViewCachePolicy(
        identifier,
        applicationFamily,
      ).kind,
    });
    return entries;
  }

  function buildModelSearchEntries(artifactData) {
    const models = normalizeArtifactCollection(artifactData?.models);
    const properties = normalizeArtifactCollection(artifactData?.properties);
    const pages = normalizeArtifactCollection(artifactData?.pages);
    const modelsById = new Map(
      models
        .filter((model) => model?.id)
        .map((model) => [String(model.id), model]),
    );
    const entries = [];

    pages.forEach((page) => {
      if (!page?.id || !page?.endpointId) {
        return;
      }

      const title = page.title || getSearchDisplayName(page, "Unnamed page");
      const pageName = page.name && page.name !== title ? page.name : null;
      entries.push({
        type: "page",
        id: String(page.id),
        endpointId: String(page.endpointId),
        title,
        meta: [pageName, page.endpointId].filter(Boolean).join(" · "),
        searchText: [
          "page",
          page.id,
          page.endpointId,
          page.name,
          page.title,
          page.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        searchTextWithoutKind: [
          "page",
          page.id,
          page.endpointId,
          page.name,
          page.title,
          page.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      });
    });

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
    const resultPreferences = normalizeQuickSwitcherResultPreferences(
      getSettingValue("runtimeSearchResultTypes"),
    );
    const enabledTypes = new Set(
      resultPreferences
        .filter((preference) => preference.enabled)
        .map((preference) => preference.id),
    );
    const typePriorities = new Map(
      resultPreferences.map((preference, index) => [preference.id, index]),
    );
    const availableEntries = entries.filter((entry) =>
      enabledTypes.has(entry.type),
    );

    if (!normalizedQuery) {
      const visits = getQuickSwitcherVisits();
      return availableEntries
        .filter((entry) => entry.type !== "navigation")
        .map((entry) => ({
          entry,
          visit: getQuickSwitcherVisit(entry, visits),
        }))
        .filter(({ visit }) => visit)
        .sort(
          (left, right) =>
            right.visit.count - left.visit.count ||
            right.visit.lastVisited - left.visit.lastVisited ||
            (typePriorities.get(left.entry.type) ?? Number.MAX_SAFE_INTEGER) -
              (typePriorities.get(right.entry.type) ?? Number.MAX_SAFE_INTEGER) ||
            left.entry.title.localeCompare(right.entry.title, undefined, {
              sensitivity: "base",
          }),
        )
        .slice(0, Math.min(limit, QUICK_SWITCHER_FREQUENT_RESULT_LIMIT))
        .map(({ entry, visit }) => ({
          ...entry,
          quickSwitcherFrequent: true,
          quickSwitcherVisitCount: visit.count,
        }));
    }

    const terms = normalizedQuery.split(/\s+/).filter(Boolean);

    return availableEntries
      .filter((entry) =>
        terms.every((term) => entry.searchText.includes(term)),
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
          (typePriorities.get(left.entry.type) ?? Number.MAX_SAFE_INTEGER) -
            (typePriorities.get(right.entry.type) ?? Number.MAX_SAFE_INTEGER) ||
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
    dialog.setAttribute("aria-label", "Quick switcher+");
    dialog.setAttribute("aria-hidden", "true");
    overlay.setAttribute("aria-hidden", "true");

    const header = document.createElement("div");
    header.className = "power-browser-model-search-header-v2";
    header.innerHTML = SvgIcons.search;

    const input = document.createElement("input");
    input.type = "search";
    input.className = "power-browser-model-search-input-v2";
    input.placeholder =
      "Search navigation, pages, actions, views, models, properties or IDs…";
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
      baseEntries: [],
      actionEntries: [],
      actionsLoaded: false,
      viewEntries: [],
      viewsLoaded: false,
      artifactData: null,
      applicationFamily: null,
      nativeViewSearchSequence: 0,
      nativeSearchOpenedByQuickSwitcher: false,
      filteredEntries: [],
      activeIndex: -1,
      identifier: null,
      observedVisitUrl: null,
      currentVisitRecorded: false,
      lastFocusedElement: null,
    };
    subscribePowerBrowserNavigation(() =>
      recordCurrentQuickSwitcherVisit(),
    );
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
      modelSearchDebounce = setTimeout(() => {
        renderModelSearchResults();
        void syncNativeBetty5ViewResults(
          modelSearchState,
          modelSearchState.input.value,
        );
      }, 80);
    });

    return modelSearchState;
  }

  function getQuickSwitcherDestinationUrl(entry) {
    if (!modelSearchState?.identifier || !entry) {
      return null;
    }

    const environmentPrefix = getEnvironmentPrefix();
    const editorOrigin = `https://${modelSearchState.identifier}.${environmentPrefix}bettyblocks.com`;
    if (entry.type === "navigation") {
      if (entry.externalDestination === "block-store") {
        return `https://my.bettyblocks.com/block-store?appId=${encodeURIComponent(modelSearchState.identifier)}`;
      }
      return entry.navigationPath
        ? `${editorOrigin}${entry.navigationPath}`
        : null;
    }
    if (entry.type === "page" && entry.endpointId) {
      return `${editorOrigin}/app/page-builder/${entry.endpointId}`;
    }
    if (entry.type === "action" && entry.id) {
      return `${editorOrigin}/app/actions/${entry.id}`;
    }
    if (entry.type === "view" && entry.id) {
      return `${editorOrigin}/#${entry.id}`;
    }
    if (!entry.modelId) {
      return null;
    }
    const propertyPath =
      entry.type === "property" || entry.type === "relation"
        ? `/properties/${entry.id}`
        : "";
    return `${editorOrigin}/app/models/${entry.modelId}${propertyPath}`;
  }

  function getQuickSwitcherVisits() {
    if (!modelSearchState?.identifier) {
      return {};
    }

    const stored = GM_getValue(QUICK_SWITCHER_VISITS_STORAGE_KEY, {});
    const visits = stored?.[modelSearchState.identifier];
    return visits && typeof visits === "object" ? visits : {};
  }

  function getQuickSwitcherVisit(entry, visits = getQuickSwitcherVisits()) {
    const url = normalizeUrlWithoutQuery(
      getQuickSwitcherDestinationUrl(entry),
    );
    if (!url) {
      return null;
    }

    const visit = visits[url];
    return visit &&
      Number.isFinite(visit.count) &&
      Number.isFinite(visit.lastVisited)
      ? visit
      : null;
  }

  function recordQuickSwitcherVisit(entry) {
    if (!modelSearchState?.identifier) {
      return;
    }

    const url = normalizeUrlWithoutQuery(
      getQuickSwitcherDestinationUrl(entry),
    );
    if (!url) {
      return;
    }

    const stored = GM_getValue(QUICK_SWITCHER_VISITS_STORAGE_KEY, {});
    const visits = stored?.[modelSearchState.identifier];
    const currentVisits =
      visits && typeof visits === "object" ? visits : {};
    const currentVisit = currentVisits[url];
    const nextVisits = {
      ...currentVisits,
      [url]: {
        count:
          (Number.isFinite(currentVisit?.count) ? currentVisit.count : 0) + 1,
        lastVisited: Date.now(),
      },
    };
    const limitedVisits = Object.fromEntries(
      Object.entries(nextVisits)
        .sort(
          ([, left], [, right]) =>
            right.lastVisited - left.lastVisited,
        )
        .slice(0, QUICK_SWITCHER_VISIT_LIMIT),
    );

    GM_setValue(QUICK_SWITCHER_VISITS_STORAGE_KEY, {
      ...(stored && typeof stored === "object" ? stored : {}),
      [modelSearchState.identifier]: limitedVisits,
    });
  }

  function recordCurrentQuickSwitcherVisit() {
    if (!modelSearchState?.identifier) {
      return;
    }

    const currentUrl = normalizeUrlWithoutQuery(location.href);
    if (modelSearchState.observedVisitUrl !== currentUrl) {
      modelSearchState.observedVisitUrl = currentUrl;
      modelSearchState.currentVisitRecorded = false;
    }
    if (modelSearchState.currentVisitRecorded) {
      return;
    }

    const enabledTypes = new Set(
      normalizeQuickSwitcherResultPreferences(
        getSettingValue("runtimeSearchResultTypes"),
      )
        .filter((preference) => preference.enabled)
        .map((preference) => preference.id),
    );
    const matchingEntry = modelSearchState.entries.find(
      (entry) =>
        entry.type !== "navigation" &&
        enabledTypes.has(entry.type) &&
        normalizeUrlWithoutQuery(getQuickSwitcherDestinationUrl(entry)) ===
          currentUrl,
    );
    if (!matchingEntry) {
      return;
    }

    recordQuickSwitcherVisit(matchingEntry);
    modelSearchState.currentVisitRecorded = true;
  }

  function getModelBackofficeUrl(entry) {
    if (
      !modelSearchState?.identifier ||
      !entry?.modelId ||
      entry.type === "view"
    ) {
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
   * Opens a Power Browser destination in a related tab.
   *
   * @param {string} url
   * @param {boolean} active
   * @returns {unknown}
   */
  function openPowerBrowserTab(url, active = true) {
    if (typeof globalThis.GM_openInTab === "function") {
      return globalThis.GM_openInTab(url, {
        active,
        insert: true,
        setParent: true,
      });
    }

    return window.open(url, "_blank", "noopener");
  }

  function openModelSearchEntry(
    entry,
    { newTab = false, active = true } = {},
  ) {
    const url = getQuickSwitcherDestinationUrl(entry);
    if (!url) {
      return;
    }

    closeModelSearch();
    if (newTab) {
      openPowerBrowserTab(url, active);
      return;
    }

    if (
      entry?.type === "view" &&
      new URL(url).origin === location.origin &&
      typeof pageWindow.Backbone?.history?.navigate === "function"
    ) {
      pageWindow.Backbone.history.navigate(entry.id, true);
      return;
    }

    if (entry?.type === "navigation" && entry.navigationTestId) {
      window.requestAnimationFrame(() => {
        const target = Array.from(
          document.querySelectorAll('nav [data-testid^="builderbar-"]'),
        ).find(
          (element) =>
            element.getAttribute("data-testid") === entry.navigationTestId,
        );
        if (target) {
          target.click();
          return;
        }
        location.assign(url);
      });
      return;
    }
    location.assign(url);
  }

  function refreshQuickSwitcherEntries() {
    if (!modelSearchState) {
      return;
    }
    modelSearchState.entries = [
      ...buildQuickSwitcherNavigationEntries(),
      ...modelSearchState.baseEntries,
      ...modelSearchState.actionEntries,
      ...modelSearchState.viewEntries,
    ];
    recordCurrentQuickSwitcherVisit();
  }

  async function loadQuickSwitcherViews(
    state,
    identifier,
    artifactData,
  ) {
    const cachePolicy = getQuickSwitcherViewCachePolicy(
      identifier,
      state.applicationFamily,
    );
    const storedCache = getStoredQuickSwitcherViews(
      identifier,
      state.applicationFamily,
    );
    const forceRefresh = storedCache?.isFresh === false;
    const requestKey = `${location.origin}:${identifier}:${cachePolicy.cacheKey}`;
    state.viewRequestKey = requestKey;

    try {
      const entries = await getCachedPowerBrowserData(
        quickSwitcherViewRequestCache,
        requestKey,
        () =>
          fetchQuickSwitcherViews(
            identifier,
            artifactData,
            state.applicationFamily,
          ),
        forceRefresh,
      );
      if (modelSearchState !== state || state.viewRequestKey !== requestKey) {
        return;
      }
      state.viewEntries = entries;
      state.viewsLoaded = true;
      refreshQuickSwitcherEntries();
      if (state.dialog.classList.contains("open")) {
        renderModelSearchResults();
      }
    } catch (error) {
      state.viewsLoaded = false;
      console.warn(
        `[Power Browser] Quick switcher+ could not load model views: ${error instanceof Error ? error.message : String(error)}`,
        { identifier, error },
      );
    }
  }

  async function loadQuickSwitcherActions(state, identifier) {
    if (currentPowerBrowserContext?.siteType !== SiteType.NEXTGEN) {
      return;
    }
    const requestKey = `${location.origin}:${identifier}`;
    state.actionRequestKey = requestKey;

    try {
      const entries = await getCachedPowerBrowserData(
        quickSwitcherActionRequestCache,
        requestKey,
        () => fetchQuickSwitcherActions(identifier),
      );
      if (modelSearchState !== state || state.actionRequestKey !== requestKey) {
        return;
      }
      state.actionEntries = entries;
      state.actionsLoaded = true;
      refreshQuickSwitcherEntries();
      if (state.dialog.classList.contains("open")) {
        renderModelSearchResults();
      }
    } catch (error) {
      state.actionsLoaded = false;
      console.warn(
        `[Power Browser] Quick switcher+ could not load actions: ${error instanceof Error ? error.message : String(error)}`,
        {
        identifier,
        operationName: "Actions",
        error,
        },
      );
    }
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
      const query = modelSearchState.input.value.trim();
      empty.textContent = query
        ? `No Quick switcher+ results found for “${query}”.`
        : "No frequently opened destinations yet.";
      modelSearchState.results.appendChild(empty);
      return;
    }

    matches.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = "power-browser-model-search-result-row-v2";

      const result = document.createElement("div");
      result.className = `power-browser-model-search-result-v2${index === 0 ? " active" : ""}`;
      result.setAttribute("role", "option");
      result.tabIndex = -1;
      result.setAttribute("aria-selected", String(index === 0));

      const chip = document.createElement("span");
      chip.className = `power-browser-model-search-chip-v2 ${entry.type}`;
      const typeLabels = {
        navigation: "Navigation",
        page: "Page",
        action: "Action",
        view: "View",
        relation: "Relation",
        property: "Property",
        model: "Model",
      };
      chip.textContent = typeLabels[entry.type] || "Item";

      const copy = document.createElement("span");
      copy.className = "power-browser-model-search-copy-v2";

      const title = document.createElement("span");
      title.className = "power-browser-model-search-title-v2";
      title.textContent = entry.title;

      const meta = document.createElement("span");
      meta.className = "power-browser-model-search-meta-v2";
      meta.textContent = entry.quickSwitcherFrequent
        ? `Frequently visited ${entry.quickSwitcherVisitCount} ${entry.quickSwitcherVisitCount === 1 ? "time" : "times"} · ${entry.meta}`
        : entry.meta;

      const open = document.createElement("button");
      open.type = "button";
      open.className = "power-browser-model-search-open-v2";
      open.textContent =
        entry.type === "navigation"
          ? "Open"
          : entry.type === "view"
            ? "Open view"
            : "Open IDE";
      open.setAttribute(
        "aria-label",
        `Open ${entry.title} in a new foreground tab`,
      );

      copy.appendChild(title);
      copy.appendChild(meta);
      result.appendChild(chip);
      result.appendChild(copy);
      result.appendChild(open);
      row.addEventListener("mouseenter", () => {
        setActiveModelSearchResult(index);
      });
      result.addEventListener("click", (event) =>
        openModelSearchEntry(
          entry,
          event.ctrlKey || event.metaKey
            ? { newTab: true, active: false }
            : { newTab: false },
        ),
      );
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openModelSearchEntry(entry, { newTab: true, active: true });
      });

      const backofficeUrl = getModelBackofficeUrl(entry);
      row.appendChild(result);
      if (backofficeUrl) {
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
        backofficeButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openPowerBrowserTab(backofficeUrl);
        });
        row.appendChild(backofficeButton);
      }
      modelSearchState.results.appendChild(row);
    });
  }

  function openModelSearch() {
    if (!modelSearchState) {
      return;
    }

    closeSettings();
    refreshQuickSwitcherEntries();
    if (!modelSearchState.entries.length) {
      return;
    }
    modelSearchState.input.value = "";
    if (!modelSearchState.actionsLoaded && modelSearchState.identifier) {
      void loadQuickSwitcherActions(
        modelSearchState,
        modelSearchState.identifier,
      );
    }
    const storedViewCache = modelSearchState.identifier
      ? getStoredQuickSwitcherViews(
          modelSearchState.identifier,
          modelSearchState.applicationFamily,
        )
      : null;
    if (
      modelSearchState.identifier &&
      (!modelSearchState.viewsLoaded || storedViewCache?.isFresh === false)
    ) {
      void loadQuickSwitcherViews(
        modelSearchState,
        modelSearchState.identifier,
        modelSearchState.artifactData,
      );
    }
    modelSearchState.shortcut.textContent = getModelSearchShortcut();
    modelSearchState.overlay.classList.add("open");
    modelSearchState.dialog.classList.add("open");
    renderModelSearchResults();
    openPowerBrowserModal({
      dialog: modelSearchState.dialog,
      overlay: modelSearchState.overlay,
      close: closeModelSearch,
      initialFocus: modelSearchState.input,
      announcement: "Quick switcher+ opened.",
    });
  }

  function closeModelSearch() {
    if (!modelSearchState?.dialog.classList.contains("open")) {
      return;
    }

    modelSearchState.overlay.classList.remove("open");
    modelSearchState.dialog.classList.remove("open");
    closeNativeBetty5SearchProxy(modelSearchState);
    closePowerBrowserModal(modelSearchState.dialog);
  }

  function toggleModelSearch() {
    if (modelSearchState?.dialog.classList.contains("open")) {
      closeModelSearch();
    } else {
      openModelSearch();
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

  function configureModelSearch(
    navigator,
    artifactData,
    identifier,
    applicationFamily = null,
  ) {
    const button = navigator.controls.get("buttonRuntimeModelSearch");
    const entries = buildModelSearchEntries(artifactData);

    if (!button || !identifier) {
      button?.classList.add("power-browser-hidden-v2");
      return;
    }

    const state = ensureModelSearchDialog();
    if (state.identifier !== identifier) {
      state.actionEntries = [];
      state.actionsLoaded = false;
      state.viewEntries = [];
      state.viewsLoaded = false;
      state.observedVisitUrl = null;
      state.currentVisitRecorded = false;
    }
    state.baseEntries = entries;
    state.artifactData = artifactData;
    state.applicationFamily = applicationFamily;
    state.identifier = identifier;
    refreshQuickSwitcherEntries();
    button.classList.remove("power-browser-hidden-v2", NAV_DISABLED_CLASS);
    button.disabled = false;
    button.setAttribute("aria-disabled", "false");
    button.title = `Quick switcher+ (${getModelSearchShortcut()})`;
    void loadQuickSwitcherActions(state, identifier);
    void loadQuickSwitcherViews(state, identifier, artifactData);

    if (!button.dataset.powerBrowserListener) {
      button.dataset.powerBrowserListener = "true";
      button.addEventListener("click", toggleModelSearch);
    }

    if (!document.documentElement.dataset.powerBrowserModelSearchShortcut) {
      document.documentElement.dataset.powerBrowserModelSearchShortcut = "true";
      document.addEventListener("keydown", handleModelSearchKeydown);
    }
  }

  /**
   * Populate the standard shortcuts while retaining the original bar order.
   */
