  function getSettingDefinition(key) {
    return SettingsDefinitions.find((setting) => setting.key === key) || null;
  }

  function getGlobalSettingValue(key) {
    const definition = getSettingDefinition(key);
    return GM_getValue(key, definition?.defaultValue);
  }

  function getApplicationProfiles() {
    const profiles = GM_getValue("powerBrowserApplicationProfiles", {});
    return profiles && typeof profiles === "object" && !Array.isArray(profiles)
      ? profiles
      : {};
  }

  function getSettingValue(key) {
    const identifier = currentPowerBrowserContext?.identifier;
    return resolveEffectiveSetting(
      getGlobalSettingValue(key),
      getApplicationProfiles(),
      identifier,
      key,
    );
  }

  function getEditableSettingValue(key) {
    const identifier = currentPowerBrowserContext?.identifier;
    const scope = GM_getValue("powerBrowserSettingsWriteScope", "global");
    return resolveEditableSetting(
      scope,
      getGlobalSettingValue(key),
      getApplicationProfiles(),
      identifier,
      key,
    );
  }

  function hasCurrentApplicationSettingOverride(key) {
    return hasApplicationOverride(
      getApplicationProfiles(),
      currentPowerBrowserContext?.identifier,
      key,
    );
  }

  function setSettingValue(key, value) {
    const identifier = currentPowerBrowserContext?.identifier;
    const scope = GM_getValue("powerBrowserSettingsWriteScope", "global");
    if (scope === "application" && identifier) {
      GM_setValue(
        "powerBrowserApplicationProfiles",
        setApplicationOverride(
          getApplicationProfiles(),
          identifier,
          key,
          value,
        ),
      );
      return;
    }
    GM_setValue(key, value);
  }

  function clearCurrentApplicationSettingOverride(key) {
    const identifier = currentPowerBrowserContext?.identifier;
    if (!identifier) {
      return false;
    }
    const profiles = getApplicationProfiles();
    if (!hasApplicationOverride(profiles, identifier, key)) {
      return false;
    }
    GM_setValue(
      "powerBrowserApplicationProfiles",
      removeApplicationOverride(profiles, identifier, key),
    );
    return true;
  }

  /**
   * Returns the selected theme and migrates the former dark-mode toggle.
   *
   * @returns {"light"|"dark"|"betty"}
   */
  function getPowerBrowserTheme(editable = false) {
    const storedTheme = GM_getValue("themeMode", null);
    if (!["light", "dark", "betty"].includes(storedTheme)) {
      const legacyDarkMode = GM_getValue("themeDarkMode", null);
      if (legacyDarkMode !== null) {
        GM_setValue(
          "themeMode",
          legacyDarkMode === true ? "dark" : "light",
        );
        GM_deleteValue("themeDarkMode");
      }
    }

    const selectedTheme = editable
      ? getEditableSettingValue("themeMode")
      : getSettingValue("themeMode");
    return ["light", "dark", "betty"].includes(selectedTheme)
      ? selectedTheme
      : "light";
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

  function getSettingsSize(key, editable = false) {
    const value = editable
      ? getEditableSettingValue(key)
      : getSettingValue(key);
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
      artifactExplorerState?.dialog,
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

