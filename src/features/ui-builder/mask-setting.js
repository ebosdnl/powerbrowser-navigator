  function applyUiBuilderMaskSetting() {
    if (
      currentPowerBrowserContext?.siteType !== SiteType.BETTY5 ||
      !location.hash.startsWith("#pages_overview")
    ) {
      return;
    }

    const shouldRemove = Boolean(
      getSettingValue("extraPageUIRemoveUneditableLayer"),
    );
    let attempts = 0;
    const updateMask = () => {
      attempts += 1;
      const iframe = document.getElementById("endpoint_preview");
      const iframeDocument =
        iframe?.contentDocument || iframe?.contentWindow?.document;
      const container = iframeDocument?.getElementById("container");
      const mask = iframeDocument?.getElementById("pretty-betty-mask");

      if (shouldRemove && mask) {
        mask.remove();
        return;
      }

      if (!shouldRemove && container && !mask) {
        const replacementMask = iframeDocument.createElement("div");
        replacementMask.id = "pretty-betty-mask";
        container.appendChild(replacementMask);
        return;
      }

      if ((!iframeDocument || (shouldRemove && !mask)) && attempts < 20) {
        setTimeout(updateMask, 250);
      }
    };

    updateMask();
  }

  /**
   * Returns whether the current Next-gen route is an action editor.
   *
   * @returns {boolean}
   */
