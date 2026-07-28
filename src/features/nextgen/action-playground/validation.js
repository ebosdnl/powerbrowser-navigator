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
