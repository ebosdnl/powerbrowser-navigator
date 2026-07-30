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

    if (definition.key === "environmentSafetyBadge") {
      const showEnvironmentBadge = Boolean(value);
      navigator.environmentBadge.hidden = !showEnvironmentBadge;
      if (showEnvironmentBadge) {
        navigator.navigatorBar.dataset.environment =
          navigator.navigatorBar.dataset.currentEnvironment || "unknown";
      } else {
        delete navigator.navigatorBar.dataset.environment;
      }
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

  function applyEffectiveSettings(navigator) {
    SettingsDefinitions.forEach((definition) => {
      applySettingChange(
        navigator,
        definition,
        getSettingValue(definition.key),
      );
    });
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
