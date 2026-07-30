  function getCommandPaletteShortcut() {
    return String(
      getSettingValue("extraCommandPaletteShortcut") ||
        "Ctrl+Shift+U",
    );
  }

  function buildPowerBrowserCommands(navigator) {
    const commands = [
      {
        label: "Open Power Browser settings",
        keywords: "preferences configuration",
        action: () => openSettings(navigator),
      },
      {
        label: "Open sandbox switcher",
        keywords: "application environment branch production",
        available: !navigator.stateToggle.disabled,
        action: () => {
          setTimeout(() => {
            navigator.stateSwitcher.classList.add("open");
            navigator.stateToggle.setAttribute(
              "aria-expanded",
              "true",
            );
            navigator.stateMenu
              .querySelector(
                ".power-browser-state-option-v2:not(:disabled)",
              )
              ?.focus();
          }, 0);
        },
      },
      {
        label: "Search models and properties",
        keywords: "runtime model relation field",
        available: Boolean(modelSearchState?.entries.length),
        action: openModelSearch,
      },
      {
        label: "Open Artifact Explorer",
        keywords:
          "artifact pages endpoints actions models properties relationships health snapshots",
        available: Boolean(getCurrentArtifact()),
        action: () => openArtifactExplorer(navigator),
      },
      {
        label: "Refresh Power Browser data",
        keywords: "reload artifact application family",
        action: () => void refreshPowerBrowserData(navigator),
      },
      {
        label: "Toggle navigation bar",
        keywords: "show hide menu",
        action: () =>
          navigator.navigatorBar.classList.toggle(
            "power-browser-setting-hidden-v2",
          ),
      },
    ];

    navigator.controls.forEach((control, id) => {
      if (
        [
          "buttonRuntimeModelSearch",
          "buttonCopyBearer",
        ].includes(id) ||
        control.disabled ||
        control.classList.contains(NAV_DISABLED_CLASS) ||
        control.classList.contains("power-browser-hidden-v2") ||
        control.classList.contains(
          "power-browser-setting-hidden-v2",
        )
      ) {
        return;
      }
      const label =
        control.querySelector("span")?.textContent?.trim() || id;
      commands.push({
        label: `Navigate to ${label}`,
        keywords: `${id} link destination`,
        action: () => control.click(),
      });
    });

    const bearer = navigator.controls.get("buttonCopyBearer");
    if (bearer && !bearer.disabled) {
      commands.push({
        label: "Copy bearer token",
        keywords: "authentication clipboard runtime",
        action: () => bearer.click(),
      });
    }

    navigator.stateMenu
      .querySelectorAll(".power-browser-state-option-v2")
      .forEach((option) => {
        if (option.disabled || option.classList.contains("current")) {
          return;
        }
        const label =
          option.querySelector("span")?.textContent?.trim() ||
          option.textContent.trim();
        commands.push({
          label: `Switch to ${label}`,
          keywords: `sandbox application environment ${option.dataset.searchText || ""}`,
          action: () => option.click(),
        });
      });

    if (powerBrowserUpdateState?.available) {
      commands.push({
        label: `Install Power Browser ${powerBrowserUpdateState.version}`,
        keywords: "update release github latest",
        action: () =>
          openPowerBrowserTab(powerBrowserUpdateState.downloadUrl),
      });
    } else if (powerBrowserUpdateState?.development) {
      commands.push({
        label: `See latest public release (${powerBrowserUpdateState.version})`,
        keywords: "development version release github stable",
        action: () =>
          openPowerBrowserTab(powerBrowserUpdateState.releaseUrl),
      });
    }

    if (getCurrentArtifact()) {
      getArtifactExplorerEntries()
        .filter(
          (entry) =>
            !["models", "properties", "pages"].includes(
              entry.collection,
            ) &&
            !(
              ["endpoints", "fileAssets"].includes(
                entry.collection,
              ) &&
              !entry.record.url
            ),
        )
        .forEach((entry) => {
          commands.push({
            label: `${entry.kind}: ${entry.label}`,
            keywords: `artifact ${entry.searchText}`,
            action:
              ["endpoints", "fileAssets"].includes(
                entry.collection,
              )
                ? () =>
                    openPowerBrowserTab(
                      new URL(
                        String(entry.record.url),
                        location.origin,
                      ).href,
                    )
                : () => openArtifactExplorer(navigator, entry),
          });
        });
    }

    return commands.filter(
      (command) => command.available !== false,
    );
  }

  function renderCommandPaletteResults() {
    if (!commandPaletteState) {
      return;
    }
    const query = commandPaletteState.input.value
      .trim()
      .toLowerCase();
    commandPaletteState.filtered = commandPaletteState.commands
      .filter((command) =>
        `${command.label} ${command.keywords || ""}`
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 30);
    commandPaletteState.activeIndex = Math.min(
      Math.max(commandPaletteState.activeIndex, 0),
      Math.max(commandPaletteState.filtered.length - 1, 0),
    );
    commandPaletteState.results.replaceChildren();
    if (!commandPaletteState.filtered.length) {
      commandPaletteState.input.removeAttribute(
        "aria-activedescendant",
      );
      const empty = document.createElement("div");
      empty.className = "power-browser-command-empty-v2";
      empty.textContent = "No matching commands.";
      commandPaletteState.results.appendChild(empty);
      return;
    }
    commandPaletteState.filtered.forEach((command, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "power-browser-command-result-v2";
      button.id = `power-browser-command-result-${index}-v2`;
      button.setAttribute("role", "option");
      button.classList.toggle(
        "active",
        index === commandPaletteState.activeIndex,
      );
      button.setAttribute(
        "aria-selected",
        String(index === commandPaletteState.activeIndex),
      );
      button.textContent = command.label;
      button.addEventListener("mouseenter", () => {
        if (commandPaletteState.activeIndex === index) {
          return;
        }
        commandPaletteState.activeIndex = index;
        renderCommandPaletteResults();
      });
      button.addEventListener("click", () =>
        executeCommandPaletteCommand(command),
      );
      commandPaletteState.results.appendChild(button);
    });
    commandPaletteState.input.setAttribute(
      "aria-activedescendant",
      `power-browser-command-result-${commandPaletteState.activeIndex}-v2`,
    );
  }

  function executeCommandPaletteCommand(command) {
    closeCommandPalette();
    command.action();
  }

  function ensureCommandPalette(navigator) {
    if (commandPaletteState) {
      return commandPaletteState;
    }
    const overlay = document.createElement("div");
    overlay.className = "power-browser-command-overlay-v2";
    const dialog = document.createElement("section");
    dialog.className = "power-browser-command-dialog-v2";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Power Browser command palette");
    dialog.setAttribute("aria-hidden", "true");
    overlay.setAttribute("aria-hidden", "true");
    const input = document.createElement("input");
    input.type = "search";
    input.className = "power-browser-command-input-v2";
    input.placeholder = "Type a command or destination…";
    input.setAttribute("aria-label", "Search commands");
    input.setAttribute(
      "aria-controls",
      "power-browser-command-results-v2",
    );
    const results = document.createElement("div");
    results.className = "power-browser-command-results-v2";
    results.id = "power-browser-command-results-v2";
    results.setAttribute("role", "listbox");
    results.setAttribute("aria-label", "Available commands");
    dialog.append(input, results);
    document.body.append(overlay, dialog);
    commandPaletteState = {
      navigator,
      overlay,
      dialog,
      input,
      results,
      commands: [],
      filtered: [],
      activeIndex: 0,
      lastFocusedElement: null,
    };
    overlay.addEventListener("click", closeCommandPalette);
    input.addEventListener("input", () => {
      commandPaletteState.activeIndex = 0;
      renderCommandPaletteResults();
    });
    return commandPaletteState;
  }

  function openCommandPalette(navigator) {
    const state = ensureCommandPalette(navigator);
    closeSettings();
    closeModelSearch();
    closeArtifactExplorer();
    const theme = getPowerBrowserTheme();
    state.dialog.classList.toggle(
      "power-browser-dark-v2",
      theme === "dark",
    );
    state.dialog.classList.toggle(
      "power-browser-betty-theme-v2",
      theme === "betty",
    );
    state.commands = buildPowerBrowserCommands(navigator);
    state.input.value = "";
    state.activeIndex = 0;
    state.overlay.classList.add("open");
    state.dialog.classList.add("open");
    renderCommandPaletteResults();
    openPowerBrowserModal({
      dialog: state.dialog,
      overlay: state.overlay,
      close: closeCommandPalette,
      initialFocus: state.input,
      announcement: "Command palette opened.",
    });
  }

  function closeCommandPalette() {
    if (!commandPaletteState?.dialog.classList.contains("open")) {
      return;
    }
    commandPaletteState.overlay.classList.remove("open");
    commandPaletteState.dialog.classList.remove("open");
    closePowerBrowserModal(commandPaletteState.dialog);
  }

  function handleCommandPaletteKeydown(event, navigator) {
    const isOpen =
      commandPaletteState?.dialog.classList.contains("open");
    if (
      shortcutMatchesEvent(getCommandPaletteShortcut(), event)
    ) {
      event.preventDefault();
      isOpen
        ? closeCommandPalette()
        : openCommandPalette(navigator);
      return;
    }
    if (!isOpen) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!commandPaletteState.filtered.length) {
        return;
      }
      commandPaletteState.activeIndex =
        (commandPaletteState.activeIndex + 1) %
        commandPaletteState.filtered.length;
      renderCommandPaletteResults();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!commandPaletteState.filtered.length) {
        return;
      }
      commandPaletteState.activeIndex =
        (commandPaletteState.activeIndex -
          1 +
          commandPaletteState.filtered.length) %
        commandPaletteState.filtered.length;
      renderCommandPaletteResults();
    } else if (
      event.key === "Enter" &&
      commandPaletteState.filtered.length
    ) {
      event.preventDefault();
      executeCommandPaletteCommand(
        commandPaletteState.filtered[
          commandPaletteState.activeIndex
        ],
      );
    }
  }

  function initializeCommandPalette(navigator) {
    document.addEventListener("keydown", (event) =>
      handleCommandPaletteKeydown(event, navigator),
    );
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand(
        "Open Power Browser command palette",
        () => openCommandPalette(navigator),
      );
    }
  }
