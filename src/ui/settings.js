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
  function appendSettingsSectionHeading(
    container,
    tabId,
    sectionName,
    index,
  ) {
    const section = document.createElement("h3");
    section.className = "power-browser-settings-section-v2";
    section.textContent = sectionName;
    section.dataset.settingsSection = sectionName;
    section.id =
      `power-browser-settings-section-${tabId}-${index}`;
    container.appendChild(section);
  }

  /**
   * Creates a read-only information card.
   *
   * @param {string} title
   * @param {Array<[string, unknown]>} entries
   * @param {string} [status]
   * @returns {HTMLElement}
   */
  function createSettingsInfoCard(title, entries, status = "") {
    const card = document.createElement("div");
    card.className =
      "power-browser-settings-card-v2 power-browser-settings-info-card-v2";
    const heading = document.createElement("div");
    heading.className = "power-browser-settings-info-title-v2";
    const headingText = document.createElement("span");
    headingText.textContent = title;
    heading.appendChild(headingText);
    if (status) {
      const badge = document.createElement("span");
      badge.className =
        "power-browser-settings-info-status-v2";
      badge.textContent = status;
      heading.appendChild(badge);
    }

    const grid = document.createElement("dl");
    grid.className = "power-browser-settings-info-grid-v2";
    entries.forEach(([label, rawValue]) => {
      const item = document.createElement("div");
      item.className = "power-browser-settings-info-item-v2";
      const term = document.createElement("dt");
      term.textContent = label;
      const valueRow = document.createElement("div");
      valueRow.className =
        "power-browser-settings-info-value-v2";
      const value = document.createElement("dd");
      const hasValue =
        rawValue !== null &&
        rawValue !== undefined &&
        rawValue !== "";
      const displayValue = hasValue
        ? String(rawValue)
        : "Unavailable";
      value.textContent = displayValue;
      valueRow.appendChild(value);
      if (hasValue) {
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className =
          "power-browser-settings-copy-value-v2";
        copyButton.textContent = "Copy";
        copyButton.setAttribute(
          "aria-label",
          `Copy ${label}`,
        );
        copyButton.addEventListener("click", () => {
          GM_setClipboard(String(rawValue));
          copyButton.textContent = "Copied";
          setTimeout(() => {
            if (copyButton.isConnected) {
              copyButton.textContent = "Copy";
            }
          }, 1400);
        });
        valueRow.appendChild(copyButton);
      }
      item.appendChild(term);
      item.appendChild(valueRow);
      grid.appendChild(item);
    });
    card.appendChild(heading);
    card.appendChild(grid);
    return card;
  }

  /**
   * Formats a timestamp without failing on incomplete family data.
   *
   * @param {string|null|undefined} value
   * @returns {string}
   */
  function formatSettingsInfoDate(value) {
    if (!value) {
      return "Never";
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleString();
  }

  /**
   * Returns bearer availability, expiry and application-match diagnostics.
   *
   * @returns {{status: string, message: string, details: object}}
   */
  function getBearerDiagnostic() {
    const token = getBearerToken();
    if (!token) {
      return {
        status: "warning",
        message: "No runtime bearer is available.",
        details: {
          available: false,
        },
      };
    }

    try {
      const payload = decodeActionPlaygroundJwt(token);
      const expiresAt = payload.exp
        ? new Date(Number(payload.exp) * 1000)
        : null;
      const expired =
        expiresAt && expiresAt.getTime() <= Date.now();
      const currentApplicationId = String(
        getApplicationId(
          currentPowerBrowserContext?.artifactData,
          currentPowerBrowserContext?.applicationFamily,
          currentPowerBrowserContext?.identifier,
        ) || "",
      );
      const applicationMatches =
        !currentApplicationId ||
        String(payload.app_uuid || "") === currentApplicationId;
      const status =
        expired || !applicationMatches ? "error" : "success";
      const parts = [
        expired
          ? `Expired ${expiresAt.toLocaleString()}`
          : expiresAt
            ? `Expires ${expiresAt.toLocaleString()}`
            : "No expiry claim",
        applicationMatches
          ? "application UUID matches"
          : "application UUID does not match",
      ];
      return {
        status,
        message: parts.join("; "),
        details: {
          available: true,
          expiresAt: expiresAt?.toISOString() || null,
          expired: Boolean(expired),
          appUuid: payload.app_uuid || null,
          currentApplicationId: currentApplicationId || null,
          applicationMatches,
        },
      };
    } catch (error) {
      return {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to inspect the runtime bearer.",
        details: {
          available: true,
          validJwt: false,
        },
      };
    }
  }

  /**
   * Creates a compact diagnostic status card.
   *
   * @param {string} title
   * @param {{status?: string, message?: string, updatedAt?: string|null}} diagnostic
   * @returns {HTMLElement}
   */
  function createSettingsDiagnosticCard(title, diagnostic) {
    const card = document.createElement("div");
    card.className = "power-browser-settings-diagnostic-v2";
    card.dataset.status = diagnostic.status || "idle";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const message = document.createElement("span");
    message.textContent = diagnostic.message || "No status available.";
    card.appendChild(heading);
    card.appendChild(message);
    if (diagnostic.updatedAt) {
      const updated = document.createElement("span");
      updated.textContent =
        `Updated ${formatSettingsInfoDate(diagnostic.updatedAt)}`;
      card.appendChild(updated);
    }
    return card;
  }

  /**
   * Builds a token-free diagnostic snapshot suitable for support requests.
   *
   * @returns {object}
   */
  function buildPowerBrowserDiagnosticSummary() {
    const context = currentPowerBrowserContext;
    const bearer = getBearerDiagnostic();
    const applicationFamily = Array.isArray(context?.applicationFamily)
      ? context.applicationFamily
      : context?.applicationFamily
        ? [context.applicationFamily]
        : [];

    return {
      generatedAt: new Date().toISOString(),
      scriptVersion:
        globalThis.GM_info?.script?.version || null,
      page: {
        origin: location.origin,
        pathname: location.pathname,
        siteType: context?.siteType || SiteType.UNKNOWN,
      },
      application: {
        identifier: context?.identifier || null,
        applicationId:
          getApplicationId(
            context?.artifactData,
            context?.applicationFamily,
            context?.identifier,
          ) || null,
        familySize: applicationFamily.length,
      },
      dataSources: JSON.parse(
        JSON.stringify(powerBrowserDiagnostics),
      ),
      csrfAvailable: Boolean(
        getCsrfToken() || getNextgenLogCsrfToken(),
      ),
      bearer: bearer.details,
    };
  }

  /**
   * Bypasses caches and reloads artifact and application-family data.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {Promise<void>}
   */
  async function refreshPowerBrowserData(navigator) {
    actionSettingsRequestCache.clear();
    let artifactData = await fetchArtifact(true);
    const identifier = resolveApplicationIdentifier(artifactData);
    const siteType = detectSiteType(artifactData);
    const applicationFamily =
      await fetchApplicationFamily(identifier, true);
    artifactData = await ensureArtifactFreshAfterFamilyMerge(
      artifactData,
      applicationFamily,
    );

    currentPowerBrowserContext = {
      artifactData,
      siteType,
      identifier,
      applicationFamily,
    };
    configureNavigator(navigator, {
      artifactData,
      siteType,
      identifier,
      applicationFamily,
    });
    configureApplicationSwitcher(
      navigator,
      applicationFamily,
      identifier,
      siteType,
    );
    configureModelSearch(navigator, artifactData, identifier);
    if (
      powerBrowserDiagnostics.artifact.status === "error" ||
      powerBrowserDiagnostics.applicationFamily.status === "error"
    ) {
      throw new Error(
        "Refresh completed, but one or more data sources failed.",
      );
    }
  }

  /**
   * Renders health checks and data-management actions on Info.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function renderSettingsDiagnostics(navigator) {
    appendSettingsSectionHeading(
      settingsState.list,
      "info",
      "Diagnostics",
      3,
    );
    const diagnostics = document.createElement("div");
    diagnostics.className =
      "power-browser-settings-diagnostics-v2";
    const csrfAvailable = Boolean(
      getCsrfToken() || getNextgenLogCsrfToken(),
    );
    [
      ["Artifact", powerBrowserDiagnostics.artifact],
      [
        "Application family",
        powerBrowserDiagnostics.applicationFamily,
      ],
      ["GraphQL", powerBrowserDiagnostics.graphql],
      [
        "Action settings",
        powerBrowserDiagnostics.actionSettings,
      ],
      [
        "CSRF token",
        {
          status: csrfAvailable ? "success" : "warning",
          message: csrfAvailable
            ? "A CSRF token is available."
            : "No CSRF token is currently available.",
        },
      ],
      ["Runtime bearer", getBearerDiagnostic()],
    ].forEach(([title, diagnostic]) => {
      diagnostics.appendChild(
        createSettingsDiagnosticCard(title, diagnostic),
      );
    });
    if (powerBrowserDiagnostics.lastError) {
      diagnostics.appendChild(
        createSettingsDiagnosticCard("Last request error", {
          status: "error",
          message: `${powerBrowserDiagnostics.lastError.source}: ${powerBrowserDiagnostics.lastError.message}`,
          updatedAt: powerBrowserDiagnostics.lastError.updatedAt,
        }),
      );
    }
    settingsState.list.appendChild(diagnostics);

    const actions = document.createElement("div");
    actions.className = "power-browser-settings-actions-v2";
    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "power-browser-settings-action-v2";
    refreshButton.textContent = "Refresh data";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "power-browser-settings-action-v2";
    copyButton.textContent = "Copy diagnostics";
    const status = document.createElement("span");
    status.className =
      "power-browser-settings-operation-status-v2";
    if (settingsState.infoOperationStatus) {
      status.dataset.status =
        settingsState.infoOperationStatus.status;
      status.textContent =
        settingsState.infoOperationStatus.message;
    }
    refreshButton.disabled =
      settingsState.infoOperationStatus?.status === "loading";
    refreshButton.addEventListener("click", async () => {
      settingsState.infoOperationStatus = {
        status: "loading",
        message: "Refreshing data…",
      };
      refreshButton.disabled = true;
      status.dataset.status = "loading";
      status.textContent = "Refreshing data…";
      try {
        await refreshPowerBrowserData(navigator);
        settingsState.infoOperationStatus = {
          status: "success",
          message: "Data refreshed.",
        };
        status.dataset.status = "success";
        status.textContent = "Data refreshed.";
        renderSettingsTab(navigator);
      } catch (error) {
        settingsState.infoOperationStatus = {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to refresh data.",
        };
        status.dataset.status = "error";
        status.textContent =
          settingsState.infoOperationStatus.message;
        refreshButton.disabled = false;
      }
    });
    copyButton.addEventListener("click", () => {
      GM_setClipboard(
        JSON.stringify(
          buildPowerBrowserDiagnosticSummary(),
          null,
          2,
        ),
      );
      settingsState.infoOperationStatus = {
        status: "success",
        message: "Diagnostics copied.",
      };
      status.dataset.status = "success";
      status.textContent = "Diagnostics copied.";
    });
    actions.append(refreshButton, copyButton, status);
    settingsState.list.appendChild(actions);
  }

  /**
   * Renders application-family and artifact information.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function renderSettingsInfoTab(navigator) {
    const context = currentPowerBrowserContext;
    const artifactData = context?.artifactData || null;
    const identifier =
      context?.identifier ||
      resolveApplicationIdentifier(artifactData);
    const applications = sortApplicationFamily(
      context?.applicationFamily,
    );
    const currentApplication =
      applications.find(
        ({ application }) =>
          application.identifier === identifier,
      )?.application || null;

    appendSettingsSectionHeading(
      settingsState.list,
      "info",
      "Current application",
      0,
    );
    settingsState.list.appendChild(
      createSettingsInfoCard(
        currentApplication?.name || identifier || "Current application",
        [
          ["Identifier", identifier],
          [
            "Application UUID",
            getApplicationId(
              artifactData,
              context?.applicationFamily,
              identifier,
            ),
          ],
          ["Application ID", currentApplication?.id],
          ["Site type", context?.siteType || SiteType.UNKNOWN],
          [
            "Environment",
            currentApplication
              ? currentApplication.parentId ||
                currentApplication.parent
                ? currentApplication.isBranch
                  ? "Branch"
                  : "Sandbox"
                : "Production"
              : "Unavailable",
          ],
          [
            "Organization",
            currentApplication?.organization
              ? `${currentApplication.organization.name} (${currentApplication.organization.id})`
              : null,
          ],
          [
            "Application zone",
            currentApplication?.applicationZone
              ? `${currentApplication.applicationZone.label} (${currentApplication.applicationZone.name})`
              : null,
          ],
          ["Application URL", currentApplication?.url || location.origin],
        ],
        "Current",
      ),
    );

    appendSettingsSectionHeading(
      settingsState.list,
      "info",
      "Sandboxes",
      1,
    );
    if (!applications.length) {
      const empty = document.createElement("div");
      empty.className = "power-browser-settings-info-empty-v2";
      empty.textContent =
        "Application-family information is unavailable. Sign in to My Betty Blocks and reload the page.";
      settingsState.list.appendChild(empty);
    } else {
      applications.forEach(({ application, depth }) => {
        const permissions = application.permissions || {};
        const access = permissions.isBuilder
          ? "Builder"
          : permissions.isMember
            ? "Member"
            : "No access";
        const environment =
          application.parentId || application.parent
            ? application.isBranch
              ? "Branch"
              : "Sandbox"
            : "Production";
        settingsState.list.appendChild(
          createSettingsInfoCard(
            `${depth ? `${"↳ ".repeat(depth)}` : ""}${application.name || application.identifier}`,
            [
              ["Identifier", application.identifier],
              ["Application UUID", application.appUuid],
              ["Environment", environment],
              ["Parent", application.parent?.name || "None"],
              [
                "Application zone",
                application.applicationZone
                  ? `${application.applicationZone.label} (${application.applicationZone.name})`
                  : null,
              ],
              ["Access", access],
              [
                "Last merge to parent",
                formatSettingsInfoDate(
                  application.lastMerge?.insertedAt,
                ),
              ],
              ["Application URL", application.url],
            ],
            application.identifier === identifier ? "Current" : "",
          ),
        );
      });
    }

    appendSettingsSectionHeading(
      settingsState.list,
      "info",
      "Artifact",
      2,
    );
    if (!artifactData) {
      const empty = document.createElement("div");
      empty.className = "power-browser-settings-info-empty-v2";
      empty.textContent =
        "No artifact was retrieved for this application.";
      settingsState.list.appendChild(empty);
    } else {
      const currentEndpoint = getCurrentEndpoint(artifactData);
      settingsState.list.appendChild(
        createSettingsInfoCard("Runtime artifact", [
          ["Artifact URL", resolveArtifactUrl()],
          [
            "Application identifier",
            artifactData.applicationIdentifier ||
              artifactData.appIdentifier ||
              identifier,
          ],
          [
            "Application UUID",
            artifactData.applicationId || artifactData.appId,
          ],
          [
            "Models",
            normalizeArtifactCollection(artifactData.models).length,
          ],
          [
            "Properties",
            normalizeArtifactCollection(artifactData.properties).length,
          ],
          ["Endpoints", normalizeEndpoints(artifactData.endpoints).length],
          [
            "Current endpoint",
            currentEndpoint?.name ||
              currentEndpoint?.label ||
              currentEndpoint?.url ||
              "None",
          ],
        ]),
      );
    }

    renderSettingsDiagnostics(navigator);
  }

  /**
   * Deletes every stored setting override and reapplies current defaults.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
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
  function getSettingsTabSections(tabId) {
    if (tabId === "info") {
      return [
        "Current application",
        "Sandboxes",
        "Artifact",
        "Diagnostics",
      ];
    }

    if (tabId === "settings") {
      return ["Appearance", "Data", "Danger zone"];
    }

    return [
      ...new Set(
        SettingsDefinitions.filter(
          (definition) => definition.tab === tabId,
        )
          .map((definition) => definition.section)
          .filter(Boolean),
      ),
    ];
  }

  /**
   * Updates the visual state of all subsection shortcuts.
   *
   * @returns {void}
   */
  function updateSettingsSectionLinkState() {
    if (!settingsState) {
      return;
    }

    settingsState.tabs
      .querySelectorAll(".power-browser-settings-section-link-v2")
      .forEach((button) => {
        button.classList.toggle(
          "active",
          button.dataset.tab === settingsState.activeTab &&
            button.dataset.section === settingsState.activeSection,
        );
      });
  }

  /**
   * Updates the highlighted subsection to match the content scroll position.
   *
   * @returns {void}
   */
  function updateVisibleSettingsSection() {
    if (!settingsState) {
      return;
    }

    const headings = Array.from(
      settingsState.list.querySelectorAll("[data-settings-section]"),
    );
    if (!headings.length) {
      settingsState.activeSection = "";
      updateSettingsSectionLinkState();
      return;
    }

    const contentTop =
      settingsState.content.getBoundingClientRect().top + 20;
    let visibleHeading = headings[0];
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top <= contentTop) {
        visibleHeading = heading;
      }
    });

    const atBottom =
      settingsState.content.scrollHeight -
        settingsState.content.scrollTop -
        settingsState.content.clientHeight <
      4;
    if (atBottom) {
      visibleHeading = headings.at(-1);
    }

    settingsState.activeSection =
      visibleHeading.dataset.settingsSection || "";
    updateSettingsSectionLinkState();
  }

  /**
   * Switches tabs when needed and scrolls to a settings subsection.
   *
   * @param {string} tabId
   * @param {string} sectionName
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function navigateToSettingsSection(tabId, sectionName, navigator) {
    if (!settingsState) {
      return;
    }

    if (settingsState.activeTab !== tabId) {
      settingsState.activeTab = tabId;
      settingsState.sectionsExpanded = true;
      GM_setValue("powerBrowserSettingsActiveTab", tabId);
      renderSettingsTab(navigator);
    }

    settingsState.activeSection = sectionName;
    updateSettingsSectionLinkState();
    window.requestAnimationFrame(() => {
      Array.from(
        settingsState.list.querySelectorAll("[data-settings-section]"),
      )
        .find(
          (heading) =>
            heading.dataset.settingsSection === sectionName,
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    });
  }

  /**
   * Renders shortcuts for the active tab, or every tab when configured.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function renderSettingsSectionNavigation(navigator) {
    if (!settingsState) {
      return;
    }

    settingsState.tabs
      .querySelectorAll(".power-browser-settings-section-links-v2")
      .forEach((navigation) => navigation.remove());

    const alwaysShowSections = Boolean(
      getSettingValue("settingsSectionsExpandedByDefault"),
    );
    settingsState.tabs
      .querySelectorAll(".power-browser-settings-tab-v2")
      .forEach((tabButton) => {
        const tabId = tabButton.dataset.tab;
        const sections = getSettingsTabSections(tabId);
        const shouldShow =
          sections.length > 0 &&
          (alwaysShowSections ||
            (tabId === settingsState.activeTab &&
              settingsState.sectionsExpanded));

        if (!shouldShow) {
          return;
        }

        const navigation = document.createElement("div");
        navigation.className =
          "power-browser-settings-section-links-v2";
        navigation.setAttribute(
          "aria-label",
          `${tabButton.textContent} sections`,
        );
        sections.forEach((sectionName) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className =
            "power-browser-settings-section-link-v2";
          button.dataset.tab = tabId;
          button.dataset.section = sectionName;
          button.textContent = sectionName;
          button.addEventListener("click", () =>
            navigateToSettingsSection(
              tabId,
              sectionName,
              navigator,
            ),
          );
          navigation.appendChild(button);
        });
        tabButton.after(navigation);
      });

    updateSettingsSectionLinkState();
  }

  /**
   * Scrolls to and briefly highlights a setting selected through search.
   *
   * @param {string} settingKey
   * @returns {void}
   */
  function flashSettingsDefinition(settingKey) {
    window.requestAnimationFrame(() => {
      const card = Array.from(
        settingsState.list.querySelectorAll("[data-setting-key]"),
      ).find(
        (candidate) =>
          candidate.dataset.settingKey === settingKey,
      );
      if (!card) {
        return;
      }

      card.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setTimeout(() => {
        if (!card.isConnected) {
          return;
        }

        card.classList.remove("setting-flash");
        void card.offsetWidth;
        card.classList.add("setting-flash");
        setTimeout(() => {
          card.classList.remove("setting-flash");
        }, 1700);
      }, 140);
    });
  }

  /**
   * Renders matching settings from every tab.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @param {string} query
   * @returns {void}
   */
  function renderSettingsSearchResults(navigator, query) {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = SettingsDefinitions.filter((definition) => {
      const tabLabel =
        SettingsTabs.find(({ id }) => id === definition.tab)
          ?.label || definition.tab;
      return [
        definition.label,
        definition.description,
        definition.section,
        definition.badge,
        tabLabel,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(normalizedQuery),
        );
    });

    settingsState.heading.textContent = "Search settings";
    settingsState.description.textContent =
      `${matches.length} result${matches.length === 1 ? "" : "s"} across all settings tabs.`;
    settingsState.reset.hidden = true;

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "power-browser-settings-info-empty-v2";
      empty.textContent =
        `No settings match “${query.trim()}”.`;
      settingsState.list.appendChild(empty);
      return;
    }

    matches.forEach((definition) => {
      const tab =
        SettingsTabs.find(({ id }) => id === definition.tab);
      const result = document.createElement("button");
      result.type = "button";
      result.className =
        "power-browser-settings-card-v2 power-browser-settings-search-result-v2";
      const copy = document.createElement("div");
      copy.className = "power-browser-settings-copy-v2";
      const labelRow = document.createElement("div");
      labelRow.className =
        "power-browser-settings-label-row-v2";
      const label = document.createElement("strong");
      label.textContent = definition.label;
      const locationBadge = document.createElement("span");
      locationBadge.className =
        "power-browser-settings-info-status-v2";
      locationBadge.textContent = [
        tab?.label || definition.tab,
        definition.section,
      ]
        .filter(Boolean)
        .join(" · ");
      const description = document.createElement("span");
      description.className =
        "power-browser-settings-description-v2";
      description.textContent = definition.description;
      labelRow.append(label, locationBadge);
      copy.append(labelRow, description);
      result.appendChild(copy);
      result.addEventListener("click", () => {
        settingsState.searchQuery = "";
        settingsState.searchInput.value = "";
        settingsState.activeTab = definition.tab;
        settingsState.activeSection =
          definition.section || "";
        settingsState.sectionsExpanded = true;
        GM_setValue(
          "powerBrowserSettingsActiveTab",
          definition.tab,
        );
        renderSettingsTab(navigator);
        updateSettingsSectionLinkState();
        flashSettingsDefinition(definition.key);
      });
      settingsState.list.appendChild(result);
    });
  }

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
      copy.appendChild(labelRow);
      copy.appendChild(description);
      card.appendChild(copy);

      if (definition.type === "theme") {
        const picker = document.createElement("div");
        picker.className =
          "power-browser-settings-theme-picker-v2";
        picker.setAttribute("role", "radiogroup");
        picker.setAttribute("aria-label", definition.label);
        const selectedTheme = getPowerBrowserTheme();
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
            GM_setValue(definition.key, themeId);
            applySettingChange(
              navigator,
              definition,
              themeId,
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
        const selectedSize = getSettingsSize(definition.key);
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
            GM_setValue(definition.key, sizeId);
            applySettingChange(navigator, definition, sizeId);
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
        input.checked = Boolean(getSettingValue(definition.key));
        input.disabled = settingDisabled;
        input.setAttribute("aria-label", definition.label);
        const track = document.createElement("span");
        track.className = "power-browser-settings-toggle-track-v2";
        if (settingDisabled) {
          wrapper.title =
            "Enable Icons only to use this setting.";
        }
        input.addEventListener("change", () => {
          GM_setValue(definition.key, input.checked);
          applySettingChange(
            navigator,
            definition,
            input.checked,
          );
        });
        wrapper.appendChild(input);
        wrapper.appendChild(track);
        card.appendChild(wrapper);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        input.className = "power-browser-settings-shortcut-v2";
        input.value = String(getSettingValue(definition.key) || "");
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
            GM_setValue(definition.key, "");
            applySettingChange(navigator, definition, "");
            return;
          }

          const shortcut = formatShortcutEvent(event);
          if (!shortcut) {
            return;
          }

          input.value = shortcut;
          GM_setValue(definition.key, shortcut);
          applySettingChange(navigator, definition, shortcut);
        });
        card.appendChild(input);
      }

      settingsState.list.appendChild(card);
    });
    if (tab.id === "settings") {
      renderSettingsDataControls(navigator);
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
    header.appendChild(headingWrapper);
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
      tabDefinitions.forEach((definition) => {
        GM_setValue(definition.key, definition.defaultValue);
      });
      tabDefinitions.forEach((definition) => {
        applySettingChange(
          navigator,
          definition,
          definition.defaultValue,
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
    state.lastFocusedElement = document.activeElement;
    state.sectionsExpanded = true;
    renderSettingsTab(navigator);
    state.overlay.classList.add("open");
    state.dialog.classList.add("open");
    state.tabs.querySelector(".active")?.focus();
  }

  function closeSettings() {
    if (!settingsState?.dialog.classList.contains("open")) {
      return;
    }

    settingsState.overlay.classList.remove("open");
    settingsState.dialog.classList.remove("open");
    settingsState.lastFocusedElement?.focus?.();
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
        (_key, _oldValue, newValue, remote) => {
          if (!remote) {
            return;
          }

          const value =
            newValue === undefined
              ? definition.defaultValue
              : newValue;
          applySettingChange(navigator, definition, value);

          if (
            settingsState?.dialog.classList.contains("open")
          ) {
            renderSettingsTab(navigator);
          }
        },
      );
    });
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
    button.addEventListener("click", () => openSettings(navigator));

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
