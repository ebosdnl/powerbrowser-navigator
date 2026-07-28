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
      applySettingChange(
        navigator,
        definition,
        definition.defaultValue,
      );
    });
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
          getSettingValue(definition.key),
        ]),
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
  function importPowerBrowserSettings(payload, navigator) {
    if (!payload || typeof payload !== "object") {
      throw new Error("The imported file must contain a JSON object.");
    }

    if (
      payload.format &&
      payload.format !== "power-browser-settings"
    ) {
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

      const valid =
        (definition.type === "toggle" &&
          typeof value === "boolean") ||
        (definition.type === "shortcut" &&
          typeof value === "string") ||
        (definition.type === "theme" &&
          ["light", "dark", "betty"].includes(value)) ||
        (definition.type === "size" &&
          SETTINGS_SIZE_VALUES.includes(value));
      if (!valid) {
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
      GM_setValue(definition.key, value);
      applySettingChange(navigator, definition, value);
    });

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
      1,
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
    fileInput.hidden = true;
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
      2,
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
