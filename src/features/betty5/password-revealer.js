  function getCurrentBetty5ConfigurationPassword() {
    const configurations = pageWindow.Betty?.Cache?.configurations?.models;

    if (!Array.isArray(configurations)) {
      return null;
    }

    const possibleIds = [
      location.hash.split("/").filter(Boolean).at(-1),
      location.pathname.split("/").filter(Boolean).at(-1),
      document.URL.split("/").filter(Boolean).at(-1),
    ].filter(Boolean);
    const configuration = configurations.find((model) =>
      possibleIds.includes(String(model?.attributes?.id)),
    );
    const settings = configuration?.attributes?.settings;

    if (!settings || typeof settings !== "object") {
      return null;
    }

    const passwordKey = Object.keys(settings).find((key) =>
      key.toLowerCase().includes("password"),
    );
    const password = passwordKey ? settings[passwordKey] : null;
    return password == null ? null : String(password);
  }

  function revealCurrentBetty5Password() {
    const password = getCurrentBetty5ConfigurationPassword();

    if (password == null) {
      return false;
    }

    let revealed = false;
    document
      .querySelectorAll(".form-control-static.input-label")
      .forEach((element) => {
        if (element.textContent.trim() !== "***") {
          return;
        }

        element.textContent = password;
        element.classList.add("power-browser-b5-password-v2");
        element.dataset.powerBrowserPasswordRevealed = "true";
        revealed = true;
      });
    document.querySelectorAll("input.form-control").forEach((input) => {
      if (input.value !== "***") {
        return;
      }

      input.dataset.powerBrowserOriginalType = input.type;
      input.dataset.powerBrowserPasswordRevealed = "true";
      input.value = password;
      input.type = "text";
      input.classList.add("power-browser-b5-password-v2");
      revealed = true;
    });
    return revealed;
  }

  function remaskBetty5Passwords() {
    document
      .querySelectorAll('[data-power-browser-password-revealed="true"]')
      .forEach((element) => {
        if (element instanceof window.HTMLInputElement) {
          element.value = "***";
          element.type =
            element.dataset.powerBrowserOriginalType || "password";
          delete element.dataset.powerBrowserOriginalType;
        } else {
          element.textContent = "***";
        }

        element.classList.remove("power-browser-b5-password-v2");
        delete element.dataset.powerBrowserPasswordRevealed;
      });
  }

  function applyBetty5PasswordRevealer() {
    const enabled =
      currentPowerBrowserContext?.siteType === SiteType.BETTY5 &&
      !location.hash.startsWith("#pages_overview") &&
      Boolean(getSettingValue("extraB5PasswordRevealer"));

    clearTimeout(betty5PasswordRetry);

    if (!enabled) {
      betty5PasswordObserver?.disconnect();
      betty5PasswordObserver = null;
      remaskBetty5Passwords();
      return;
    }

    if (!pageWindow.Betty?.Cache?.configurations?.models) {
      betty5PasswordRetry = setTimeout(
        applyBetty5PasswordRevealer,
        250,
      );
      return;
    }

    revealCurrentBetty5Password();

    if (!betty5PasswordObserver) {
      betty5PasswordObserver = new MutationObserver(() => {
        revealCurrentBetty5Password();
      });
      betty5PasswordObserver.observe(document, {
        childList: true,
        subtree: true,
      });
    }

  }

  /**
   * Adds the layout rules used by enhanced Betty 5 variable browsers.
   *
   * @returns {void}
   */
