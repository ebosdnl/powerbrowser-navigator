  const powerBrowserModalStates = new WeakMap();
  const powerBrowserActiveModals = new Set();
  const powerBrowserBackgroundStates = new Map();
  let powerBrowserLiveRegion = null;
  let powerBrowserDocumentScrollState = null;

  function capturePowerBrowserStyle(element, property) {
    return {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    };
  }

  function restorePowerBrowserStyle(element, property, state) {
    if (state.value) {
      element.style.setProperty(
        property,
        state.value,
        state.priority,
      );
      return;
    }
    element.style.removeProperty(property);
  }

  function lockPowerBrowserDocumentScroll() {
    if (powerBrowserDocumentScrollState) {
      return;
    }
    const root = document.documentElement;
    const body = document.body;
    powerBrowserDocumentScrollState = {
      rootOverflow: capturePowerBrowserStyle(root, "overflow"),
      rootOverscroll: capturePowerBrowserStyle(
        root,
        "overscroll-behavior",
      ),
      bodyOverflow: capturePowerBrowserStyle(body, "overflow"),
      bodyOverscroll: capturePowerBrowserStyle(
        body,
        "overscroll-behavior",
      ),
    };
    root.style.setProperty("overflow", "hidden", "important");
    root.style.setProperty(
      "overscroll-behavior",
      "none",
      "important",
    );
    body.style.setProperty("overflow", "hidden", "important");
    body.style.setProperty(
      "overscroll-behavior",
      "none",
      "important",
    );
  }

  function unlockPowerBrowserDocumentScroll() {
    if (!powerBrowserDocumentScrollState) {
      return;
    }
    const root = document.documentElement;
    const body = document.body;
    restorePowerBrowserStyle(
      root,
      "overflow",
      powerBrowserDocumentScrollState.rootOverflow,
    );
    restorePowerBrowserStyle(
      root,
      "overscroll-behavior",
      powerBrowserDocumentScrollState.rootOverscroll,
    );
    restorePowerBrowserStyle(
      body,
      "overflow",
      powerBrowserDocumentScrollState.bodyOverflow,
    );
    restorePowerBrowserStyle(
      body,
      "overscroll-behavior",
      powerBrowserDocumentScrollState.bodyOverscroll,
    );
    powerBrowserDocumentScrollState = null;
  }

  function restorePowerBrowserBackground() {
    powerBrowserBackgroundStates.forEach((wasInert, element) => {
      if (element.isConnected) {
        element.inert = wasInert;
      }
    });
    powerBrowserBackgroundStates.clear();
  }

  function updatePowerBrowserModalIsolation() {
    restorePowerBrowserBackground();
    if (!powerBrowserActiveModals.size) {
      unlockPowerBrowserDocumentScroll();
      return;
    }

    lockPowerBrowserDocumentScroll();
    const modalElements = [];
    powerBrowserActiveModals.forEach((dialog) => {
      const state = powerBrowserModalStates.get(dialog);
      modalElements.push(dialog);
      if (state?.overlay) {
        modalElements.push(state.overlay);
      }
    });

    [...document.body.children].forEach((element) => {
      const containsModal = modalElements.some(
        (modalElement) =>
          modalElement === element || element.contains(modalElement),
      );
      if (containsModal || element === powerBrowserLiveRegion) {
        return;
      }
      powerBrowserBackgroundStates.set(element, element.inert);
      element.inert = true;
    });
  }

  function getPowerBrowserFocusableElements(dialog) {
    return [...dialog.querySelectorAll(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )].filter(
      (element) =>
        element instanceof window.HTMLElement &&
        !element.hidden &&
        element.getClientRects().length > 0,
    );
  }

  function ensurePowerBrowserLiveRegion() {
    if (powerBrowserLiveRegion?.isConnected) {
      return powerBrowserLiveRegion;
    }
    powerBrowserLiveRegion = document.createElement("div");
    powerBrowserLiveRegion.className = "power-browser-sr-only-v2";
    powerBrowserLiveRegion.setAttribute("role", "status");
    powerBrowserLiveRegion.setAttribute("aria-live", "polite");
    powerBrowserLiveRegion.setAttribute("aria-atomic", "true");
    document.body.appendChild(powerBrowserLiveRegion);
    return powerBrowserLiveRegion;
  }

  function announcePowerBrowser(message, priority = "polite") {
    const region = ensurePowerBrowserLiveRegion();
    region.setAttribute("aria-live", priority);
    region.textContent = "";
    window.setTimeout(() => {
      region.textContent = String(message || "");
    }, 0);
  }

  function openPowerBrowserModal({
    dialog,
    overlay = null,
    close,
    initialFocus = null,
    announcement = "",
  }) {
    closePowerBrowserModal(dialog, { restoreFocus: false });
    const previouslyFocused =
      document.activeElement instanceof window.HTMLElement
        ? document.activeElement
        : null;
    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = getPowerBrowserFocusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleFocusIn = (event) => {
      if (!dialog.contains(event.target)) {
        const target =
          (typeof initialFocus === "function"
            ? initialFocus()
            : initialFocus) ||
          getPowerBrowserFocusableElements(dialog)[0] ||
          dialog;
        target.focus?.();
      }
    };
    dialog.tabIndex = -1;
    dialog.setAttribute("aria-hidden", "false");
    overlay?.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    powerBrowserModalStates.set(dialog, {
      previouslyFocused,
      overlay,
      handleKeydown,
      handleFocusIn,
    });
    powerBrowserActiveModals.add(dialog);
    updatePowerBrowserModalIsolation();
    window.setTimeout(() => {
      const target =
        (typeof initialFocus === "function"
          ? initialFocus()
          : initialFocus) ||
        getPowerBrowserFocusableElements(dialog)[0] ||
        dialog;
      target.focus?.();
    }, 0);
    if (announcement) {
      announcePowerBrowser(announcement);
    }
  }

  function closePowerBrowserModal(
    dialog,
    { restoreFocus = true } = {},
  ) {
    const state = dialog
      ? powerBrowserModalStates.get(dialog)
      : null;
    if (!dialog || !state) {
      return;
    }
    document.removeEventListener(
      "keydown",
      state.handleKeydown,
      true,
    );
    document.removeEventListener(
      "focusin",
      state.handleFocusIn,
      true,
    );
    dialog.setAttribute("aria-hidden", "true");
    state.overlay?.setAttribute("aria-hidden", "true");
    powerBrowserModalStates.delete(dialog);
    powerBrowserActiveModals.delete(dialog);
    updatePowerBrowserModalIsolation();
    if (restoreFocus && state.previouslyFocused?.isConnected) {
      state.previouslyFocused.focus();
    }
  }
