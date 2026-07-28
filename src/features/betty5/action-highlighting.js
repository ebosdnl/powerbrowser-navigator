  function refreshBetty5ActionHighlighting() {
    const stackedViews = Object.values(
      pageWindow.Betty?.trail_view?.children?._views || {},
    );

    if (!stackedViews.length) {
      clearTimeout(betty5HighlightRetry);
      betty5HighlightRetry = setTimeout(() => {
        if (getSettingValue("extraB5Highlighting")) {
          refreshBetty5ActionHighlighting();
        }
      }, 250);
      return;
    }

    const actionIds = stackedViews.map(
      (view) => view.model?.attributes?.action_id,
    );
    const selectedRecordIds = stackedViews.map(
      (view) => view.model?.attributes?.selected_record_id,
    );

    actionIds.forEach((actionId, index) => {
      if (actionId === undefined) {
        return;
      }

      const actionView = stackedViews[index];
      const nextView = stackedViews[index + 1];
      const actionElements = [
        ...(actionView?.body?.el?.getElementsByClassName("event") || []),
      ];

      if (!nextView) {
        actionElements
          .find((element) => element.classList.contains("active"))
          ?.classList.remove("active");
        return;
      }

      const selectedAction = actionElements.find(
        (element) =>
          element.dataset.id === String(selectedRecordIds[index + 1]),
      );

      if (!selectedAction) {
        return;
      }

      actionElements
        .find((element) => element.classList.contains("active"))
        ?.classList.remove("active");
      selectedAction.classList.add("active");
    });
  }

  function applyBetty5ActionHighlighting() {
    const enabled =
      currentPowerBrowserContext?.siteType === SiteType.BETTY5 &&
      !location.hash.startsWith("#pages_overview") &&
      Boolean(getSettingValue("extraB5Highlighting"));

    document.documentElement.classList.toggle(
      "power-browser-b5-highlighting-v2",
      enabled,
    );
    clearTimeout(betty5HighlightRetry);

    if (!enabled) {
      document
        .querySelectorAll("div.event.active")
        .forEach((element) => element.classList.remove("active"));
      return;
    }

    refreshBetty5ActionHighlighting();

  }

