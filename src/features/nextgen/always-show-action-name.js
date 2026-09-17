  const NEXTGEN_ALWAYS_SHOW_ACTION_NAME_CLASS =
    "power-browser-always-show-action-name";
  const NEXTGEN_ALWAYS_SHOW_ACTION_NAME_STYLE_ID =
    "power-browser-always-show-action-name-styles";

  function ensureNextgenAlwaysShowActionNameStyles() {
    if (document.getElementById(NEXTGEN_ALWAYS_SHOW_ACTION_NAME_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = NEXTGEN_ALWAYS_SHOW_ACTION_NAME_STYLE_ID;
    style.textContent = `
      html.${NEXTGEN_ALWAYS_SHOW_ACTION_NAME_CLASS} #actionCanvas :is(.react-flow__node-step, .react-flow__node-yieldsAll) p[class~="group-hover:max-h-4"] {
        max-height: 1rem !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
    `;
    document.head.appendChild(style);
  }

  function cleanupNextgenAlwaysShowActionName() {
    document.documentElement.classList.remove(
      NEXTGEN_ALWAYS_SHOW_ACTION_NAME_CLASS,
    );
    document
      .getElementById(NEXTGEN_ALWAYS_SHOW_ACTION_NAME_STYLE_ID)
      ?.remove();
  }

  function applyNextgenAlwaysShowActionNameSetting() {
    if (!getSettingValue("nextgenAlwaysShowActionName")) {
      cleanupNextgenAlwaysShowActionName();
      return;
    }
    ensureNextgenAlwaysShowActionNameStyles();
    document.documentElement.classList.add(
      NEXTGEN_ALWAYS_SHOW_ACTION_NAME_CLASS,
    );
  }
