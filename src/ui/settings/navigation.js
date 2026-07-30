  function getSettingsTabSections(tabId) {
    if (tabId === "info") {
      return [
        "Current application",
        "Sandboxes",
        "Artifact",
        "Diagnostics",
      ];
    }

    if (tabId === "settings") {
      return [
        "Appearance",
        "Updates",
        "Data",
        "Application profiles",
        "Danger zone",
      ];
    }

    return [
      ...new Set(
        SettingsDefinitions.filter(
          (definition) => definition.tab === tabId,
        )
          .map((definition) => definition.section)
          .filter(Boolean),
      ),
    ];
  }

  /**
   * Updates the visual state of all subsection shortcuts.
   *
   * @returns {void}
   */
  function updateSettingsSectionLinkState() {
    if (!settingsState) {
      return;
    }

    settingsState.tabs
      .querySelectorAll(".power-browser-settings-section-link-v2")
      .forEach((button) => {
        button.classList.toggle(
          "active",
          button.dataset.tab === settingsState.activeTab &&
            button.dataset.section === settingsState.activeSection,
        );
      });
  }

  /**
   * Updates the highlighted subsection to match the content scroll position.
   *
   * @returns {void}
   */
  function updateVisibleSettingsSection() {
    if (!settingsState) {
      return;
    }

    const headings = Array.from(
      settingsState.list.querySelectorAll("[data-settings-section]"),
    );
    if (!headings.length) {
      settingsState.activeSection = "";
      updateSettingsSectionLinkState();
      return;
    }

    const contentTop =
      settingsState.content.getBoundingClientRect().top + 20;
    let visibleHeading = headings[0];
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top <= contentTop) {
        visibleHeading = heading;
      }
    });

    const atBottom =
      settingsState.content.scrollHeight -
        settingsState.content.scrollTop -
        settingsState.content.clientHeight <
      4;
    if (atBottom) {
      visibleHeading = headings.at(-1);
    }

    settingsState.activeSection =
      visibleHeading.dataset.settingsSection || "";
    updateSettingsSectionLinkState();
  }

  /**
   * Switches tabs when needed and scrolls to a settings subsection.
   *
   * @param {string} tabId
   * @param {string} sectionName
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function navigateToSettingsSection(tabId, sectionName, navigator) {
    if (!settingsState) {
      return;
    }

    if (settingsState.activeTab !== tabId) {
      settingsState.activeTab = tabId;
      settingsState.sectionsExpanded = true;
      GM_setValue("powerBrowserSettingsActiveTab", tabId);
      renderSettingsTab(navigator);
    }

    settingsState.activeSection = sectionName;
    updateSettingsSectionLinkState();
    window.requestAnimationFrame(() => {
      Array.from(
        settingsState.list.querySelectorAll("[data-settings-section]"),
      )
        .find(
          (heading) =>
            heading.dataset.settingsSection === sectionName,
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    });
  }

  /**
   * Renders shortcuts for the active tab, or every tab when configured.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
  function renderSettingsSectionNavigation(navigator) {
    if (!settingsState) {
      return;
    }

    settingsState.tabs
      .querySelectorAll(".power-browser-settings-section-links-v2")
      .forEach((navigation) => navigation.remove());

    const alwaysShowSections = Boolean(
      getSettingValue("settingsSectionsExpandedByDefault"),
    );
    settingsState.tabs
      .querySelectorAll(".power-browser-settings-tab-v2")
      .forEach((tabButton) => {
        const tabId = tabButton.dataset.tab;
        const sections = getSettingsTabSections(tabId);
        const shouldShow =
          sections.length > 0 &&
          (alwaysShowSections ||
            (tabId === settingsState.activeTab &&
              settingsState.sectionsExpanded));

        if (!shouldShow) {
          return;
        }

        const navigation = document.createElement("div");
        navigation.className =
          "power-browser-settings-section-links-v2";
        navigation.setAttribute(
          "aria-label",
          `${tabButton.textContent} sections`,
        );
        sections.forEach((sectionName) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className =
            "power-browser-settings-section-link-v2";
          button.dataset.tab = tabId;
          button.dataset.section = sectionName;
          button.textContent = sectionName;
          button.addEventListener("click", () =>
            navigateToSettingsSection(
              tabId,
              sectionName,
              navigator,
            ),
          );
          navigation.appendChild(button);
        });
        tabButton.after(navigation);
      });

    updateSettingsSectionLinkState();
  }

  /**
   * Scrolls to and briefly highlights a setting selected through search.
   *
   * @param {string} settingKey
   * @returns {void}
   */
  function flashSettingsDefinition(settingKey) {
    window.requestAnimationFrame(() => {
      const card = Array.from(
        settingsState.list.querySelectorAll("[data-setting-key]"),
      ).find(
        (candidate) =>
          candidate.dataset.settingKey === settingKey,
      );
      if (!card) {
        return;
      }

      card.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setTimeout(() => {
        if (!card.isConnected) {
          return;
        }

        card.classList.remove("setting-flash");
        void card.offsetWidth;
        card.classList.add("setting-flash");
        setTimeout(() => {
          card.classList.remove("setting-flash");
        }, 1700);
      }, 140);
    });
  }

  /**
   * Renders matching settings from every tab.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @param {string} query
   * @returns {void}
   */
  function renderSettingsSearchResults(navigator, query) {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = SettingsDefinitions.filter((definition) => {
      const tabLabel =
        SettingsTabs.find(({ id }) => id === definition.tab)
          ?.label || definition.tab;
      return [
        definition.label,
        definition.description,
        definition.section,
        definition.badge,
        tabLabel,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(normalizedQuery),
        );
    });

    settingsState.heading.textContent = "Search settings";
    settingsState.description.textContent =
      `${matches.length} result${matches.length === 1 ? "" : "s"} across all settings tabs.`;
    settingsState.reset.hidden = true;

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "power-browser-settings-info-empty-v2";
      empty.textContent =
        `No settings match “${query.trim()}”.`;
      settingsState.list.appendChild(empty);
      return;
    }

    matches.forEach((definition) => {
      const tab =
        SettingsTabs.find(({ id }) => id === definition.tab);
      const result = document.createElement("button");
      result.type = "button";
      result.className =
        "power-browser-settings-card-v2 power-browser-settings-search-result-v2";
      const copy = document.createElement("div");
      copy.className = "power-browser-settings-copy-v2";
      const labelRow = document.createElement("div");
      labelRow.className =
        "power-browser-settings-label-row-v2";
      const label = document.createElement("strong");
      label.textContent = definition.label;
      const locationBadge = document.createElement("span");
      locationBadge.className =
        "power-browser-settings-info-status-v2";
      locationBadge.textContent = [
        tab?.label || definition.tab,
        definition.section,
      ]
        .filter(Boolean)
        .join(" · ");
      const description = document.createElement("span");
      description.className =
        "power-browser-settings-description-v2";
      description.textContent = definition.description;
      labelRow.append(label, locationBadge);
      copy.append(labelRow, description);
      result.appendChild(copy);
      result.addEventListener("click", () => {
        settingsState.searchQuery = "";
        settingsState.searchInput.value = "";
        settingsState.activeTab = definition.tab;
        settingsState.activeSection =
          definition.section || "";
        settingsState.sectionsExpanded = true;
        GM_setValue(
          "powerBrowserSettingsActiveTab",
          definition.tab,
        );
        renderSettingsTab(navigator);
        updateSettingsSectionLinkState();
        flashSettingsDefinition(definition.key);
      });
      settingsState.list.appendChild(result);
    });
  }

