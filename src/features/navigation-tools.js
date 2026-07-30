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
