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
    const currentApplication =
      sortApplicationFamily(
        currentPowerBrowserContext?.applicationFamily,
      ).find(
        ({ application }) =>
          application.identifier ===
          currentPowerBrowserContext?.identifier,
      )?.application || null;
    settingsState.applicationScopeOption.textContent =
      `Settings for: ${
        currentApplication?.name ||
        currentPowerBrowserContext?.identifier ||
        "current application"
      }`;
    const editingApplication =
      GM_getValue("powerBrowserSettingsWriteScope", "global") ===
      "application";
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
        button.tabIndex = isActive ? 0 : -1;
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
      if (hasCurrentApplicationSettingOverride(definition.key)) {
        const overrideBadge = document.createElement("span");
        overrideBadge.className =
          "power-browser-settings-override-badge-v2";
        overrideBadge.textContent = "Application override";
        const clearOverride = document.createElement("button");
        clearOverride.type = "button";
        clearOverride.className =
          "power-browser-settings-use-global-v2";
        clearOverride.textContent = "Use global";
        clearOverride.title =
          "Delete this application override and inherit the global value.";
        clearOverride.addEventListener("click", () => {
          if (
            !clearCurrentApplicationSettingOverride(
              definition.key,
            )
          ) {
            return;
          }
          applySettingChange(
            navigator,
            definition,
            getSettingValue(definition.key),
          );
          renderSettingsTab(navigator);
        });
        labelRow.append(overrideBadge, clearOverride);
      } else if (editingApplication) {
        const inheritedBadge = document.createElement("span");
        inheritedBadge.className =
          "power-browser-settings-override-badge-v2 inherited";
        inheritedBadge.textContent = "Inherited from global";
        labelRow.appendChild(inheritedBadge);
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
        const selectedTheme = getPowerBrowserTheme(true);
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
            setSettingValue(definition.key, themeId);
            applySettingChange(
              navigator,
              definition,
              getSettingValue(definition.key),
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
        const selectedSize = getSettingsSize(definition.key, true);
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
            setSettingValue(definition.key, sizeId);
            applySettingChange(
              navigator,
              definition,
              getSettingValue(definition.key),
            );
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
        input.checked = Boolean(
          getEditableSettingValue(definition.key),
        );
        input.disabled = settingDisabled;
        input.setAttribute("aria-label", definition.label);
        const track = document.createElement("span");
        track.className = "power-browser-settings-toggle-track-v2";
        if (settingDisabled) {
          wrapper.title =
            "Enable Icons only to use this setting.";
        }
        input.addEventListener("change", () => {
          setSettingValue(definition.key, input.checked);
          applySettingChange(
            navigator,
            definition,
            getSettingValue(definition.key),
          );
          renderSettingsTab(navigator);
        });
        wrapper.appendChild(input);
        wrapper.appendChild(track);
        card.appendChild(wrapper);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        input.className = "power-browser-settings-shortcut-v2";
        input.value = String(
          getEditableSettingValue(definition.key) || "",
        );
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
            setSettingValue(definition.key, "");
            applySettingChange(
              navigator,
              definition,
              getSettingValue(definition.key),
            );
            renderSettingsTab(navigator);
            return;
          }

          const shortcut = formatShortcutEvent(event);
          if (!shortcut) {
            return;
          }

          input.value = shortcut;
          setSettingValue(definition.key, shortcut);
          applySettingChange(
            navigator,
            definition,
            getSettingValue(definition.key),
          );
          renderSettingsTab(navigator);
        });
        card.appendChild(input);
      }

      settingsState.list.appendChild(card);
    });
    if (tab.id === "settings") {
      renderPowerBrowserUpdateControls(navigator);
      renderSettingsDataControls(navigator);
      renderApplicationProfileManagement(navigator);
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
    dialog.setAttribute("aria-hidden", "true");
    overlay.setAttribute("aria-hidden", "true");

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
      button.addEventListener("keydown", (event) => {
        if (
          !["ArrowUp", "ArrowDown", "Home", "End"].includes(
            event.key,
          )
        ) {
          return;
        }
        event.preventDefault();
        const buttons = [
          ...tabs.querySelectorAll(
            ".power-browser-settings-tab-v2",
          ),
        ];
        const currentIndex = buttons.indexOf(button);
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (currentIndex +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                buttons.length;
        buttons[nextIndex].click();
        buttons[nextIndex].focus();
      });
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
    const scopeSelect = document.createElement("select");
    scopeSelect.className = "power-browser-settings-scope-v2";
    scopeSelect.setAttribute("aria-label", "Settings edit scope");
    let applicationScopeOption = null;
    [
      ["global", "Global settings"],
      ["application", "Settings for current application"],
    ].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      if (value === "application") {
        applicationScopeOption = option;
      }
      scopeSelect.appendChild(option);
    });
    scopeSelect.value = GM_getValue(
      "powerBrowserSettingsWriteScope",
      "global",
    );
    scopeSelect.addEventListener("change", () => {
      GM_setValue("powerBrowserSettingsWriteScope", scopeSelect.value);
      renderSettingsTab(navigator);
    });
    header.appendChild(headingWrapper);
    header.appendChild(scopeSelect);
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
      const editScope = GM_getValue(
        "powerBrowserSettingsWriteScope",
        "global",
      );
      tabDefinitions.forEach((definition) => {
        if (editScope === "application") {
          clearCurrentApplicationSettingOverride(definition.key);
        } else {
          setSettingValue(
            definition.key,
            definition.defaultValue,
          );
        }
      });
      tabDefinitions.forEach((definition) => {
        applySettingChange(
          navigator,
          definition,
          getSettingValue(definition.key),
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
      applicationScopeOption,
      scopeSelect,
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
    state.sectionsExpanded = true;
    renderSettingsTab(navigator);
    state.overlay.classList.add("open");
    state.dialog.classList.add("open");
    openPowerBrowserModal({
      dialog: state.dialog,
      overlay: state.overlay,
      close: closeSettings,
      initialFocus: () => state.tabs.querySelector(".active"),
      announcement: "Power Browser settings opened.",
    });
  }

  function toggleSettings(navigator) {
    if (settingsState?.dialog.classList.contains("open")) {
      closeSettings();
      return;
    }
    openSettings(navigator);
  }

  function closeSettings() {
    if (!settingsState?.dialog.classList.contains("open")) {
      return;
    }

    settingsState.overlay.classList.remove("open");
    settingsState.dialog.classList.remove("open");
    closePowerBrowserModal(settingsState.dialog);
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
        (_key, _oldValue, _newValue, remote) => {
          if (!remote) {
            return;
          }

          const value = getSettingValue(definition.key);
          applySettingChange(navigator, definition, value);

          if (
            settingsState?.dialog.classList.contains("open")
          ) {
            renderSettingsTab(navigator);
          }
        },
      );
    });
    globalThis.GM_addValueChangeListener(
      "powerBrowserApplicationProfiles",
      (_key, _oldValue, _newValue, remote) => {
        if (!remote) {
          return;
        }
        applyEffectiveSettings(navigator);
        if (settingsState?.dialog.classList.contains("open")) {
          renderSettingsTab(navigator);
        }
      },
    );
    globalThis.GM_addValueChangeListener(
      "powerBrowserSettingsWriteScope",
      (_key, _oldValue, newValue, remote) => {
        if (!remote || !settingsState) {
          return;
        }
        settingsState.scopeSelect.value =
          newValue === "application" ? "application" : "global";
        if (settingsState.dialog.classList.contains("open")) {
          renderSettingsTab(navigator);
        }
      },
    );
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
    button.addEventListener("click", () => toggleSettings(navigator));

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
