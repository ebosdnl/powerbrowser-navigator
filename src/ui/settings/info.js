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

    updateCurrentPowerBrowserContext({
      artifactData,
      siteType,
      identifier,
      applicationFamily,
    });
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
