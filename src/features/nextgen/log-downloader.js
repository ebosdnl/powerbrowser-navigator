  function isNextgenLogsPage() {
    return (
      location.hostname.endsWith(".bettyblocks.com") &&
      /^\/app\/logs(?:\/|$)/.test(location.pathname)
    );
  }

  /**
   * Stores authentication headers and the active grouped-logs filter from a
   * page-level GraphQL request.
   *
   * @param {Request|string|URL} input
   * @param {RequestInit|undefined} init
   * @returns {void}
   */
  function rememberNextgenLogGraphqlRequest(input, init) {
    const url =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input?.url;

    if (!url?.includes("/api/meta/graphql")) {
      return;
    }

    copyNextgenLogHeaders(input?.headers);
    copyNextgenLogHeaders(init?.headers);

    const body = init?.body;
    if (typeof body !== "string") {
      return;
    }

    try {
      const payload = JSON.parse(body);
      if (payload.operationName === "groupedLogs") {
        capturedGroupedLogsFilter = payload.variables?.filter || {};
      }
    } catch (_error) {
      // Other GraphQL payloads do not affect the log downloader.
    }
  }

  /**
   * Copies the request headers needed to repeat the grouped-logs query.
   *
   * @param {Headers|Array<Array<string>>|Record<string, string>|undefined} headers
   * @returns {void}
   */
  function copyNextgenLogHeaders(headers) {
    if (!headers) {
      return;
    }

    const rememberHeader = (value, key) => {
      const normalizedKey = String(key).toLowerCase();
      if (
        normalizedKey === "x-csrf-token" ||
        normalizedKey === "application-identifier"
      ) {
        capturedGroupedLogsHeaders[normalizedKey] = String(value);
      }
    };

    if (typeof headers.forEach === "function") {
      headers.forEach(rememberHeader);
      return;
    }

    if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => rememberHeader(value, key));
      return;
    }

    Object.entries(headers).forEach(([key, value]) =>
      rememberHeader(value, key),
    );
  }

  /**
   * Hooks the page's fetch implementation so filters selected in the log UI
   * can be reused by the CSV request.
   *
   * @returns {void}
   */
  function captureNextgenLogGraphqlRequests() {
    if (
      nextgenLogDownloaderPatchedFetch ||
      typeof pageWindow.fetch !== "function"
    ) {
      return;
    }

    nextgenLogDownloaderOriginalFetch = pageWindow.fetch;
    nextgenLogDownloaderPatchedFetch = function patchedFetch(input, init) {
      rememberNextgenLogGraphqlRequest(input, init);
      return nextgenLogDownloaderOriginalFetch.apply(this, arguments);
    };
    pageWindow.fetch = nextgenLogDownloaderPatchedFetch;
  }

  /**
   * Restores the page's fetch implementation if Power Browser still owns it.
   *
   * @returns {void}
   */
  function releaseNextgenLogGraphqlCapture() {
    if (
      nextgenLogDownloaderPatchedFetch &&
      pageWindow.fetch === nextgenLogDownloaderPatchedFetch
    ) {
      pageWindow.fetch = nextgenLogDownloaderOriginalFetch;
    }

    nextgenLogDownloaderOriginalFetch = null;
    nextgenLogDownloaderPatchedFetch = null;
  }

  /**
   * Finds a CSRF token exposed by the current Next-gen application.
   *
   * @returns {string}
   */
  function getNextgenLogCsrfToken() {
    const capturedToken = capturedGroupedLogsHeaders["x-csrf-token"];
    if (capturedToken) {
      return capturedToken;
    }

    const metaToken = document.querySelector(
      'meta[name="csrf-token"]',
    )?.content;
    if (metaToken) {
      return metaToken;
    }

    const tokenPattern = /^[A-Za-z0-9_\-+/=]{20,}$/;
    for (const storage of [
      pageWindow.localStorage,
      pageWindow.sessionStorage,
    ]) {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          const value = key ? storage.getItem(key) : "";
          if (/csrf/i.test(key || "") && value && tokenPattern.test(value)) {
            return value;
          }
        }
      } catch (_error) {
        // Storage access may be blocked in embedded or private contexts.
      }
    }

    return "";
  }

  /**
   * Combines the captured GraphQL filter with filters represented in the URL.
   *
   * @returns {Record<string, unknown>}
   */
  function getCurrentNextgenLogFilter() {
    const params = new URLSearchParams(location.search);
    const urlFilter = {};

    if (params.has("status")) {
      urlFilter.logLevel = params.get("status");
    }
    if (params.has("type")) {
      urlFilter.service = params.get("type");
    }

    return {
      ...(capturedGroupedLogsFilter || {}),
      ...urlFilter,
    };
  }

  /**
   * Requests all grouped logs for the active filter.
   *
   * @param {Record<string, unknown>} filter
   * @returns {Promise<{results?: Array<Record<string, unknown>>}>}
   */
  async function fetchNextgenGroupedLogs(filter) {
    const csrfToken = getNextgenLogCsrfToken();
    const identifier =
      capturedGroupedLogsHeaders["application-identifier"] ||
      currentPowerBrowserContext?.identifier ||
      location.hostname.split(".")[0];
    const apiUrl = new URL("/api/meta/graphql", location.origin);
    apiUrl.searchParams.set("applicationId", identifier);
    const headers = {
      accept: "*/*",
      "application-identifier": identifier,
      "content-type": "application/json",
    };

    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }

    const query = `query groupedLogs($page: Int!, $perPage: Int, $filter: GroupedLogsFilter!) {
      groupedLogs(page: $page, perPage: $perPage, filter: $filter) {
        pageInfo {
          currentPage
          totalCount
          hasNextPage
          lastPage
          __typename
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
            __typename
          }
          message {
            summary
            __typename
          }
          __typename
        }
        __typename
      }
    }`;
    const fetchImplementation =
      nextgenLogDownloaderOriginalFetch || pageWindow.fetch;
    const response = await fetchImplementation.call(pageWindow, apiUrl.href, {
      headers,
      referrer: location.href,
      body: JSON.stringify({
        ...(csrfToken ? { _csrf_token: csrfToken } : {}),
        operationName: "groupedLogs",
        variables: {
          page: 1,
          perPage: 1000000,
          filter,
        },
        query,
      }),
      method: "POST",
      mode: "cors",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(
        `Grouped-logs request failed with HTTP ${response.status}.`,
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

  /**
   * Escapes a value for the semicolon-delimited CSV file.
   *
   * @param {unknown} value
   * @returns {string}
   */
  function nextgenLogCsvCell(value) {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  /**
   * Creates a descriptive filename for the current log filter.
   *
   * @param {Record<string, unknown>} filter
   * @returns {string}
   */
  function createNextgenLogFilename(filter) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = Object.entries(filter)
      .filter(([, value]) => value != null && value !== "")
      .map(([key, value]) => `${key}-${value}`)
      .join("_")
      .replace(/[^a-z0-9_-]+/gi, "-");

    return suffix
      ? `betty-blocks-logs_${suffix}_${timestamp}.csv`
      : `betty-blocks-logs_${timestamp}.csv`;
  }

  /**
   * Downloads grouped logs as an Excel-friendly UTF-8 CSV file.
   *
   * @param {Array<Record<string, any>>} logs
   * @param {Record<string, unknown>} filter
   * @returns {void}
   */
  function downloadNextgenLogsCsv(logs, filter) {
    const rows = [
      [
        "logId",
        "service",
        "maxTimestamp",
        "minTimestamp",
        "level",
        "actionId",
        "actionName",
        "summary",
      ],
      ...logs.map((log) => [
        log.logId,
        log.service,
        log.maxTimestamp,
        log.minTimestamp,
        log.level,
        log.action?.id || "",
        log.action?.name || "",
        log.message?.summary || "",
      ]),
    ];
    const csv = rows
      .map((row) => row.map(nextgenLogCsvCell).join(";"))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = createNextgenLogFilename(filter);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  /**
   * Adds the downloader's small, page-native visual treatment once.
   *
   * @returns {void}
   */
  function ensureNextgenLogDownloaderStyle() {
    if (document.getElementById("power-browser-log-downloader-style-v2")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "power-browser-log-downloader-style-v2";
    style.textContent = `
      .power-browser-log-downloader-v2 {
        align-items: center;
        display: inline-flex;
        gap: 6px;
      }

      .power-browser-log-downloader-button-v2 {
        align-items: center;
        background: #fff;
        border: 0.666667px solid rgb(204, 208, 221);
        border-radius: 4px;
        color: rgb(38, 42, 58);
        cursor: pointer;
        display: inline-flex;
        font-family: Fustat, sans-serif;
        font-size: 14px;
        height: 40px;
        padding: 8px 12px;
        white-space: nowrap;
      }

      .power-browser-log-downloader-button-v2:hover {
        background: rgb(247, 247, 249);
      }

      .power-browser-log-downloader-button-v2:disabled {
        cursor: default;
        opacity: 0.65;
      }

      .power-browser-log-downloader-status-v2 {
        color: #475569;
        font-family: Fustat, sans-serif;
        font-size: 12px;
        white-space: nowrap;
      }

      .power-browser-log-downloader-status-v2[data-status="success"] {
        color: #167346;
      }

      .power-browser-log-downloader-status-v2[data-status="error"] {
        color: #c52a3a;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * Creates the grouped-log CSV control.
   *
   * @returns {HTMLDivElement}
   */
  function createNextgenLogDownloader() {
    const root = document.createElement("div");
    root.id = "power-browser-log-downloader-v2";
    root.className = "power-browser-log-downloader-v2";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "power-browser-log-downloader-button-v2";
    button.textContent = "Download CSV";

    const status = document.createElement("span");
    status.className = "power-browser-log-downloader-status-v2";

    button.addEventListener("click", async () => {
      button.disabled = true;
      status.dataset.status = "loading";
      status.textContent = "Preparing…";

      try {
        const filter = getCurrentNextgenLogFilter();
        const groupedLogs = await fetchNextgenGroupedLogs(filter);
        const logs = groupedLogs.results || [];
        downloadNextgenLogsCsv(logs, filter);
        status.dataset.status = "success";
        status.textContent = `${logs.length} rows`;
        setTimeout(() => {
          status.textContent = "";
          delete status.dataset.status;
        }, 2500);
      } catch (error) {
        status.dataset.status = "error";
        status.textContent = "Download failed";
        console.error("[Power Browser v2] Unable to download logs.", {
          error,
        });
      } finally {
        button.disabled = false;
      }
    });

    root.append(button, status);
    return root;
  }

  /**
   * Inserts the downloader into the grouped-logs toolbar when it is available.
   *
   * @returns {void}
   */
  function installNextgenLogDownloader() {
    const existing = document.getElementById(
      "power-browser-log-downloader-v2",
    );

    if (!isNextgenLogsPage()) {
      existing?.remove();
      return;
    }

    if (existing) {
      return;
    }

    const target = document.evaluate(
      "/html/body/div[2]/div/div[3]/div/div/div/div[2]/div[2]/div[1]/div[1]",
      document,
      null,
      window.XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;

    if (!target) {
      return;
    }

    ensureNextgenLogDownloaderStyle();
    target.appendChild(createNextgenLogDownloader());
  }

  /**
   * Enables or disables the Next-gen grouped-log downloader.
   *
   * @returns {void}
   */
  function syncNextgenLogDownloader() {
    const shouldEnable =
      Boolean(getSettingValue("nextgenLogDumpDownloader")) &&
      isNextgenLogsPage();

    if (!shouldEnable) {
      nextgenLogDownloaderObserver?.disconnect();
      nextgenLogDownloaderObserver = null;
      document.getElementById("power-browser-log-downloader-v2")?.remove();
      releaseNextgenLogGraphqlCapture();
      return;
    }

    captureNextgenLogGraphqlRequests();

    const startInstaller = () => {
      if (
        !Boolean(getSettingValue("nextgenLogDumpDownloader")) ||
        !isNextgenLogsPage() ||
        !document.body
      ) {
        return;
      }

      installNextgenLogDownloader();
      if (!nextgenLogDownloaderObserver) {
        nextgenLogDownloaderObserver = new MutationObserver(
          installNextgenLogDownloader,
        );
        nextgenLogDownloaderObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }
    };

    if (document.body) {
      startInstaller();
    } else {
      document.addEventListener("DOMContentLoaded", startInstaller, {
        once: true,
      });
    }
  }

  /**
   * Starts early capture and keeps the downloader aligned with SPA navigation.
   *
   * @returns {void}
   */
  function initializeNextgenLogDownloader() {
    syncNextgenLogDownloader();
  }

