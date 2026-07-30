  function configureNavigator(
    navigator,
    { artifactData, siteType, identifier, applicationFamily = null },
  ) {
    if (!identifier) {
      return;
    }

    const environmentPrefix = getEnvironmentPrefix();
    const builderHost = `${identifier}.${environmentPrefix}bettyblocks.com`;
    const runtimeHost = `${identifier}.${environmentPrefix}betty.app`;
    const applicationId = getApplicationId(
      artifactData,
      applicationFamily,
      identifier,
    );

    updateNavigatorLink(
      navigator,
      "organizationButton",
      `https://my.${environmentPrefix}bettyblocks.com/applications/${identifier}`,
    );
    updateNavigatorLink(
      navigator,
      "homePageButton",
      `https://${runtimeHost}/`,
    );
    updateNavigatorLink(
      navigator,
      "backOfficeButton",
      `https://${builderHost}/`,
    );
    updateNavigatorLink(
      navigator,
      "b5Models",
      `https://${builderHost}/#models`,
    );
    updateNavigatorLink(
      navigator,
      "monitoringButton",
      `https://${builderHost}/monitoring`,
    );
    updateNavigatorLink(
      navigator,
      "playgroundButton",
      applicationId
        ? `https://${runtimeHost}/api/runtime/${applicationId}`
        : null,
    );

    ["buttonRuntime", "buttonPagebuilder", "buttonProcoderMode"].forEach(
      (id) => updateNavigatorLink(navigator, id, null, false),
    );

    const builderPageId = getBuilderPageId();

    if (siteType === SiteType.NEXTGEN && builderPageId) {
      const endpoint = normalizeEndpoints(artifactData?.endpoints).find(
        (candidate) =>
          candidate?.id === builderPageId ||
          candidate?.pageId === builderPageId,
      );
      const runtimeHref = endpoint?.url
        ? `https://${runtimeHost}${endpoint.url}`
        : null;

      updateNavigatorLink(
        navigator,
        "buttonRuntime",
        runtimeHref,
        true,
      );

      if (location.pathname.includes("/page-builder/")) {
        updateNavigatorLink(
          navigator,
          "buttonProcoderMode",
          location.href.replace("/page-builder/", "/pro-coder-mode/"),
          true,
        );
      } else {
        updateNavigatorLink(
          navigator,
          "buttonPagebuilder",
          location.href.replace("/pro-coder-mode/", "/page-builder/"),
          true,
        );
      }
    }

    if (siteType === SiteType.RUNTIME) {
      const endpoint = getCurrentEndpoint(artifactData);
      const pageBuilderId = endpoint?.id || endpoint?.pageId;
      updateNavigatorLink(
        navigator,
        "buttonPagebuilder",
        pageBuilderId
          ? `https://${builderHost}/app/page-builder/${pageBuilderId}`
          : null,
        true,
      );
      configureBearerButton(navigator, true);
    } else {
      configureBearerButton(navigator, false);
    }

    navigator.navigatorBar.setAttribute("aria-busy", "false");
  }

  function sortApplicationFamily(applicationFamily) {
    const applications = (Array.isArray(applicationFamily)
      ? applicationFamily
      : applicationFamily
        ? [applicationFamily]
        : []
    ).filter((application) => application?.id && application?.identifier);
    const applicationsById = new Map(
      applications.map((application) => [String(application.id), application]),
    );
    const childrenByParentId = new Map();
    const roots = [];
    const compareApplications = (left, right) =>
      String(left.insertedAt || "").localeCompare(
        String(right.insertedAt || ""),
      ) || String(left.name || left.identifier).localeCompare(
        String(right.name || right.identifier),
      );

    applications.forEach((application) => {
      const parentId = application.parentId ?? application.parent?.id;
      const parentKey = parentId == null ? null : String(parentId);

      if (!parentKey || !applicationsById.has(parentKey)) {
        roots.push(application);
        return;
      }

      const children = childrenByParentId.get(parentKey) || [];
      children.push(application);
      childrenByParentId.set(parentKey, children);
    });

    roots.sort(compareApplications);
    childrenByParentId.forEach((children) =>
      children.sort(compareApplications),
    );

    const ordered = [];
    const visited = new Set();
    const visit = (application, depth) => {
      const key = String(application.id);

      if (visited.has(key)) {
        return;
      }

      visited.add(key);
      ordered.push({ application, depth });
      (childrenByParentId.get(key) || []).forEach((child) =>
        visit(child, depth + 1),
      );
    };

    roots.forEach((root) => visit(root, 0));
    applications
      .filter((application) => !visited.has(String(application.id)))
      .sort(compareApplications)
      .forEach((application) => visit(application, 0));

    return ordered;
  }

  function switchApplication(
    currentIdentifier,
    selectedApplication,
    siteType,
  ) {
    const selectedIdentifier = selectedApplication?.identifier;

    if (
      !currentIdentifier ||
      !selectedIdentifier ||
      currentIdentifier === selectedIdentifier
    ) {
      return;
    }

    const targetUrl = new URL(location.href);
    const currentPrefix = `${currentIdentifier}.`;

    if (!targetUrl.hostname.startsWith(currentPrefix)) {
      console.warn(
        "[Power Browser v2] The current application identifier was not found at the start of the hostname.",
        { currentIdentifier, hostname: targetUrl.hostname },
      );
      return;
    }

    targetUrl.hostname =
      selectedIdentifier + targetUrl.hostname.slice(currentIdentifier.length);

    if (siteType === SiteType.PLAYGROUND) {
      if (!selectedApplication.appUuid) {
        console.warn(
          "[Power Browser v2] The selected sandbox has no application UUID.",
          selectedApplication,
        );
        return;
      }

      const runtimePathPattern = /(\/api\/runtime\/)[^/]+/;

      if (!runtimePathPattern.test(targetUrl.pathname)) {
        console.warn(
          "[Power Browser v2] The Playground runtime UUID was not found in the URL.",
          { pathname: targetUrl.pathname },
        );
        return;
      }

      targetUrl.pathname = targetUrl.pathname.replace(
        runtimePathPattern,
        `$1${selectedApplication.appUuid}`,
      );
    }

    location.assign(targetUrl.href);
  }

  function configureApplicationSwitcher(
    navigator,
    applicationFamily,
    currentIdentifier,
    siteType,
  ) {
    const orderedApplications = sortApplicationFamily(applicationFamily);

    if (!orderedApplications.length) {
      updateApplicationSwitcherStatus(
        "manual-login-required",
        "Sandbox data is unavailable. Visit my.bettyblocks.com, then reload this page.",
      );
      return;
    }

    const currentApplication =
      orderedApplications.find(
        ({ application }) =>
          application.identifier === currentIdentifier,
      )?.application || null;

    const currentSandboxName =
      currentApplication?.name || currentIdentifier || "Unknown";
    navigator.stateToggleLabel.textContent = currentSandboxName;
    navigator.stateToggle.setAttribute(
      "aria-label",
      `Sandbox switcher. Current sandbox: ${currentSandboxName}`,
    );
    navigator.stateMenu.replaceChildren();

    orderedApplications.forEach(({ application, depth }) => {
      const option = document.createElement("button");
      const isCurrent = application.identifier === currentIdentifier;
      const hasNoAccess =
        application.permissions?.isBuilder === false &&
        application.permissions?.isMember === false;
      option.type = "button";
      option.className = [
        "power-browser-state-option-v2",
        isCurrent ? "current" : "",
        hasNoAccess ? "no-access" : "",
      ]
        .filter(Boolean)
        .join(" ");
      option.style.setProperty("--power-browser-depth", depth);
      option.disabled = isCurrent || hasNoAccess;
      option.setAttribute("aria-disabled", String(isCurrent || hasNoAccess));

      if (hasNoAccess) {
        option.title = "You are not a builder or member of this application.";
      }

      const label = document.createElement("span");
      label.textContent = application.name || application.identifier;
      option.appendChild(label);

      const state = document.createElement("small");
      state.textContent =
        hasNoAccess
          ? "No access"
          : depth === 0
          ? "Production"
          : application.parent?.name || application.parent?.identifier || "";
      option.appendChild(state);

      if (!isCurrent && !hasNoAccess) {
        option.addEventListener("click", () =>
          switchApplication(currentIdentifier, application, siteType),
        );
      }

      navigator.stateMenu.appendChild(option);
    });

    updateApplicationSwitcherStatus(
      "ready",
      `Loaded ${orderedApplications.length} sandbox environments.`,
    );
  }

  function renderApplicationSwitcherStatus(navigator, snapshot) {
    const { status, message } = snapshot;
    navigator.stateSwitcher.dataset.status = status;
    navigator.stateStatusMessage.textContent = message;
    navigator.stateStatusPopover.hidden = status === "ready";
    navigator.stateRetryButton.disabled =
      status === "loading" || status === "reauthenticating";

    if (status === "ready") {
      navigator.stateSwitcher.removeAttribute("tabindex");
      navigator.stateToggle.disabled = false;
      navigator.stateToggle.setAttribute("aria-disabled", "false");
      navigator.stateToggle.classList.remove(NAV_DISABLED_CLASS);
      return;
    }

    navigator.stateSwitcher.tabIndex = 0;
    navigator.stateToggle.disabled = true;
    navigator.stateToggle.setAttribute("aria-disabled", "true");
    navigator.stateToggle.setAttribute(
      "aria-label",
      `Sandbox switcher unavailable. ${message}`,
    );
    navigator.stateToggle.classList.add(NAV_DISABLED_CLASS);
    navigator.stateSwitcher.classList.remove("open");
    navigator.stateToggle.setAttribute("aria-expanded", "false");
  }

  /**
   * Keeps every route-sensitive feature aligned with SPA navigation.
   *
   * @param {ReturnType<typeof initializeNavigator>} navigator
   * @returns {void}
   */
