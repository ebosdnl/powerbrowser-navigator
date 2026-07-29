  const APPLICATION_FAMILY_QUERY = `
    query applicationFamily($identifier: String!) {
        applicationFamily(identifier: $identifier) {
            ... on Application {
                id
                appUuid
                parentId
                identifier
                name
                isBranch
                url
                insertedAt
                launchDate
                initials
                pdmDaysRemaining
                lastMerge {
                    insertedAt
                }
                lastRollback {
                    insertedAt
                }
                permissions {
                    isBuilder
                    isMember
                }
                organization {
                    name
                    id
                }
                applicationZone {
                    id
                    label
                    name
                    skipSandboxName
                }
                parent {
                    id
                    name
                    identifier
                }
            }
        }
    }
  `;

  /**
   * Read a cookie from the current document.
   * @param {string} name
   * @return {string|null}
   */
  function getCookieValue(name) {
    const cookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${name}=`));

    if (!cookie) {
      return null;
    }

    return decodeURIComponent(cookie.slice(name.length + 1));
  }

  /**
   * Find the CSRF token used by Betty Blocks APIs.
   * @return {string|null}
   */
  function getCsrfToken() {
    return (
      document.querySelector(PowerBrowserSelectors.csrfMeta)?.content ||
      getCookieValue("x-csrf-token") ||
      getCookieValue("ide_csrf_token") ||
      getCookieValue("csrf_token") ||
      getCookieValue("_csrf_token")
    );
  }

  /**
   * Perform an authenticated GraphQL request through the userscript manager.
   * @param {object} request
   * @param {string} request.url
   * @param {string} request.query
   * @param {object} [request.variables]
   * @param {string} [request.operationName]
   * @param {string} [request.csrfToken]
   * @param {object} [request.headers]
   * @param {number} [request.timeout]
   * @param {string} [request.cookie]
   * @return {Promise<object>}
   */
  function requestGraphQL({
    url,
    query,
    variables = {},
    operationName,
    csrfToken = getCsrfToken(),
    headers = {},
    timeout = 10000,
    cookie = "",
  }) {
    const rejectImmediately = (error) => {
      updatePowerBrowserDiagnostic(
        "graphql",
        "error",
        error.message,
        error,
      );
      return Promise.reject(error);
    };
    if (typeof GM_xmlhttpRequest !== "function") {
      return rejectImmediately(
        new Error("GM_xmlhttpRequest is unavailable."),
      );
    }

    if (!url || !query) {
      return rejectImmediately(
        new Error("A GraphQL URL and query are required."),
      );
    }

    if (!csrfToken) {
      return rejectImmediately(
        new Error("No CSRF token is available."),
      );
    }

    updatePowerBrowserDiagnostic(
      "graphql",
      "loading",
      `${operationName || "GraphQL"} request in progress…`,
    );
    return new Promise((resolve, reject) => {
      const fail = (error) => {
        updatePowerBrowserDiagnostic(
          "graphql",
          "error",
          error.message,
          error,
        );
        reject(error);
      };
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: {
          Accept: "*/*",
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          ...headers,
        },
        data: JSON.stringify({
          operationName,
          variables,
          query,
        }),
        timeout,
        anonymous: false,
        ...(cookie ? { cookie } : {}),
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            const requestError = new Error(
              `GraphQL request failed with status ${response.status}.`,
            );
            requestError.status = response.status;
            requestError.finalUrl = response.finalUrl;
            fail(requestError);
            return;
          }

          try {
            const payload = JSON.parse(response.responseText);

            if (payload.errors?.length) {
              const graphqlError = new Error(
                payload.errors.map((error) => error.message).join("; "),
              );
              if (isPowerBrowserAuthenticationError(payload.errors)) {
                graphqlError.status = 401;
                graphqlError.authenticationError = true;
              }
              fail(graphqlError);
              return;
            }

            updatePowerBrowserDiagnostic(
              "graphql",
              "success",
              `${operationName || "GraphQL"} request completed.`,
            );
            resolve(payload.data);
          } catch (error) {
            fail(
              new Error("Unable to parse the GraphQL response.", {
                cause: error,
              }),
            );
          }
        },
        onerror: () =>
          fail(new Error("GraphQL network request failed.")),
        ontimeout: () =>
          fail(new Error("GraphQL request timed out.")),
      });
    });
  }

  /**
   * Read cookies belonging to the My Betty Blocks GraphQL endpoint.
   * @return {Promise<{csrfToken: string|null, cookieHeader: string, cookieNames: string[]}>}
   */
  function getMyBettyCookieContext() {
    if (
      typeof GM_cookie === "undefined" ||
      typeof GM_cookie.list !== "function"
    ) {
      return Promise.resolve({
        csrfToken: null,
        cookieHeader: "",
        cookieNames: [],
      });
    }

    return new Promise((resolve) => {
      GM_cookie.list(
        {
          url: "https://my.bettyblocks.com/api/graphql",
        },
        (cookies, error) => {
          if (error) {
            console.warn(
              "[Power Browser v2] Unable to read My Betty Blocks cookies.",
              error,
            );
            resolve({
              csrfToken: null,
              cookieHeader: "",
              cookieNames: [],
            });
            return;
          }

          const sortedCookies = [...cookies].sort(
            (left, right) =>
              String(right.path || "").length -
              String(left.path || "").length,
          );
          const preferredCookieNames = [
            "csrf_token",
            "_csrf_token",
            "CSRF-TOKEN",
            "XSRF-TOKEN",
            "xsrf-token",
          ];
          const csrfCookie =
            preferredCookieNames
              .map((name) =>
                sortedCookies.find((cookie) => cookie.name === name),
              )
              .find(Boolean) ||
            sortedCookies.find((cookie) =>
              /(?:csrf|xsrf)/i.test(cookie.name),
            );

          resolve({
            csrfToken: csrfCookie?.value
              ? decodeURIComponent(csrfCookie.value)
              : null,
            cookieHeader: sortedCookies
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; "),
            cookieNames: sortedCookies.map((cookie) => cookie.name),
          });
        },
      );
    });
  }

  /**
   * Refreshes the access token in the existing My Betty Blocks session.
   * This mirrors the request made by the My Betty frontend before GraphQL.
   *
   * @param {string} cookieHeader
   * @returns {Promise<void>}
   */
  function refreshMyBettySession(cookieHeader) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: "https://my.bettyblocks.com/api/auth/refresh",
        headers: {
          Accept: "application/json",
        },
        timeout: 10000,
        anonymous: false,
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            logger.debug("My Betty session refreshed.");
            resolve();
            return;
          }

          const refreshError = new Error(
            `My Betty session refresh failed with status ${response.status}.`,
          );
          refreshError.status = response.status;
          reject(refreshError);
        },
        onerror: () =>
          reject(new Error("Unable to refresh the My Betty session.")),
        ontimeout: () =>
          reject(new Error("My Betty session refresh timed out.")),
      });
    });
  }

  /**
   * Retrieve authentication data belonging to the My Betty Blocks session.
   * @param {string} identifier
   * @param {boolean} [forceRefresh]
   * @return {Promise<{csrfToken: string, cookieHeader: string}>}
   */
  async function fetchMyBettyAuthContext(identifier, forceRefresh = false) {
    const initialContext = await getMyBettyCookieContext();

    if (
      !forceRefresh &&
      initialContext.csrfToken &&
      initialContext.cookieHeader
    ) {
      return initialContext;
    }

    if (forceRefresh) {
      await refreshMyBettySession(initialContext.cookieHeader);
      const refreshedContext = await getMyBettyCookieContext();
      if (refreshedContext.csrfToken && refreshedContext.cookieHeader) {
        return refreshedContext;
      }
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://my.bettyblocks.com/applications/${encodeURIComponent(identifier)}`,
        headers: {
          Accept: "text/html",
        },
        timeout: 10000,
        anonymous: false,
        ...(initialContext.cookieHeader
          ? { cookie: initialContext.cookieHeader }
          : {}),
        onload: async (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(
              new Error(
                `Unable to open My Betty Blocks (status ${response.status}).`,
              ),
            );
            return;
          }

          if (
            /(?:sign[_-]?in|login)/i.test(response.finalUrl || "")
          ) {
            reject(
              new Error(
                "Your My Betty Blocks session has expired. Sign in at my.bettyblocks.com and reload this page.",
              ),
            );
            return;
          }

          const page = new DOMParser().parseFromString(
            response.responseText,
            "text/html",
          );
          const refreshedContext = await getMyBettyCookieContext();
          const csrfToken =
            page.querySelector('meta[name="csrf-token"]')?.content ||
            refreshedContext.csrfToken ||
            initialContext.csrfToken;
          const cookieHeader =
            refreshedContext.cookieHeader ||
            initialContext.cookieHeader;

          if (!csrfToken || !cookieHeader) {
            reject(
              new Error(
                "My Betty Blocks authentication cookies are unavailable. Sign in at my.bettyblocks.com and reload this page.",
              ),
            );
            return;
          }

          resolve({
            csrfToken,
            cookieHeader,
          });
        },
        onerror: () =>
          reject(new Error("Unable to connect to My Betty Blocks.")),
        ontimeout: () =>
          reject(new Error("My Betty Blocks token request timed out.")),
      });
    });
  }

  /**
   * Fetch application-family information from My Betty Blocks.
   * @param {string} identifier
   * @param {boolean} [force]
   * @return {Promise<object|null>}
   */
  async function fetchApplicationFamily(identifier, force = false) {
    if (!identifier) {
      return null;
    }

    try {
      return await getCachedPowerBrowserData(
        applicationFamilyRequestCache,
        identifier,
        async () => {
          updatePowerBrowserDiagnostic(
            "applicationFamily",
            "loading",
            "Loading application-family data…",
          );
          const requestApplicationFamily = (authContext) =>
            requestGraphQL({
              url: "https://my.bettyblocks.com/api/graphql",
              operationName: "applicationFamily",
              variables: { identifier },
              query: APPLICATION_FAMILY_QUERY,
              csrfToken: authContext.csrfToken,
              cookie: authContext.cookieHeader,
              headers: {
                Referer: `https://my.bettyblocks.com/applications/${encodeURIComponent(identifier)}`,
              },
            });
          let authContext =
            await fetchMyBettyAuthContext(identifier);
          let data;

          try {
            data = await requestApplicationFamily(authContext);
          } catch (error) {
            if (error?.status !== 401) {
              throw error;
            }

            authContext = await fetchMyBettyAuthContext(
              identifier,
              true,
            );

            try {
              data = await requestApplicationFamily(authContext);
            } catch (retryError) {
              if (retryError?.status === 401) {
                throw new Error(
                  "My Betty Blocks rejected the authenticated session. Sign in at https://my.bettyblocks.com and reload this page.",
                  { cause: retryError },
                );
              }

              throw retryError;
            }
          }

          const applicationFamily =
            data?.applicationFamily || null;
          updatePowerBrowserDiagnostic(
            "applicationFamily",
            applicationFamily ? "success" : "warning",
            applicationFamily
              ? `Loaded ${Array.isArray(applicationFamily) ? applicationFamily.length : 1} application-family entries.`
              : "No application-family data was returned.",
          );
          return applicationFamily;
        },
        force,
      );
    } catch (error) {
      updatePowerBrowserDiagnostic(
        "applicationFamily",
        "error",
        error instanceof Error
          ? error.message
          : "Unable to retrieve application-family data.",
        error,
      );
      console.warn(
        "[Power Browser v2] Unable to retrieve application-family data.",
        {
          identifier,
          error,
        },
      );
      return null;
    }
  }

  /**
   * Resolve the static artifact location for the current host.
   * Runtime artifacts for bettyblocks.com hosts are served from betty.app.
   * @return {string}
   */
  function resolveArtifactUrl() {
    const artifactHost = location.hostname.replace(
      /\.bettyblocks\.com$/i,
      ".betty.app",
    );
    return new URL(
      "/static/artifact.json",
      `${location.protocol}//${artifactHost}`,
    ).href;
  }

  /**
   * Retrieve and parse the current application's static artifact.
   * @param {boolean} [force]
   * @return {Promise<object|null>}
   */
  async function fetchArtifact(force = false) {
    const artifactUrl = resolveArtifactUrl();

    try {
      return await getCachedPowerBrowserData(
        artifactRequestCache,
        artifactUrl,
        async () => {
          updatePowerBrowserDiagnostic(
            "artifact",
            "loading",
            "Loading runtime artifact…",
          );
          const response = await fetch(artifactUrl, {
            // The betty.app artifact endpoint allows cross-origin requests with
            // a wildcard origin, which cannot be combined with credentials.
            credentials: "omit",
            cache: force ? "no-store" : "default",
          });

          if (!response.ok) {
            throw new Error(
              `Artifact request failed with status ${response.status}`,
            );
          }

          const artifactData = await response.json();
          updatePowerBrowserDiagnostic(
            "artifact",
            "success",
            "Runtime artifact loaded.",
          );
          return artifactData;
        },
        force,
      );
    } catch (error) {
      updatePowerBrowserDiagnostic(
        "artifact",
        "error",
        error instanceof Error
          ? error.message
          : "Unable to retrieve the artifact.",
        error,
      );
      console.warn("[Power Browser v2] Unable to retrieve the artifact.", {
        artifactUrl,
        error,
      });
      return null;
    }
  }

  /**
   * Refreshes the artifact when a family merge is newer than its cache entry.
   *
   * @param {object|null} artifactData
   * @param {object|object[]|null} applicationFamily
   * @returns {Promise<object|null>}
   */
  async function ensureArtifactFreshAfterFamilyMerge(
    artifactData,
    applicationFamily,
  ) {
    const applications = Array.isArray(applicationFamily)
      ? applicationFamily
      : applicationFamily
        ? [applicationFamily]
        : [];
    const latestMergeTimestamp = Math.max(
      0,
      ...applications.map((application) => {
        const timestamp = Date.parse(
          application?.lastMerge?.insertedAt || "",
        );
        return Number.isNaN(timestamp) ? 0 : timestamp;
      }),
    );
    if (!latestMergeTimestamp) {
      return artifactData;
    }

    const artifactUrl = resolveArtifactUrl();
    const cacheEntry = artifactRequestCache.get(artifactUrl);
    const artifactCachedAt = cacheEntry?.cachedAt || 0;
    if (
      artifactCachedAt &&
      latestMergeTimestamp <= artifactCachedAt
    ) {
      return artifactData;
    }

    updatePowerBrowserDiagnostic(
      "artifact",
      "loading",
      "A newer sandbox merge was detected; refreshing the artifact…",
    );
    const refreshedArtifact = await fetchArtifact(true);
    if (!refreshedArtifact) {
      return artifactData;
    }

    const refreshedCacheEntry =
      artifactRequestCache.get(artifactUrl);
    if (refreshedCacheEntry) {
      // A merge timestamp can be slightly ahead of the browser clock. Since
      // this fetch happened after observing it, treat that merge as covered.
      refreshedCacheEntry.cachedAt = Math.max(
        refreshedCacheEntry.cachedAt || 0,
        latestMergeTimestamp,
      );
    }
    updatePowerBrowserDiagnostic(
      "artifact",
      "success",
      "Artifact refreshed after a newer merge to parent.",
    );
    return refreshedArtifact;
  }

  /**
   * Detect the Betty Blocks site type using the current URL and page globals.
   * @param {object|null} artifactData
   * @return {string}
   */
  function detectSiteType(artifactData) {
    if (location.pathname.includes("/api/runtime/")) {
      return SiteType.PLAYGROUND;
    }

    if (
      location.hostname.endsWith(".bettyblocks.com") &&
      location.pathname.startsWith("/app/")
    ) {
      return SiteType.NEXTGEN;
    }

    if (location.hostname.endsWith(".bettyblocks.com")) {
      return SiteType.BETTY5;
    }

    if (pageWindow.Betty) {
      return SiteType.BETTY5;
    }

    if (pageWindow.artifact || artifactData) {
      return SiteType.RUNTIME;
    }

    return SiteType.UNKNOWN;
  }

  /**
   * Resolve the application identifier from the artifact, Betty 5, or hostname.
   * @param {object|null} artifactData
   * @return {string|null}
   */
  function resolveApplicationIdentifier(artifactData) {
    if (artifactData?.applicationIdentifier || artifactData?.appIdentifier) {
      return artifactData.applicationIdentifier || artifactData.appIdentifier;
    }

    if (pageWindow.Betty?.application_identifier) {
      return pageWindow.Betty.application_identifier;
    }

    const [subdomain] = location.hostname.split(".");
    return subdomain && subdomain !== "www" ? subdomain : null;
  }

  /**
   * Create the navigator immediately in its loading state.
   * @return {object}
   */
