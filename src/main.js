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
    currentPowerBrowserContext.identifier = identifier;
    currentPowerBrowserContext.siteType = siteType;

    applyFeatureFlagSettings(siteType);
    clearTimeout(betty5HighlightRetry);
    betty5HighlightRetry = setTimeout(
      applyBetty5ActionHighlighting,
      200,
    );
    remaskBetty5Passwords();
    clearTimeout(betty5PasswordRetry);
    betty5PasswordRetry = setTimeout(
      applyBetty5PasswordRevealer,
      200,
    );
    applyBetty5VariableSearch();
    applyUiBuilderMaskSetting();
    applyNextgenActionPlaygroundSetting();
    syncNextgenLogDownloader();
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
  initializeSettings(navigator);
  initializeHoldToHideMenu(navigator);
  let artifactData = await fetchArtifact();
  const siteType = detectSiteType(artifactData);
  const applicationIdentifier = resolveApplicationIdentifier(artifactData);
  currentPowerBrowserContext = {
    artifactData,
    siteType,
    identifier: applicationIdentifier,
  };
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
  applyBetty5ActionHighlighting();
  applyBetty5PasswordRevealer();
  applyBetty5VariableSearch();
  applyUiBuilderMaskSetting();
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
  currentPowerBrowserContext.artifactData = artifactData;
  currentPowerBrowserContext.applicationFamily = applicationFamily;
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
  console.info("[Power Browser v2] Initialized.", powerBrowser);
})();
