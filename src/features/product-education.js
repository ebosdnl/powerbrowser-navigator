  const POWER_BROWSER_SEEN_VERSION_KEY =
    "powerBrowserLastSeenVersion";
  let powerBrowserEducationState = null;

  function createPowerBrowserEducationFeature(icon, title, description) {
    const feature = document.createElement("div");
    feature.className = "power-browser-education-feature-v2";
    const marker = document.createElement("span");
    marker.className = "power-browser-education-icon-v2";
    marker.textContent = icon;
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const text = document.createElement("span");
    text.textContent = description;
    copy.append(heading, text);
    feature.append(marker, copy);
    return feature;
  }

  function ensurePowerBrowserEducation(navigator) {
    if (powerBrowserEducationState) {
      powerBrowserEducationState.navigator = navigator;
      return powerBrowserEducationState;
    }
    const overlay = document.createElement("div");
    overlay.className = "power-browser-education-overlay-v2";
    overlay.setAttribute("aria-hidden", "true");
    const dialog = document.createElement("section");
    dialog.className = "power-browser-education-dialog-v2";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-hidden", "true");
    dialog.setAttribute(
      "aria-labelledby",
      "power-browser-education-title-v2",
    );
    dialog.setAttribute(
      "aria-describedby",
      "power-browser-education-description-v2",
    );
    const header = document.createElement("header");
    header.className = "power-browser-education-header-v2";
    const heading = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.className = "power-browser-education-eyebrow-v2";
    const title = document.createElement("h2");
    title.id = "power-browser-education-title-v2";
    const description = document.createElement("p");
    description.id = "power-browser-education-description-v2";
    heading.append(eyebrow, title, description);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "power-browser-education-close-v2";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    header.append(heading, close);
    const body = document.createElement("div");
    body.className = "power-browser-education-body-v2";
    const footer = document.createElement("footer");
    footer.className = "power-browser-education-footer-v2";
    dialog.append(header, body, footer);
    document.body.append(overlay, dialog);
    powerBrowserEducationState = {
      navigator,
      overlay,
      dialog,
      eyebrow,
      title,
      description,
      body,
      footer,
      close,
    };
    overlay.addEventListener("click", closePowerBrowserEducation);
    close.addEventListener("click", closePowerBrowserEducation);
    return powerBrowserEducationState;
  }

  function renderPowerBrowserEducation(mode) {
    const state = powerBrowserEducationState;
    state.body.replaceChildren();
    state.footer.replaceChildren();
    const primary = document.createElement("button");
    primary.type = "button";
    primary.className = "power-browser-education-primary-v2";
    primary.textContent = "Got it";
    primary.addEventListener("click", closePowerBrowserEducation);
    const secondary = document.createElement("button");
    secondary.type = "button";
    secondary.className = "power-browser-education-secondary-v2";

    if (mode === "welcome") {
      state.eyebrow.textContent = "Welcome";
      state.title.textContent = "Meet Power Browser";
      state.description.textContent =
        "Your navigation and inspection workspace for Betty Blocks applications.";
      [
        [
          "⌘",
          "Command palette",
          "Press Ctrl+Shift+U to find destinations and common actions.",
        ],
        [
          "↔",
          "Sandbox switching",
          "Move between applications in the same family; Power Browser will explain when sign-in is required.",
        ],
        [
          "◎",
          "Global and application settings",
          "Keep global defaults and override only the settings that differ for one application.",
        ],
        [
          "{}",
          "Artifact Explorer",
          "Search runtime entities, inspect relationships, audit structure, and compare local snapshots.",
        ],
      ].forEach((feature) =>
        state.body.appendChild(
          createPowerBrowserEducationFeature(...feature),
        ),
      );
      secondary.textContent = "Open settings";
      secondary.addEventListener("click", () => {
        closePowerBrowserEducation();
        openSettings(state.navigator);
      });
    } else {
      const version = String(
        globalThis.GM_info?.script?.version || "",
      );
      state.eyebrow.textContent = version
        ? `Updated to ${version}`
        : "Updated";
      state.title.textContent = "What’s new";
      state.description.textContent =
        "Version 3.5.2 improves disabled-state clarity and recovery controls.";
      [
        [
          "◐",
          "Clear hotfix disabled states",
          "Disabled navigation buttons remain visually distinct while Betty 5 hotfix mode is active.",
        ],
        [
          "↻",
          "Reliable sandbox recovery",
          "The unavailable sandbox-switcher dialog stays open while moving to Retry or Open My Betty.",
        ],
      ].forEach((feature) =>
        state.body.appendChild(
          createPowerBrowserEducationFeature(...feature),
        ),
      );
      secondary.textContent = "Open Info";
      secondary.addEventListener("click", () => {
        closePowerBrowserEducation();
        settingsState.activeTab = "info";
        openSettings(state.navigator);
      });
    }
    state.footer.append(secondary, primary);
  }

  function openPowerBrowserEducation(navigator, mode = "welcome") {
    const state = ensurePowerBrowserEducation(navigator);
    closeSettings();
    closeModelSearch();
    closeArtifactExplorer();
    closeCommandPalette();
    renderPowerBrowserEducation(mode);
    const theme = getPowerBrowserTheme();
    state.dialog.classList.toggle(
      "power-browser-dark-v2",
      theme === "dark",
    );
    state.dialog.classList.toggle(
      "power-browser-betty-theme-v2",
      theme === "betty",
    );
    state.overlay.classList.add("open");
    state.dialog.classList.add("open");
    openPowerBrowserModal({
      dialog: state.dialog,
      overlay: state.overlay,
      close: closePowerBrowserEducation,
      initialFocus: () =>
        state.footer.querySelector(
          ".power-browser-education-primary-v2",
        ),
      announcement:
        mode === "welcome"
          ? "Welcome to Power Browser."
          : "Power Browser has been updated.",
    });
  }

  function closePowerBrowserEducation() {
    if (
      !powerBrowserEducationState?.dialog.classList.contains("open")
    ) {
      return;
    }
    powerBrowserEducationState.overlay.classList.remove("open");
    powerBrowserEducationState.dialog.classList.remove("open");
    closePowerBrowserModal(powerBrowserEducationState.dialog);
  }

  function initializePowerBrowserEducation(navigator) {
    const currentVersion = String(
      globalThis.GM_info?.script?.version || "unknown",
    );
    const seenVersion = String(
      GM_getValue(POWER_BROWSER_SEEN_VERSION_KEY, ""),
    );
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("Show Power Browser welcome", () =>
        openPowerBrowserEducation(navigator, "welcome"),
      );
    }
    if (seenVersion === currentVersion) {
      return;
    }
    GM_setValue(POWER_BROWSER_SEEN_VERSION_KEY, currentVersion);
    window.setTimeout(
      () =>
        openPowerBrowserEducation(
          navigator,
          seenVersion ? "updated" : "welcome",
        ),
      350,
    );
  }
