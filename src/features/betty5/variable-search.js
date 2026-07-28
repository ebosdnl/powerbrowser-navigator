  function ensureBetty5VariableSearchStyles() {
    if (document.getElementById("power-browser-b5-variable-search-style-v2")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "power-browser-b5-variable-search-style-v2";
    style.textContent = `
      .power-browser-b5-variable-dialog-v2 {
        width: min(1400px, calc(100vw - 48px)) !important;
        max-width: calc(100vw - 48px) !important;
      }

      .power-browser-b5-variable-content-v2 .modal-body {
        height: min(76vh, 820px) !important;
        max-height: calc(100vh - 190px) !important;
      }

      .power-browser-b5-variable-content-v2 .variables_browser,
      .power-browser-b5-variable-content-v2 .model_browser {
        width: 100% !important;
        max-width: 100% !important;
      }

      .power-browser-b5-variable-content-v2 .variables_browser > .raumer > .variables,
      .power-browser-b5-variable-content-v2 .model_browser > .raumer > .variables,
      .power-browser-b5-variable-content-v2 .variables_browser > .raumer > .variables > ul.variables,
      .power-browser-b5-variable-content-v2 .model_browser > .raumer > .variables > ul.variables,
      .power-browser-b5-variable-content-v2 .variables_browser > .raumer > .variables > ul.variables > li,
      .power-browser-b5-variable-content-v2 .model_browser > .raumer > .variables > ul.variables > li {
        width: 282px !important;
      }

      .power-browser-b5-variable-content-v2 .variables_browser > .raumer > .path,
      .power-browser-b5-variable-content-v2 .model_browser > .raumer > .path {
        width: 100% !important;
      }

      .power-browser-b5-variable-content-v2 .variables_browser .path > ul.path,
      .power-browser-b5-variable-content-v2 .model_browser .path > ul.path {
        display: flex !important;
        left: 282px !important;
        width: calc(100% - 282px) !important;
      }

      .power-browser-b5-variable-content-v2.power-browser-b5-variable-no-arrowbox-v2 .variables_browser .path > ul.path,
      .power-browser-b5-variable-content-v2.power-browser-b5-variable-no-arrowbox-v2 .model_browser .path > ul.path {
        left: 248px !important;
        width: 100% !important;
        max-width: 1150px !important;
      }

      .power-browser-b5-variable-content-v2 .variables_browser .path > ul.path > li,
      .power-browser-b5-variable-content-v2 .model_browser .path > ul.path > li {
        flex: 1 1 0 !important;
        min-width: 300px !important;
        max-width: none !important;
      }

      [data-power-browser-b5-variable-enhanced-v2] .variables li > h4,
      [data-power-browser-b5-variable-enhanced-v2] .path li > h4 {
        position: relative !important;
        box-sizing: border-box !important;
        min-height: 82px !important;
        height: 82px !important;
        line-height: 32px !important;
        padding-right: 50px !important;
        padding-bottom: 42px !important;
      }

      [data-power-browser-b5-variable-enhanced-v2] div.properties,
      [data-power-browser-b5-variable-enhanced-v2] div.categories {
        top: 82px !important;
      }

      [data-power-browser-b5-variable-search-v2] {
        position: absolute !important;
        top: 42px !important;
        left: 10px !important;
        right: 50px !important;
        display: block !important;
        width: auto !important;
        max-width: none !important;
        min-width: 0 !important;
        height: 34px !important;
        z-index: 2 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * Marks the containing Betty 5 modal so its browser can use more space.
   *
   * @param {Element} browser
   * @returns {void}
   */
  function markBetty5VariableBrowserModal(browser) {
    browser
      .closest(".modal-dialog")
      ?.classList.add("power-browser-b5-variable-dialog-v2");

    const modalContent = browser.closest(".modal-content");
    if (!modalContent) {
      return;
    }

    modalContent.classList.add("power-browser-b5-variable-content-v2");
    modalContent.classList.toggle(
      "power-browser-b5-variable-no-arrowbox-v2",
      !modalContent.querySelector(".arrowbox"),
    );
  }

  /**
   * Restores the display value an item had before filtering.
   *
   * @param {HTMLElement} item
   * @returns {void}
   */
  function restoreBetty5VariableItemDisplay(item) {
    if (!item.hasAttribute("data-power-browser-b5-original-display-v2")) {
      return;
    }

    item.style.display = item.getAttribute(
      "data-power-browser-b5-original-display-v2",
    );
    item.removeAttribute("data-power-browser-b5-original-display-v2");
  }

  /**
   * Applies one column's current variable-search query.
   *
   * @param {Element} column
   * @returns {void}
   */
  function filterBetty5VariableColumn(column) {
    const input = column.querySelector(
      ':scope > h4 [data-power-browser-b5-variable-search-v2]',
    );
    if (!input) {
      return;
    }

    const query = input.value.trim().toLocaleLowerCase();
    column
      .querySelectorAll(
        ".properties .list-group-item, .categories .list-group-item",
      )
      .forEach((item) => {
        if (
          !item.hasAttribute("data-power-browser-b5-original-display-v2")
        ) {
          item.setAttribute(
            "data-power-browser-b5-original-display-v2",
            item.style.display,
          );
        }

        const title = item.getAttribute("title");
        const directText = Array.from(item.childNodes)
          .filter((node) => node.nodeType === window.Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join(" ")
          .trim();
        const searchableText = (
          title ||
          directText ||
          item.textContent ||
          ""
        ).toLocaleLowerCase();
        const originalDisplay = item.getAttribute(
          "data-power-browser-b5-original-display-v2",
        );
        item.style.display =
          !query || searchableText.includes(query)
            ? originalDisplay
            : "none";
      });
  }

  /**
   * Adds a search field to a Betty 5 variable-browser column.
   *
   * @param {Element} column
   * @returns {void}
   */
  function addBetty5VariableSearchInput(column) {
    const heading = column.querySelector(":scope > h4");
    if (
      !heading ||
      heading.querySelector("[data-power-browser-b5-variable-search-v2]")
    ) {
      return;
    }

    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search...";
    input.className = "form-control";
    input.setAttribute("data-power-browser-b5-variable-search-v2", "");
    input.setAttribute("aria-label", "Search variables");
    input.autocomplete = "off";
    input.spellcheck = false;

    const label = heading.querySelector("span");
    if (label) {
      heading.insertBefore(input, label);
    } else {
      heading.appendChild(input);
    }
  }

  /**
   * Enhances all variable and model browsers currently mounted by Betty 5.
   *
   * @returns {void}
   */
  function enhanceBetty5VariableBrowsers() {
    if (
      currentPowerBrowserContext?.siteType !== SiteType.BETTY5 ||
      !Boolean(getSettingValue("extraB5VariableSearch"))
    ) {
      return;
    }

    ensureBetty5VariableSearchStyles();
    document
      .querySelectorAll(PowerBrowserSelectors.betty5VariableBrowser)
      .forEach((browser) => {
        browser.setAttribute(
          "data-power-browser-b5-variable-enhanced-v2",
          "",
        );
        markBetty5VariableBrowserModal(browser);
        browser
          .querySelectorAll(
            ".variables ul.variables > li, .path ul.path > li",
          )
          .forEach((column) => {
            addBetty5VariableSearchInput(column);
            filterBetty5VariableColumn(column);
          });
      });
  }

  /**
   * Debounces enhancement after Betty 5 adds another variable path column.
   *
   * @returns {void}
   */
  function scheduleBetty5VariableSearchEnhancement() {
    clearTimeout(betty5VariableSearchTimer);
    betty5VariableSearchTimer = setTimeout(
      enhanceBetty5VariableBrowsers,
      80,
    );
  }

  /**
   * Handles input without allowing Betty 5's modal shortcuts to consume it.
   *
   * @param {Event} event
   * @returns {void}
   */
  function handleBetty5VariableSearchInput(event) {
    const input = event.target?.closest?.(
      "[data-power-browser-b5-variable-search-v2]",
    );
    if (!input) {
      return;
    }

    const column = input.closest(
      ".variables ul.variables > li, .path ul.path > li",
    );
    if (column) {
      filterBetty5VariableColumn(column);
    }
  }

  /**
   * Prevents Betty 5 browser click and keyboard handlers from consuming input
   * interactions.
   *
   * @param {Event} event
   * @returns {void}
   */
  function stopBetty5VariableSearchPropagation(event) {
    if (
      event.target?.closest?.(
        "[data-power-browser-b5-variable-search-v2]",
      )
    ) {
      event.stopPropagation();
    }
  }

  /**
   * Schedules enhancement when a nested browser column is opened.
   *
   * @param {Event} event
   * @returns {void}
   */
  function handleBetty5VariableBrowserClick(event) {
    const item = event.target?.closest?.(".list-group-item.has-children");
    if (
      item?.closest(PowerBrowserSelectors.betty5VariableBrowser)
    ) {
      scheduleBetty5VariableSearchEnhancement();
    }
  }

  /**
   * Removes all DOM changes made by enhanced variable search.
   *
   * @returns {void}
   */
  function cleanupBetty5VariableSearch() {
    clearTimeout(betty5VariableSearchTimer);
    betty5VariableSearchTimer = null;
    betty5VariableSearchObserver?.disconnect();
    betty5VariableSearchObserver = null;

    document
      .querySelectorAll("[data-power-browser-b5-variable-search-v2]")
      .forEach((input) => input.remove());
    document
      .querySelectorAll("[data-power-browser-b5-original-display-v2]")
      .forEach(restoreBetty5VariableItemDisplay);
    document
      .querySelectorAll("[data-power-browser-b5-variable-enhanced-v2]")
      .forEach((browser) =>
        browser.removeAttribute(
          "data-power-browser-b5-variable-enhanced-v2",
        ),
      );
    document
      .querySelectorAll(".power-browser-b5-variable-dialog-v2")
      .forEach((dialog) =>
        dialog.classList.remove("power-browser-b5-variable-dialog-v2"),
      );
    document
      .querySelectorAll(".power-browser-b5-variable-content-v2")
      .forEach((content) => {
        content.classList.remove(
          "power-browser-b5-variable-content-v2",
          "power-browser-b5-variable-no-arrowbox-v2",
        );
      });
    document
      .getElementById("power-browser-b5-variable-search-style-v2")
      ?.remove();

    if (betty5VariableSearchListenersAttached) {
      document.removeEventListener(
        "input",
        handleBetty5VariableSearchInput,
        true,
      );
      ["click", "mousedown", "keydown"].forEach((eventName) => {
        document.removeEventListener(
          eventName,
          stopBetty5VariableSearchPropagation,
          true,
        );
      });
      document.removeEventListener(
        "click",
        handleBetty5VariableBrowserClick,
        true,
      );
      betty5VariableSearchListenersAttached = false;
    }
  }

  /**
   * Applies the enhanced variable-search setting to Betty 5.
   *
   * @returns {void}
   */
  function applyBetty5VariableSearch() {
    const enabled =
      currentPowerBrowserContext?.siteType === SiteType.BETTY5 &&
      Boolean(getSettingValue("extraB5VariableSearch"));

    if (!enabled) {
      cleanupBetty5VariableSearch();
      return;
    }

    if (!betty5VariableSearchListenersAttached) {
      document.addEventListener(
        "input",
        handleBetty5VariableSearchInput,
        true,
      );
      ["click", "mousedown", "keydown"].forEach((eventName) => {
        document.addEventListener(
          eventName,
          stopBetty5VariableSearchPropagation,
          true,
        );
      });
      document.addEventListener(
        "click",
        handleBetty5VariableBrowserClick,
        true,
      );
      betty5VariableSearchListenersAttached = true;
    }

    enhanceBetty5VariableBrowsers();
    if (!betty5VariableSearchObserver) {
      betty5VariableSearchObserver = new MutationObserver((mutations) => {
        const browserSelector = PowerBrowserSelectors.betty5VariableBrowser;
        const columnSelector =
          ".variables ul.variables > li, .path ul.path > li";
        const shouldEnhance = mutations.some((mutation) =>
          Array.from(mutation.addedNodes).some(
            (node) =>
              node.nodeType === window.Node.ELEMENT_NODE &&
              (node.matches?.(browserSelector) ||
                node.matches?.(columnSelector) ||
                node.querySelector?.(
                  `${browserSelector}, ${columnSelector}`,
                )),
          ),
        );

        if (shouldEnhance) {
          scheduleBetty5VariableSearchEnhancement();
        }
      });
      betty5VariableSearchObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

