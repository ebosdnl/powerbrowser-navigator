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
    });
    GM_deleteValue("powerBrowserApplicationProfiles");
    GM_deleteValue("powerBrowserApplicationProfileNames");
    applyEffectiveSettings(navigator);
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
          getGlobalSettingValue(definition.key),
        ]),
      ),
      applicationProfiles: GM_getValue(
        "powerBrowserApplicationProfiles",
        {},
      ),
      applicationProfileNames: GM_getValue(
        "powerBrowserApplicationProfileNames",
        {},
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
  function isValidImportedSettingValue(definition, value) {
    return (
      (definition.type === "toggle" &&
        typeof value === "boolean") ||
      (definition.type === "shortcut" &&
        typeof value === "string") ||
      (definition.type === "theme" &&
        ["light", "dark", "betty"].includes(value)) ||
      (definition.type === "size" &&
        SETTINGS_SIZE_VALUES.includes(value))
    );
  }

  function importPowerBrowserSettings(payload, navigator) {
    if (!payload || typeof payload !== "object") {
      throw new Error("The imported file must contain a JSON object.");
    }

    if (payload.format === "power-browser-application-profile") {
      if (
        typeof payload.identifier !== "string" ||
        !payload.identifier ||
        !payload.settings ||
        typeof payload.settings !== "object" ||
        Array.isArray(payload.settings)
      ) {
        throw new Error("This application profile is invalid.");
      }
      const settings = {};
      let ignored = 0;
      Object.entries(payload.settings).forEach(([key, value]) => {
        const definition = getSettingDefinition(key);
        if (!definition) {
          ignored += 1;
          return;
        }
        if (!isValidImportedSettingValue(definition, value)) {
          throw new Error(
            `Setting “${definition.label}” has an invalid value.`,
          );
        }
        settings[key] = value;
      });
      if (!Object.keys(settings).length) {
        throw new Error(
          "The application profile contains no recognized settings.",
        );
      }
      GM_setValue("powerBrowserApplicationProfiles", {
        ...getApplicationProfiles(),
        [payload.identifier]: settings,
      });
      if (typeof payload.name === "string" && payload.name.trim()) {
        GM_setValue("powerBrowserApplicationProfileNames", {
          ...GM_getValue(
            "powerBrowserApplicationProfileNames",
            {},
          ),
          [payload.identifier]: payload.name.trim(),
        });
      }
      applyEffectiveSettings(navigator);
      return {
        applied: Object.keys(settings).length,
        ignored,
      };
    }

    if (payload.format && payload.format !== "power-browser-settings") {
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

      if (!isValidImportedSettingValue(definition, value)) {
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
      setSettingValue(definition.key, value);
      applySettingChange(
        navigator,
        definition,
        getSettingValue(definition.key),
      );
    });
    if (
      payload.applicationProfiles &&
      typeof payload.applicationProfiles === "object" &&
      !Array.isArray(payload.applicationProfiles)
    ) {
      GM_setValue(
        "powerBrowserApplicationProfiles",
        payload.applicationProfiles,
      );
    }
    if (
      payload.applicationProfileNames &&
      typeof payload.applicationProfileNames === "object" &&
      !Array.isArray(payload.applicationProfileNames)
    ) {
      GM_setValue(
        "powerBrowserApplicationProfileNames",
        payload.applicationProfileNames,
      );
    }
    applyEffectiveSettings(navigator);

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
      2,
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
    fileInput.className = "power-browser-settings-file-input-v2";
    fileInput.hidden = true;
    fileInput.setAttribute("aria-hidden", "true");
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

  function renderPowerBrowserUpdateControls(navigator) {
    appendSettingsSectionHeading(
      settingsState.list,
      "settings",
      "Updates",
      1,
    );
    const card = document.createElement("div");
    card.className =
      "power-browser-settings-card-v2 power-browser-settings-update-v2";
    const copy = document.createElement("div");
    copy.className = "power-browser-settings-copy-v2";
    const title = document.createElement("strong");
    const currentVersion = String(
      globalThis.GM_info?.script?.version || "unknown",
    );
    title.textContent = powerBrowserUpdateState?.available
      ? `Version ${powerBrowserUpdateState.version} is available`
      : powerBrowserUpdateState?.development
        ? `Development version ${currentVersion}`
      : `Power Browser ${currentVersion}`;
    const description = document.createElement("span");
    description.className =
      "power-browser-settings-description-v2";
    description.textContent = powerBrowserUpdateState?.checking
      ? "Checking GitHub Releases…"
      : powerBrowserUpdateState?.error
        ? powerBrowserUpdateState.error
        : powerBrowserUpdateState?.available
          ? "Published through GitHub Releases. Install it through your userscript manager."
          : powerBrowserUpdateState?.development
            ? `This build is newer than the latest public release (${powerBrowserUpdateState.version}).`
          : "You are using the latest published release.";
    copy.append(title, description);
    const actions = document.createElement("div");
    actions.className =
      "power-browser-settings-profile-actions-v2";
    if (powerBrowserUpdateState?.available) {
      const install = document.createElement("button");
      install.type = "button";
      install.textContent = "Install update";
      install.addEventListener("click", () =>
        openPowerBrowserTab(powerBrowserUpdateState.downloadUrl),
      );
      actions.appendChild(install);
    }
    if (powerBrowserUpdateState?.development) {
      const latestRelease = document.createElement("button");
      latestRelease.type = "button";
      latestRelease.textContent = "See latest release";
      latestRelease.addEventListener("click", () =>
        openPowerBrowserTab(powerBrowserUpdateState.releaseUrl),
      );
      actions.appendChild(latestRelease);
    }
    const check = document.createElement("button");
    check.type = "button";
    check.textContent = "Check now";
    check.disabled = Boolean(powerBrowserUpdateState?.checking);
    check.addEventListener("click", () => {
      void checkPowerBrowserReleaseUpdate(navigator, {
        force: true,
      });
    });
    actions.appendChild(check);
    card.append(copy, actions);
    settingsState.list.appendChild(card);
  }

  function renderApplicationProfileManagement(navigator) {
    appendSettingsSectionHeading(
      settingsState.list,
      "settings",
      "Application profiles",
      3,
    );
    const profiles = getApplicationProfiles();
    const identifiers = Object.keys(profiles).filter(
      (identifier) =>
        profiles[identifier] &&
        Object.keys(profiles[identifier]).length > 0,
    );
    if (!identifiers.length) {
      const empty = document.createElement("div");
      empty.className = "power-browser-settings-info-empty-v2";
      empty.textContent =
        "No application-specific overrides have been saved yet.";
      settingsState.list.appendChild(empty);
      return;
    }

    const knownApplications = GM_getValue(
      "powerBrowserKnownApplications",
      {},
    );
    const profileNames = GM_getValue(
      "powerBrowserApplicationProfileNames",
      {},
    );
    identifiers
      .sort((left, right) =>
        String(
          profileNames[left] ||
            knownApplications[left]?.name ||
            left,
        ).localeCompare(
          String(
            profileNames[right] ||
              knownApplications[right]?.name ||
              right,
          ),
        ),
      )
      .forEach((identifier) => {
        const card = document.createElement("div");
        card.className =
          "power-browser-settings-card-v2 power-browser-settings-profile-v2";
        const copy = document.createElement("div");
        copy.className = "power-browser-settings-copy-v2";
        const name = document.createElement("input");
        name.type = "text";
        name.className = "power-browser-settings-profile-name-v2";
        name.value =
          profileNames[identifier] ||
          knownApplications[identifier]?.name ||
          identifier;
        name.setAttribute(
          "aria-label",
          `Profile name for ${identifier}`,
        );
        const description = document.createElement("span");
        description.className =
          "power-browser-settings-description-v2";
        const overrideCount = Object.keys(
          profiles[identifier],
        ).length;
        description.textContent =
          `${identifier} · ${overrideCount} override${overrideCount === 1 ? "" : "s"}` +
          (identifier === currentPowerBrowserContext?.identifier
            ? " · Current application"
            : "");
        name.addEventListener("change", () => {
          const nextNames = {
            ...GM_getValue(
              "powerBrowserApplicationProfileNames",
              {},
            ),
          };
          const value = name.value.trim();
          if (value) {
            nextNames[identifier] = value;
          } else {
            delete nextNames[identifier];
            name.value =
              knownApplications[identifier]?.name || identifier;
          }
          GM_setValue(
            "powerBrowserApplicationProfileNames",
            nextNames,
          );
        });
        copy.append(name, description);

        const actions = document.createElement("div");
        actions.className =
          "power-browser-settings-profile-actions-v2";
        const exportButton = document.createElement("button");
        exportButton.type = "button";
        exportButton.textContent = "Export";
        exportButton.addEventListener("click", () => {
          downloadPowerBrowserTextFile(
            `power-browser-profile_${identifier}.json`,
            JSON.stringify(
              {
                format: "power-browser-application-profile",
                formatVersion: 1,
                identifier,
                name: name.value.trim() || identifier,
                settings: profiles[identifier],
              },
              null,
              2,
            ),
            "application/json;charset=utf-8",
          );
        });
        const clearButton = document.createElement("button");
        clearButton.type = "button";
        clearButton.className =
          "power-browser-settings-profile-clear-v2";
        clearButton.textContent = "Clear overrides";
        clearButton.addEventListener("click", () => {
          if (
            !window.confirm(
              `Clear all overrides for ${name.value || identifier}?`,
            )
          ) {
            return;
          }
          GM_setValue(
            "powerBrowserApplicationProfiles",
            removeApplicationProfile(
              getApplicationProfiles(),
              identifier,
            ),
          );
          const nextNames = {
            ...GM_getValue(
              "powerBrowserApplicationProfileNames",
              {},
            ),
          };
          delete nextNames[identifier];
          GM_setValue(
            "powerBrowserApplicationProfileNames",
            nextNames,
          );
          if (
            identifier === currentPowerBrowserContext?.identifier
          ) {
            applyEffectiveSettings(navigator);
          }
          renderSettingsTab(navigator);
        });
        actions.append(exportButton, clearButton);
        card.append(copy, actions);
        settingsState.list.appendChild(card);
      });
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
      4,
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
