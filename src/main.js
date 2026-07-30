  const applicationContext = createApplicationContext();
  const featureRegistry = createFeatureRegistry(logger.child("features"));

  function updateCurrentPowerBrowserContext(patch) {
    currentPowerBrowserContext = applicationContext.update(patch);
    return currentPowerBrowserContext;
  }

  async function retryApplicationSwitcherAuthentication() {
    const identifier = currentPowerBrowserContext?.identifier;
    if (!identifier) {
      updateApplicationSwitcherStatus(
        "manual-login-required",
        "The current application could not be identified. Visit my.bettyblocks.com, then reload this page.",
      );
      return;
    }

    updateApplicationSwitcherStatus(
      "loading",
      "Retrying sandbox authentication…",
    );
    const applicationFamily = await fetchApplicationFamily(identifier, true);
    const artifactData = await ensureArtifactFreshAfterFamilyMerge(
      currentPowerBrowserContext?.artifactData,
      applicationFamily,
    );
    updateCurrentPowerBrowserContext({
      artifactData,
      applicationFamily,
    });
    configureApplicationSwitcher(
      activePowerBrowserNavigator,
      applicationFamily,
      identifier,
      currentPowerBrowserContext?.siteType || SiteType.UNKNOWN,
    );
  }

  featureRegistry.register({
    name: "betty5-action-highlighting",
    start: applyBetty5ActionHighlighting,
    sync() {
      clearTimeout(betty5HighlightRetry);
      betty5HighlightRetry = setTimeout(applyBetty5ActionHighlighting, 200);
    },
    stop() {
      clearTimeout(betty5HighlightRetry);
    },
  });
  featureRegistry.register({
    name: "betty5-password-revealer",
    start: applyBetty5PasswordRevealer,
    sync() {
      remaskBetty5Passwords();
      clearTimeout(betty5PasswordRetry);
      betty5PasswordRetry = setTimeout(applyBetty5PasswordRevealer, 200);
    },
    stop() {
      clearTimeout(betty5PasswordRetry);
      betty5PasswordObserver?.disconnect();
      betty5PasswordObserver = null;
      remaskBetty5Passwords();
    },
  });
  featureRegistry.register({
    name: "betty5-variable-search",
    start: applyBetty5VariableSearch,
    sync: applyBetty5VariableSearch,
    stop: cleanupBetty5VariableSearch,
  });
  featureRegistry.register({
    name: "ui-builder-mask",
    start: applyUiBuilderMaskSetting,
    sync: applyUiBuilderMaskSetting,
  });
  featureRegistry.register({
    name: "nextgen-action-playground",
    start: applyNextgenActionPlaygroundSetting,
    sync: applyNextgenActionPlaygroundSetting,
    stop() {
      clearTimeout(nextgenActionPlaygroundTimer);
      clearTimeout(nextgenActionValidationTimer);
      nextgenActionPlaygroundObserver?.disconnect();
      nextgenActionPlaygroundObserver = null;
      cleanupActionPlaygroundEnhancements();
    },
  });
  featureRegistry.register({
    name: "nextgen-log-downloader",
    start: initializeNextgenLogDownloader,
    sync: syncNextgenLogDownloader,
    stop() {
      nextgenLogDownloaderObserver?.disconnect();
      nextgenLogDownloaderObserver = null;
      document.getElementById("power-browser-log-downloader-v2")?.remove();
      releaseNextgenLogGraphqlCapture();
    },
  });

  function synchronizePowerBrowserRoute(navigator) {
    if (!currentPowerBrowserContext) {
      return;
    }

    const artifactData = currentPowerBrowserContext.artifactData;
    const applicationFamily =
      currentPowerBrowserContext.applicationFamily;
    const identifier =
      resolveApplicationIdentifier(artifactData) ||
      currentPowerBrowserContext.identifier;
    const siteType = detectSiteType(artifactData);
    updateCurrentPowerBrowserContext({
      artifactData,
      applicationFamily,
      identifier,
      siteType,
    });

    applyFeatureFlagSettings(siteType);
    void featureRegistry.sync(currentPowerBrowserContext);
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

    if (settingsState?.activeTab === "info") {
      renderSettingsTab(navigator);
    }
  }

  if (!document.body) {
    await new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", resolve, { once: true });
    });
  }

  // This dialog can open before artifact and application-family requests have
  // finished, so its observer must start independently of main initialization.
  applyNextgenActionPlaygroundSetting();

  const navigator = initializeNavigator();
  activePowerBrowserNavigator = navigator;
  updateApplicationSwitcherStatus(
    "loading",
    "Loading sandbox information…",
  );
  initializeSettings(navigator);
  initializeHoldToHideMenu(navigator);
  initializeArtifactExplorer(navigator);
  initializeCommandPalette(navigator);
  void initializeReleaseUpdateChecker(navigator);
  let artifactData = await fetchArtifact();
  const siteType = detectSiteType(artifactData);
  const applicationIdentifier = resolveApplicationIdentifier(artifactData);
  updateCurrentPowerBrowserContext({
    artifactData,
    siteType,
    identifier: applicationIdentifier,
  });
  applyFeatureFlagSettings(siteType);
  applyBetty5Setting(
    "extraHotfix",
    getSettingValue("extraHotfix"),
  );
  applyBetty5Setting(
    "extraAdvancedMode",
    getSettingValue("extraAdvancedMode"),
  );
  applyHotfixMenuState();
  await featureRegistry.start(currentPowerBrowserContext);
  window.addEventListener(
    "pagehide",
    () => {
      void featureRegistry.stop(currentPowerBrowserContext);
    },
    { once: true },
  );
  configureNavigator(navigator, {
    artifactData,
    siteType,
    identifier: applicationIdentifier,
  });
  configureModelSearch(navigator, artifactData, applicationIdentifier);

  const applicationFamily = await fetchApplicationFamily(applicationIdentifier);
  artifactData = await ensureArtifactFreshAfterFamilyMerge(
    artifactData,
    applicationFamily,
  );
  updateCurrentPowerBrowserContext({
    artifactData,
    applicationFamily,
  });
  if (settingsState?.activeTab === "info") {
    renderSettingsTab(navigator);
  }
  configureModelSearch(
    navigator,
    artifactData,
    applicationIdentifier,
  );
  configureNavigator(navigator, {
    artifactData,
    siteType,
    identifier: applicationIdentifier,
    applicationFamily,
  });
  configureApplicationSwitcher(
    navigator,
    applicationFamily,
    applicationIdentifier,
    siteType,
  );
  subscribePowerBrowserNavigation(() =>
    synchronizePowerBrowserRoute(navigator),
  );

  // Keep this result easy to inspect and reuse while v2 is being developed.
  const powerBrowser = Object.freeze({
    context: applicationContext,
    features: featureRegistry.names(),
    get artifact() {
      return currentPowerBrowserContext?.artifactData || null;
    },
    get siteType() {
      return currentPowerBrowserContext?.siteType || SiteType.UNKNOWN;
    },
    get applicationFamily() {
      return currentPowerBrowserContext?.applicationFamily || null;
    },
    requestGraphQL,
    refreshData: () => refreshPowerBrowserData(navigator),
  });

  window.powerBrowserV2 = powerBrowser;
  window.setTimeout(() => {
    if (!navigator.navigatorBar.isConnected) {
      reportPowerBrowserHealthIssue(
        "navigator",
        "The navigation bar was removed from the page DOM.",
      );
    }
    if (!navigator.controls.get("settingsButton") && !document.getElementById("settingsButton")) {
      reportPowerBrowserHealthIssue(
        "settings",
        "The settings control could not be found.",
      );
    }
  }, 1500);
  logger.info("Initialized.", powerBrowser);
})();
