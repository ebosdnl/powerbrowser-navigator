  const NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS =
    "power-browser-action-history-controls";
  const NEXTGEN_ACTION_HISTORY_STYLE_ID =
    "power-browser-action-history-style";
  const NEXTGEN_ACTION_VERSIONS_KEY =
    "powerBrowserNextgenActionVersionsV1";
  const NEXTGEN_ACTION_HISTORY_STORAGE_KEY =
    "powerBrowserNextgenActionHistoryV1";
  const nextgenActionHistoryByAction = new Map();
  const nextgenActionHistoryHook = {
    before: captureNextgenActionHistoryBeforeMutation,
    after: captureNextgenActionHistoryAfterMutation,
  };
  let nextgenActionHistoryHookInstalled = false;
  let nextgenActionHistoryDialogState = null;
  let nextgenActionVersionDialogState = null;
  GM_addValueChangeListener(
    NEXTGEN_ACTION_HISTORY_STORAGE_KEY,
    (_key, _oldValue, _newValue, remote) => {
      if (!remote) return;
      nextgenActionHistoryByAction.clear();
      updateNextgenActionHistoryControls();
      renderNextgenActionHistoryDialog();
    },
  );
  GM_addValueChangeListener(
    NEXTGEN_ACTION_VERSIONS_KEY,
    (_key, _oldValue, _newValue, remote) => {
      if (remote) renderNextgenActionVersionDialog();
    },
  );

  function getNextgenActionHistoryLimit() {
    const value = Math.floor(
      Number(getSettingValue("nextgenActionStepHistoryLength")),
    );
    return Number.isFinite(value) ? Math.min(50, Math.max(1, value)) : 20;
  }

  function getNextgenActionHistoryRoute() {
    const match = location.pathname.match(/\/app\/actions\/([^/?#]+)/i);
    return match ? { actionId: match[1] } : null;
  }

  function getNextgenActionStorageScopeKey(actionId) {
    return `${location.hostname.toLowerCase()}:${actionId}`;
  }

  function getNextgenLegacyActionStorageScopeKeys(actionId) {
    const identifier = currentPowerBrowserContext?.identifier;
    return identifier
      ? [`${identifier}:${actionId}`].filter(
          (key) => key !== getNextgenActionStorageScopeKey(actionId),
        )
      : [];
  }

  function readNextgenActionHistoryState(actionId) {
    const stored = GM_getValue(NEXTGEN_ACTION_HISTORY_STORAGE_KEY, {});
    const scopeKey = getNextgenActionStorageScopeKey(actionId);
    const saved = stored?.[scopeKey];
    if (!saved || saved.schemaVersion !== 1) {
      return { actionId, undo: [], redo: [], busy: false };
    }
    const limit = getNextgenActionHistoryLimit();
    const undo = Array.isArray(saved.undo)
      ? structuredClone(saved.undo).slice(-limit)
      : [];
    const redo = Array.isArray(saved.redo)
      ? structuredClone(saved.redo).slice(-limit)
      : [];
    if (undo.length || redo.length) {
      console.info("[Power Browser] Restored persisted action-step history.", {
        actionId,
        undoDepth: undo.length,
        redoDepth: redo.length,
      });
    }
    return {
      actionId,
      undo,
      redo,
      busy: false,
    };
  }

  function persistNextgenActionHistoryState(actionId, state) {
    const stored = GM_getValue(NEXTGEN_ACTION_HISTORY_STORAGE_KEY, {});
    const scopeKey = getNextgenActionStorageScopeKey(actionId);
    try {
      GM_setValue(NEXTGEN_ACTION_HISTORY_STORAGE_KEY, {
        ...(stored && typeof stored === "object" ? stored : {}),
        [scopeKey]: {
          schemaVersion: 1,
          updatedAt: new Date().toISOString(),
          undo: state.undo,
          redo: state.redo,
        },
      });
    } catch (error) {
      console.error("[Power Browser] Unable to persist action-step history.", {
        actionId,
        error,
      });
    }
  }

  function getNextgenActionHistoryState(actionId) {
    const scopeKey = getNextgenActionStorageScopeKey(actionId);
    if (!nextgenActionHistoryByAction.has(scopeKey)) {
      nextgenActionHistoryByAction.set(
        scopeKey,
        readNextgenActionHistoryState(actionId),
      );
    }
    return nextgenActionHistoryByAction.get(scopeKey);
  }

  function getNextgenActionMutationInput(details) {
    const variables = details.variables || {};
    if (details.mutationType === "create") {
      return variables.createActionStepInput || variables.createInput || null;
    }
    if (details.mutationType === "update") {
      return variables.updateInput || null;
    }
    return variables.deleteActionStepInput || variables.deleteInput || null;
  }

  function resolveNextgenActionHistoryActionId(stepId, explicitActionId) {
    if (explicitActionId) return explicitActionId;
    const routeActionId = getNextgenActionHistoryRoute()?.actionId;
    if (routeActionId) return routeActionId;
    const bridge = getNextgenActionRuntimeBridge();
    for (const store of bridge?.reduxStores || []) {
      try {
        const action = store.getState()?.action?.action;
        if (action?.actionSteps?.some((step) => step.id === stepId)) {
          return action.id;
        }
      } catch {
        // Ignore stores that are being replaced during route transitions.
      }
    }
    return null;
  }

  function createNextgenActionStepSnapshot(source, stepId) {
    const position = source.action?.actionSteps?.find(
      (step) => step.id === stepId,
    );
    if (!source.actionStep || !position) return null;
    return {
      actionStep: structuredClone(source.actionStep),
      actionStepVariables: {
        results: structuredClone(source.actionStepVariables?.results || []),
      },
      position: structuredClone(position),
    };
  }

  async function captureNextgenActionStepSnapshot(actionId, stepId) {
    const source = await fetchNextgenActionStepForDuplication(actionId, stepId);
    if (!source.actionStep) return null;
    source.actionStepVariables = {
      results: await getNextgenSourceActionStepVariables(source),
    };
    return createNextgenActionStepSnapshot(source, stepId);
  }

  async function captureNextgenActionStepTree(actionId, rootStepId) {
    const rootSource = await fetchNextgenActionStepForDuplication(
      actionId,
      rootStepId,
    );
    if (!rootSource.actionStep) return [];
    rootSource.actionStepVariables = {
      results: await getNextgenSourceActionStepVariables(rootSource),
    };
    const actionSteps = rootSource.action?.actionSteps || [];
    const pathOwners = new Map(
      (rootSource.action?.actionStepPaths || []).map((path) => [
        path.id,
        path.actionStepId,
      ]),
    );
    const stepIds = new Set([rootStepId]);
    let added = true;
    while (added) {
      added = false;
      actionSteps.forEach((step) => {
        const ownerStepId =
          step.parentId || pathOwners.get(step.actionStepPathId) || null;
        if (ownerStepId && stepIds.has(ownerStepId) && !stepIds.has(step.id)) {
          stepIds.add(step.id);
          added = true;
        }
      });
    }
    const snapshots = [];
    const rootSnapshot = createNextgenActionStepSnapshot(
      rootSource,
      rootStepId,
    );
    if (rootSnapshot) snapshots.push(rootSnapshot);
    for (const stepId of stepIds) {
      if (stepId === rootStepId) continue;
      const snapshot = await captureNextgenActionStepSnapshot(actionId, stepId);
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }

  async function captureNextgenActionGraphSnapshot(actionId) {
    const data = await requestNextgenActionStepGraphql(
      "Action",
      NEXTGEN_ACTION_CANVAS_QUERY,
      { input: { id: actionId } },
    );
    const action = data.action;
    if (!action) throw new Error("The action was not returned.");
    const snapshots = [];
    for (const position of action.actionSteps || []) {
      const snapshot = await captureNextgenActionStepSnapshot(
        actionId,
        position.id,
      );
      if (snapshot) snapshots.push(snapshot);
    }
    return {
      action: {
        id: action.id,
        name: action.name,
      },
      snapshots,
    };
  }

  function getNextgenActionVersionScopeKey(actionId) {
    return getNextgenActionStorageScopeKey(actionId);
  }

  function getStoredNextgenActionVersions(actionId) {
    const stored = GM_getValue(NEXTGEN_ACTION_VERSIONS_KEY, {});
    const scopeKey = getNextgenActionVersionScopeKey(actionId);
    let versions = stored?.[scopeKey];
    if (!Array.isArray(versions)) {
      const legacyKeys = new Set([
        ...getNextgenLegacyActionStorageScopeKeys(actionId),
        ...Object.keys(stored || {}).filter(
          (key) => key !== scopeKey && key.endsWith(`:${actionId}`),
        ),
      ]);
      const migrated = [...legacyKeys]
        .flatMap((legacyKey) =>
          Array.isArray(stored?.[legacyKey]) ? stored[legacyKey] : [],
        )
        .filter(
          (version, index, all) =>
            version?.id &&
            all.findIndex((candidate) => candidate?.id === version.id) === index,
        );
      if (migrated.length) {
        versions = migrated;
        GM_setValue(NEXTGEN_ACTION_VERSIONS_KEY, {
          ...(stored && typeof stored === "object" ? stored : {}),
          [scopeKey]: versions,
        });
        console.info("[Power Browser] Migrated saved action versions.", {
          actionId,
          legacyKeys: [...legacyKeys],
          to: scopeKey,
          versionCount: versions.length,
        });
      }
    }
    return Array.isArray(versions)
      ? versions.filter(
          (version) =>
            version?.schemaVersion === 1 &&
            version.id &&
            Array.isArray(version.snapshots),
        )
      : [];
  }

  function setStoredNextgenActionVersions(actionId, versions) {
    const stored = GM_getValue(NEXTGEN_ACTION_VERSIONS_KEY, {});
    GM_setValue(NEXTGEN_ACTION_VERSIONS_KEY, {
      ...(stored && typeof stored === "object" ? stored : {}),
      [getNextgenActionVersionScopeKey(actionId)]: versions,
    });
  }

  async function captureNextgenActionHistoryBeforeMutation(details) {
    if (!getSettingValue("nextgenActionStepHistory")) return null;
    const input = getNextgenActionMutationInput(details);
    const stepId = input?.id;
    if (!stepId) return null;
    const actionId = resolveNextgenActionHistoryActionId(
      stepId,
      input.actionId,
    );
    if (!actionId || getNextgenActionHistoryState(actionId).busy) return null;
    const before =
      details.mutationType === "create"
        ? []
        : details.mutationType === "delete"
          ? await captureNextgenActionStepTree(actionId, stepId)
          : [await captureNextgenActionStepSnapshot(actionId, stepId)].filter(
              Boolean,
            );
    return {
      actionId,
      stepId,
      mutationType: details.mutationType,
      operationName: details.operationName,
      before,
    };
  }

  async function captureNextgenActionHistoryAfterMutation(details, capture) {
    if (!capture || !getSettingValue("nextgenActionStepHistory")) return;
    const after =
      details.mutationType === "delete"
        ? []
        : [
            await captureNextgenActionStepSnapshot(
              capture.actionId,
              capture.stepId,
            ),
          ].filter(Boolean);
    if (JSON.stringify(capture.before) === JSON.stringify(after)) return;
    const state = getNextgenActionHistoryState(capture.actionId);
    state.undo.push({
      ...capture,
      after,
      recordedAt: Date.now(),
    });
    state.undo.splice(0, Math.max(0, state.undo.length - getNextgenActionHistoryLimit()));
    state.redo.length = 0;
    persistNextgenActionHistoryState(capture.actionId, state);
    console.info("[Power Browser] Action-step history entry recorded.", {
      actionId: capture.actionId,
      stepId: capture.stepId,
      mutationType: capture.mutationType,
      operationName: capture.operationName,
      undoDepth: state.undo.length,
    });
    updateNextgenActionHistoryControls();
    renderNextgenActionHistoryDialog();
  }

  function getNextgenHistorySnapshotParentId(snapshot, snapshotsById) {
    if (snapshot.position.parentId) return snapshot.position.parentId;
    const pathId = snapshot.position.actionStepPathId;
    if (!pathId) return null;
    for (const candidate of snapshotsById.values()) {
      if (
        candidate.actionStep.actionStepPaths?.some((path) => path.id === pathId)
      ) {
        return candidate.actionStep.id;
      }
    }
    return null;
  }

  function getNextgenHistorySnapshotDepth(snapshot, snapshotsById) {
    let depth = 0;
    let parentId = getNextgenHistorySnapshotParentId(snapshot, snapshotsById);
    const seen = new Set();
    while (parentId && snapshotsById.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      depth += 1;
      parentId = getNextgenHistorySnapshotParentId(
        snapshotsById.get(parentId),
        snapshotsById,
      );
    }
    return depth;
  }

  function getNextgenHistoryRestorePlacement(actionSteps, position) {
    const siblings = actionSteps
      .filter(
        (step) =>
          step.id !== position.id &&
          (step.parentId || null) === (position.parentId || null) &&
          (step.actionStepPathId || null) ===
            (position.actionStepPathId || null),
      )
      .sort((left, right) => Number(left.index) - Number(right.index));
    const insertionIndex = Math.min(
      siblings.length,
      Math.max(0, Number(position.index || 1) - 1),
    );
    siblings.splice(insertionIndex, 0, {
      id: position.id,
      parentId: position.parentId || null,
      actionStepPathId: position.actionStepPathId || null,
    });
    return siblings.map((step, index) => ({
      id: step.id,
      index: index + 1,
      parentId: step.parentId || null,
      actionStepPathId: step.actionStepPathId || null,
    }));
  }

  function replaceNextgenHistorySerializedValue(value, replacements) {
    if (typeof value !== "string")
      return JSON.stringify(
        replaceNextgenActionStepValueIds(value || {}, replacements),
      );
    try {
      return JSON.stringify(
        replaceNextgenActionStepValueIds(JSON.parse(value), replacements),
      );
    } catch {
      return replacements.get(value) || value;
    }
  }

  async function ensureNextgenHistoryLocalVariables(
    actionId,
    stepId,
    desiredVariables,
    currentVariables,
    replacements,
  ) {
    const currentIds = new Set(
      currentVariables
        .filter((variable) => variable.scope === "LOCAL")
        .map((variable) => variable.id),
    );
    for (const variable of desiredVariables.filter(
      (item) => item.scope === "LOCAL",
    )) {
      if (currentIds.has(variable.id)) continue;
      const data = await requestNextgenActionStepGraphql(
        "PowerBrowserRestoreActionHistoryLocalVariable",
        `mutation PowerBrowserRestoreActionHistoryLocalVariable($input: CreateActionVariableInput) {
          createActionVariable(input: $input) { id }
        }`,
        {
          input: {
            name: variable.name,
            kind: variable.kind,
            scope: "LOCAL",
            actionId,
            hideFromLogs: Boolean(variable.hideFromLogs),
            actionStepId: stepId,
            options: replaceNextgenHistorySerializedValue(
              variable.options || "{}",
              replacements,
            ),
          },
        },
      );
      const newId = data.createActionVariable?.id;
      if (!newId) throw new Error(`Local variable ${variable.name} was not restored.`);
      replacements.set(variable.id, newId);
    }
  }

  function getNextgenHistoryUpdateVariables(
    actionId,
    stepId,
    desiredVariables,
    currentVariables,
    replacements,
  ) {
    const desired = desiredVariables.filter(
      (variable) => variable.scope !== "LOCAL",
    );
    const desiredIds = new Set(desired.map((variable) => variable.id));
    const variables = desired.map((variable) => ({
      actionId,
      actionStepId: stepId,
      name: variable.name,
      delete: false,
      id: variable.id,
      kind: variable.kind,
      scope: variable.scope,
      options: replaceNextgenHistorySerializedValue(
        variable.options || "{}",
        replacements,
      ),
    }));
    currentVariables
      .filter(
        (variable) =>
          variable.scope !== "LOCAL" && !desiredIds.has(variable.id),
      )
      .forEach((variable) => {
        variables.push({
          actionId,
          actionStepId: stepId,
          name: variable.name,
          delete: true,
          id: variable.id,
          kind: variable.kind,
          scope: variable.scope,
          options:
            typeof variable.options === "string"
              ? variable.options
              : JSON.stringify(variable.options || {}),
        });
      });
    return variables;
  }

  async function configureNextgenActionStepFromHistory(
    actionId,
    snapshot,
    replacements = new Map(),
  ) {
    const stepId = snapshot.actionStep.id;
    const current = await fetchNextgenActionStepForDuplication(actionId, stepId);
    const currentVariables = await getNextgenSourceActionStepVariables(current);
    const desiredVariables = snapshot.actionStepVariables?.results || [];
    await ensureNextgenHistoryLocalVariables(
      actionId,
      stepId,
      desiredVariables,
      currentVariables,
      replacements,
    );
    const functionOptions = replaceNextgenActionStepValueIds(
      snapshot.actionStep.functionOptions,
      replacements,
    );
    const paths = (snapshot.actionStep.actionStepPaths || []).map((path) => ({
      id: path.id,
      index: path.index,
      isElse: Boolean(path.isElse),
      label: path.label,
      options: replaceNextgenHistorySerializedValue(
        path.options || {},
        replacements,
      ),
    }));
    await requestNextgenActionStepGraphql(
      "PowerBrowserRestoreActionHistoryStep",
      `mutation PowerBrowserRestoreActionHistoryStep($updateInput: UpdateActionStepInput!, $toggleSyncInput: ToggleSyncActionStepWithPageComponentInput) {
        updateActionStep(input: $updateInput) { id }
        toggleSyncActionStepWithPageComponent(input: $toggleSyncInput)
      }`,
      {
        updateInput: {
          id: stepId,
          label: snapshot.actionStep.label,
          variables: getNextgenHistoryUpdateVariables(
            actionId,
            stepId,
            desiredVariables,
            currentVariables,
            replacements,
          ),
          functionOptions: JSON.stringify(functionOptions || {}),
          actionStepPaths: paths,
        },
        toggleSyncInput: null,
      },
    );
  }

  async function createNextgenActionStepFromHistory(
    actionId,
    snapshot,
    actionSteps,
    replacements,
  ) {
    const step = snapshot.actionStep;
    const descriptor = getNextgenActionStepFunctionDescriptor(step);
    if (!descriptor?.value?.id) {
      throw new Error("The historical action function is unavailable.");
    }
    const desiredVariables = snapshot.actionStepVariables?.results || [];
    const localIds = new Set(
      desiredVariables
        .filter((variable) => variable.scope === "LOCAL")
        .map((variable) => variable.id),
    );
    const createFunctionOptions = replaceNextgenActionStepValueIds(
      structuredClone(step.functionOptions || {}),
      replacements,
    );
    (descriptor.value.options || [])
      .filter(
        (option) =>
          option?.meta?.output ||
          hasNextgenActionStepValueId(
            createFunctionOptions[option.name],
            localIds,
          ),
      )
      .forEach((option) => {
        createFunctionOptions[option.name] = null;
      });
    const moveInput = getNextgenHistoryRestorePlacement(
      actionSteps,
      snapshot.position,
    );
    const functionIdKey =
      descriptor.type === "NATIVE"
        ? "nativeFunctionId"
        : descriptor.type === "APPLICATION"
          ? "applicationFunctionId"
          : "blockStoreFunctionId";
    await requestNextgenActionStepGraphql(
      "PowerBrowserRecreateActionHistoryStep",
      `mutation PowerBrowserRecreateActionHistoryStep($createInput: CreateActionStepInput, $moveInput: [MoveActionStepsInput]) {
        createActionStep(input: $createInput) { id }
        moveActionSteps(input: $moveInput)
      }`,
      {
        createInput: {
          actionStepPaths: (step.actionStepPaths || []).map((path) => ({
            id: path.id,
            index: path.index,
            isElse: Boolean(path.isElse),
            label: path.label,
            options: replaceNextgenHistorySerializedValue(
              path.options || {},
              replacements,
            ),
          })),
          parentId: snapshot.position.parentId || null,
          actionStepPathId: snapshot.position.actionStepPathId || null,
          actionId,
          index:
            moveInput.find((item) => item.id === step.id)?.index ||
            snapshot.position.index,
          id: step.id,
          functionOptions: JSON.stringify(createFunctionOptions),
          [functionIdKey]: descriptor.value.id,
        },
        moveInput,
      },
    );
    moveInput.forEach((moved) => {
      const current = actionSteps.find((item) => item.id === moved.id);
      if (current) Object.assign(current, moved);
    });
    actionSteps.push({
      id: step.id,
      index: moveInput.find((item) => item.id === step.id)?.index || 1,
      parentId: snapshot.position.parentId || null,
      actionStepPathId: snapshot.position.actionStepPathId || null,
    });
    await configureNextgenActionStepFromHistory(
      actionId,
      snapshot,
      replacements,
    );
  }

  async function deleteNextgenActionHistorySteps(actionId, snapshots) {
    const snapshotsById = new Map(
      snapshots.map((snapshot) => [snapshot.actionStep.id, snapshot]),
    );
    const roots = snapshots.filter(
      (snapshot) =>
        !snapshotsById.has(
          getNextgenHistorySnapshotParentId(snapshot, snapshotsById),
        ),
    );
    for (const snapshot of roots) {
      await requestNextgenActionStepGraphql(
        "DeleteActionStep",
        `mutation DeleteActionStep($deleteActionStepInput: DeleteActionStepInput, $moveActionStepsInput: [MoveActionStepsInput]) {
          deleteActionStep(input: $deleteActionStepInput)
          moveActionSteps(input: $moveActionStepsInput)
        }`,
        {
          deleteActionStepInput: { id: snapshot.actionStep.id },
          moveActionStepsInput: [],
        },
      );
    }
  }

  async function replaceNextgenActionGraphFromHistory(
    actionId,
    targetSnapshots,
    currentSnapshots = null,
  ) {
    const current =
      currentSnapshots ||
      (await captureNextgenActionGraphSnapshot(actionId)).snapshots;
    if (current.length) {
      await deleteNextgenActionHistorySteps(actionId, current);
    }
    const snapshotsById = new Map(
      targetSnapshots.map((snapshot) => [snapshot.actionStep.id, snapshot]),
    );
    const ordered = [...targetSnapshots].sort(
      (left, right) =>
        getNextgenHistorySnapshotDepth(left, snapshotsById) -
          getNextgenHistorySnapshotDepth(right, snapshotsById) ||
        Number(left.position.index) - Number(right.position.index),
    );
    const actionSteps = [];
    const replacements = new Map();
    for (const snapshot of ordered) {
      await createNextgenActionStepFromHistory(
        actionId,
        snapshot,
        actionSteps,
        replacements,
      );
    }
    const verificationStepId =
      ordered[0]?.actionStep.id ||
      current[0]?.actionStep.id ||
      "__power_browser_empty_action__";
    await refreshNextgenActionCanvas(
      actionId,
      verificationStepId,
      ordered.length ? "added" : "removed",
      false,
    );
  }

  async function applyNextgenActionHistoryEntry(entry, direction) {
    const source = direction === "undo" ? entry.after : entry.before;
    const target = direction === "undo" ? entry.before : entry.after;
    if (entry.mutationType === "snapshot") {
      await replaceNextgenActionGraphFromHistory(
        entry.actionId,
        target,
        source,
      );
      return;
    }
    const sourceIds = new Set(source.map((snapshot) => snapshot.actionStep.id));
    const targetIds = new Set(target.map((snapshot) => snapshot.actionStep.id));
    const removed = source.filter(
      (snapshot) => !targetIds.has(snapshot.actionStep.id),
    );
    if (removed.length) {
      await deleteNextgenActionHistorySteps(entry.actionId, removed);
    }
    if (target.length) {
      const data = await requestNextgenActionStepGraphql(
        "Action",
        NEXTGEN_ACTION_CANVAS_QUERY,
        { input: { id: entry.actionId } },
      );
      const actionSteps = structuredClone(data.action?.actionSteps || []);
      const snapshotsById = new Map(
        target.map((snapshot) => [snapshot.actionStep.id, snapshot]),
      );
      const ordered = [...target].sort(
        (left, right) =>
          getNextgenHistorySnapshotDepth(left, snapshotsById) -
            getNextgenHistorySnapshotDepth(right, snapshotsById) ||
          Number(left.position.index) - Number(right.position.index),
      );
      const replacements = new Map();
      for (const snapshot of ordered) {
        if (sourceIds.has(snapshot.actionStep.id)) {
          await configureNextgenActionStepFromHistory(
            entry.actionId,
            snapshot,
            replacements,
          );
        } else {
          await createNextgenActionStepFromHistory(
            entry.actionId,
            snapshot,
            actionSteps,
            replacements,
          );
        }
      }
    }
    await refreshNextgenActionCanvas(
      entry.actionId,
      entry.stepId,
      targetIds.has(entry.stepId) ? "added" : "removed",
      false,
    );
  }

  async function replayNextgenActionHistory(direction) {
    const actionId = getNextgenActionHistoryRoute()?.actionId;
    if (!actionId || !getSettingValue("nextgenActionStepHistory")) return;
    const state = getNextgenActionHistoryState(actionId);
    const sourceStack = direction === "undo" ? state.undo : state.redo;
    const targetStack = direction === "undo" ? state.redo : state.undo;
    const entry = sourceStack.at(-1);
    if (!entry || state.busy) return;
    state.busy = true;
    updateNextgenActionHistoryControls();
    const bridge = getNextgenActionRuntimeBridge();
    bridge.suppressActionHistory = (bridge.suppressActionHistory || 0) + 1;
    try {
      await applyNextgenActionHistoryEntry(entry, direction);
      sourceStack.pop();
      targetStack.push(entry);
      targetStack.splice(
        0,
        Math.max(0, targetStack.length - getNextgenActionHistoryLimit()),
      );
      persistNextgenActionHistoryState(actionId, state);
      console.info(`[Power Browser] Action-step ${direction} completed.`, {
        actionId,
        stepId: entry.stepId,
        mutationType: entry.mutationType,
        undoDepth: state.undo.length,
        redoDepth: state.redo.length,
      });
    } catch (error) {
      console.error(`[Power Browser] Unable to ${direction} action-step change.`, {
        actionId,
        entry,
        error,
      });
      window.alert(
        `Unable to ${direction} this action-step change: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      bridge.suppressActionHistory = Math.max(
        0,
        (bridge.suppressActionHistory || 1) - 1,
      );
      state.busy = false;
      updateNextgenActionHistoryControls();
      renderNextgenActionHistoryDialog();
    }
  }

  function ensureNextgenActionHistoryStyles() {
    if (document.getElementById(NEXTGEN_ACTION_HISTORY_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = NEXTGEN_ACTION_HISTORY_STYLE_ID;
    style.textContent = `
      .${NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS}{position:absolute;top:12px;right:12px;z-index:25;display:flex;gap:2px;padding:3px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,.14)}
      .${NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS} button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;cursor:pointer;opacity:.8}
      .${NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS} button:hover:not(:disabled),.${NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS} button:focus-visible:not(:disabled){background:#f3f4f6;opacity:1;outline:none}
      .${NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS} button:disabled{cursor:not-allowed;opacity:.3}
      .${NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS} svg{width:14px;height:14px;fill:#374151}
      .power-browser-action-history-overlay{position:fixed;inset:0;z-index:2147483004;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.4)}
      .power-browser-action-history-overlay[aria-hidden="true"]{display:none}
      .power-browser-action-history-dialog{display:flex;flex-direction:column;width:min(620px,calc(100vw - 48px));max-height:min(720px,calc(100vh - 48px));padding:20px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;box-shadow:0 20px 50px rgba(15,23,42,.24);color:#111827}
      .power-browser-action-history-dialog>header{display:flex;align-items:center;justify-content:space-between;gap:16px}
      .power-browser-action-history-dialog h2{margin:0;font-size:18px;font-weight:600}
      .power-browser-action-history-dialog>header button{display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:5px;background:transparent;color:#4b5563;font-size:24px;line-height:1;cursor:pointer}
      .power-browser-action-history-dialog>header button:hover{background:#f3f4f6;color:#111827}
      .power-browser-action-history-dialog>p{margin:8px 0 16px;color:#6b7280;font-size:13px}
      .power-browser-action-history-list{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto}
      .power-browser-action-history-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 12px;border:1px solid #e5e7eb;border-radius:7px;background:#fff}
      .power-browser-action-history-copy{display:flex;flex-direction:column;min-width:0;gap:3px}
      .power-browser-action-history-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
      .power-browser-action-history-copy span{color:#6b7280;font-size:12px}
      .power-browser-action-history-row>button{flex:0 0 auto;padding:6px 10px;border:1px solid #d1d5db;border-radius:5px;background:#fff;color:#374151;font-size:12px;font-weight:600;cursor:pointer}
      .power-browser-action-history-row>button:hover:not(:disabled){border-color:#9ca3af;background:#f9fafb}
      .power-browser-action-history-row>button:disabled{cursor:not-allowed;opacity:.4}
      .power-browser-action-history-empty{padding:28px 12px;text-align:center!important;color:#6b7280!important}
      .power-browser-action-version-save{display:flex;gap:8px;margin:0 0 16px}
      .power-browser-action-version-save input{min-width:0;flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;color:#111827;font-size:13px;outline:none}
      .power-browser-action-version-save input:focus{border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,.15)}
      .power-browser-action-version-save button,.power-browser-action-version-actions button{padding:7px 11px;border:1px solid #d1d5db;border-radius:5px;background:#fff;color:#374151;font-size:12px;font-weight:600;cursor:pointer}
      .power-browser-action-version-save button{border-color:#4f46e5;background:#4f46e5;color:#fff}
      .power-browser-action-version-save button:hover:not(:disabled){background:#4338ca}
      .power-browser-action-version-actions{display:flex;flex:0 0 auto;gap:6px}
      .power-browser-action-version-actions button:hover:not(:disabled){border-color:#9ca3af;background:#f9fafb}
      .power-browser-action-version-actions button:last-child{color:#dc2626}
      .power-browser-action-version-save button:disabled,.power-browser-action-version-actions button:disabled{cursor:not-allowed;opacity:.45}
    `;
    document.head.appendChild(style);
  }

  function updateNextgenActionHistoryControls() {
    const actionId = getNextgenActionHistoryRoute()?.actionId;
    const state = actionId ? getNextgenActionHistoryState(actionId) : null;
    document
      .querySelectorAll(`.${NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS}`)
      .forEach((controls) => {
        const undo = controls.querySelector('[data-test="power-browser-undo-step"]');
        const redo = controls.querySelector('[data-test="power-browser-redo-step"]');
        const history = controls.querySelector(
          '[data-test="power-browser-selective-history"]',
        );
        const versions = controls.querySelector(
          '[data-test="power-browser-action-versions"]',
        );
        undo.disabled = !state?.undo.length || state.busy;
        redo.disabled = !state?.redo.length || state.busy;
        history.disabled = !state?.undo.length || state.busy;
        versions.disabled = Boolean(state?.busy);
        undo.title = state?.undo.length
          ? `Undo action-step change (${state.undo.length})`
          : "Nothing to undo";
        redo.title = state?.redo.length
          ? `Redo action-step change (${state.redo.length})`
          : "Nothing to redo";
        history.title = state?.undo.length
          ? `Choose a change to revert (${state.undo.length})`
          : "No action-step history";
        versions.title = "Save or load an action version";
        undo.setAttribute("aria-label", undo.title);
        redo.setAttribute("aria-label", redo.title);
        history.setAttribute("aria-label", history.title);
        versions.setAttribute("aria-label", versions.title);
      });
  }

  function getNextgenActionHistoryEntryStepIds(entry) {
    return new Set(
      [...entry.before, ...entry.after].map(
        (snapshot) => snapshot.actionStep.id,
      ),
    );
  }

  function hasNextgenActionHistoryConflict(entries, index) {
    const selected = entries[index];
    const newer = entries.slice(index + 1);
    if (
      selected.mutationType === "snapshot" ||
      newer.some((entry) => entry.mutationType === "snapshot")
    ) {
      return newer.length > 0;
    }
    const selectedIds = getNextgenActionHistoryEntryStepIds(selected);
    return newer.some((entry) =>
      [...getNextgenActionHistoryEntryStepIds(entry)].some((stepId) =>
        selectedIds.has(stepId),
      ),
    );
  }

  function getNextgenActionHistoryEntryLabel(entry) {
    if (entry.mutationType === "snapshot") {
      return entry.snapshotName || "Action version";
    }
    const snapshot = entry.after[0] || entry.before[0];
    const step = snapshot?.actionStep;
    const actionFunction = getNextgenActionStepFunctionDescriptor(step)?.value;
    return step?.label || actionFunction?.label || actionFunction?.name || "Action step";
  }

  function closeNextgenActionHistoryDialog() {
    if (!nextgenActionHistoryDialogState) return;
    const { overlay, dialog } = nextgenActionHistoryDialogState;
    overlay.setAttribute("aria-hidden", "true");
    dialog.setAttribute("aria-hidden", "true");
    closePowerBrowserModal(dialog);
  }

  async function revertSelectedNextgenActionHistoryEntry(index) {
    const actionId = getNextgenActionHistoryRoute()?.actionId;
    if (!actionId) return;
    const state = getNextgenActionHistoryState(actionId);
    const entry = state.undo[index];
    if (!entry || state.busy || hasNextgenActionHistoryConflict(state.undo, index)) {
      return;
    }
    state.busy = true;
    updateNextgenActionHistoryControls();
    renderNextgenActionHistoryDialog();
    const bridge = getNextgenActionRuntimeBridge();
    bridge.suppressActionHistory = (bridge.suppressActionHistory || 0) + 1;
    try {
      await applyNextgenActionHistoryEntry(entry, "undo");
      state.undo.splice(index, 1);
      state.redo.push(entry);
      state.redo.splice(
        0,
        Math.max(0, state.redo.length - getNextgenActionHistoryLimit()),
      );
      persistNextgenActionHistoryState(actionId, state);
      console.info("[Power Browser] Selected action-step history entry reverted.", {
        actionId,
        stepId: entry.stepId,
        mutationType: entry.mutationType,
        remainingUndoDepth: state.undo.length,
      });
    } catch (error) {
      console.error("[Power Browser] Unable to revert selected history entry.", {
        actionId,
        entry,
        error,
      });
      window.alert(
        `Unable to revert this action-step change: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      bridge.suppressActionHistory = Math.max(
        0,
        (bridge.suppressActionHistory || 1) - 1,
      );
      state.busy = false;
      updateNextgenActionHistoryControls();
      renderNextgenActionHistoryDialog();
    }
  }

  function renderNextgenActionHistoryDialog() {
    if (!nextgenActionHistoryDialogState) return;
    const { list } = nextgenActionHistoryDialogState;
    const actionId = getNextgenActionHistoryRoute()?.actionId;
    const state = actionId ? getNextgenActionHistoryState(actionId) : null;
    list.replaceChildren();
    if (!state?.undo.length) {
      const empty = document.createElement("p");
      empty.className = "power-browser-action-history-empty";
      empty.textContent = "No recorded action-step changes.";
      list.appendChild(empty);
      return;
    }
    [...state.undo]
      .map((entry, index) => ({ entry, index }))
      .reverse()
      .forEach(({ entry, index }) => {
        const row = document.createElement("div");
        row.className = "power-browser-action-history-row";
        const copy = document.createElement("div");
        copy.className = "power-browser-action-history-copy";
        const title = document.createElement("strong");
        const verb = {
          create: "Created",
          "scope-create": "Created scope",
          update: "Updated",
          delete: "Deleted",
          snapshot: "Loaded version",
        }[entry.mutationType];
        title.textContent = `${verb || "Changed"} ${getNextgenActionHistoryEntryLabel(entry)}`;
        const meta = document.createElement("span");
        const changesAgo = state.undo.length - index;
        meta.textContent = `${changesAgo} change${changesAgo === 1 ? "" : "s"} ago · ${new Date(entry.recordedAt).toLocaleTimeString()}`;
        copy.append(title, meta);
        const revert = document.createElement("button");
        revert.type = "button";
        revert.textContent = "Revert";
        const conflict = hasNextgenActionHistoryConflict(state.undo, index);
        revert.disabled = state.busy || conflict;
        revert.title = conflict
          ? "A newer history entry changes the same step. Revert that newer change first."
          : `Revert only: ${title.textContent}`;
        revert.addEventListener("click", () =>
          void revertSelectedNextgenActionHistoryEntry(index),
        );
        row.append(copy, revert);
        list.appendChild(row);
      });
  }

  function ensureNextgenActionHistoryDialog() {
    if (nextgenActionHistoryDialogState?.dialog.isConnected) {
      return nextgenActionHistoryDialogState;
    }
    const overlay = document.createElement("div");
    overlay.className = "power-browser-action-history-overlay";
    overlay.setAttribute("aria-hidden", "true");
    const dialog = document.createElement("section");
    dialog.className = "power-browser-action-history-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Action-step history");
    dialog.setAttribute("aria-hidden", "true");
    const header = document.createElement("header");
    const heading = document.createElement("h2");
    heading.textContent = "Action-step history";
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close action-step history");
    close.textContent = "×";
    close.addEventListener("click", closeNextgenActionHistoryDialog);
    header.append(heading, close);
    const description = document.createElement("p");
    description.textContent =
      "Revert one independent change without undoing the newer entries above it.";
    const list = document.createElement("div");
    list.className = "power-browser-action-history-list";
    dialog.append(header, description, list);
    overlay.appendChild(dialog);
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) closeNextgenActionHistoryDialog();
    });
    document.body.appendChild(overlay);
    nextgenActionHistoryDialogState = { overlay, dialog, list, close };
    return nextgenActionHistoryDialogState;
  }

  function openNextgenActionHistoryDialog() {
    const state = ensureNextgenActionHistoryDialog();
    renderNextgenActionHistoryDialog();
    state.overlay.setAttribute("aria-hidden", "false");
    state.dialog.setAttribute("aria-hidden", "false");
    openPowerBrowserModal({
      dialog: state.dialog,
      overlay: state.overlay,
      close: closeNextgenActionHistoryDialog,
      initialFocus: () => state.close,
      announcement: "Action-step history opened.",
    });
  }

  function closeNextgenActionVersionDialog() {
    if (!nextgenActionVersionDialogState) return;
    const { overlay, dialog } = nextgenActionVersionDialogState;
    overlay.setAttribute("aria-hidden", "true");
    dialog.setAttribute("aria-hidden", "true");
    closePowerBrowserModal(dialog);
  }

  async function saveNextgenActionVersion() {
    const actionId = getNextgenActionHistoryRoute()?.actionId;
    const state = nextgenActionVersionDialogState;
    if (!actionId || !state) return;
    const name = state.nameInput.value.trim();
    if (!name) {
      state.nameInput.setCustomValidity("Enter a version name.");
      state.nameInput.reportValidity();
      return;
    }
    state.nameInput.setCustomValidity("");
    state.saveButton.disabled = true;
    state.saveButton.textContent = "Saving…";
    try {
      const captured = await captureNextgenActionGraphSnapshot(actionId);
      const versions = getStoredNextgenActionVersions(actionId);
      versions.unshift({
        schemaVersion: 1,
        id: createPowerBrowserUuid(),
        name: name.slice(0, 100),
        createdAt: new Date().toISOString(),
        actionId,
        actionName: captured.action.name,
        snapshots: captured.snapshots,
      });
      setStoredNextgenActionVersions(actionId, versions);
      state.nameInput.value = "";
      console.info("[Power Browser] Action version saved.", {
        actionId,
        name,
        stepCount: captured.snapshots.length,
      });
      renderNextgenActionVersionDialog();
      announcePowerBrowser(`Action version ${name} saved.`);
    } catch (error) {
      console.error("[Power Browser] Unable to save action version.", {
        actionId,
        error,
      });
      window.alert(
        `Unable to save this action version: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      state.saveButton.disabled = false;
      state.saveButton.textContent = "Save version";
    }
  }

  async function loadNextgenActionVersion(version) {
    const actionId = getNextgenActionHistoryRoute()?.actionId;
    if (
      !actionId ||
      !window.confirm(
        `Load “${version.name}”? The current action canvas will be replaced with this saved version.`,
      )
    ) {
      return;
    }
    const state = getNextgenActionHistoryState(actionId);
    if (state.busy) return;
    state.busy = true;
    updateNextgenActionHistoryControls();
    renderNextgenActionVersionDialog();
    const bridge = getNextgenActionRuntimeBridge();
    bridge.suppressActionHistory = (bridge.suppressActionHistory || 0) + 1;
    let currentSnapshots = null;
    let replacementStarted = false;
    try {
      const current = await captureNextgenActionGraphSnapshot(actionId);
      currentSnapshots = current.snapshots;
      const targetSnapshots = structuredClone(version.snapshots);
      if (JSON.stringify(current.snapshots) === JSON.stringify(targetSnapshots)) {
        announcePowerBrowser(`The action already matches ${version.name}.`);
        return;
      }
      replacementStarted = true;
      await replaceNextgenActionGraphFromHistory(
        actionId,
        targetSnapshots,
        currentSnapshots,
      );
      const entry = {
        actionId,
        stepId:
          targetSnapshots[0]?.actionStep.id ||
          currentSnapshots[0]?.actionStep.id ||
          "__power_browser_empty_action__",
        mutationType: "snapshot",
        operationName: "PowerBrowserLoadActionVersion",
        snapshotName: version.name,
        before: currentSnapshots,
        after: targetSnapshots,
        recordedAt: Date.now(),
      };
      state.undo.push(entry);
      state.undo.splice(
        0,
        Math.max(0, state.undo.length - getNextgenActionHistoryLimit()),
      );
      state.redo.length = 0;
      persistNextgenActionHistoryState(actionId, state);
      console.info("[Power Browser] Action version loaded.", {
        actionId,
        versionId: version.id,
        name: version.name,
        stepCount: targetSnapshots.length,
      });
      announcePowerBrowser(`Action version ${version.name} loaded.`);
    } catch (error) {
      console.error("[Power Browser] Unable to load action version.", {
        actionId,
        version,
        error,
      });
      if (replacementStarted && currentSnapshots) {
        try {
          await replaceNextgenActionGraphFromHistory(
            actionId,
            currentSnapshots,
          );
          console.info(
            "[Power Browser] Restored the action state from before the failed version load.",
            { actionId },
          );
        } catch (rollbackError) {
          console.error(
            "[Power Browser] Unable to roll back the failed action-version load.",
            { actionId, rollbackError },
          );
        }
      }
      window.alert(
        `Unable to load this action version: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      bridge.suppressActionHistory = Math.max(
        0,
        (bridge.suppressActionHistory || 1) - 1,
      );
      state.busy = false;
      updateNextgenActionHistoryControls();
      renderNextgenActionHistoryDialog();
      renderNextgenActionVersionDialog();
    }
  }

  function deleteNextgenActionVersion(version) {
    const actionId = getNextgenActionHistoryRoute()?.actionId;
    if (
      !actionId ||
      !window.confirm(`Delete saved action version “${version.name}”?`)
    ) {
      return;
    }
    setStoredNextgenActionVersions(
      actionId,
      getStoredNextgenActionVersions(actionId).filter(
        (candidate) => candidate.id !== version.id,
      ),
    );
    renderNextgenActionVersionDialog();
    announcePowerBrowser(`Action version ${version.name} deleted.`);
  }

  function renderNextgenActionVersionDialog() {
    if (!nextgenActionVersionDialogState) return;
    const { list } = nextgenActionVersionDialogState;
    const actionId = getNextgenActionHistoryRoute()?.actionId;
    const historyState = actionId
      ? getNextgenActionHistoryState(actionId)
      : null;
    const versions = actionId ? getStoredNextgenActionVersions(actionId) : [];
    nextgenActionVersionDialogState.nameInput.disabled = Boolean(
      historyState?.busy,
    );
    nextgenActionVersionDialogState.saveButton.disabled = Boolean(
      historyState?.busy,
    );
    list.replaceChildren();
    if (!versions.length) {
      const empty = document.createElement("p");
      empty.className = "power-browser-action-history-empty";
      empty.textContent = "No saved action versions.";
      list.appendChild(empty);
      return;
    }
    versions.forEach((version) => {
      const row = document.createElement("div");
      row.className = "power-browser-action-history-row";
      const copy = document.createElement("div");
      copy.className = "power-browser-action-history-copy";
      const title = document.createElement("strong");
      title.textContent = version.name;
      const meta = document.createElement("span");
      const stepCount = version.snapshots.length;
      meta.textContent = `${stepCount} step${stepCount === 1 ? "" : "s"} · ${new Date(version.createdAt).toLocaleString()}`;
      copy.append(title, meta);
      const actions = document.createElement("div");
      actions.className = "power-browser-action-version-actions";
      const load = document.createElement("button");
      load.type = "button";
      load.textContent = "Load";
      load.disabled = Boolean(historyState?.busy);
      load.addEventListener("click", () =>
        void loadNextgenActionVersion(version),
      );
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.disabled = Boolean(historyState?.busy);
      remove.addEventListener("click", () =>
        deleteNextgenActionVersion(version),
      );
      actions.append(load, remove);
      row.append(copy, actions);
      list.appendChild(row);
    });
  }

  function ensureNextgenActionVersionDialog() {
    if (nextgenActionVersionDialogState?.dialog.isConnected) {
      return nextgenActionVersionDialogState;
    }
    const overlay = document.createElement("div");
    overlay.className =
      "power-browser-action-history-overlay power-browser-action-version-overlay";
    overlay.setAttribute("aria-hidden", "true");
    const dialog = document.createElement("section");
    dialog.className =
      "power-browser-action-history-dialog power-browser-action-version-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Saved action versions");
    dialog.setAttribute("aria-hidden", "true");
    const header = document.createElement("header");
    const heading = document.createElement("h2");
    heading.textContent = "Saved action versions";
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close saved action versions");
    close.textContent = "×";
    close.addEventListener("click", closeNextgenActionVersionDialog);
    header.append(heading, close);
    const description = document.createElement("p");
    description.textContent =
      "Save the complete action canvas, then load it again later.";
    const saveRow = document.createElement("form");
    saveRow.className = "power-browser-action-version-save";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 100;
    nameInput.placeholder = "Version name";
    nameInput.setAttribute("aria-label", "Action version name");
    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.textContent = "Save version";
    saveRow.addEventListener("submit", (event) => {
      event.preventDefault();
      void saveNextgenActionVersion();
    });
    saveRow.append(nameInput, saveButton);
    const list = document.createElement("div");
    list.className = "power-browser-action-history-list";
    dialog.append(header, description, saveRow, list);
    overlay.appendChild(dialog);
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) closeNextgenActionVersionDialog();
    });
    document.body.appendChild(overlay);
    nextgenActionVersionDialogState = {
      overlay,
      dialog,
      list,
      close,
      nameInput,
      saveButton,
    };
    return nextgenActionVersionDialogState;
  }

  function openNextgenActionVersionDialog() {
    const state = ensureNextgenActionVersionDialog();
    renderNextgenActionVersionDialog();
    state.overlay.setAttribute("aria-hidden", "false");
    state.dialog.setAttribute("aria-hidden", "false");
    openPowerBrowserModal({
      dialog: state.dialog,
      overlay: state.overlay,
      close: closeNextgenActionVersionDialog,
      initialFocus: () => state.nameInput,
      announcement: "Saved action versions opened.",
    });
  }

  function installNextgenActionHistoryControls() {
    if (!getSettingValue("nextgenActionStepHistory")) return;
    const actionId = getNextgenActionHistoryRoute()?.actionId;
    const canvas = document.querySelector(".react-flow");
    if (!actionId || !canvas) return;
    ensureNextgenActionHistoryStyles();
    if (
      canvas.querySelector(
        `:scope > .${NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS}`,
      )
    ) {
      updateNextgenActionHistoryControls();
      return;
    }
    const controls = document.createElement("div");
    controls.className = NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS;
    const createButton = (title, testId, path) => {
      const button = document.createElement("button");
      button.type = "button";
      button.title = title;
      button.dataset.test = testId;
      button.setAttribute("aria-label", title);
      button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 14 14"><path d="${path}"></path></svg>`;
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      return button;
    };
    const undo = createButton(
      "Nothing to undo",
      "power-browser-undo-step",
      "M5.25 2.1 0 6.3l5.25 4.2V7.35h2.1c2.32 0 4.2 1.88 4.2 4.2V14H14v-2.45A6.65 6.65 0 0 0 7.35 4.9h-2.1V2.1Z",
    );
    const redo = createButton(
      "Nothing to redo",
      "power-browser-redo-step",
      "M8.75 2.1 14 6.3l-5.25 4.2V7.35h-2.1a4.2 4.2 0 0 0-4.2 4.2V14H0v-2.45A6.65 6.65 0 0 1 6.65 4.9h2.1V2.1Z",
    );
    const history = createButton(
      "No action-step history",
      "power-browser-selective-history",
      "M1.75 0h10.5C13.22 0 14 .78 14 1.75v10.5c0 .97-.78 1.75-1.75 1.75H1.75C.78 14 0 13.22 0 12.25V1.75C0 .78.78 0 1.75 0Zm1.4 3.15V4.9h7.7V3.15h-7.7Zm0 3.5V8.4h7.7V6.65h-7.7Zm0 3.5v1.75h4.9v-1.75h-4.9Z",
    );
    const versions = createButton(
      "Save or load an action version",
      "power-browser-action-versions",
      "M1.75 0h9.63L14 2.63v9.62c0 .97-.78 1.75-1.75 1.75H1.75C.78 14 0 13.22 0 12.25V1.75C0 .78.78 0 1.75 0Zm1.4 1.75v3.5h7.7v-3.5h-1.4V4.2H4.55V1.75h-1.4Zm1.4 6.3v4.2h4.9v-4.2h-4.9Z",
    );
    undo.addEventListener("click", () => void replayNextgenActionHistory("undo"));
    redo.addEventListener("click", () => void replayNextgenActionHistory("redo"));
    history.addEventListener("click", openNextgenActionHistoryDialog);
    versions.addEventListener("click", openNextgenActionVersionDialog);
    controls.append(undo, redo, history, versions);
    canvas.appendChild(controls);
    updateNextgenActionHistoryControls();
  }

  function handleNextgenActionHistoryShortcut(event) {
    if (!getSettingValue("nextgenActionStepHistory")) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }
    const undoShortcut = String(
      getSettingValue("nextgenActionStepUndoShortcut") || "",
    );
    const redoShortcut = String(
      getSettingValue("nextgenActionStepRedoShortcut") || "",
    );
    const direction = shortcutMatchesEvent(undoShortcut, event)
      ? "undo"
      : shortcutMatchesEvent(redoShortcut, event)
        ? "redo"
        : null;
    if (!direction) return;
    event.preventDefault();
    void replayNextgenActionHistory(direction);
  }

  function trimNextgenActionHistory() {
    const limit = getNextgenActionHistoryLimit();
    nextgenActionHistoryByAction.forEach((state) => {
      state.undo.splice(0, Math.max(0, state.undo.length - limit));
      state.redo.splice(0, Math.max(0, state.redo.length - limit));
      persistNextgenActionHistoryState(state.actionId, state);
    });
    updateNextgenActionHistoryControls();
    renderNextgenActionHistoryDialog();
  }

  function cleanupNextgenActionStepHistory() {
    nextgenActionHistoryObserver?.disconnect();
    nextgenActionHistoryObserver = null;
    document.removeEventListener("keydown", handleNextgenActionHistoryShortcut, true);
    document
      .querySelectorAll(`.${NEXTGEN_ACTION_HISTORY_CONTROLS_CLASS}`)
      .forEach((controls) => controls.remove());
    document.getElementById(NEXTGEN_ACTION_HISTORY_STYLE_ID)?.remove();
    if (nextgenActionHistoryDialogState) {
      closeNextgenActionHistoryDialog();
      nextgenActionHistoryDialogState.overlay.remove();
      nextgenActionHistoryDialogState = null;
    }
    if (nextgenActionVersionDialogState) {
      closeNextgenActionVersionDialog();
      nextgenActionVersionDialogState.overlay.remove();
      nextgenActionVersionDialogState = null;
    }
  }

  function applyNextgenActionStepHistorySetting() {
    const bridge = getNextgenActionRuntimeBridge();
    if (
      bridge &&
      !nextgenActionHistoryHookInstalled &&
      !bridge.actionMutationHooks.includes(nextgenActionHistoryHook)
    ) {
      bridge.actionMutationHooks.push(nextgenActionHistoryHook);
      nextgenActionHistoryHookInstalled = true;
    }
    trimNextgenActionHistory();
    if (!getSettingValue("nextgenActionStepHistory")) {
      nextgenActionHistoryByAction.clear();
      cleanupNextgenActionStepHistory();
      return;
    }
    installNextgenActionHistoryControls();
    document.removeEventListener("keydown", handleNextgenActionHistoryShortcut, true);
    document.addEventListener("keydown", handleNextgenActionHistoryShortcut, true);
    if (!nextgenActionHistoryObserver) {
      nextgenActionHistoryObserver = new MutationObserver(
        installNextgenActionHistoryControls,
      );
      nextgenActionHistoryObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }
