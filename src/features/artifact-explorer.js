  let powerBrowserArtifactIndexSource = null;
  let powerBrowserArtifactIndex = [];

  function getCurrentArtifact() {
    return currentPowerBrowserContext?.artifactData || null;
  }

  function getArtifactExplorerEntries() {
    const artifact = getCurrentArtifact();
    if (!artifact) {
      powerBrowserArtifactIndexSource = null;
      powerBrowserArtifactIndex = [];
      return powerBrowserArtifactIndex;
    }
    if (artifact !== powerBrowserArtifactIndexSource) {
      powerBrowserArtifactIndexSource = artifact;
      powerBrowserArtifactIndex = buildArtifactSearchEntries(artifact);
      diagnosticTimeline.add({
        source: "artifact-index",
        status: "success",
        message: `Indexed ${powerBrowserArtifactIndex.length} artifact entries on demand.`,
      });
    }
    return powerBrowserArtifactIndex;
  }

  function createArtifactExplorerButton(label, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    return button;
  }

  function createArtifactEntryButton(entry, onClick) {
    const button = createArtifactExplorerButton(
      "",
      "power-browser-artifact-entry-v2",
    );
    const chip = document.createElement("span");
    chip.className = "power-browser-artifact-kind-v2";
    chip.textContent = entry.kind;
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = entry.label;
    const meta = document.createElement("small");
    meta.textContent = `${entry.meta} · ${entry.id}`;
    copy.append(title, meta);
    button.append(chip, copy);
    button.addEventListener("click", () => onClick(entry));
    return button;
  }

  function appendArtifactEmpty(container, message) {
    const empty = document.createElement("div");
    empty.className = "power-browser-artifact-empty-v2";
    empty.textContent = message;
    container.appendChild(empty);
  }

  function renderArtifactRecordDetails(container, entry) {
    const heading = document.createElement("div");
    heading.className = "power-browser-artifact-detail-heading-v2";
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = entry.label;
    const meta = document.createElement("span");
    meta.textContent = `${entry.kind} · ${entry.id}`;
    copy.append(title, meta);
    const actions = document.createElement("div");
    const relationships = createArtifactExplorerButton(
      "Relationships",
      "power-browser-artifact-action-v2",
    );
    relationships.addEventListener("click", () => {
      artifactExplorerState.selectedEntry = entry;
      artifactExplorerState.activeTab = "relationships";
      renderArtifactExplorer();
    });
    const copyJson = createArtifactExplorerButton(
      "Copy JSON",
      "power-browser-artifact-action-v2",
    );
    copyJson.addEventListener("click", () => {
      GM_setClipboard(JSON.stringify(entry.record, null, 2));
      announcePowerBrowser(`${entry.label} JSON copied.`);
    });
    actions.append(relationships, copyJson);
    heading.append(copy, actions);
    const data = document.createElement("pre");
    data.className = "power-browser-artifact-code-v2";
    data.textContent = JSON.stringify(entry.record, null, 2);
    container.append(heading, data);
  }

  function renderArtifactSearch() {
    const layout = document.createElement("div");
    layout.className = "power-browser-artifact-split-v2";
    const browser = document.createElement("div");
    browser.className = "power-browser-artifact-browser-v2";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "power-browser-artifact-search-v2";
    input.placeholder =
      "Search pages, endpoints, actions, models, properties, forms, variables…";
    input.value = artifactExplorerState.searchQuery;
    const results = document.createElement("div");
    results.className = "power-browser-artifact-results-v2";
    const renderResults = () => {
      artifactExplorerState.searchQuery = input.value;
      const matches = searchArtifactEntries(
        artifactExplorerState.entries,
        input.value,
        150,
      );
      results.replaceChildren();
      if (!matches.length) {
        appendArtifactEmpty(results, "No matching artifact entries.");
        return;
      }
      matches.forEach((entry) => {
        const button = createArtifactEntryButton(entry, (selected) => {
          artifactExplorerState.selectedEntry = selected;
          renderArtifactExplorer();
        });
        button.classList.toggle(
          "active",
          artifactExplorerState.selectedEntry?.collection ===
            entry.collection &&
            artifactExplorerState.selectedEntry?.id === entry.id,
        );
        results.appendChild(button);
      });
    };
    input.addEventListener("input", renderResults);
    browser.append(input, results);
    const details = document.createElement("div");
    details.className = "power-browser-artifact-details-v2";
    if (artifactExplorerState.selectedEntry) {
      renderArtifactRecordDetails(
        details,
        artifactExplorerState.selectedEntry,
      );
    } else {
      appendArtifactEmpty(
        details,
        "Select an artifact entry to inspect its complete data.",
      );
    }
    layout.append(browser, details);
    artifactExplorerState.body.appendChild(layout);
    renderResults();
    setTimeout(() => input.focus(), 0);
  }

  function renderArtifactRelationships() {
    const selected = artifactExplorerState.selectedEntry;
    if (!selected) {
      appendArtifactEmpty(
        artifactExplorerState.body,
        "Select an entry in Search to inspect its relationships.",
      );
      const choose = createArtifactExplorerButton(
        "Choose an artifact entry",
        "power-browser-artifact-primary-v2",
      );
      choose.addEventListener("click", () => {
        artifactExplorerState.activeTab = "search";
        renderArtifactExplorer();
      });
      artifactExplorerState.body.appendChild(choose);
      return;
    }
    const header = document.createElement("div");
    header.className = "power-browser-artifact-section-header-v2";
    const title = document.createElement("div");
    title.innerHTML = `<strong></strong><span></span>`;
    title.querySelector("strong").textContent = selected.label;
    title.querySelector("span").textContent =
      `${selected.kind} · ${selected.id}`;
    const inspect = createArtifactExplorerButton(
      "Inspect JSON",
      "power-browser-artifact-action-v2",
    );
    inspect.addEventListener("click", () => {
      artifactExplorerState.activeTab = "search";
      renderArtifactExplorer();
    });
    header.append(title, inspect);
    artifactExplorerState.body.appendChild(header);

    const relationships = getArtifactRelationships(
      artifactExplorerState.entries,
      selected,
    );
    if (!relationships.length) {
      appendArtifactEmpty(
        artifactExplorerState.body,
        "No ID-based relationships were found for this entry.",
      );
      return;
    }
    const list = document.createElement("div");
    list.className = "power-browser-artifact-relationship-list-v2";
    relationships.forEach((relationship) => {
      const row = createArtifactEntryButton(
        relationship.entry,
        (entry) => {
          artifactExplorerState.selectedEntry = entry;
          renderArtifactExplorer();
        },
      );
      const direction = document.createElement("span");
      direction.className =
        "power-browser-artifact-relationship-direction-v2";
      direction.textContent =
        relationship.direction === "incoming"
          ? `Referenced by · ${relationship.field}`
          : `References · ${relationship.field}`;
      row.prepend(direction);
      list.appendChild(row);
    });
    artifactExplorerState.body.appendChild(list);
  }

  function renderArtifactHealth() {
    const issues = auditArtifact(getCurrentArtifact());
    const summary = document.createElement("div");
    summary.className = "power-browser-artifact-health-summary-v2";
    ["error", "warning", "info"].forEach((severity) => {
      const count = issues.filter(
        (issue) => issue.severity === severity,
      ).length;
      const badge = document.createElement("span");
      badge.dataset.severity = severity;
      badge.textContent = `${count} ${severity}${count === 1 ? "" : "s"}`;
      summary.appendChild(badge);
    });
    artifactExplorerState.body.appendChild(summary);
    if (!issues.length) {
      appendArtifactEmpty(
        artifactExplorerState.body,
        "No structural artifact issues were detected.",
      );
      return;
    }
    const list = document.createElement("div");
    list.className = "power-browser-artifact-health-list-v2";
    issues.forEach((issue) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "power-browser-artifact-health-item-v2";
      item.dataset.severity = issue.severity;
      const meta = document.createElement("span");
      meta.textContent =
        `${issue.severity} · ${issue.collection}` +
        (issue.id ? ` · ${issue.id}` : "");
      const message = document.createElement("strong");
      message.textContent = issue.message;
      item.append(meta, message);
      const entry = artifactExplorerState.entries.find(
        (candidate) =>
          candidate.collection === issue.collection &&
          candidate.id === issue.id,
      );
      item.disabled = !entry;
      if (entry) {
        item.addEventListener("click", () => {
          artifactExplorerState.selectedEntry = entry;
          artifactExplorerState.activeTab = "relationships";
          renderArtifactExplorer();
        });
      }
      list.appendChild(item);
    });
    artifactExplorerState.body.appendChild(list);
  }

  function renderArtifactActions() {
    const actions = artifactExplorerState.entries.filter(
      (entry) => entry.collection === "actions",
    );
    const layout = document.createElement("div");
    layout.className = "power-browser-artifact-split-v2";
    const browser = document.createElement("div");
    browser.className = "power-browser-artifact-browser-v2";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "power-browser-artifact-search-v2";
    input.placeholder = "Search actions, IDs, API versions or mutations…";
    input.value = artifactExplorerState.actionQuery;
    const results = document.createElement("div");
    results.className = "power-browser-artifact-results-v2";
    const details = document.createElement("div");
    details.className = "power-browser-artifact-details-v2";
    const renderActionDetails = () => {
      details.replaceChildren();
      const selected =
        artifactExplorerState.selectedAction &&
        artifactExplorerState.selectedAction.collection === "actions"
          ? artifactExplorerState.selectedAction
          : null;
      if (!selected) {
        appendArtifactEmpty(
          details,
          "Select an action to inspect its mutation and metadata.",
        );
        return;
      }
      const heading = document.createElement("div");
      heading.className = "power-browser-artifact-detail-heading-v2";
      const copy = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = selected.label;
      const meta = document.createElement("span");
      meta.textContent =
        `ID: ${selected.id} · API: ${selected.record.apiVersion || "unknown"}`;
      copy.append(title, meta);
      const buttons = document.createElement("div");
      const copyMutation = createArtifactExplorerButton(
        "Copy mutation",
        "power-browser-artifact-action-v2",
      );
      copyMutation.disabled = !selected.record.mutation;
      copyMutation.addEventListener("click", () => {
        GM_setClipboard(String(selected.record.mutation || ""));
        announcePowerBrowser(`${selected.label} mutation copied.`);
      });
      const relationships = createArtifactExplorerButton(
        "Relationships",
        "power-browser-artifact-action-v2",
      );
      relationships.addEventListener("click", () => {
        artifactExplorerState.selectedEntry = selected;
        artifactExplorerState.activeTab = "relationships";
        renderArtifactExplorer();
      });
      buttons.append(copyMutation, relationships);
      heading.append(copy, buttons);
      const mutation = document.createElement("pre");
      mutation.className = "power-browser-artifact-code-v2";
      mutation.textContent = String(
        selected.record.mutation || "No mutation available.",
      );
      const json = document.createElement("pre");
      json.className =
        "power-browser-artifact-code-v2 power-browser-artifact-code-secondary-v2";
      json.textContent = JSON.stringify(selected.record, null, 2);
      details.append(heading, mutation, json);
    };
    const renderActions = () => {
      artifactExplorerState.actionQuery = input.value;
      const matches = searchArtifactEntries(
        actions,
        input.value,
        150,
      );
      results.replaceChildren();
      if (!matches.length) {
        appendArtifactEmpty(results, "No matching actions.");
      } else {
        matches.forEach((entry) => {
          const button = createArtifactEntryButton(entry, (selected) => {
            artifactExplorerState.selectedAction = selected;
            renderActions();
            renderActionDetails();
          });
          button.classList.toggle(
            "active",
            artifactExplorerState.selectedAction?.id === entry.id,
          );
          results.appendChild(button);
        });
      }
    };
    input.addEventListener("input", renderActions);
    browser.append(input, results);
    layout.append(browser, details);
    artifactExplorerState.body.appendChild(layout);
    renderActions();
    renderActionDetails();
    setTimeout(() => input.focus(), 0);
  }

  function getStoredArtifactSnapshots() {
    const snapshots = GM_getValue("powerBrowserArtifactSnapshots", []);
    return Array.isArray(snapshots) ? snapshots : [];
  }

  function setStoredArtifactSnapshots(snapshots) {
    GM_setValue(
      "powerBrowserArtifactSnapshots",
      snapshots.slice(0, 5),
    );
  }

  function renderArtifactSnapshotDiff(container) {
    const diff = artifactExplorerState.snapshotDiff;
    if (!diff) {
      return;
    }
    const heading = document.createElement("h3");
    heading.textContent = "Changes compared with current artifact";
    container.appendChild(heading);
    if (!diff.length) {
      appendArtifactEmpty(container, "No artifact changes detected.");
      return;
    }
    diff.forEach((collection) => {
      const group = document.createElement("div");
      group.className = "power-browser-artifact-diff-group-v2";
      const title = document.createElement("strong");
      title.textContent =
        `${collection.collection}: +${collection.added.length} ` +
        `−${collection.removed.length} ~${collection.changed.length}`;
      const list = document.createElement("ul");
      [
        ["+", collection.added],
        ["−", collection.removed],
        ["~", collection.changed],
      ].forEach(([symbol, items]) => {
        items.forEach((item) => {
          const row = document.createElement("li");
          row.dataset.change = symbol;
          row.textContent = `${symbol} ${item.label} (${item.id})`;
          list.appendChild(row);
        });
      });
      group.append(title, list);
      container.appendChild(group);
    });
  }

  function renderArtifactSnapshots() {
    const artifact = getCurrentArtifact();
    const currentSnapshot = createArtifactSnapshot(artifact);
    if (!currentSnapshot.applicationIdentifier) {
      currentSnapshot.applicationIdentifier =
        currentPowerBrowserContext?.identifier || "unknown";
    }
    const header = document.createElement("div");
    header.className = "power-browser-artifact-section-header-v2";
    const copy = document.createElement("div");
    copy.innerHTML =
      "<strong>Local artifact snapshots</strong><span>Store compact fingerprints and compare them with the current artifact.</span>";
    const save = createArtifactExplorerButton(
      "Save current snapshot",
      "power-browser-artifact-primary-v2",
    );
    save.addEventListener("click", () => {
      setStoredArtifactSnapshots([
        currentSnapshot,
        ...getStoredArtifactSnapshots(),
      ]);
      artifactExplorerState.snapshotDiff = null;
      renderArtifactExplorer();
    });
    header.append(copy, save);
    artifactExplorerState.body.appendChild(header);

    const snapshots = getStoredArtifactSnapshots().filter(
      (snapshot) =>
        snapshot?.applicationIdentifier ===
        currentSnapshot.applicationIdentifier,
    );
    if (!snapshots.length) {
      appendArtifactEmpty(
        artifactExplorerState.body,
        "No snapshots exist for this application.",
      );
      return;
    }
    const layout = document.createElement("div");
    layout.className = "power-browser-artifact-snapshot-layout-v2";
    const list = document.createElement("div");
    list.className = "power-browser-artifact-snapshot-list-v2";
    snapshots.forEach((snapshot) => {
      const card = document.createElement("div");
      card.className = "power-browser-artifact-snapshot-v2";
      const details = document.createElement("div");
      const timestamp = document.createElement("strong");
      timestamp.textContent = new Date(
        snapshot.capturedAt,
      ).toLocaleString();
      const count = Object.values(snapshot.collections || {}).reduce(
        (total, items) => total + items.length,
        0,
      );
      const meta = document.createElement("span");
      meta.textContent = `${count} indexed entries`;
      details.append(timestamp, meta);
      const actions = document.createElement("div");
      const compare = createArtifactExplorerButton(
        "Compare",
        "power-browser-artifact-action-v2",
      );
      compare.addEventListener("click", () => {
        artifactExplorerState.snapshotDiff =
          diffArtifactSnapshots(snapshot, currentSnapshot);
        renderArtifactExplorer();
      });
      const remove = createArtifactExplorerButton(
        "Delete",
        "power-browser-artifact-action-v2 danger",
      );
      remove.addEventListener("click", () => {
        setStoredArtifactSnapshots(
          getStoredArtifactSnapshots().filter(
            (candidate) =>
              !(
                candidate.applicationIdentifier ===
                  snapshot.applicationIdentifier &&
                candidate.capturedAt === snapshot.capturedAt
              ),
          ),
        );
        artifactExplorerState.snapshotDiff = null;
        renderArtifactExplorer();
      });
      actions.append(compare, remove);
      card.append(details, actions);
      list.appendChild(card);
    });
    const diff = document.createElement("div");
    diff.className = "power-browser-artifact-snapshot-diff-v2";
    renderArtifactSnapshotDiff(diff);
    layout.append(list, diff);
    artifactExplorerState.body.appendChild(layout);
  }

  function renderArtifactExplorer() {
    if (!artifactExplorerState) {
      return;
    }
    artifactExplorerState.entries = getArtifactExplorerEntries();
    artifactExplorerState.tabs
      .querySelectorAll("button")
      .forEach((button) => {
        const active =
          button.dataset.tab === artifactExplorerState.activeTab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      });
    artifactExplorerState.body.replaceChildren();
    if (!getCurrentArtifact()) {
      appendArtifactEmpty(
        artifactExplorerState.body,
        "Artifact data is unavailable on this page.",
      );
      return;
    }
    if (artifactExplorerState.activeTab === "search") {
      renderArtifactSearch();
    } else if (
      artifactExplorerState.activeTab === "relationships"
    ) {
      renderArtifactRelationships();
    } else if (artifactExplorerState.activeTab === "health") {
      renderArtifactHealth();
    } else if (artifactExplorerState.activeTab === "actions") {
      renderArtifactActions();
    } else {
      renderArtifactSnapshots();
    }
  }

  function ensureArtifactExplorer(navigator) {
    if (artifactExplorerState) {
      return artifactExplorerState;
    }
    const overlay = document.createElement("div");
    overlay.className = "power-browser-artifact-overlay-v2";
    const dialog = document.createElement("section");
    dialog.className = "power-browser-artifact-dialog-v2";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Power Browser Artifact Explorer");
    dialog.setAttribute("aria-hidden", "true");
    overlay.setAttribute("aria-hidden", "true");
    const header = document.createElement("header");
    header.className = "power-browser-artifact-header-v2";
    const title = document.createElement("div");
    title.innerHTML =
      "<strong>Artifact Explorer</strong><span>Search, inspect, audit and compare runtime artifacts</span>";
    const close = createArtifactExplorerButton(
      "×",
      "power-browser-artifact-close-v2",
    );
    close.setAttribute("aria-label", "Close Artifact Explorer");
    header.append(title, close);
    const tabs = document.createElement("div");
    tabs.className = "power-browser-artifact-tabs-v2";
    tabs.setAttribute("role", "tablist");
    [
      ["search", "Search"],
      ["relationships", "Relationships"],
      ["health", "Health"],
      ["actions", "Actions"],
      ["snapshots", "Snapshots"],
    ].forEach(([id, label]) => {
      const button = createArtifactExplorerButton(label);
      button.dataset.tab = id;
      button.setAttribute("role", "tab");
      button.addEventListener("keydown", (event) => {
        if (
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
            event.key,
          )
        ) {
          return;
        }
        event.preventDefault();
        const buttons = [...tabs.querySelectorAll('[role="tab"]')];
        const currentIndex = buttons.indexOf(button);
        const nextIndex =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (currentIndex +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    buttons.length) %
                buttons.length;
        buttons[nextIndex].click();
        buttons[nextIndex].focus();
      });
      button.addEventListener("click", () => {
        artifactExplorerState.activeTab = id;
        renderArtifactExplorer();
      });
      tabs.appendChild(button);
    });
    const body = document.createElement("div");
    body.className = "power-browser-artifact-body-v2";
    dialog.append(header, tabs, body);
    document.body.append(overlay, dialog);
    artifactExplorerState = {
      navigator,
      overlay,
      dialog,
      tabs,
      body,
      entries: [],
      activeTab: "search",
      searchQuery: "",
      actionQuery: "",
      selectedEntry: null,
      selectedAction: null,
      snapshotDiff: null,
      lastFocusedElement: null,
    };
    const theme = getPowerBrowserTheme();
    dialog.classList.toggle(
      "power-browser-dark-v2",
      theme === "dark",
    );
    dialog.classList.toggle(
      "power-browser-betty-theme-v2",
      theme === "betty",
    );
    overlay.addEventListener("click", closeArtifactExplorer);
    close.addEventListener("click", closeArtifactExplorer);
    return artifactExplorerState;
  }

  function openArtifactExplorer(navigator, entry = null) {
    const state = ensureArtifactExplorer(navigator);
    closeSettings();
    closeModelSearch();
    if (entry) {
      state.selectedEntry = entry;
      if (entry.collection === "actions") {
        state.selectedAction = entry;
        state.activeTab = "actions";
      } else {
        state.activeTab = "relationships";
      }
    }
    state.overlay.classList.add("open");
    state.dialog.classList.add("open");
    renderArtifactExplorer();
    openPowerBrowserModal({
      dialog: state.dialog,
      overlay: state.overlay,
      close: closeArtifactExplorer,
      initialFocus: () =>
        state.body.querySelector("input, button") ||
        state.tabs.querySelector(".active"),
      announcement: "Artifact Explorer opened.",
    });
  }

  function closeArtifactExplorer() {
    if (!artifactExplorerState?.dialog.classList.contains("open")) {
      return;
    }
    artifactExplorerState.overlay.classList.remove("open");
    artifactExplorerState.dialog.classList.remove("open");
    closePowerBrowserModal(artifactExplorerState.dialog);
  }

  function initializeArtifactExplorer(navigator) {
    document.addEventListener("keydown", (event) => {
      if (
        artifactExplorerState?.dialog.classList.contains("open") &&
        shortcutMatchesEvent(
          String(
            getSettingValue("extraDialogCloseShortcut") ||
              "Escape",
          ),
          event,
        )
      ) {
        event.preventDefault();
        closeArtifactExplorer();
      }
    });
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("Open Artifact Explorer", () =>
        openArtifactExplorer(navigator),
      );
    }
  }
