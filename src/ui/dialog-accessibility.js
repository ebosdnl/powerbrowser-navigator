  const powerBrowserModalStates = new WeakMap();
  let powerBrowserLiveRegion = null;

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
    if (restoreFocus && state.previouslyFocused?.isConnected) {
      state.previouslyFocused.focus();
    }
  }
