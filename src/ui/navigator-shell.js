  function isPointNearNavigationElement(x, y, element, margin = 16) {
    const rect = element.getBoundingClientRect();
    return (
      x >= rect.left - margin &&
      x <= rect.right + margin &&
      y >= rect.top - margin &&
      y <= rect.bottom + margin
    );
  }

  function initializeNavigator() {
    const navigatorBar = document.createElement("divider");
    navigatorBar.id = "navigatorBar";
    navigatorBar.className =
      "nav-container-1c7b2759-c793-4d17-b89b-1da6c5c5cf5b";
    navigatorBar.setAttribute("aria-busy", "true");

    const dropdown = document.createElement("divider");
    dropdown.id = "dropdownMenu";
    dropdown.className =
      "dropdown-1aaab757-b16d-413a-9499-a72197bb1732";

    const autoHideHandle = document.createElement("button");
    autoHideHandle.type = "button";
    autoHideHandle.className = "power-browser-navigation-handle-v2";
    autoHideHandle.hidden = true;
    autoHideHandle.setAttribute("aria-controls", dropdown.id);
    autoHideHandle.setAttribute("aria-expanded", "false");
    autoHideHandle.setAttribute("aria-label", "Reveal navigation bar");
    autoHideHandle.title = "Reveal navigation bar";
    autoHideHandle.innerHTML =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.25 7.5 4.75 4.75 4.75-4.75 1.5 1.5L10 15.25 3.75 9l1.5-1.5Z"/></svg>';

    let autoHideCloseTimer = null;
    const clearAutoHideCloseTimer = () => {
      if (autoHideCloseTimer !== null) {
        window.clearTimeout(autoHideCloseTimer);
        autoHideCloseTimer = null;
      }
    };
    const setAutoHideOpen = (open) => {
      clearAutoHideCloseTimer();
      const expanded =
        navigatorBar.classList.contains(
          "power-browser-navigation-auto-hide-v2",
        ) && Boolean(open);
      navigatorBar.classList.toggle(
        "power-browser-navigation-open-v2",
        expanded,
      );
      autoHideHandle.setAttribute("aria-expanded", String(expanded));
      autoHideHandle.setAttribute(
        "aria-label",
        expanded ? "Navigation bar revealed" : "Reveal navigation bar",
      );
      autoHideHandle.title = expanded
        ? "Navigation bar revealed"
        : "Reveal navigation bar";
    };

    const isPointerNearNavigation = (event) => {
      const proximityElements = navigatorBar.classList.contains(
        "power-browser-navigation-open-v2",
      )
        ? [autoHideHandle, dropdown]
        : [autoHideHandle];
      return proximityElements.some((element) =>
        isPointNearNavigationElement(
          event.clientX,
          event.clientY,
          element,
        ),
      );
    };
    const scheduleAutoHideClose = () => {
      clearAutoHideCloseTimer();
      autoHideCloseTimer = window.setTimeout(() => {
        autoHideCloseTimer = null;
        if (!navigatorBar.contains(document.activeElement)) {
          setAutoHideOpen(false);
        }
      }, 160);
    };

    navigatorBar.addEventListener("pointerenter", () => setAutoHideOpen(true));
    navigatorBar.addEventListener("pointerleave", (event) => {
      if (isPointerNearNavigation(event)) {
        clearAutoHideCloseTimer();
        return;
      }
      scheduleAutoHideClose();
    });
    document.addEventListener("pointermove", (event) => {
      if (
        !navigatorBar.classList.contains(
          "power-browser-navigation-auto-hide-v2",
        ) ||
        navigatorBar.contains(document.activeElement)
      ) {
        return;
      }

      if (isPointerNearNavigation(event)) {
        setAutoHideOpen(true);
      } else if (
        navigatorBar.classList.contains(
          "power-browser-navigation-open-v2",
        ) &&
        autoHideCloseTimer === null
      ) {
        scheduleAutoHideClose();
      }
    });
    navigatorBar.addEventListener("focusin", () => setAutoHideOpen(true));
    navigatorBar.addEventListener("focusout", (event) => {
      if (!navigatorBar.contains(event.relatedTarget)) {
        scheduleAutoHideClose();
      }
    });
    autoHideHandle.addEventListener("click", () => setAutoHideOpen(true));

    const controls = new Map();
    let stateSwitcher;
    let stateToggle;
    let stateToggleLabel;
    let stateMenu;
    let stateStatusPopover;
    let stateStatusMessage;
    let stateRetryButton;
    let environmentBadge;

    NavigatorItems.forEach((item) => {
      const control = document.createElement(item.button ? "button" : "a");
      control.id = item.id;
      control.innerHTML = `${item.icon}<span>${item.label}</span>`;
      control.classList.add(NAV_DISABLED_CLASS);
      control.setAttribute("aria-disabled", "true");

      if (item.button) {
        control.type = "button";
        control.disabled = true;
      }

      if (item.dynamic) {
        control.classList.add("power-browser-hidden-v2");
      }

      dropdown.appendChild(control);
      controls.set(item.id, control);

      if (item.id === "organizationButton") {
        stateSwitcher = document.createElement("div");
        stateSwitcher.id = "sandboxSwitcher";
        stateSwitcher.className = "power-browser-state-switcher-v2";

        stateToggle = document.createElement("button");
        stateToggle.type = "button";
        stateToggle.className = `power-browser-state-toggle-v2 ${NAV_DISABLED_CLASS}`;
        stateToggle.disabled = true;
        stateToggle.setAttribute("aria-expanded", "false");
        stateToggle.setAttribute("aria-disabled", "true");
        stateToggle.setAttribute("aria-label", "Sandbox switcher");
        stateToggle.innerHTML = `${SvgIcons.switch}<span class="power-browser-state-toggle-label-v2">Sandbox switcher</span>`;
        stateToggleLabel = stateToggle.querySelector(
          ".power-browser-state-toggle-label-v2",
        );

        stateMenu = document.createElement("div");
        stateMenu.className = "power-browser-state-menu-v2";

        stateStatusPopover = document.createElement("div");
        stateStatusPopover.id = "power-browser-state-status-v2";
        stateStatusPopover.className =
          "power-browser-state-status-v2";
        stateStatusPopover.setAttribute("role", "status");
        stateStatusPopover.setAttribute("aria-live", "polite");
        const statusHeading = document.createElement("strong");
        statusHeading.textContent = "Sandbox switcher";
        stateStatusMessage = document.createElement("span");
        stateStatusMessage.textContent = "Loading sandbox information…";
        const statusActions = document.createElement("div");
        statusActions.className =
          "power-browser-state-status-actions-v2";
        stateRetryButton = document.createElement("button");
        stateRetryButton.type = "button";
        stateRetryButton.textContent = "Retry";
        stateRetryButton.addEventListener("click", () => {
          void retryApplicationSwitcherAuthentication();
        });
        const openMyBettyButton = document.createElement("button");
        openMyBettyButton.type = "button";
        openMyBettyButton.textContent = "Open My Betty";
        openMyBettyButton.addEventListener("click", () => {
          const url = "https://my.bettyblocks.com";
          if (typeof globalThis.GM_openInTab === "function") {
            globalThis.GM_openInTab(url, {
              active: true,
              insert: true,
            });
          } else {
            window.open(url, "_blank", "noopener,noreferrer");
          }
        });
        statusActions.append(stateRetryButton, openMyBettyButton);
        stateStatusPopover.append(
          statusHeading,
          stateStatusMessage,
          statusActions,
        );

        stateToggle.addEventListener("click", () => {
          const isOpen = stateSwitcher.classList.toggle("open");
          stateToggle.setAttribute("aria-expanded", String(isOpen));
        });
        stateToggle.setAttribute(
          "aria-describedby",
          stateStatusPopover.id,
        );

        stateSwitcher.appendChild(stateToggle);
        stateSwitcher.appendChild(stateMenu);
        stateSwitcher.appendChild(stateStatusPopover);
        dropdown.appendChild(stateSwitcher);
      }
    });

    environmentBadge = document.createElement("span");
    environmentBadge.id = "environmentBadge";
    environmentBadge.className = "power-browser-environment-badge-v2";
    environmentBadge.hidden = true;
    dropdown.appendChild(environmentBadge);

    const settingsButton = document.createElement("button");
    settingsButton.id = "settingsButton";
    settingsButton.type = "button";
    settingsButton.disabled = true;
    settingsButton.className = NAV_DISABLED_CLASS;
    settingsButton.innerHTML = `${SvgIcons.settings}<span>Settings</span>`;
    settingsButton.title = "Settings will be added in a later v2 step.";
    dropdown.appendChild(settingsButton);

    navigatorBar.append(autoHideHandle, dropdown);
    (document.body || document.documentElement).appendChild(navigatorBar);

    document.addEventListener("click", (event) => {
      if (stateSwitcher && !stateSwitcher.contains(event.target)) {
        stateSwitcher.classList.remove("open");
        stateToggle.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && stateSwitcher?.classList.contains("open")) {
        stateSwitcher.classList.remove("open");
        stateToggle.setAttribute("aria-expanded", "false");
        stateToggle.focus();
      }
    });

    return {
      navigatorBar,
      autoHideHandle,
      dropdown,
      controls,
      stateSwitcher,
      stateToggle,
      stateToggleLabel,
      stateMenu,
      stateStatusPopover,
      stateStatusMessage,
      stateRetryButton,
      environmentBadge,
    };
  }

