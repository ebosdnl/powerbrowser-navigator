  function isNextgenActionPage() {
    return (
      location.pathname === "/app/actions" ||
      location.pathname.includes("/app/actions/")
    );
  }

  /**
   * Locates the active "Enter test values" dialog and verifies its complete
   * Playground signature. Radix reuses dialog containers, so the title, tabs,
   * selected tab, active panel and expected fields must all match.
   *
   * @returns {{dialog: Element, panel: Element}|null}
   */
  function getActiveActionPlaygroundDialog() {
    if (!isNextgenActionPage()) {
      return null;
    }

    const dialogs = Array.from(
      document.querySelectorAll(
        '[role="dialog"][data-state="open"]',
      ),
    );

    for (const dialog of dialogs) {
      const title = dialog.querySelector("h2");
      if (title?.textContent.trim() !== "Enter test values") {
        continue;
      }

      const tabs = Array.from(
        dialog.querySelectorAll('[role="tab"]'),
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
          tab.textContent.trim() === "Playground" &&
          tab.getAttribute("aria-selected") === "true" &&
          tab.dataset.state === "active",
      );
      const panelId = playgroundTab?.getAttribute("aria-controls");
      const panel = Array.from(
        dialog.querySelectorAll('[role="tabpanel"]'),
      ).find(
        (candidate) =>
          candidate.id === panelId &&
          candidate.dataset.state === "active" &&
          !candidate.hidden,
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
        !fieldNames.has("Variables") ||
        panel.querySelectorAll("textarea").length < 2
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
        '[data-testid="icon_publicaction"]',
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
    if (currentPowerBrowserContext) {
      currentPowerBrowserContext.artifactData = artifactData;
    }
    let applicationId = getApplicationId(
      artifactData,
      applicationFamily,
      identifier,
    );

    if (!applicationId && identifier) {
      applicationFamily = await fetchApplicationFamily(identifier);
      if (currentPowerBrowserContext) {
        currentPowerBrowserContext.applicationFamily =
          applicationFamily;
      }
      artifactData = await ensureArtifactFreshAfterFamilyMerge(
        artifactData,
        applicationFamily,
      );
      if (currentPowerBrowserContext) {
        currentPowerBrowserContext.artifactData = artifactData;
      }
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
      if (currentPowerBrowserContext) {
        currentPowerBrowserContext.applicationFamily =
          applicationFamily;
      }
    }

    if (!applicationFamily) {
      return [];
    }

    if (currentPowerBrowserContext) {
      currentPowerBrowserContext.artifactData =
        await ensureArtifactFreshAfterFamilyMerge(
          currentPowerBrowserContext.artifactData,
          applicationFamily,
        );
    }

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
  function ensureActionPlaygroundAlert(dialog) {
    const existing = dialog.querySelector(
      "[data-power-browser-action-alert-v2]",
    );
    if (existing) {
      return existing;
    }

    const playgroundButton = Array.from(
      dialog.querySelectorAll("button"),
    ).find(
      (button) => button.textContent.trim() === "Go to playground",
    );
    const footer = playgroundButton?.parentElement;
    if (!footer) {
      return null;
    }

    const alert = document.createElement("div");
    alert.className = "power-browser-action-alert-v2";
    alert.setAttribute("data-power-browser-action-alert-v2", "");
    alert.setAttribute("role", "alert");
    footer.before(alert);
    return alert;
  }

  /**
   * Shows or clears the action dialog's inline alert.
   *
   * @param {Element} dialog
   * @param {string} [message]
   * @returns {void}
   */
  function showActionPlaygroundAlert(dialog, message = "") {
    const alert = ensureActionPlaygroundAlert(dialog);
    if (!alert) {
      return;
    }

    alert.textContent = message;
    alert.classList.toggle("open", Boolean(message));
  }

  /**
   * Updates the Headers field and Run button for authorization validation.
   *
   * @param {Element} dialog
   * @param {Element} panel
   * @param {{state: "checking"|"valid"|"invalid", message?: string, required?: boolean}} validation
   * @returns {void}
   */
  function setActionAuthorizationValidation(
    dialog,
    panel,
    validation,
  ) {
    const headersField = panel.querySelector(
      "[data-power-browser-action-headers-v2]",
    );
    const textarea = headersField?.querySelector("textarea");
    const helper = headersField?.querySelector(
      "div[color] span, span[color]",
    );
    const runButton = dialog.querySelector(
      "[data-power-browser-action-run-request-v2]",
    );
    if (!textarea) {
      return;
    }

    const isInvalid = validation.state === "invalid";
    const isChecking = validation.state === "checking";
    textarea.dataset.authorizationValidationState = validation.state;
    textarea.dataset.error = String(isInvalid);
    textarea.setAttribute("aria-invalid", String(isInvalid));
    textarea.required = Boolean(validation.required);
    textarea.setAttribute(
      "aria-required",
      String(Boolean(validation.required)),
    );

    if (helper) {
      helper.textContent =
        validation.message ||
        "Paste JSON request headers here. Authorization is validated automatically.";
      helper.style.color = isInvalid ? "#dc2626" : "";
    }

    if (runButton && runButton.dataset.requestRunning !== "true") {
      runButton.disabled = isChecking || isInvalid;
      runButton.title = isChecking
        ? "Checking Authorization…"
        : validation.message || "";
    }
  }

  /**
   * Validates the Headers Authorization before the request can be run.
   *
   * @param {Element} dialog
   * @param {Element} panel
   * @returns {Promise<boolean>}
   */
  async function validateActionPlaygroundAuthorization(
    dialog,
    panel,
  ) {
    const sequence = ++nextgenActionValidationSequence;
    const textarea = getActionPlaygroundTextarea(
      panel,
      "Headers",
    );
    if (!textarea) {
      return false;
    }

    const headersValue = textarea.value;
    setActionAuthorizationValidation(dialog, panel, {
      state: "checking",
      message: "Checking Authorization…",
    });

    try {
      const parsedHeaders = JSON.parse(
        headersValue.trim() || "{}",
      );
      if (
        !parsedHeaders ||
        Array.isArray(parsedHeaders) ||
        typeof parsedHeaders !== "object"
      ) {
        throw new Error("Headers must be a JSON object.");
      }

      if (isCurrentActionPublic()) {
        if (sequence !== nextgenActionValidationSequence) {
          return false;
        }

        panel.dataset.authorizationRequiredV2 = "false";
        textarea.dataset.authorizationValidatedValue = headersValue;
        setActionAuthorizationValidation(dialog, panel, {
          state: "valid",
          required: false,
          message:
            "This is a public action; Authorization is not required.",
        });
        return true;
      }

      const runtimeContext =
        await getActionPlaygroundRuntimeContext();
      const actionSettings =
        await fetchActionAuthorizationSettings(
          runtimeContext.identifier,
        );
      if (sequence !== nextgenActionValidationSequence) {
        return false;
      }

      if (actionSettings.public) {
        panel.dataset.authorizationRequiredV2 = "false";
        textarea.dataset.authorizationValidatedValue = headersValue;
        setActionAuthorizationValidation(dialog, panel, {
          state: "valid",
          required: false,
          message:
            "This is a public action; Authorization is not required.",
        });
        return true;
      }

      const requiredAuthenticationProfile =
        actionSettings.authenticationProfile;
      if (!requiredAuthenticationProfile) {
        panel.dataset.authorizationRequiredV2 = "false";
        textarea.dataset.authorizationValidatedValue = headersValue;
        setActionAuthorizationValidation(dialog, panel, {
          state: "valid",
          required: false,
          message:
            "This action has no authentication profile; Authorization is optional.",
        });
        return true;
      }

      const authorization = getAuthorizationHeader(parsedHeaders);
      if (!authorization) {
        throw new Error(
          `Authorization is required for authentication profile ${requiredAuthenticationProfile}.`,
        );
      }

      const jwtPayload = decodeActionPlaygroundJwt(authorization);
      const bearerApplicationId = String(
        jwtPayload.app_uuid || "",
      );
      if (
        !bearerApplicationId ||
        bearerApplicationId !== runtimeContext.applicationId
      ) {
        throw new Error(
          await getActionBearerApplicationMismatchMessage(
            bearerApplicationId,
            runtimeContext,
          ),
        );
      }

      if (
        String(jwtPayload.auth_profile || "") !==
        requiredAuthenticationProfile
      ) {
        throw new Error(
          `Bearer auth_profile ${jwtPayload.auth_profile || "is missing"} does not match this action's authentication profile (${requiredAuthenticationProfile}).`,
        );
      }

      if (sequence !== nextgenActionValidationSequence) {
        return false;
      }

      panel.dataset.authorizationRequiredV2 = "true";
      textarea.dataset.authorizationValidatedValue = headersValue;
      setActionAuthorizationValidation(dialog, panel, {
        state: "valid",
        required: true,
        message: `Authorization verified for authentication profile ${requiredAuthenticationProfile}.`,
      });
      return true;
    } catch (error) {
      if (sequence !== nextgenActionValidationSequence) {
        return false;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Unable to validate Authorization.";
      textarea.dataset.authorizationValidatedValue = headersValue;
      setActionAuthorizationValidation(dialog, panel, {
        state: "invalid",
        message,
        required:
          panel.dataset.authorizationRequiredV2 === "true",
      });
      return false;
    }
  }

  /**
   * Debounces validation while the user edits Headers.
   *
   * @param {Element} dialog
   * @param {Element} panel
   * @param {number} [delay]
   * @returns {void}
   */
  function scheduleActionAuthorizationValidation(
    dialog,
    panel,
    delay = 180,
  ) {
    clearTimeout(nextgenActionValidationTimer);
    setActionAuthorizationValidation(dialog, panel, {
      state: "checking",
      message: "Checking Authorization…",
    });
    nextgenActionValidationTimer = setTimeout(() => {
      validateActionPlaygroundAuthorization(dialog, panel);
    }, delay);
  }

  /**
   * Sends the edited Playground request through Tampermonkey so the builder
   * can reach the cross-origin runtime endpoint reliably.
   *
   * @param {string} url
   * @param {Record<string, string>} headers
   * @param {Record<string, unknown>} body
   * @returns {Promise<{status: number, payload: unknown}>}
   */
  function sendActionPlaygroundRequest(url, headers, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: {
          Accept: "application/json, multipart/mixed",
          "Content-Type": "application/json",
          ...headers,
          Referer: url,
        },
        data: JSON.stringify(body),
        anonymous: false,
        timeout: 30000,
        onload: (response) => {
          let payload = response.responseText;
          try {
            payload = JSON.parse(response.responseText);
          } catch (_error) {
            // Multipart or empty successful responses may not be JSON.
          }

          if (response.status < 200 || response.status >= 300) {
            const message =
              payload?.errors
                ?.map((error) => error.message)
                .filter(Boolean)
                .join("; ") ||
              `Runtime request failed with status ${response.status}.`;
            reject(new Error(message));
            return;
          }

          if (payload?.errors?.length) {
            reject(
              new Error(
                payload.errors
                  .map((error) => error.message)
                  .join("; "),
              ),
            );
            return;
          }

          resolve({
            status: response.status,
            payload,
          });
        },
        onerror: () =>
          reject(new Error("Runtime network request failed.")),
        ontimeout: () =>
          reject(new Error("Runtime request timed out.")),
      });
    });
  }

  /**
   * Reads the editable fields and executes their runtime GraphQL request.
   *
   * @param {Element} panel
   * @param {HTMLButtonElement} button
   * @returns {Promise<void>}
   */
  async function runActionPlaygroundRequest(panel, button) {
    const dialog = panel.closest('[role="dialog"]');
    const mutationTextarea = getActionPlaygroundTextarea(
      panel,
      "Mutation",
    );
    const variablesTextarea = getActionPlaygroundTextarea(
      panel,
      "Variables",
    );
    const headersTextarea = getActionPlaygroundTextarea(
      panel,
      "Headers",
    );

    if (
      !dialog ||
      headersTextarea?.dataset.authorizationValidationState !==
        "valid"
    ) {
      if (dialog) {
        scheduleActionAuthorizationValidation(dialog, panel, 0);
      }
      return;
    }

    button.dataset.requestRunning = "true";
    button.disabled = true;
    button.textContent = "Running…";
    button.title = "";
    showActionPlaygroundAlert(dialog);

    try {
      if (!mutationTextarea?.value.trim()) {
        throw new Error("Mutation cannot be empty.");
      }

      const variablesText = variablesTextarea?.value.trim() || "";
      const headersText = headersTextarea?.value.trim() || "{}";
      const variables = variablesText
        ? JSON.parse(variablesText)
        : undefined;
      const parsedHeaders = JSON.parse(headersText);
      if (
        !parsedHeaders ||
        Array.isArray(parsedHeaders) ||
        typeof parsedHeaders !== "object"
      ) {
        throw new Error("Headers must be a JSON object.");
      }

      const headers = Object.fromEntries(
        Object.entries(parsedHeaders).map(([key, value]) => [
          key,
          String(value),
        ]),
      );
      const runtimeContext =
        await getActionPlaygroundRuntimeContext();
      const body = {
        query: mutationTextarea.value,
        ...(variables === undefined ? {} : { variables }),
      };
      const response = await sendActionPlaygroundRequest(
        runtimeContext.url,
        headers,
        body,
      );

      button.textContent = `Success (${response.status})`;
      console.info("[Power Browser v2] Action request completed.", {
        url: runtimeContext.url,
        response: response.payload,
      });
    } catch (error) {
      button.textContent = "Request failed";
      const message =
        error instanceof Error
          ? error.message
          : "An unknown request error occurred.";
      button.title = message;
      showActionPlaygroundAlert(dialog, message);
      console.error(
        "[Power Browser v2] Unable to run the action request.",
        { error },
      );
    } finally {
      delete button.dataset.requestRunning;
      setTimeout(() => {
        if (button.isConnected) {
          button.disabled =
            headersTextarea?.dataset
              .authorizationValidationState !== "valid";
          button.textContent = "Run request";
        }
      }, 2500);
    }
  }

  /**
   * Adds a request button beside the dialog's existing Playground button.
   *
   * @param {Element} dialog
   * @param {Element} panel
   * @returns {void}
   */
  function ensureActionPlaygroundRunButton(dialog, panel) {
    if (
      dialog.querySelector(
        "[data-power-browser-action-run-request-v2]",
      )
    ) {
      return;
    }

    const playgroundButton = Array.from(
      dialog.querySelectorAll("button"),
    ).find(
      (button) => button.textContent.trim() === "Go to playground",
    );
    if (!playgroundButton) {
      return;
    }

    const runButton = playgroundButton.cloneNode(true);
    runButton.setAttribute(
      "data-power-browser-action-run-request-v2",
      "",
    );
    runButton.removeAttribute("aria-label");
    runButton.textContent = "Run request";
    runButton.style.marginLeft = "auto";
    runButton.disabled = true;
    runButton.title = "Checking Authorization…";
    runButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runActionPlaygroundRequest(panel, runButton);
    });
    playgroundButton.before(runButton);
    ensureActionPlaygroundAlert(dialog);
  }

  /**
   * Restores enhanced textareas and removes injected fields. When a matching
   * dialog is supplied, only stale enhancements outside that dialog are reset.
   *
   * @param {Element|null} [activeDialog]
   * @returns {void}
   */
  function cleanupActionPlaygroundEnhancements(activeDialog = null) {
    if (!activeDialog) {
      clearTimeout(nextgenActionValidationTimer);
      nextgenActionValidationSequence += 1;
    }
    document
      .querySelectorAll(
        "[data-power-browser-action-alert-v2]",
      )
      .forEach((alert) => {
        if (!activeDialog?.contains(alert)) {
          alert.remove();
        }
      });
    document
      .querySelectorAll(
        "[data-power-browser-action-run-request-v2]",
      )
      .forEach((button) => {
        if (!activeDialog?.contains(button)) {
          button.remove();
        }
      });
    document
      .querySelectorAll(
        ".power-browser-action-playground-dialog-v2",
      )
      .forEach((dialog) => {
        if (dialog !== activeDialog) {
          dialog.classList.remove(
            "power-browser-action-playground-dialog-v2",
          );
        }
      });
    document
      .querySelectorAll("[data-power-browser-action-headers-v2]")
      .forEach((field) => {
        if (!activeDialog?.contains(field)) {
          field.remove();
        }
      });
    document
      .querySelectorAll(
        "textarea[data-power-browser-action-original-readonly-v2]",
      )
      .forEach((textarea) => {
        if (activeDialog?.contains(textarea)) {
          return;
        }

        textarea.readOnly =
          textarea.dataset.powerBrowserActionOriginalReadonlyV2 ===
          "true";
        textarea.removeAttribute(
          "data-power-browser-action-original-readonly-v2",
        );
      });
    document
      .querySelectorAll(
        "textarea[data-power-browser-action-original-rows-v2]",
      )
      .forEach((textarea) => {
        if (activeDialog?.contains(textarea)) {
          return;
        }

        textarea.rows = Number.parseInt(
          textarea.dataset.powerBrowserActionOriginalRowsV2,
          10,
        );
        textarea.removeAttribute(
          "data-power-browser-action-original-rows-v2",
        );
        textarea.removeAttribute(
          "data-power-browser-action-variables-v2",
        );
      });
  }

  /**
   * Adds a Headers field by cloning the dialog's own Variables field.
   *
   * @param {Element} panel
   * @returns {HTMLTextAreaElement|null}
   */
  function ensureActionPlaygroundHeadersField(panel) {
    const existingField = panel.querySelector(
      "[data-power-browser-action-headers-v2]",
    );
    const existingTextarea = existingField?.querySelector("textarea");
    const generatedHeaders = getActionPlaygroundHeadersJson();

    if (existingTextarea) {
      const previousGeneratedValue =
        existingTextarea.dataset.powerBrowserGeneratedHeadersV2;
      if (
        !previousGeneratedValue ||
        existingTextarea.value === previousGeneratedValue
      ) {
        existingTextarea.value = generatedHeaders;
      }
      existingTextarea.dataset.powerBrowserGeneratedHeadersV2 =
        generatedHeaders;
      return existingTextarea;
    }

    const variablesLabel = Array.from(
      panel.querySelectorAll("label"),
    ).find((label) => label.textContent.trim() === "Variables");
    const variablesField = variablesLabel?.parentElement;
    if (!variablesField) {
      return null;
    }

    const headersField = variablesField.cloneNode(true);
    headersField.setAttribute(
      "data-power-browser-action-headers-v2",
      "",
    );
    const label = headersField.querySelector("label");
    const textarea = headersField.querySelector("textarea");
    if (!label || !textarea) {
      return null;
    }

    label.textContent = "Headers";
    textarea.rows = 5;
    textarea.value = generatedHeaders;
    textarea.readOnly = false;
    textarea.removeAttribute("readonly");
    textarea.dataset.powerBrowserGeneratedHeadersV2 =
      generatedHeaders;

    const helper = headersField.querySelector(
      "div[color] span, span[color]",
    );
    if (helper) {
      helper.textContent =
        "Paste these JSON headers into the playground request headers field.";
    }

    variablesField.after(headersField);
    return textarea;
  }

  /**
   * Makes every Playground textarea editable and injects request headers.
   *
   * @returns {void}
   */
  function enhanceActionPlaygroundDialog() {
    const match = getActiveActionPlaygroundDialog();
    if (!match) {
      cleanupActionPlaygroundEnhancements();
      return;
    }

    cleanupActionPlaygroundEnhancements(match.dialog);
    const headersTextarea =
      ensureActionPlaygroundHeadersField(match.panel);
    const variablesTextarea = getActionPlaygroundTextarea(
      match.panel,
      "Variables",
    );
    if (variablesTextarea) {
      if (
        !variablesTextarea.hasAttribute(
          "data-power-browser-action-original-rows-v2",
        )
      ) {
        variablesTextarea.dataset.powerBrowserActionOriginalRowsV2 =
          String(variablesTextarea.rows);
      }
      variablesTextarea.rows = Math.min(
        Math.max(variablesTextarea.rows || 1, 1),
        8,
      );
      variablesTextarea.setAttribute(
        "data-power-browser-action-variables-v2",
        "",
      );
    }
    match.dialog.classList.add(
      "power-browser-action-playground-dialog-v2",
    );
    ensureActionPlaygroundRunButton(match.dialog, match.panel);
    if (
      headersTextarea &&
      headersTextarea.dataset.authorizationListenerAttachedV2 !==
        "true"
    ) {
      headersTextarea.dataset.authorizationListenerAttachedV2 =
        "true";
      headersTextarea.addEventListener("input", () => {
        delete headersTextarea.dataset.authorizationValidatedValue;
        scheduleActionAuthorizationValidation(
          match.dialog,
          match.panel,
        );
      });
    }
    if (
      headersTextarea &&
      headersTextarea.dataset.authorizationValidatedValue !==
        headersTextarea.value &&
      headersTextarea.dataset.authorizationValidationState !==
        "checking"
    ) {
      scheduleActionAuthorizationValidation(
        match.dialog,
        match.panel,
        0,
      );
    }
    match.panel.querySelectorAll("textarea").forEach((textarea) => {
      if (
        !textarea.hasAttribute(
          "data-power-browser-action-original-readonly-v2",
        )
      ) {
        textarea.dataset.powerBrowserActionOriginalReadonlyV2 = String(
          textarea.readOnly,
        );
      }
      textarea.readOnly = false;
      textarea.removeAttribute("readonly");
    });
  }

  /**
   * Debounces action-dialog work during Radix tab and dialog transitions.
   *
   * @returns {void}
   */
  function scheduleActionPlaygroundEnhancement() {
    clearTimeout(nextgenActionPlaygroundTimer);
    nextgenActionPlaygroundTimer = setTimeout(
      enhanceActionPlaygroundDialog,
      0,
    );
  }

  /**
   * Applies the editable Action Playground setting and observes reused dialogs.
   *
   * @returns {void}
   */
  function applyNextgenActionPlaygroundSetting() {
    const enabled =
      location.hostname.endsWith(".bettyblocks.com") &&
      isNextgenActionPage() &&
      Boolean(getSettingValue("nextgenEditableActionPlayground"));

    clearTimeout(nextgenActionPlaygroundTimer);
    if (!enabled) {
      nextgenActionPlaygroundObserver?.disconnect();
      nextgenActionPlaygroundObserver = null;
      cleanupActionPlaygroundEnhancements();
      return;
    }

    enhanceActionPlaygroundDialog();
    if (!nextgenActionPlaygroundObserver) {
      nextgenActionPlaygroundObserver = new MutationObserver(
        scheduleActionPlaygroundEnhancement,
      );
      nextgenActionPlaygroundObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "aria-selected",
          "data-state",
          "readonly",
        ],
      });
    }
  }

  /**
   * Returns whether the current page is the Next-gen grouped-logs screen.
   *
   * @returns {boolean}
   */
