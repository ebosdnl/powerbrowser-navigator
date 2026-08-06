  const NEXTGEN_ACTION_TYPE_ICON_CLASS = "power-browser-action-type-icon";
  const NEXTGEN_ACTION_TYPE_ICON_STYLE_ID =
    "power-browser-action-type-icon-styles";
  const nextgenActionTypeIconTemplates = new Map();

  function getNextgenActionTypeIconRouteId() {
    return location.pathname.match(/\/app\/actions\/([^/?#]+)/i)?.[1] || null;
  }

  function getFunctionTypeIconElement(type) {
    const iconMarkupByType = {
      application:
        '<svg data-testid="icon_design_tools" viewBox="0 0 14 14" functionType="APPLICATION"><path d="M13.264 3.28 3.989 12.545a1.12 1.12 0 0 1-.495.287l-2.42.7a.5.5 0 0 1-.608-.608l.696-2.424c.052-.187.151-.358.288-.494L10.723.74a1.006 1.006 0 0 1 1.425 0l1.116 1.116c.394.39.4 1.024.009 1.419l-.009.005ZM11.116 8.227c-.572 0-.978-.111-1.363-.311L7.917 9.752c.212.294.324.645.324 1.006 0 .88.16 1.588.872 2.244.596.55 1.397 1.081 2.285.984.278-.039.37-.38.178-.532l-.939-.939a.823.823 0 0 1 0-1.165l.718-.719a.826.826 0 0 1 1.167 0l.939.939c.195.197.504.067.531-.183.004-.095.008-.189.008-.282-.002-1.59-1.293-2.88-2.884-2.878ZM3.369 2.655a.824.824 0 0 0 0-1.167L2.43.543c-.2-.196-.035-.502.184-.529 1.583-.157 2.994 1.001 3.151 2.584.01.095.014.19.014.285 0 .57.11.978.316 1.363L4.245 6.087c-.33-.238-.734-.35-1.139-.319C1.518 5.892.132 4.706.008 3.12A2.902 2.902 0 0 1 .013 2.612c.02-.17.176-.292.347-.273.07.009.135.04.184.09l.938.937a.825.825 0 0 0 1.167 0l.72-.711Z"/></svg>',
      blockstore:
        '<svg data-testid="icon_blockstore" viewBox="0 0 14 14" functionType="BLOCKSTORE"><path d="M1.444.455A.7.7 0 0 1 2.1 0h9.8a.7.7 0 0 1 .631.397C12.567.47 14 3.46 14 5.6a2.8 2.8 0 0 1-2.8 2.8c-.925 0-1.59-.452-2.024-.983C8.725 7.986 8.012 8.4 7 8.4c-.975 0-1.672-.384-2.125-.92A2.8 2.8 0 0 1 0 5.6C0 4.213 1.444.455 1.444.455ZM2.8 9.8a.7.7 0 0 0-1.4 0v3.5c0 .387.313.7.7.7h9.8a.7.7 0 0 0 .7-.7V9.8a.7.7 0 0 0-1.4 0v2.45a.35.35 0 0 1-.35.35h-7.7a.35.35 0 0 1-.35-.35V9.8Z"/></svg>',
      native:
        '<svg data-testid="icon_betty_logo" viewBox="0 0 14 14" functionType="NATIVE"><path fill-rule="evenodd" d="M.66 3.929A1.05 1.05 0 0 0 0 4.904v4.178c0 .43.261.815.66.975l5.954 2.47c.25.1.53.1.78 0l5.946-2.47c.399-.16.66-.546.66-.975V4.904c0-.43-.261-.815-.66-.975L7.35 1.475a1.05 1.05 0 0 0-.78 0L.66 3.929ZM4.55 4.201h2.262c.78 0 1.376.11 1.788.334.412.224.617.589.617 1.095 0 .657-.34 1.059-1.018 1.204.369.07.67.207.902.412.233.205.349.512.349.921 0 .598-.213 1.02-.638 1.265-.425.245-1.019.368-1.783.368H4.55v-.24c0-.384.309-.696.691-.696V5.399l.921-.26h-.921c-.382 0-.691-.312-.691-.697v-.241Zm3.545 3.893c0-.517-.32-.775-.962-.775h-.577v1.519h.481c.347 0 .61-.053.789-.158.179-.105.269-.3.269-.586Zm-.441-2.816c-.15-.094-.388-.141-.714-.141h-.384v1.301h.489c.555 0 .833-.226.833-.679 0-.226-.075-.387-.224-.481Z" clip-rule="evenodd"/></svg>',
    };
    const markup = iconMarkupByType[type];
    if (!markup) return null;

    if (!nextgenActionTypeIconTemplates.has(type)) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = markup;
      nextgenActionTypeIconTemplates.set(type, wrapper.firstElementChild);
    }
    const icon = nextgenActionTypeIconTemplates.get(type)?.cloneNode(true);
    if (!icon) return null;
    icon.classList.add(NEXTGEN_ACTION_TYPE_ICON_CLASS);
    icon.dataset.powerBrowserFunctionType = type;
    icon.setAttribute("aria-label", `${type} function`);
    icon.setAttribute("role", "img");
    return icon;
  }

  function ensureNextgenActionTypeIconStyles() {
    if (document.getElementById(NEXTGEN_ACTION_TYPE_ICON_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = NEXTGEN_ACTION_TYPE_ICON_STYLE_ID;
    style.textContent = `[data-testid="function-type-icon"].hidden{display:block!important}[data-testid="function-type-icon"] svg{fill:#374151!important}svg.${NEXTGEN_ACTION_TYPE_ICON_CLASS}{display:inline-block;flex:0 0 auto;width:1rem;height:1rem;margin-left:.25rem;fill:#374151!important}.react-flow__node-yieldsAll svg.${NEXTGEN_ACTION_TYPE_ICON_CLASS}{margin-right:.375rem}`;
    document.head.appendChild(style);
  }

  function clearNextgenActionTypeIcons() {
    document
      .querySelectorAll(`.${NEXTGEN_ACTION_TYPE_ICON_CLASS}`)
      .forEach((icon) => icon.remove());
  }

  function renderNextgenActionTypeIcons() {
    const nodes = document.querySelectorAll(
      ".react-flow__node-step[data-id], .react-flow__node-yieldsAll[data-id]",
    );
    nodes.forEach((node) => {
      const id = node.getAttribute("data-id");
      const type =
        nextgenActionTypeIconsById.get(id) ||
        (node.classList.contains("react-flow__node-yieldsAll") ? "native" : null);
      const existing = node.querySelector(`.${NEXTGEN_ACTION_TYPE_ICON_CLASS}`);
      if (!type) {
        existing?.remove();
        return;
      }
      if (existing?.dataset.powerBrowserFunctionType === type) return;
      const icon = getFunctionTypeIconElement(type);
      if (!icon) return;
      if (existing) {
        existing.replaceWith(icon);
        return;
      }
      const errorIcon = node.querySelector("svg[data-testid='icon_error_triangle']");
      const actionArea =
        errorIcon?.closest("div[data-state]")?.parentElement ||
        node.querySelector(
          ".p-1.flex.items-center.relative.justify-between.w-full > .flex.items-center.pr-1",
        ) ||
        node.querySelector(
          ".flex.items-center.flex-row.py-1.px-0\\.5.w-full.justify-between",
        );
      if (!actionArea) return;
      if (errorIcon) {
        actionArea.insertBefore(icon, errorIcon.closest("div[data-state]"));
      } else {
        actionArea.appendChild(icon);
      }
    });
  }

  async function fetchNextgenActionTypeIcons(actionId) {
    const identifier = currentPowerBrowserContext?.identifier;
    const csrfToken = getCsrfToken() || getNextgenLogCsrfToken();
    if (!identifier || !csrfToken) return new Map();
    const response = await fetch(`${location.origin}/api/meta/graphql`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "application-identifier": identifier,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        operationName: "PowerBrowserActionFunctionTypes",
        variables: { input: { id: actionId } },
        query: `query PowerBrowserActionFunctionTypes($input: ActionInput!) { action(input: $input) { actionSteps { id nativeFunction { name } applicationFunction { name } blockStoreFunction { name } } } }`,
      }),
    });
    if (!response.ok) throw new Error(`Action request failed (${response.status}).`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors[0].message);
    return (payload.data?.action?.actionSteps || []).reduce((types, step) => {
      const type = step.applicationFunction
        ? "application"
        : step.blockStoreFunction
          ? "blockstore"
          : step.nativeFunction
            ? "native"
            : null;
      if (step.id && type) types.set(step.id, type);
      return types;
    }, new Map());
  }

  function scheduleNextgenActionTypeIconRender() {
    clearTimeout(nextgenActionTypeIconsTimer);
    nextgenActionTypeIconsTimer = setTimeout(() => {
      renderNextgenActionTypeIcons();
      const hasUnmappedStep = Array.from(
        document.querySelectorAll(".react-flow__node-step[data-id]"),
      ).some(
        (node) =>
          !nextgenActionTypeIconsById.has(node.getAttribute("data-id")),
      );
      if (hasUnmappedStep) {
        nextgenActionTypeIconsRoute = "";
        void applyNextgenActionTypeIconsSetting();
      }
    }, 50);
  }

  function cleanupNextgenActionTypeIcons() {
    clearTimeout(nextgenActionTypeIconsTimer);
    nextgenActionTypeIconsObserver?.disconnect();
    nextgenActionTypeIconsObserver = null;
    nextgenActionTypeIconsById = new Map();
    nextgenActionTypeIconsRoute = "";
    nextgenActionTypeIconsRequest += 1;
    clearNextgenActionTypeIcons();
    document.getElementById(NEXTGEN_ACTION_TYPE_ICON_STYLE_ID)?.remove();
  }

  async function applyNextgenActionTypeIconsSetting() {
    const actionId = getNextgenActionTypeIconRouteId();
    if (!getSettingValue("nextgenActionTypeIcons") || !actionId) {
      cleanupNextgenActionTypeIcons();
      return;
    }
    ensureNextgenActionTypeIconStyles();
    if (!nextgenActionTypeIconsObserver) {
      nextgenActionTypeIconsObserver = new MutationObserver(
        scheduleNextgenActionTypeIconRender,
      );
      nextgenActionTypeIconsObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
    if (!currentPowerBrowserContext?.identifier) return;
    if (nextgenActionTypeIconsRoute === actionId) {
      renderNextgenActionTypeIcons();
      return;
    }
    nextgenActionTypeIconsRoute = actionId;
    const request = ++nextgenActionTypeIconsRequest;
    try {
      const types = await fetchNextgenActionTypeIcons(actionId);
      if (request !== nextgenActionTypeIconsRequest) return;
      nextgenActionTypeIconsById = types;
      renderNextgenActionTypeIcons();
    } catch (error) {
      logger.warn("Unable to load Next-gen action function types", error);
    }
  }
