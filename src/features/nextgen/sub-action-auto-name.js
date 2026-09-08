  let nextgenSubActionAutoNameSequence = 0;
  let nextgenSubActionAutoNameLastTrigger = null;
  let nextgenSubActionAutoNamePendingSelection = null;
  let nextgenSubActionAutoNameClickListenerInstalled = false;

  function getNextgenSubActionEditorContext() {
    const match = location.pathname.match(
      /\/app\/actions\/([^/?#]+)\/steps\/([^/?#]+)/i,
    );
    return match ? { actionId: match[1], stepId: match[2] } : null;
  }

  function getNextgenSubActionDialog() {
    return (
      Array.from(document.querySelectorAll('[role="dialog"]')).find(
        (dialog) =>
          dialog.getAttribute("aria-hidden") !== "true" &&
          dialog.querySelector('button[data-test="select-variable"]'),
      ) || null
    );
  }

  function synchronizeNextgenSubActionLabel(label, stepId) {
    const dialog = getNextgenSubActionDialog();
    const heading = dialog?.querySelector("h6");
    if (heading && heading.textContent !== label) {
      heading.textContent = label;
    }

    const canvasLabel = document.querySelector(
      `.react-flow__node-step[data-id="${CSS.escape(stepId)}"] p.truncate.text-xs`,
    );
    if (canvasLabel && canvasLabel.textContent !== label) {
      canvasLabel.textContent = label;
    }
  }

  function keepNextgenSubActionLabelSynchronized(label, stepId, sequence) {
    let observer = null;
    const synchronize = () => {
      if (
        sequence !== nextgenSubActionAutoNameSequence ||
        !getSettingValue("nextgenSubActionAutoName") ||
        getNextgenSubActionEditorContext()?.stepId !== stepId
      ) {
        observer?.disconnect();
        return;
      }
      synchronizeNextgenSubActionLabel(label, stepId);
    };
    synchronize();
    observer = new MutationObserver(synchronize);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    setTimeout(() => {
      synchronize();
      observer.disconnect();
    }, 5000);
  }

  function refreshNextgenSubActionLabelState(context, label) {
    const bridge = pageWindow[NEXTGEN_RUNTIME_BRIDGE_KEY];
    for (const client of bridge?.apolloClients || []) {
      const cache = client?.cache;
      if (!cache || typeof cache.modify !== "function") continue;
      try {
        const cacheId = cache.identify?.({
          __typename: "ActionStep",
          id: context.stepId,
        });
        if (cacheId) {
          cache.modify({ id: cacheId, fields: { label: () => label } });
          cache.broadcastWatches?.();
        }
      } catch (error) {
        console.debug(
          "[Power Browser] Unable to refresh the Sub Action label in Apollo.",
          error,
        );
      }
    }

    const store = (bridge?.reduxStores || []).find((candidate) => {
      try {
        return candidate.getState()?.action?.action?.id === context.actionId;
      } catch {
        return false;
      }
    });
    if (!store) return;
    const action = store.getState()?.action?.action;
    const actionSteps = action?.actionSteps;
    if (!Array.isArray(actionSteps)) return;
    store.dispatch({
      type: "action/setAction",
      payload: {
        ...action,
        actionSteps: actionSteps.map((actionStep) =>
          actionStep.id === context.stepId
            ? { ...actionStep, label }
            : actionStep,
        ),
      },
    });
  }

  function getCachedNextgenActionIdByName(name) {
    const matches = Array.from(quickSwitcherActionRequestCache.values())
      .flatMap((entry) => entry?.value || [])
      .filter(
        (entry) =>
          entry?.type === "action" &&
          entry.title?.trim() === name &&
          entry.id,
      );
    return matches.length === 1 ? matches[0].id : null;
  }

  async function resolveNextgenActionIdByName(name) {
    const cachedId = getCachedNextgenActionIdByName(name);
    if (cachedId) return cachedId;
    const data = await requestNextgenActionStepGraphql(
      "PowerBrowserResolveSubAction",
      `query PowerBrowserResolveSubAction($filter: ActionFilter, $order: [ActionOrder]) {
        actions(perPage: 50, page: 1, filter: $filter, order: $order) {
          results { id name }
        }
      }`,
      {
        filter: { field: { name: { like: name } } },
        order: [{ field: "name", direction: "ASC" }],
      },
    );
    const matches = (data.actions?.results || []).filter(
      (action) => action?.name?.trim() === name && action.id,
    );
    return matches.length === 1 ? matches[0].id : null;
  }

  async function autoNameNextgenSelectedSubAction(actionName) {
    const selectedActionId = await resolveNextgenActionIdByName(actionName);
    if (!selectedActionId) {
      throw new Error(`Unable to uniquely resolve the selected action “${actionName}”.`);
    }
    const data = await requestNextgenActionStepGraphql(
      "ActionName",
      `query ActionName($input: ActionInput!) {
        action(input: $input) {
          name
          __typename
        }
      }`,
      { input: { id: selectedActionId } },
    );
    const selectedActionName = data.action?.name?.trim();
    if (!selectedActionName) return;
    return autoNameNextgenSubAction(selectedActionId, selectedActionName);
  }

  async function autoNameNextgenSubAction(
    selectedActionId,
    selectedActionName,
  ) {
    if (!getSettingValue("nextgenSubActionAutoName")) return;
    const context = getNextgenSubActionEditorContext();
    if (!context || !selectedActionId || !selectedActionName) return;
    const trigger = `${context.stepId}:${selectedActionId}:${selectedActionName}`;
    const now = Date.now();
    if (
      nextgenSubActionAutoNameLastTrigger?.key === trigger &&
      now - nextgenSubActionAutoNameLastTrigger.time < 1000
    ) {
      return;
    }
    nextgenSubActionAutoNameLastTrigger = { key: trigger, time: now };

    const sequence = ++nextgenSubActionAutoNameSequence;
    const data = await requestNextgenActionStepGraphql(
      "PowerBrowserSubActionAutoNameStep",
      `query PowerBrowserSubActionAutoNameStep($input: ActionStepInput) {
        actionStep(input: $input) {
          id
          label
          nativeFunction { name }
        }
      }`,
      { input: { id: context.stepId } },
    );
    const step = data.actionStep;
    if (
      sequence !== nextgenSubActionAutoNameSequence ||
      !getSettingValue("nextgenSubActionAutoName") ||
      getNextgenSubActionEditorContext()?.stepId !== context.stepId ||
      step?.id !== context.stepId ||
      step.nativeFunction?.name !== "subAction"
    ) {
      return;
    }

    if (step.label !== selectedActionName) {
      await requestNextgenActionStepGraphql(
        "UpdateActionStepWithSync",
        `mutation UpdateActionStepWithSync($updateInput: UpdateActionStepInput!, $toggleSyncInput: ToggleSyncActionStepWithPageComponentInput) {
          updateActionStep(input: $updateInput) {
            __typename
            id
            actionStepPaths {
              __typename
              id
            }
          }
          toggleSyncActionStepWithPageComponent(input: $toggleSyncInput)
        }`,
        {
          updateInput: { id: context.stepId, label: selectedActionName },
          toggleSyncInput: null,
        },
      );
    }
    refreshNextgenSubActionLabelState(context, selectedActionName);
    // Keep the visible labels stable while Betty Blocks processes its own
    // asynchronous renders after the Apollo and Redux state refreshes.
    keepNextgenSubActionLabelSynchronized(
      selectedActionName,
      context.stepId,
      sequence,
    );
  }

  function commitNextgenSubActionAutoNameSelection() {
    const selection = nextgenSubActionAutoNamePendingSelection;
    nextgenSubActionAutoNamePendingSelection = null;
    const context = getNextgenSubActionEditorContext();
    if (
      !selection ||
      !context ||
      selection.stepId !== context.stepId ||
      Date.now() - selection.capturedAt > 30000
    ) {
      return;
    }
    queueMicrotask(() => {
      void autoNameNextgenSelectedSubAction(selection.name).catch((error) =>
        console.error(
          "[Power Browser] Unable to name the selected Sub Action step.",
          error,
        ),
      );
    });
  }

  function handleNextgenSubActionAutoNameClick(event) {
    if (!getSettingValue("nextgenSubActionAutoName")) return;
    const control = event.target.closest?.('button, [role="button"]');
    if (!control) return;
    if (control.querySelector('svg[aria-label="Action"]')) {
      const context = getNextgenSubActionEditorContext();
      const name = control.textContent?.trim();
      nextgenSubActionAutoNamePendingSelection =
        context && name
          ? { name, stepId: context.stepId, capturedAt: Date.now() }
          : null;
      if (event.detail >= 2) {
        commitNextgenSubActionAutoNameSelection();
      }
      return;
    }
    if (control.textContent?.trim() !== "Select") return;
    commitNextgenSubActionAutoNameSelection();
  }

  function cleanupNextgenSubActionAutoName() {
    nextgenSubActionAutoNameSequence += 1;
    nextgenSubActionAutoNameLastTrigger = null;
    nextgenSubActionAutoNamePendingSelection = null;
    if (nextgenSubActionAutoNameClickListenerInstalled) {
      document.removeEventListener(
        "click",
        handleNextgenSubActionAutoNameClick,
        true,
      );
      nextgenSubActionAutoNameClickListenerInstalled = false;
    }
  }

  function applyNextgenSubActionAutoNameSetting() {
    if (!getSettingValue("nextgenSubActionAutoName")) {
      cleanupNextgenSubActionAutoName();
      return;
    }
    if (!nextgenSubActionAutoNameClickListenerInstalled) {
      document.addEventListener(
        "click",
        handleNextgenSubActionAutoNameClick,
        true,
      );
      nextgenSubActionAutoNameClickListenerInstalled = true;
    }
  }
