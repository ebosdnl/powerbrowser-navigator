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
