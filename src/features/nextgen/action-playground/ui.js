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
      injectActionPlaygroundRequestLog(dialog, {
        status: response.status,
        payload: response.payload,
        request: body,
      });
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

  const ACTION_LOGS_QUERY = `query groupedLogs($page: Int!, $perPage: Int, $filter: GroupedLogsFilter!) {
    groupedLogs(page: $page, perPage: $perPage, filter: $filter) {
      pageInfo {
        currentPage
        totalCount
        hasNextPage
        lastPage
      }
      results {
        logId
        service
        maxTimestamp
        minTimestamp
        level
        action {
          id
          name
        }
        message {
          summary
        }
      }
    }
  }`;
  /**
   * Loads one grouped-log page for the action in the current URL.
   *
   * @param {number} page
   * @returns {Promise<{pageInfo?: object, results?: object[]}>}
   */
  async function fetchActionPlaygroundLogs(page) {
    const actionId = getCurrentActionId();
    const identifier =
      currentPowerBrowserContext?.identifier ||
      location.hostname.split(".")[0];
    const csrfToken = getCsrfToken() || getNextgenLogCsrfToken();
    if (!actionId || !identifier || !csrfToken) {
      throw new Error(
        "The action, application identifier, or CSRF token is unavailable.",
      );
    }

    const response = await fetch(
      `${location.origin}/api/meta/graphql?applicationId=${encodeURIComponent(identifier)}`,
      {
        headers: {
          Accept: "*/*",
          "application-identifier": identifier,
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        referrer: `${location.origin}/app/logs?actionid=${encodeURIComponent(actionId)}`,
        body: JSON.stringify({
          operationName: "groupedLogs",
          variables: {
            page,
            perPage: 50,
            filter: { actionId },
          },
          query: ACTION_LOGS_QUERY,
        }),
        method: "POST",
        mode: "cors",
        credentials: "include",
      },
    );
    if (!response.ok) {
      throw new Error(
        `Logs request failed with status ${response.status}.`,
      );
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(
        payload.errors.map((error) => error.message).join("; "),
      );
    }
    return payload.data?.groupedLogs || { results: [] };
  }

  function formatActionLogValue(value) {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function formatActionLogTimestamp(value) {
    if (!value) return "Unknown time";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleString();
  }

  function injectActionPlaygroundRequestLog(dialog, entry) {
    const panel = dialog.querySelector(
      "[data-power-browser-action-logs-panel-v350]",
    );
    if (!panel) return;

    const requestLogs = Array.isArray(
      panel.powerBrowserRequestLogsV350,
    )
      ? panel.powerBrowserRequestLogsV350
      : [];
    requestLogs.unshift({
      ...entry,
      createdAt: new Date().toISOString(),
    });
    panel.powerBrowserRequestLogsV350 = requestLogs.slice(0, 20);

    const localList = panel.querySelector(
      ".power-browser-action-local-logs-v350",
    );
    if (localList) {
      renderActionPlaygroundRequestLogs(panel, localList);
      const count = panel.querySelector(
        "[data-power-browser-action-log-count-v350]",
      );
      if (count) {
        const total =
          Number(panel.powerBrowserServerLogCountV350 || 0) +
          panel.powerBrowserRequestLogsV350.length;
        count.textContent = `${total} Log${total === 1 ? "" : "s"}`;
      }
    }
  }

  function renderActionPlaygroundRequestLogs(panel, container) {
    container.replaceChildren();
    const requestLogs = Array.isArray(
      panel.powerBrowserRequestLogsV350,
    )
      ? panel.powerBrowserRequestLogsV350
      : [];
    requestLogs.forEach((log) => {
      const item = document.createElement("div");
      item.className =
        "power-browser-action-log-item-v350 power-browser-action-local-log-v350";
      const row = document.createElement("div");
      row.className = "power-browser-action-log-row-v350";
      row.dataset.level =
        log.status >= 200 && log.status < 300 ? "info" : "error";
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-expanded", "false");
      const chevron = document.createElement("span");
      chevron.className =
        "power-browser-action-log-chevron-v350";
      chevron.textContent = "›";
      const badge = document.createElement("span");
      badge.className = "power-browser-action-log-level-v350";
      badge.textContent = "request";
      const message = document.createElement("span");
      message.className = "power-browser-action-log-message-v350";
      message.textContent = `Playground response (${log.status})`;
      const service = document.createElement("span");
      service.className = "power-browser-action-log-service-v350";
      service.textContent = "Local";
      const timestamp = document.createElement("time");
      timestamp.textContent = formatActionLogTimestamp(log.createdAt);
      const details = document.createElement("div");
      details.className =
        "power-browser-action-log-details-v350 power-browser-action-response-v350";
      details.hidden = true;
      const heading = document.createElement("strong");
      heading.textContent = "Response JSON";
      const response = document.createElement("pre");
      response.textContent = formatActionLogValue(log.payload);
      details.append(heading, response);

      const toggle = () => {
        const opening = details.hidden;
        details.hidden = !opening;
        row.setAttribute("aria-expanded", String(opening));
        chevron.textContent = opening ? "⌄" : "›";
      };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle();
      });
      row.append(chevron, badge, message, service, timestamp);
      item.append(row, details);
      container.appendChild(item);
    });
    container.hidden = requestLogs.length === 0;
  }

  /**
   * Renders a grouped-log response without trusting log text as HTML.
   *
   * @param {HTMLElement} panel
   * @param {{pageInfo?: object, results?: object[]}} groupedLogs
   * @returns {void}
   */
  function renderActionPlaygroundLogs(panel, groupedLogs) {
    const results = Array.isArray(groupedLogs.results)
      ? groupedLogs.results
      : [];
    const pageInfo = groupedLogs.pageInfo || {};
    const currentPage = Number(pageInfo.currentPage) || 1;
    const lastPage = Math.max(Number(pageInfo.lastPage) || 1, 1);
    const localCount = Array.isArray(
      panel.powerBrowserRequestLogsV350,
    )
      ? panel.powerBrowserRequestLogsV350.length
      : 0;
    const totalCount =
      (Number(pageInfo.totalCount) || results.length) + localCount;
    panel.powerBrowserServerLogCountV350 =
      Number(pageInfo.totalCount) || results.length;
    panel.replaceChildren();

    const toolbar = document.createElement("div");
    toolbar.className = "power-browser-action-logs-toolbar-v350";
    const count = document.createElement("span");
    count.dataset.powerBrowserActionLogCountV350 = "";
    count.textContent = `${totalCount} Log${totalCount === 1 ? "" : "s"}`;
    const controls = document.createElement("div");
    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "Previous";
    previous.disabled = currentPage <= 1;
    const pageLabel = document.createElement("span");
    pageLabel.textContent = `${currentPage} of ${lastPage}`;
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next";
    next.disabled =
      pageInfo.hasNextPage === false || currentPage >= lastPage;
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.textContent = "Refresh";
    controls.append(previous, pageLabel, next, refresh);
    toolbar.append(count, controls);

    const list = document.createElement("div");
    list.className = "power-browser-action-logs-list-v350";
    const localList = document.createElement("div");
    localList.className =
      "power-browser-action-local-logs-v350";
    renderActionPlaygroundRequestLogs(panel, localList);
    list.appendChild(localList);
    if (!results.length && !localCount) {
      const empty = document.createElement("p");
      empty.className = "power-browser-action-logs-empty-v350";
      empty.textContent = "No logs found for this action.";
      list.append(empty);
    }
    results.forEach((log) => {
      const item = document.createElement("div");
      item.className = "power-browser-action-log-item-v350";
      const row = document.createElement("a");
      const level = String(log.level || "unknown").toLowerCase();
      row.className = "power-browser-action-log-row-v350";
      row.dataset.level = level;
      row.href = `/app/logs?actionid=${encodeURIComponent(log.action?.id || getCurrentActionId() || "")}`;
      row.setAttribute(
        "aria-label",
        `Open native logs for ${log.action?.name || "this action"}`,
      );

      const chevron = document.createElement("span");
      chevron.className =
        "power-browser-action-log-chevron-v350";
      chevron.textContent = "↗";
      const badge = document.createElement("span");
      badge.className = "power-browser-action-log-level-v350";
      badge.textContent = level;
      const message = document.createElement("span");
      message.className = "power-browser-action-log-message-v350";
      message.textContent =
        log.message?.summary ||
        log.action?.name ||
        log.service ||
        "No summary";
      const service = document.createElement("span");
      service.className = "power-browser-action-log-service-v350";
      service.textContent = String(log.service || "");
      const timestamp = document.createElement("time");
      timestamp.textContent = formatActionLogTimestamp(
        log.maxTimestamp || log.minTimestamp,
      );
      row.append(chevron, badge, message, service, timestamp);
      item.appendChild(row);
      list.append(item);
    });
    panel.append(toolbar, list);

    previous.addEventListener("click", () =>
      loadActionPlaygroundLogs(panel, currentPage - 1),
    );
    next.addEventListener("click", () =>
      loadActionPlaygroundLogs(panel, currentPage + 1),
    );
    refresh.addEventListener("click", () =>
      loadActionPlaygroundLogs(panel, currentPage),
    );
  }

  async function loadActionPlaygroundLogs(panel, page = 1) {
    panel.dataset.logsState = "loading";
    panel.textContent = "Loading action logs…";
    try {
      const groupedLogs = await fetchActionPlaygroundLogs(page);
      if (panel.isConnected) {
        panel.dataset.logsState = "ready";
        renderActionPlaygroundLogs(panel, groupedLogs);
      }
    } catch (error) {
      if (panel.isConnected) {
        panel.dataset.logsState = "error";
        panel.textContent =
          error instanceof Error
            ? error.message
            : "Unable to load action logs.";
      }
    }
  }

  /**
   * Adds a Logs tab alongside Basic, Advanced, and Playground.
   *
   * @param {Element} dialog
   * @param {Element} playgroundPanel
   * @returns {void}
   */
  function ensureActionPlaygroundLogsTab(dialog, playgroundPanel) {
    const existingLogsTab = dialog.querySelector(
      "[data-power-browser-action-logs-tab-v350]",
    );
    if (existingLogsTab) {
      if (existingLogsTab.dataset.state === "active") {
        updateActionPlaygroundTabIndicator(existingLogsTab);
      }
      return;
    }
    const playgroundTab = Array.from(
      dialog.querySelectorAll('[role="tab"]'),
    ).find((tab) => tab.textContent.trim() === "Playground");
    const tablist = playgroundTab?.closest('[role="tablist"]');
    if (!playgroundTab || !tablist) return;

    const logsTab = playgroundTab.cloneNode(false);
    const logsPanel = document.createElement("div");
    const panelId = `power-browser-action-logs-${getCurrentActionId() || "current"}`;
    logsTab.textContent = "Logs";
    logsTab.id = `${panelId}-tab`;
    logsTab.dataset.powerBrowserActionLogsTabV350 = "";
    logsTab.dataset.state = "inactive";
    logsTab.setAttribute("aria-selected", "false");
    logsTab.setAttribute("aria-controls", panelId);
    logsTab.tabIndex = -1;
    logsPanel.id = panelId;
    logsPanel.className = "power-browser-action-logs-panel-v350";
    logsPanel.dataset.powerBrowserActionLogsPanelV350 = "";
    logsPanel.setAttribute("role", "tabpanel");
    logsPanel.setAttribute("aria-labelledby", logsTab.id);
    logsPanel.hidden = true;

    const selectPlayground = () => {
      playgroundTab.setAttribute("aria-selected", "true");
      playgroundTab.dataset.state = "active";
      playgroundTab.tabIndex = 0;
      playgroundPanel.hidden = false;
      playgroundPanel.dataset.state = "active";
      logsTab.setAttribute("aria-selected", "false");
      logsTab.dataset.state = "inactive";
      logsTab.tabIndex = -1;
      logsPanel.hidden = true;
      logsPanel.dataset.state = "inactive";
      updateActionPlaygroundTabIndicator(playgroundTab);
    };
    const selectLogs = () => {
      playgroundTab.setAttribute("aria-selected", "false");
      playgroundTab.dataset.state = "inactive";
      playgroundTab.tabIndex = -1;
      playgroundPanel.hidden = true;
      playgroundPanel.dataset.state = "inactive";
      logsTab.setAttribute("aria-selected", "true");
      logsTab.dataset.state = "active";
      logsTab.tabIndex = 0;
      logsPanel.hidden = false;
      logsPanel.dataset.state = "active";
      updateActionPlaygroundTabIndicator(logsTab);
      if (!logsPanel.dataset.logsState) {
        void loadActionPlaygroundLogs(logsPanel);
      }
    };
    logsTab.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectLogs();
    });
    playgroundTab.addEventListener(
      "click",
      (event) => {
        if (logsTab.dataset.state !== "active") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        selectPlayground();
      },
      true,
    );
    playgroundTab.after(logsTab);
    playgroundPanel.after(logsPanel);
  }

  /**
   * Positions the existing Radix indicator below an injected or native tab.
   *
   * @param {HTMLElement} activeTab
   * @returns {void}
   */
  function updateActionPlaygroundTabIndicator(activeTab) {
    const tablist = activeTab.closest('[role="tablist"]');
    const indicator = Array.from(tablist?.children || []).find(
      (child) =>
        child.getAttribute("role") !== "tab" &&
        child.classList.contains("absolute") &&
        child.classList.contains("bottom-[-1px]"),
    );
    if (!tablist || !indicator) return;

    const tabRect = activeTab.getBoundingClientRect();
    const tablistRect = tablist.getBoundingClientRect();
    indicator.style.left =
      `${tabRect.left - tablistRect.left + tablist.scrollLeft}px`;
    indicator.style.width = `${tabRect.width}px`;
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
        "[data-power-browser-action-logs-tab-v350], [data-power-browser-action-logs-panel-v350]",
      )
      .forEach((element) => {
        if (!activeDialog?.contains(element)) {
          element.remove();
        }
      });
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
        existingTextarea.dataset
          .powerBrowserClipboardAppliedV350 !== "true" &&
        (!previousGeneratedValue ||
          existingTextarea.value === previousGeneratedValue)
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
      const savedVariables =
        variablesTextarea.dataset
          .powerBrowserActionVariablesDraftV350;
      if (
        savedVariables !== undefined &&
        variablesTextarea.value !== savedVariables
      ) {
        variablesTextarea.value = savedVariables;
      }
      if (
        variablesTextarea.dataset
          .powerBrowserVariablesListenerAttachedV350 !== "true"
      ) {
        variablesTextarea.dataset
          .powerBrowserVariablesListenerAttachedV350 = "true";
        variablesTextarea.addEventListener("input", (event) => {
          variablesTextarea.dataset
            .powerBrowserActionVariablesDraftV350 =
            variablesTextarea.value;
          event.stopPropagation();
        });
        variablesTextarea.addEventListener(
          "change",
          (event) => event.stopPropagation(),
        );
      }
    }
    match.dialog.classList.add(
      "power-browser-action-playground-dialog-v2",
    );
    ensureActionPlaygroundRunButton(match.dialog, match.panel);
    ensureActionPlaygroundLogsTab(match.dialog, match.panel);
    if (
      headersTextarea &&
      headersTextarea.dataset.authorizationListenerAttachedV2 !==
        "true"
    ) {
      headersTextarea.dataset.authorizationListenerAttachedV2 =
        "true";
      headersTextarea.addEventListener("input", (event) => {
        if (event.isTrusted) {
          headersTextarea.dataset.powerBrowserHeadersUserEditedV350 =
            "true";
        }
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
    if (headersTextarea) {
      void autoPasteActionPlaygroundHeaders(
        match.dialog,
        match.panel,
      );
      if (
        match.dialog.dataset.powerBrowserClipboardRetryV350 !== "true"
      ) {
        match.dialog.dataset.powerBrowserClipboardRetryV350 = "true";
        match.dialog.addEventListener(
          "pointerdown",
          () => {
            void autoPasteActionPlaygroundHeaders(
              match.dialog,
              match.panel,
            );
          },
          { once: true },
        );
      }
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

  function refreshActionPlaygroundClipboardOnFocus() {
    if (
      !getSettingValue("nextgenEditableActionPlayground") ||
      !isNextgenActionPage()
    ) {
      return;
    }
    const match = getActiveActionPlaygroundDialog();
    if (match) {
      void autoPasteActionPlaygroundHeaders(
        match.dialog,
        match.panel,
        true,
      );
    }
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
    if (!nextgenActionClipboardFocusAttached) {
      nextgenActionClipboardFocusAttached = true;
      window.addEventListener(
        "focus",
        refreshActionPlaygroundClipboardOnFocus,
      );
    }
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
