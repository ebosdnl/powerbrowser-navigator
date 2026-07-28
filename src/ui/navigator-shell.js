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

    const controls = new Map();
    let stateSwitcher;
    let stateToggle;
    let stateToggleLabel;
    let stateMenu;

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
        stateSwitcher.className = "power-browser-state-switcher-v2";

        stateToggle = document.createElement("button");
        stateToggle.type = "button";
        stateToggle.className = `power-browser-state-toggle-v2 ${NAV_DISABLED_CLASS}`;
        stateToggle.disabled = true;
        stateToggle.setAttribute("aria-expanded", "false");
        stateToggle.setAttribute("aria-label", "Sandbox switcher");
        stateToggle.title = "Switch sandbox";
        stateToggle.innerHTML = `${SvgIcons.switch}<span class="power-browser-state-toggle-label-v2">Sandbox switcher</span>`;
        stateToggleLabel = stateToggle.querySelector(
          ".power-browser-state-toggle-label-v2",
        );

        stateMenu = document.createElement("div");
        stateMenu.className = "power-browser-state-menu-v2";

        stateToggle.addEventListener("click", () => {
          const isOpen = stateSwitcher.classList.toggle("open");
          stateToggle.setAttribute("aria-expanded", String(isOpen));
        });

        stateSwitcher.appendChild(stateToggle);
        stateSwitcher.appendChild(stateMenu);
        dropdown.appendChild(stateSwitcher);
      }
    });

    const settingsButton = document.createElement("button");
    settingsButton.id = "settingsButton";
    settingsButton.type = "button";
    settingsButton.disabled = true;
    settingsButton.className = NAV_DISABLED_CLASS;
    settingsButton.innerHTML = `${SvgIcons.settings}<span>Settings</span>`;
    settingsButton.title = "Settings will be added in a later v2 step.";
    dropdown.appendChild(settingsButton);

    navigatorBar.appendChild(dropdown);
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
      controls,
      stateSwitcher,
      stateToggle,
      stateToggleLabel,
      stateMenu,
    };
  }

