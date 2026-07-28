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
