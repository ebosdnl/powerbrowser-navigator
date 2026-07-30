  const POWER_BROWSER_RELEASE_API =
    "https://api.github.com/repos/ebosdnl/powerbrowser-navigator/releases/latest";
  const POWER_BROWSER_RELEASE_CACHE_TTL = 6 * 60 * 60 * 1000;

  function requestLatestPowerBrowserRelease() {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("Release checks are unavailable."));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: POWER_BROWSER_RELEASE_API,
        headers: {
          Accept: "application/vnd.github+json",
        },
        timeout: 10000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(
              new Error(
                `GitHub release check failed with status ${response.status}.`,
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch {
            reject(new Error("GitHub returned invalid release data."));
          }
        },
        onerror: () =>
          reject(new Error("Unable to reach GitHub Releases.")),
        ontimeout: () =>
          reject(new Error("The GitHub release check timed out.")),
      });
    });
  }

  function normalizePowerBrowserRelease(release) {
    const version = String(release?.tag_name || "").replace(/^v/i, "");
    if (!version || release?.draft || release?.prerelease) {
      return null;
    }
    const asset = Array.isArray(release.assets)
      ? release.assets.find(
          (candidate) =>
            candidate.name === "bb-powerbrowser.user.js",
        )
      : null;
    return {
      version,
      releaseUrl:
        release.html_url ||
        "https://github.com/ebosdnl/powerbrowser-navigator/releases/latest",
      downloadUrl:
        asset?.browser_download_url ||
        "https://github.com/ebosdnl/powerbrowser-navigator/releases/latest/download/bb-powerbrowser.user.js",
      publishedAt: release.published_at || null,
    };
  }

  function updatePowerBrowserReleaseIndicator(navigator) {
    const button =
      navigator.controls.get("settingsButton") ||
      document.getElementById("settingsButton");
    if (!button) {
      return;
    }
    const available = Boolean(powerBrowserUpdateState?.available);
    button.classList.toggle(
      "power-browser-update-available-v2",
      available,
    );
    button.title = available
      ? `Power Browser ${powerBrowserUpdateState.version} is available`
      : powerBrowserUpdateState?.development
        ? `Development version ${powerBrowserUpdateState.currentVersion}; latest public release ${powerBrowserUpdateState.version}`
        : "Power Browser settings";
    if (available) {
      button.setAttribute(
        "aria-label",
        `Settings. Power Browser ${powerBrowserUpdateState.version} is available.`,
      );
    } else {
      button.removeAttribute("aria-label");
    }
  }

  function notifyPowerBrowserRelease(release) {
    const notificationKey = "powerBrowserLastNotifiedRelease";
    if (
      GM_getValue(notificationKey, "") === release.version ||
      typeof globalThis.GM_notification !== "function"
    ) {
      return;
    }
    GM_setValue(notificationKey, release.version);
    globalThis.GM_notification({
      title: "Power Browser update available",
      text: `Version ${release.version} was published through GitHub Releases.`,
      onclick: () => openPowerBrowserTab(release.downloadUrl),
    });
  }

  async function checkPowerBrowserReleaseUpdate(
    navigator,
    { force = false } = {},
  ) {
    powerBrowserUpdateState = {
      ...powerBrowserUpdateState,
      checking: true,
      error: null,
    };
    if (settingsState?.activeTab === "settings") {
      renderSettingsTab(navigator);
    }
    try {
      const cached = GM_getValue("powerBrowserLatestRelease", null);
      const useCachedRelease = Boolean(
        !force &&
          cached?.fetchedAt &&
          Date.now() - cached.fetchedAt <
            POWER_BROWSER_RELEASE_CACHE_TTL,
      );
      const release = useCachedRelease
        ? cached.release
        : normalizePowerBrowserRelease(
            await requestLatestPowerBrowserRelease(),
          );
      if (!release) {
        throw new Error("No stable Power Browser release was found.");
      }
      if (!useCachedRelease) {
        GM_setValue("powerBrowserLatestRelease", {
          fetchedAt: Date.now(),
          release,
        });
      }
      const currentVersion = String(
        globalThis.GM_info?.script?.version || "0.0.0",
      );
      const available = isVersionNewer(
        release.version,
        currentVersion,
      );
      powerBrowserUpdateState = {
        ...release,
        currentVersion,
        checking: false,
        available,
        development:
          !available &&
          isVersionNewer(currentVersion, release.version),
        error: null,
      };
      updatePowerBrowserReleaseIndicator(navigator);
      if (powerBrowserUpdateState.available) {
        notifyPowerBrowserRelease(powerBrowserUpdateState);
      }
    } catch (error) {
      powerBrowserUpdateState = {
        checking: false,
        available: false,
        development: false,
        currentVersion: String(
          globalThis.GM_info?.script?.version || "0.0.0",
        ),
        error:
          error instanceof Error
            ? error.message
            : "Unable to check for updates.",
      };
      diagnosticTimeline.add({
        source: "release-update",
        status: "warn",
        message: powerBrowserUpdateState.error,
      });
    }
    if (settingsState?.activeTab === "settings") {
      renderSettingsTab(navigator);
    }
    return powerBrowserUpdateState;
  }

  async function initializeReleaseUpdateChecker(navigator) {
    await checkPowerBrowserReleaseUpdate(navigator);
  }
