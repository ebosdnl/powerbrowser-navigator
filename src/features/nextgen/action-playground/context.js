  function isNextgenActionPage() {
    return (
      location.pathname === "/app/actions" ||
      location.pathname.includes("/app/actions/")
    );
  }

  /**
   * Locates the active "Enter test values" dialog and verifies its complete
   * Playground signature. Radix reuses dialog containers, so the title, tabs,
   * selected tab, active panel and Mutation field must all match. Actions
   * without inputs do not render a Variables field.
   *
   * @returns {{dialog: Element, panel: Element}|null}
   */
  function getActiveActionPlaygroundDialog() {
    if (!isNextgenActionPage()) {
      return null;
    }

    const dialogs = Array.from(
      document.querySelectorAll(
        PowerBrowserSelectors.actionPlaygroundDialog,
      ),
    );

    for (const dialog of dialogs) {
      const title = dialog.querySelector("h2");
      if (title?.textContent.trim() !== "Enter test values") {
        continue;
      }

      const tabs = Array.from(
        dialog.querySelectorAll(PowerBrowserSelectors.actionPlaygroundTab),
      );
      const tabNames = new Set(
        tabs.map((tab) => tab.textContent.trim()),
      );
      if (
        !["Basic", "Advanced", "Playground"].every((name) =>
          tabNames.has(name),
        )
      ) {
        continue;
      }

      const playgroundTab = tabs.find(
        (tab) =>
          tab.textContent.trim() === "Playground",
      );
      const logsTab = tabs.find((tab) =>
        tab.hasAttribute(
          "data-power-browser-action-logs-tab-v350",
        ),
      );
      const playgroundOrLogsActive =
        (playgroundTab?.getAttribute("aria-selected") === "true" &&
          playgroundTab.dataset.state === "active") ||
        (logsTab?.getAttribute("aria-selected") === "true" &&
          logsTab.dataset.state === "active");
      if (!playgroundOrLogsActive) {
        continue;
      }
      const panelId = playgroundTab?.getAttribute("aria-controls");
      const panel = Array.from(
        dialog.querySelectorAll(PowerBrowserSelectors.actionPlaygroundPanel),
      ).find(
        (candidate) =>
          candidate.id === panelId &&
          (logsTab?.dataset.state === "active" ||
            (candidate.dataset.state === "active" &&
              !candidate.hidden)),
      );
      if (!panel) {
        continue;
      }

      const fieldNames = new Set(
        Array.from(panel.querySelectorAll("label")).map((label) =>
          label.textContent.trim(),
        ),
      );
      if (
        !fieldNames.has("Mutation") ||
        panel.querySelectorAll("textarea").length < 1
      ) {
        continue;
      }

      return { dialog, panel };
    }

    return null;
  }

  /**
   * Checks whether the current action is marked as public by Betty Blocks.
   *
   * @returns {boolean}
   */
  function isCurrentActionPublic() {
    return Boolean(
      document.querySelector(
        PowerBrowserSelectors.actionPlaygroundPublicIcon,
      ),
    );
  }

  /**
   * Creates the editable JSON shown in the injected Headers field.
   *
   * @returns {string}
   */
  function getActionPlaygroundHeadersJson() {
    if (isCurrentActionPublic()) {
      return JSON.stringify({}, null, 2);
    }

    const token = getBearerToken();
    const authorization = token
      ? token.toLowerCase().startsWith("bearer ")
        ? token
        : `Bearer ${token}`
      : "Bearer ";

    return JSON.stringify(
      {
        Authorization: authorization,
      },
      null,
      2,
    );
  }

  /**
   * Extracts an Authorization value from a case-insensitive headers object.
   *
   * @param {Record<string, unknown>} headers
   * @returns {string}
   */
  function getAuthorizationHeader(headers) {
    const entry = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === "authorization",
    );
    return entry?.[1] == null ? "" : String(entry[1]).trim();
  }

  /**
   * Accepts clipboard contents only when they are a JSON headers object with
   * a Bearer value containing a decodable JWT.
   *
   * @param {string} clipboardText
   * @returns {string|null}
   */
  function getValidClipboardHeadersJson(clipboardText) {
    try {
      const headers = JSON.parse(String(clipboardText || "").trim());
      if (
        !headers ||
        Array.isArray(headers) ||
        typeof headers !== "object"
      ) {
        return null;
      }

      const authorization = getAuthorizationHeader(headers);
      if (!/^Bearer\s+\S+$/i.test(authorization)) {
        return null;
      }
      decodeActionPlaygroundJwt(authorization);
      return JSON.stringify(headers, null, 2);
    } catch {
      return null;
    }
  }

  /**
   * Reads a valid JSON Bearer object from the clipboard into the Headers field.
   * Clipboard permission failures are intentionally silent.
   *
   * @param {Element} dialog
   * @param {Element} panel
   * @param {boolean} [force]
   * @returns {Promise<void>}
   */
  async function autoPasteActionPlaygroundHeaders(
    dialog,
    panel,
    force = false,
  ) {
    const textarea = getActionPlaygroundTextarea(panel, "Headers");
    if (
      !textarea ||
      textarea.dataset.powerBrowserHeadersUserEditedV350 === "true" ||
      (!force &&
        textarea.dataset.powerBrowserClipboardAppliedV350 ===
          "true") ||
      (!force &&
        textarea.dataset.powerBrowserClipboardCheckedV350 ===
          "true") ||
      typeof window.navigator.clipboard?.readText !== "function"
    ) {
      return;
    }

    if (force) {
      delete textarea.dataset.powerBrowserClipboardCheckedV350;
    }
    textarea.dataset.powerBrowserClipboardCheckedV350 = "true";
    const sequence = ++nextgenActionClipboardSequence;
    try {
      const clipboardHeaders = getValidClipboardHeadersJson(
        await window.navigator.clipboard.readText(),
      );
      if (
        !clipboardHeaders ||
        sequence !== nextgenActionClipboardSequence ||
        !dialog.isConnected ||
        !panel.contains(textarea)
      ) {
        return;
      }

      textarea.value = clipboardHeaders;
      textarea.dataset.powerBrowserClipboardAppliedV350 = "true";
      delete textarea.dataset.authorizationValidatedValue;
      textarea.dispatchEvent(
        new Event("input", { bubbles: true }),
      );
    } catch {
      delete textarea.dataset.powerBrowserClipboardCheckedV350;
      // Reading the clipboard can be denied when the browser requires a
      // user gesture. The editable field remains available for manual paste.
    }
  }

  /**
   * Returns the action identifier from the current Next-gen route.
   *
   * @returns {string|null}
   */
  function getCurrentActionId() {
    return (
      location.pathname.match(/\/app\/actions\/([^/?#]+)/i)?.[1] ||
      null
    );
  }

  /**
   * Decodes a JWT payload without attempting to verify its signature.
   *
   * @param {string} authorization
   * @returns {Record<string, unknown>}
   */
  function decodeActionPlaygroundJwt(authorization) {
    const token = authorization
      .replace(/^Bearer\s+/i, "")
      .trim();
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Authorization does not contain a valid JWT.");
    }

    try {
      const base64 = parts[1]
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
      const binary = window.atob(base64);
      const bytes = Uint8Array.from(
        binary,
        (character) => character.charCodeAt(0),
      );
      const payload = JSON.parse(
        new window.TextDecoder().decode(bytes),
      );

      if (!payload || typeof payload !== "object") {
        throw new Error("JWT payload is not an object.");
      }

      return payload;
    } catch (error) {
      throw new Error("Unable to decode the Authorization JWT.", {
        cause: error,
      });
    }
  }

  /**
   * Finds a textarea by its field label inside the active Playground panel.
   *
   * @param {Element} panel
   * @param {string} fieldName
   * @returns {HTMLTextAreaElement|null}
   */
  function getActionPlaygroundTextarea(panel, fieldName) {
    const label = Array.from(panel.querySelectorAll("label")).find(
      (candidate) => candidate.textContent.trim() === fieldName,
    );
    return label?.parentElement?.querySelector("textarea") || null;
  }

  /**
   * Resolves the current application's runtime request context.
   *
   * @returns {Promise<{url: string, identifier: string, applicationId: string}>}
   */
  async function getActionPlaygroundRuntimeContext() {
    let artifactData =
      currentPowerBrowserContext?.artifactData || (await fetchArtifact());
    const identifier =
      currentPowerBrowserContext?.identifier ||
      resolveApplicationIdentifier(artifactData);
    let applicationFamily =
      currentPowerBrowserContext?.applicationFamily || null;
    artifactData = await ensureArtifactFreshAfterFamilyMerge(
      artifactData,
      applicationFamily,
    );
    updateCurrentPowerBrowserContext({ artifactData });
    let applicationId = getApplicationId(
      artifactData,
      applicationFamily,
      identifier,
    );

    if (!applicationId && identifier) {
      applicationFamily = await fetchApplicationFamily(identifier);
      artifactData = await ensureArtifactFreshAfterFamilyMerge(
        artifactData,
        applicationFamily,
      );
      updateCurrentPowerBrowserContext({
        applicationFamily,
        artifactData,
      });
      applicationId = getApplicationId(
        artifactData,
        applicationFamily,
        identifier,
      );
    }

    if (!identifier || !applicationId) {
      throw new Error(
        "The application identifier or runtime UUID is unavailable.",
      );
    }

    const environmentPrefix = getEnvironmentPrefix();
    return {
      url: `https://${identifier}.${environmentPrefix}betty.app/api/runtime/${applicationId}`,
      identifier,
      applicationId: String(applicationId),
    };
  }

  /**
   * Returns the applications belonging to the current application family.
   *
   * @param {string} identifier
   * @returns {Promise<object[]>}
   */
  async function getActionPlaygroundApplicationFamily(identifier) {
    let applicationFamily =
      currentPowerBrowserContext?.applicationFamily || null;

    if (!applicationFamily && identifier) {
      applicationFamily = await fetchApplicationFamily(identifier);
      updateCurrentPowerBrowserContext({ applicationFamily });
    }

    if (!applicationFamily) {
      return [];
    }

    const artifactData = await ensureArtifactFreshAfterFamilyMerge(
      currentPowerBrowserContext?.artifactData,
      applicationFamily,
    );
    updateCurrentPowerBrowserContext({ artifactData });

    return Array.isArray(applicationFamily)
      ? applicationFamily
      : [applicationFamily];
  }

  /**
   * Describes which family application a mismatched bearer belongs to.
   *
   * @param {string} bearerApplicationId
   * @param {{identifier: string, applicationId: string}} runtimeContext
   * @returns {Promise<string>}
   */
  async function getActionBearerApplicationMismatchMessage(
    bearerApplicationId,
    runtimeContext,
  ) {
    const applicationFamily =
      await getActionPlaygroundApplicationFamily(
        runtimeContext.identifier,
      );
    const bearerApplication = applicationFamily.find(
      (application) =>
        String(application?.appUuid || "") ===
        bearerApplicationId,
    );
    const currentApplication = applicationFamily.find(
      (application) =>
        String(application?.appUuid || "") ===
          runtimeContext.applicationId ||
        application?.identifier === runtimeContext.identifier,
    );
    const currentApplicationName =
      currentApplication?.name ||
      currentApplication?.identifier ||
      runtimeContext.identifier;

    if (bearerApplication) {
      const bearerApplicationName =
        bearerApplication.name ||
        bearerApplication.identifier ||
        "Unknown application";
      return `Bearer belongs to ${bearerApplicationName} (${bearerApplicationId}), but the current application is ${currentApplicationName} (${runtimeContext.applicationId}).`;
    }

    const bearerApplicationLabel =
      bearerApplicationId || "missing";
    return `Bearer app_uuid ${bearerApplicationLabel} does not match the current application ${currentApplicationName} (${runtimeContext.applicationId}).`;
  }

  /**
   * Retrieves only the action settings needed for Authorization validation.
   *
   * @param {string} identifier
   * @param {boolean} [force]
   * @returns {Promise<{public: boolean, authenticationProfile: string}>}
   */
  async function fetchActionAuthorizationSettings(
    identifier,
    force = false,
  ) {
    const actionId = location.pathname.match(
      /\/app\/actions\/([^/?#]+)/i,
    )?.[1];
    if (!actionId) {
      throw new Error(
        "Unable to determine the current action identifier.",
      );
    }

    const cacheKey = `${location.origin}:${identifier}:${actionId}`;
    try {
      return await getCachedPowerBrowserData(
        actionSettingsRequestCache,
        cacheKey,
        async () => {
          updatePowerBrowserDiagnostic(
            "actionSettings",
            "loading",
            "Loading action authorization settings…",
          );
          const csrfToken =
            getCsrfToken() || getNextgenLogCsrfToken();
          if (!csrfToken) {
            throw new Error(
              "Unable to retrieve the action settings because no CSRF token is available.",
            );
          }

          const response = await fetch(
            `${location.origin}/api/meta/graphql`,
            {
              headers: {
                Accept: "*/*",
                "application-identifier": identifier,
                "content-type": "application/json",
                "x-csrf-token": csrfToken,
              },
              referrer: location.href,
              body: JSON.stringify({
                operationName: "Action",
                variables: {
                  input: {
                    id: actionId,
                  },
                },
                query: `query Action($input: ActionInput!) {
                  action(input: $input) {
                    public
                    options {
                      authenticationProfile
                    }
                  }
                }`,
              }),
              method: "POST",
              mode: "cors",
              credentials: "include",
            },
          );

          if (!response.ok) {
            throw new Error(
              `Action-settings request failed with status ${response.status}.`,
            );
          }

          const payload = await response.json();
          if (payload.errors?.length) {
            throw new Error(
              payload.errors
                .map((error) => error.message)
                .join("; "),
            );
          }

          const action = payload.data?.action;
          if (!action) {
            throw new Error(
              "Betty Blocks did not return the current action settings.",
            );
          }

          const settings = {
            public: Boolean(action.public),
            authenticationProfile: String(
              action.options?.authenticationProfile || "",
            ),
          };
          updatePowerBrowserDiagnostic(
            "actionSettings",
            "success",
            settings.public
              ? "Public action; Authorization is optional."
              : settings.authenticationProfile
                ? "Protected action settings loaded."
                : "Action has no authentication profile.",
          );
          return settings;
        },
        force,
      );
    } catch (error) {
      updatePowerBrowserDiagnostic(
        "actionSettings",
        "error",
        error instanceof Error
          ? error.message
          : "Unable to retrieve action settings.",
        error,
      );
      throw error;
    }
  }

  /**
   * Creates the non-blocking alert shown inside the action dialog.
   *
   * @param {Element} dialog
   * @returns {HTMLElement|null}
   */
