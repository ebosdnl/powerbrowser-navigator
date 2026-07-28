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

