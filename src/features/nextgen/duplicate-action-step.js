  const NEXTGEN_DUPLICATE_STEP_BUTTON_TEST_ID =
    "power-browser-duplicate-step";
  const NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS =
    "power-browser-action-step-quick-actions";
  const NEXTGEN_ACTION_STEP_QUICK_ACTIONS_STYLE_ID =
    "power-browser-action-step-quick-actions-style";
  const NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS =
    "power-browser-action-step-edge-paste";
  const NEXTGEN_ACTION_STEP_EDGE_PASTE_STYLE_ID =
    "power-browser-action-step-edge-paste-style";
  const NEXTGEN_ACTION_STEP_EDGE_PASTE_ACTIVE_CLASS =
    "power-browser-action-step-edge-paste-shortcut-active";
  const NEXTGEN_ACTION_STEP_CLIPBOARD_KEY =
    "powerBrowserNextgenActionStepClipboardV1";
  const NEXTGEN_RESERVED_ACTION_STEP_IDS = new Set(["start", "finish"]);
  let nextgenActionStepClipboard = GM_getValue(
    NEXTGEN_ACTION_STEP_CLIPBOARD_KEY,
    null,
  );
  const nextgenPasteFunctionMatchCache = new Map();
  const nextgenAnimatedEdgePasteKeys = new Set();
  let nextgenEdgePasteClipboardKey = "";
  let nextgenActionStepPasteShortcutInstalled = false;
  let nextgenActionStepPasteShortcutActive = false;
  let nextgenScopeMenuDocumentListenerInstalled = false;
  let nextgenActionScopeHooksInstalled = false;
  let nextgenScopeMenuCheckSequence = 0;
  let nextgenActionScopeRevision = 0;
  const nextgenScopeActionCache = new Map();
  const nextgenScopeActionFetches = new Map();
  const nextgenPendingActionStepNodes = new Set();
  let nextgenActionStepEnhancementFrame = 0;
  let nextgenActionStepDrawerRefreshPending = false;
  let nextgenActionStepEdgeRefreshPending = false;
  let nextgenActionStepMenuCleanupPending = false;
  let nextgenActionStepDeleteDialogState = null;
  const nextgenActionScopeMutationHook = {
    after: invalidateNextgenActionScopeData,
  };
  const nextgenActionScopeGraphqlResponseHook = ({ payload }) => {
    const query = String(payload?.query || "");
    if (
      /\b(?:createActionStep|updateActionStep|deleteActionStep|moveActionSteps)\s*\(/.test(
        query,
      )
    ) {
      invalidateNextgenActionScopeData();
    }
  };
  GM_addValueChangeListener(
    NEXTGEN_ACTION_STEP_CLIPBOARD_KEY,
    (_key, _oldValue, newValue) => {
      nextgenActionStepClipboard = newValue || null;
      nextgenPasteFunctionMatchCache.clear();
      refreshNextgenPasteButtons();
    },
  );
  const NEXTGEN_ACTION_CANVAS_QUERY = `query Action($input: ActionInput!) {
    action(input: $input) {
      id name description runtime hasInheritedAuthProfile folderId
      folder { id name type authenticationProfileId }
      options { authenticationProfile isBackground isScheduled scheduleCron debugLogging switchedToWasm }
      canSwitchToJavascript public draft
      actionStepPaths { __typename id label index actionStepId isElse }
      actionSteps {
        __typename id parentId index isSyncedWithPagesComponent label actionStepPathId functionOptions draft
        nativeFunction { __typename id label description icon { name color } category yields name options paths version runtime }
        applicationFunction { __typename id label description icon { name color } category yields name options paths version runtime }
        blockStoreFunction { __typename id label description icon { name color } category yields name options paths version releasedBlockContentId runtime }
      }
      actionReferences { referenceId referenceType }
      permissions { id permissionType roleId value }
    }
  }`;

  function getNextgenEditedActionStepContext() {
    const match = location.pathname.match(
      /\/app\/actions\/([^/?#]+)\/steps\/([^/?#]+)/i,
    );
    return match && !NEXTGEN_RESERVED_ACTION_STEP_IDS.has(match[2].toLowerCase())
      ? { actionId: match[1], stepId: match[2] }
      : null;
  }

  function createPowerBrowserUuid() {
    return crypto.randomUUID().replaceAll("-", "");
  }

  async function requestNextgenActionStepGraphql(
    operationName,
    query,
    variables,
  ) {
    const identifier = currentPowerBrowserContext?.identifier;
    const csrfToken = getCsrfToken() || getNextgenLogCsrfToken();
    if (!identifier || !csrfToken) {
      throw new Error("The application identifier or CSRF token is unavailable.");
    }
    const response = await pageWindow.fetch(`${location.origin}/api/meta/graphql`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        "application-identifier": identifier,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ operationName, query, variables }),
    });
    if (!response.ok) {
      throw new Error(`Betty Blocks returned status ${response.status}.`);
    }
    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }
    return payload.data;
  }

  function getNextgenActionRuntimeBridge() {
    return pageWindow[NEXTGEN_RUNTIME_BRIDGE_KEY] || null;
  }

  function getNextgenActionReduxStore(bridge, actionId) {
    return (bridge?.reduxStores || []).find((store) => {
      try {
        return store.getState()?.action?.action?.id === actionId;
      } catch {
        return false;
      }
    });
  }

  function waitForNextgenActionCanvasStep(
    stepId,
    shouldExist = true,
    timeout = 5000,
  ) {
    const matchesExpectedState = () =>
      Boolean(document.querySelector(`.react-flow__node[data-id="${stepId}"]`)) ===
      shouldExist;
    if (matchesExpectedState()) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (matchesExpectedState()) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(true);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeout);
    });
  }

  function getNextgenGraphqlSelectionFieldNames(
    document,
    selectionSet,
    visitedFragments = new Set(),
  ) {
    const fieldNames = new Set();
    for (const selection of selectionSet?.selections || []) {
      if (selection.kind === "Field") {
        fieldNames.add(selection.name?.value);
        for (const nestedName of getNextgenGraphqlSelectionFieldNames(
          document,
          selection.selectionSet,
          visitedFragments,
        )) {
          fieldNames.add(nestedName);
        }
        continue;
      }
      if (selection.kind === "InlineFragment") {
        for (const nestedName of getNextgenGraphqlSelectionFieldNames(
          document,
          selection.selectionSet,
          visitedFragments,
        )) {
          fieldNames.add(nestedName);
        }
        continue;
      }
      if (selection.kind !== "FragmentSpread") continue;
      const fragmentName = selection.name?.value;
      if (!fragmentName || visitedFragments.has(fragmentName)) continue;
      visitedFragments.add(fragmentName);
      const fragment = document?.definitions?.find(
        (definition) =>
          definition.kind === "FragmentDefinition" &&
          definition.name?.value === fragmentName,
      );
      for (const nestedName of getNextgenGraphqlSelectionFieldNames(
        document,
        fragment?.selectionSet,
        visitedFragments,
      )) {
        fieldNames.add(nestedName);
      }
    }
    return fieldNames;
  }

  function isNextgenActionCanvasObservableQuery(observableQuery, actionId) {
    const document = observableQuery?.options?.query;
    const operation = document?.definitions?.find(
      (definition) =>
        definition.kind === "OperationDefinition" &&
        definition.operation === "query" &&
        definition.name?.value === "Action",
    );
    const actionSelection = operation?.selectionSet?.selections?.find(
      (selection) =>
        selection.kind === "Field" && selection.name?.value === "action",
    );
    if (!actionSelection) return false;
    const fieldNames = getNextgenGraphqlSelectionFieldNames(
      document,
      actionSelection.selectionSet,
    );
    if (!fieldNames.has("actionSteps") || !fieldNames.has("actionStepPaths")) {
      return false;
    }
    const currentActionId = observableQuery.getCurrentResult?.()?.data?.action?.id;
    const inputActionId = observableQuery.options?.variables?.input?.id;
    return !currentActionId && !inputActionId
      ? true
      : currentActionId === actionId || inputActionId === actionId;
  }

  async function refetchNextgenActionCanvasApolloQueries(clients, actionId) {
    let refetchedCount = 0;
    for (const client of clients) {
      if (typeof client?.getObservableQueries !== "function") continue;
      let observableQueries = [];
      try {
        observableQueries = Array.from(
          client.getObservableQueries("active")?.values?.() || [],
        );
      } catch (error) {
        console.debug(
          "[Power Browser] Unable to inspect active Apollo queries for the action canvas.",
          error,
        );
        continue;
      }
      for (const observableQuery of observableQueries) {
        if (!isNextgenActionCanvasObservableQuery(observableQuery, actionId)) {
          continue;
        }
        try {
          await observableQuery.refetch();
          refetchedCount += 1;
        } catch (error) {
          console.debug(
            "[Power Browser] Action canvas Apollo query refetch skipped.",
            error,
          );
        }
      }
    }
    return refetchedCount;
  }

  async function refreshNextgenActionCanvas(
    actionId,
    stepId,
    mode = "added",
    closeDrawer = true,
  ) {
    const bridge = getNextgenActionRuntimeBridge();
    const clients = bridge?.apolloClients || [];
    const store = getNextgenActionReduxStore(bridge, actionId);
    if (!store) {
      throw new Error("The action-canvas Redux store was not found.");
    }
    const previousAction = store.getState()?.action?.action;
    const previousActionStepIds = new Set(
      (previousAction?.actionSteps || []).map((step) => step.id),
    );
    console.info("[Power Browser] Apollo client found.", {
      found: clients.length > 0,
      clientCount: clients.length,
    });

    const refetchedCount = await refetchNextgenActionCanvasApolloQueries(
      clients,
      actionId,
    );
    const data = await requestNextgenActionStepGraphql(
      "Action",
      NEXTGEN_ACTION_CANVAS_QUERY,
      { input: { id: actionId } },
    );
    const action = data.action || null;
    if (action?.id !== actionId || !Array.isArray(action.actionSteps)) {
      throw new Error("The full Action query returned an invalid canvas payload.");
    }
    const containsStep = action?.actionSteps?.some((step) => step.id === stepId);
    if (mode === "added" ? !containsStep : containsStep) {
      throw new Error(
        mode === "added"
          ? "The refreshed Action query did not return the duplicated step."
          : "The refreshed Action query still returned the deleted step.",
      );
    }
    if (mode === "added") {
      const refreshedActionStepIds = new Set(
        action.actionSteps.map((step) => step.id),
      );
      const missingExistingStepIds = Array.from(previousActionStepIds).filter(
        (existingStepId) => !refreshedActionStepIds.has(existingStepId),
      );
      if (missingExistingStepIds.length) {
        throw new Error(
          `The full Action query omitted ${missingExistingStepIds.length} existing canvas step${missingExistingStepIds.length === 1 ? "" : "s"}; the canvas state was not replaced.`,
        );
      }
    }
    store.dispatch({ type: "action/setAction", payload: action });
    console.info("[Power Browser] Action canvas query refreshed and state updated.", {
      operationName: "Action",
      apolloRefetched: refetchedCount > 0,
      apolloRefetchedQueryCount: refetchedCount,
      previousActionStepCount: previousAction?.actionSteps?.length ?? null,
      refreshedActionStepCount: action?.actionSteps?.length ?? null,
      actionStepsField: "action.actionSteps",
      actionStepPathsField: "action.actionStepPaths",
    });

    if (closeDrawer) {
      const cancel = document.querySelector(
        '[role="dialog"] button[data-test="cancel-step"]',
      );
      if (cancel) {
        cancel.click();
      } else {
        throw new Error("The native Cancel action for the step drawer was not found.");
      }
    }
    const rendered = await waitForNextgenActionCanvasStep(
      stepId,
      mode === "added",
    );
    console.info("[Power Browser] Action canvas node state verified.", {
      stepId,
      mode,
      rendered,
    });
    if (!rendered) {
      throw new Error(
        mode === "added"
          ? "The duplicated step was updated in state but did not render in time."
          : "The deleted step was updated in state but remained rendered.",
      );
    }
  }

  async function fetchNextgenActionStepForDuplication(actionId, stepId) {
    if (!stepId) {
      return requestNextgenActionStepGraphql(
        "PowerBrowserEmptyActionStepPlacement",
        `query PowerBrowserEmptyActionStepPlacement($actionInput: ActionInput!) {
          action(input: $actionInput) {
            actionSteps { id index parentId actionStepPathId }
            actionStepPaths { id actionStepId }
          }
        }`,
        { actionInput: { id: actionId } },
      );
    }
    return requestNextgenActionStepGraphql(
      "PowerBrowserDuplicateActionStepSource",
      `query PowerBrowserDuplicateActionStepSource($actionInput: ActionInput!, $stepInput: ActionStepInput, $variablesInput: ActionStepVariablesInput) {
        action(input: $actionInput) {
          actionSteps { id index parentId actionStepPathId }
          actionStepPaths { id actionStepId }
        }
        actionStep(input: $stepInput) {
          id label functionOptions draft isSyncedWithPagesComponent
          actionStepPaths { id index isElse label options actionStepId }
          nativeFunction { id name version options }
          applicationFunction { id name version options }
          blockStoreFunction { id name version options }
        }
        actionStepVariables(input: $variablesInput) {
          results { id actionId actionStepId name scope kind options hideFromLogs }
        }
      }`,
      {
        actionInput: { id: actionId },
        stepInput: { id: stepId },
        variablesInput: { id: stepId },
      },
    );
  }

  function replaceNextgenActionStepValueIds(value, replacements) {
    if (typeof value === "string") return replacements.get(value) || value;
    if (Array.isArray(value)) {
      return value.map((item) =>
        replaceNextgenActionStepValueIds(item, replacements),
      );
    }
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceNextgenActionStepValueIds(item, replacements),
      ]),
    );
  }

  function hasNextgenActionStepValueId(value, ids) {
    if (typeof value === "string") return ids.has(value);
    if (Array.isArray(value)) {
      return value.some((item) => hasNextgenActionStepValueId(item, ids));
    }
    return Boolean(
      value &&
        typeof value === "object" &&
        Object.values(value).some((item) =>
          hasNextgenActionStepValueId(item, ids),
        ),
    );
  }

  function getNextgenActionStepFunctionDescriptor(step) {
    if (step?.nativeFunction) {
      return { type: "NATIVE", value: step.nativeFunction };
    }
    if (step?.applicationFunction) {
      return { type: "APPLICATION", value: step.applicationFunction };
    }
    if (step?.blockStoreFunction) {
      return { type: "BLOCKSTORE", value: step.blockStoreFunction };
    }
    return null;
  }

  async function getNextgenSourceActionStepVariables(source) {
    const savedVariables = (source.actionStepVariables?.results || []).filter(
      (variable) => variable.actionStepId === source.actionStep.id,
    );
    const actionFunction = getNextgenActionStepFunctionDescriptor(
      source.actionStep,
    )?.value;
    const outputOptions = (actionFunction?.options || []).filter(
      (option) => option?.meta?.output,
    );
    for (const option of outputOptions) {
      const outputVariableId =
        source.actionStep.functionOptions?.[option.name]?.value;
      if (
        !outputVariableId ||
        savedVariables.some((variable) => variable.id === outputVariableId)
      ) {
        continue;
      }
      const data = await requestNextgenActionStepGraphql(
        "PowerBrowserDuplicateActionVariable",
        `query PowerBrowserDuplicateActionVariable($input: ActionVariableInput) {
          actionVariable(input: $input) {
            id actionId actionStepId name scope kind options hideFromLogs
          }
        }`,
        { input: { id: outputVariableId } },
      );
      const outputVariable = data.actionVariable;
      if (
        outputVariable?.id &&
        outputVariable.actionStepId === source.actionStep.id
      ) {
        savedVariables.push(outputVariable);
      }
    }
    return savedVariables;
  }

  async function getNextgenDuplicateVariables(
    source,
    actionId,
    newStepId,
    replacements,
  ) {
    const savedVariables = await getNextgenSourceActionStepVariables(source);
    const step = source.actionStep;
    const actionFunction = getNextgenActionStepFunctionDescriptor(step)?.value;
    const outputOptions = (actionFunction?.options || []).filter(
      (option) => option?.meta?.output,
    );
    const localVariables = savedVariables.filter(
      (variable) => variable.scope === "LOCAL",
    );
    const variables = savedVariables
      .filter((variable) => variable.scope !== "LOCAL")
      .map((variable) => {
      const id = createPowerBrowserUuid();
      replacements.set(variable.id, id);
      return {
        actionId,
        actionStepId: newStepId,
        name:
          variable.scope === "OUTPUT" || variable.scope === "YIELDED"
            ? `${variable.name}_duplicate`
            : variable.name,
        delete: false,
        id,
        kind: variable.kind,
        scope: variable.scope,
        options:
          typeof variable.options === "string"
            ? variable.options
            : JSON.stringify(variable.options || {}),
        };
      });

    const outputInputs = Array.from(
      document.querySelectorAll(
        '[role="dialog"] input[data-testid="step-output"]',
      ),
    );
    const savedOutputVariables = savedVariables.filter(
      (variable) => variable.scope === "OUTPUT",
    );
    outputOptions.forEach((option, index) => {
      const oldId = step.functionOptions?.[option.name]?.value;
      if (!oldId || replacements.has(oldId)) return;
      const savedOutputId = savedOutputVariables[index]?.id;
      if (savedOutputId && replacements.has(savedOutputId)) {
        replacements.set(oldId, replacements.get(savedOutputId));
        return;
      }
      const id = createPowerBrowserUuid();
      replacements.set(oldId, id);
      const output = option.meta.output;
      const modelOption = output.model
        ? step.functionOptions?.[output.model]
        : null;
      const sourceOption = output.source
        ? step.functionOptions?.[output.source]
        : null;
      const sourceVariableId = sourceOption?.value?.find?.(
        (item) => item?.type === "Variable",
      )?.value;
      const sourceVariable = savedVariables.find(
        (variable) => variable.id === sourceVariableId,
      );
      const inheritedKind = sourceVariable?.kind === "COLLECTION"
        ? output.toSingleItem
          ? "RECORD"
          : "COLLECTION"
        : sourceVariable?.kind;
      const kindByOutputType = {
        BOOLEAN: "BOOLEAN",
        NUMBER: "INTEGER",
        TEXT: "STRING",
      };
      const outputType = String(output.type || "OBJECT").toUpperCase();
      const sourceOptions =
        typeof sourceVariable?.options === "string"
          ? JSON.parse(sourceVariable.options || "{}")
          : sourceVariable?.options || {};
      const outputVariableOptions = modelOption?.value
        ? { model: modelOption.value }
        : sourceOptions.model
          ? { model: sourceOptions.model }
          : {};
      variables.push({
        actionId,
        actionStepId: newStepId,
        name: `${outputInputs[index]?.value || option.name}_duplicate`,
        delete: false,
        id,
        kind:
          outputType === "INHERIT"
            ? inheritedKind || "OBJECT"
            : kindByOutputType[outputType] || outputType,
        scope: output.scoped ? "YIELDED" : "OUTPUT",
        options: JSON.stringify(outputVariableOptions),
      });
    });
    return { localVariables, variables };
  }

  function getNextgenDuplicatePlacement(
    actionSteps,
    sourceStepId,
    newStepId,
    placementPosition = "after",
    actionStepPaths = [],
  ) {
    const placement =
      placementPosition && typeof placementPosition === "object"
        ? placementPosition
        : { position: placementPosition };
    if (placement.position === "empty") {
      if (actionSteps.length) {
        throw new Error("The destination action is no longer empty.");
      }
      const duplicate = {
        id: newStepId,
        index: 1,
        parentId: null,
        actionStepPathId: null,
      };
      return { duplicate, moveActionStepInput: [duplicate] };
    }
    if (placement.position === "path-empty") {
      const pathOwnerId = placement.pathOwnerId || null;
      const actionStepPathId = placement.actionStepPathId || null;
      const ownsPath = actionStepPaths.some(
        (path) =>
          path.id === actionStepPathId && path.actionStepId === pathOwnerId,
      );
      if (!pathOwnerId || !actionStepPathId || !ownsPath) {
        throw new Error("The destination action path could not be resolved.");
      }
      if (
        actionSteps.some(
          (step) =>
            (step.parentId || null) === null &&
            (step.actionStepPathId || null) === actionStepPathId,
        )
      ) {
        throw new Error("The destination action path is no longer empty.");
      }
      const duplicate = {
        id: newStepId,
        index: 1,
        parentId: null,
        actionStepPathId,
      };
      return { duplicate, moveActionStepInput: [duplicate] };
    }
    if (placement.position === "scope-empty") {
      const parentId = placement.parentId || null;
      if (!parentId || !actionSteps.some((step) => step.id === parentId)) {
        throw new Error("The destination action scope could not be resolved.");
      }
      if (
        actionSteps.some(
          (step) =>
            (step.parentId || null) === parentId &&
            (step.actionStepPathId || null) === null,
        )
      ) {
        throw new Error("The destination action scope is no longer empty.");
      }
      const duplicate = {
        id: newStepId,
        index: 1,
        parentId,
        actionStepPathId: null,
      };
      return { duplicate, moveActionStepInput: [duplicate] };
    }
    const source = actionSteps.find((step) => step.id === sourceStepId);
    if (!source) throw new Error("The source step position could not be found.");
    const duplicateTemplate = {
      id: newStepId,
      parentId: source.parentId || null,
      actionStepPathId: source.actionStepPathId || null,
    };
    const orderedSiblings = actionSteps
      .filter(
        (step) =>
          (step.parentId || null) === duplicateTemplate.parentId &&
          (step.actionStepPathId || null) === duplicateTemplate.actionStepPathId,
      )
      .sort((left, right) => Number(left.index) - Number(right.index));
    const sourcePosition = orderedSiblings.findIndex(
      (step) => step.id === sourceStepId,
    );
    if (sourcePosition < 0) {
      throw new Error("The source step was not found among its siblings.");
    }
    orderedSiblings.splice(
      sourcePosition + (placement.position === "before" ? 0 : 1),
      0,
      duplicateTemplate,
    );
    const moveActionStepInput = orderedSiblings.map((step, index) => ({
      id: step.id,
      index: index + 1,
      parentId: step.parentId || null,
      actionStepPathId: step.actionStepPathId || null,
    }));
    const duplicate = moveActionStepInput.find((step) => step.id === newStepId);
    return { duplicate, moveActionStepInput };
  }

  function isValidNextgenActionStepClipboard(clipboard) {
    if (!clipboard?.sourceStepId) return false;
    if (clipboard.schemaVersion === 1) {
      return Boolean(
        clipboard.actionStep?.id &&
          clipboard.actionFunction?.type &&
          clipboard.actionFunction?.name &&
          clipboard.actionFunction?.version,
      );
    }
    return Boolean(
      clipboard.schemaVersion === 2 &&
        clipboard.kind === "scope" &&
        Array.isArray(clipboard.snapshots) &&
        clipboard.snapshots.length > 1 &&
        clipboard.snapshots.some(
          (snapshot) => snapshot?.actionStep?.id === clipboard.sourceStepId,
        ) &&
        Array.isArray(clipboard.actionFunctions) &&
        clipboard.actionFunctions.length,
    );
  }

  function getNextgenActionFunctionSignature(actionFunction) {
    return [
      actionFunction?.type,
      actionFunction?.name,
      actionFunction?.version,
    ].join(":");
  }

  function getNextgenClipboardActionFunctions(clipboard) {
    if (!isValidNextgenActionStepClipboard(clipboard)) return [];
    return clipboard.schemaVersion === 2
      ? clipboard.actionFunctions
      : [clipboard.actionFunction];
  }

  function getNextgenActionStepClipboardSignature(clipboard) {
    return isValidNextgenActionStepClipboard(clipboard)
      ? getNextgenClipboardActionFunctions(clipboard)
          .map(getNextgenActionFunctionSignature)
          .sort()
          .join("|")
      : "empty";
  }

  async function resolveNextgenPasteActionFunctions(clipboard) {
    if (!isValidNextgenActionStepClipboard(clipboard)) return null;
    const applicationIdentifier = currentPowerBrowserContext?.identifier;
    if (!applicationIdentifier) return null;
    const cacheKey = `${applicationIdentifier}:${getNextgenActionStepClipboardSignature(clipboard)}`;
    if (!nextgenPasteFunctionMatchCache.has(cacheKey)) {
      const lookup = requestNextgenActionStepGraphql(
        "ListActionFunctions",
        `query ListActionFunctions($filter: ListActionFunctionFilter) {
          listActionFunctions(filter: $filter) {
            results { id name type version }
          }
        }`,
        {},
      )
        .then((data) => {
          const available = data.listActionFunctions?.results || [];
          const matches = new Map();
          for (const requested of getNextgenClipboardActionFunctions(clipboard)) {
            const match = available.find(
              (actionFunction) =>
                actionFunction.type === requested.type &&
                actionFunction.name === requested.name &&
                String(actionFunction.version) === String(requested.version),
            );
            if (!match) return null;
            matches.set(getNextgenActionFunctionSignature(requested), match);
          }
          return matches;
        })
        .catch((error) => {
          nextgenPasteFunctionMatchCache.delete(cacheKey);
          throw error;
        });
      nextgenPasteFunctionMatchCache.set(cacheKey, lookup);
    }
    return nextgenPasteFunctionMatchCache.get(cacheKey);
  }

  async function resolveNextgenPasteActionFunction(clipboard) {
    const matches = await resolveNextgenPasteActionFunctions(clipboard);
    return matches?.get(
      getNextgenActionFunctionSignature(clipboard?.actionFunction),
    );
  }

  async function updateNextgenPasteButtonAvailability(button) {
    if (!button?.isConnected) return;
    const clipboard = nextgenActionStepClipboard;
    const signature = getNextgenActionStepClipboardSignature(clipboard);
    button.dataset.clipboardSignature = signature;
    button.disabled = true;
    button.classList.add("is-unavailable");
    if (!isValidNextgenActionStepClipboard(clipboard)) {
      button.title = "Paste unavailable: copy an action step first";
      button.setAttribute("aria-label", button.title);
      return;
    }
    button.title = "Checking copied action function…";
    button.setAttribute("aria-label", button.title);
    try {
      const matches = await resolveNextgenPasteActionFunctions(clipboard);
      if (
        !button.isConnected ||
        button.dataset.clipboardSignature !== signature
      ) {
        return;
      }
      if (!matches) {
        const names = getNextgenClipboardActionFunctions(clipboard)
          .map((actionFunction) => `${actionFunction.name} ${actionFunction.version}`)
          .join(", ");
        button.title = `Paste unavailable: one or more functions are not available (${names})`;
        button.setAttribute("aria-label", button.title);
        return;
      }
      button.disabled = false;
      button.classList.remove("is-unavailable");
      button.title =
        clipboard.schemaVersion === 2
          ? `Paste ${clipboard.rootLabel || "scope"} (${clipboard.snapshots.length} steps)`
          : `Paste ${clipboard.actionFunction.name} ${clipboard.actionFunction.version}`;
      button.setAttribute("aria-label", button.title);
    } catch (error) {
      console.error(
        "[Power Browser] Unable to check action-step paste compatibility.",
        error,
      );
      if (button.isConnected) {
        button.title = "Paste unavailable: compatibility check failed";
        button.setAttribute("aria-label", button.title);
      }
    }
  }

  function refreshNextgenPasteButtons() {
    void installNextgenActionStepEdgePasteButtons();
  }

  async function copyNextgenActionStep(button, context) {
    button.disabled = true;
    button.classList.add("is-loading");
    try {
      const source = await fetchNextgenActionStepForDuplication(
        context.actionId,
        context.stepId,
      );
      if (!source.actionStep) throw new Error("The source step was not returned.");
      const descriptor = getNextgenActionStepFunctionDescriptor(
        source.actionStep,
      );
      if (!descriptor?.value?.name || !descriptor.value.version) {
        throw new Error("The source action function and version were not returned.");
      }
      const variables = await getNextgenSourceActionStepVariables(source);
      nextgenActionStepClipboard = {
        schemaVersion: 1,
        copiedAt: Date.now(),
        sourceActionId: context.actionId,
        sourceStepId: context.stepId,
        actionFunction: {
          id: descriptor.value.id,
          type: descriptor.type,
          name: descriptor.value.name,
          version: descriptor.value.version,
        },
        actionStep: structuredClone(source.actionStep),
        actionStepVariables: { results: structuredClone(variables) },
      };
      GM_setValue(
        NEXTGEN_ACTION_STEP_CLIPBOARD_KEY,
        nextgenActionStepClipboard,
      );
      nextgenPasteFunctionMatchCache.clear();
      refreshNextgenPasteButtons();
      console.info("[Power Browser] Action step copied.", {
        actionId: context.actionId,
        stepId: context.stepId,
        functionType: descriptor.type,
        functionName: descriptor.value.name,
        functionVersion: descriptor.value.version,
      });
    } catch (error) {
      console.error("[Power Browser] Unable to copy action step.", {
        ...context,
        error,
      });
      window.alert(
        `Unable to copy this action step: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  function setNextgenPastedActionFunction(actionStep, match) {
    const descriptor = getNextgenActionStepFunctionDescriptor(actionStep);
    if (!descriptor || descriptor.type !== match.type) {
      throw new Error("The copied action function type no longer matches.");
    }
    descriptor.value.id = match.id;
    descriptor.value.name = match.name;
    descriptor.value.version = match.version;
  }

  function getNextgenActionScopeInfo(action, rootStepId) {
    if (!action?.actionSteps?.length) return null;
    const root = action.actionSteps.find((step) => step.id === rootStepId);
    if (!root) return null;
    const pathOwners = new Map(
      (action.actionStepPaths || []).map((path) => [path.id, path.actionStepId]),
    );
    const stepIds = new Set([rootStepId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const step of action.actionSteps) {
        const parentId =
          step.parentId || pathOwners.get(step.actionStepPathId) || null;
        if (parentId && stepIds.has(parentId) && !stepIds.has(step.id)) {
          stepIds.add(step.id);
          changed = true;
        }
      }
    }
    if (stepIds.size < 2) return null;
    const pathCount = (action.actionStepPaths || []).filter((path) =>
      stepIds.has(path.actionStepId),
    ).length;
    return {
      label: root.label || "Action step",
      stepIds,
      stepCount: stepIds.size,
      pathCount,
    };
  }

  async function fetchNextgenActionForScope(actionId) {
    const revision = nextgenActionScopeRevision;
    const cachedAction = nextgenScopeActionCache.get(actionId);
    if (cachedAction?.revision === revision) return cachedAction.action;
    const existingFetch = nextgenScopeActionFetches.get(actionId);
    if (existingFetch) return existingFetch;
    const actionFetch = requestNextgenActionStepGraphql(
      "Action",
      NEXTGEN_ACTION_CANVAS_QUERY,
      { input: { id: actionId } },
    ).then((data) => {
      const action = data.action || null;
      if (revision === nextgenActionScopeRevision) {
        nextgenScopeActionCache.set(actionId, { revision, action });
      }
      return action;
    });
    nextgenScopeActionFetches.set(actionId, actionFetch);
    try {
      return await actionFetch;
    } finally {
      if (nextgenScopeActionFetches.get(actionId) === actionFetch) {
        nextgenScopeActionFetches.delete(actionId);
      }
    }
  }

  function invalidateNextgenActionScopeData() {
    nextgenActionScopeRevision += 1;
    nextgenScopeActionCache.clear();
    nextgenScopeActionFetches.clear();
  }

  function getNextgenScopeActionFunctions(snapshots) {
    const actionFunctions = new Map();
    for (const snapshot of snapshots) {
      const descriptor = getNextgenActionStepFunctionDescriptor(
        snapshot.actionStep,
      );
      if (!descriptor?.value?.name || !descriptor.value.version) {
        throw new Error("A scoped action function and version were not returned.");
      }
      const actionFunction = {
        id: descriptor.value.id,
        type: descriptor.type,
        name: descriptor.value.name,
        version: descriptor.value.version,
      };
      actionFunctions.set(
        getNextgenActionFunctionSignature(actionFunction),
        actionFunction,
      );
    }
    return [...actionFunctions.values()];
  }

  function collectNextgenActionVariableReferenceIds(value, ids = new Set()) {
    if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
      try {
        return collectNextgenActionVariableReferenceIds(JSON.parse(value), ids);
      } catch {
        return ids;
      }
    }
    if (Array.isArray(value)) {
      value.forEach((item) =>
        collectNextgenActionVariableReferenceIds(item, ids),
      );
      return ids;
    }
    if (!value || typeof value !== "object") return ids;
    if (value.type === "Variable" && typeof value.value === "string") {
      ids.add(value.value);
    }
    Object.values(value).forEach((item) =>
      collectNextgenActionVariableReferenceIds(item, ids),
    );
    return ids;
  }

  function getNextgenScopeExternalVariableIds(snapshots) {
    const ownedIds = new Set();
    const referencedIds = new Set();
    for (const snapshot of snapshots) {
      for (const variable of snapshot.actionStepVariables?.results || []) {
        ownedIds.add(variable.id);
        collectNextgenActionVariableReferenceIds(variable.options, referencedIds);
      }
      collectNextgenActionVariableReferenceIds(
        snapshot.actionStep.functionOptions,
        referencedIds,
      );
      for (const path of snapshot.actionStep.actionStepPaths || []) {
        collectNextgenActionVariableReferenceIds(path.options, referencedIds);
      }
    }
    return [...referencedIds].filter((id) => !ownedIds.has(id));
  }

  async function fetchNextgenActionVariableDescriptor(variableId) {
    const data = await requestNextgenActionStepGraphql(
      "ActionVariable",
      `query ActionVariable($input: ActionVariableInput) {
        actionVariable(input: $input) {
          id actionId actionStepId name scope kind options
        }
      }`,
      { input: { id: variableId } },
    );
    return data.actionVariable || null;
  }

  async function getNextgenScopeExternalVariables(snapshots) {
    const descriptors = [];
    for (const variableId of getNextgenScopeExternalVariableIds(snapshots)) {
      try {
        const descriptor = await fetchNextgenActionVariableDescriptor(variableId);
        descriptors.push(descriptor || { id: variableId });
      } catch (error) {
        console.debug("[Power Browser] External scope variable details unavailable.", {
          variableId,
          error,
        });
        descriptors.push({ id: variableId });
      }
    }
    return descriptors;
  }

  async function fetchNextgenVisibleActionVariables(actionId, stepId) {
    const data = await requestNextgenActionStepGraphql(
      "ActionVariableBrowser",
      `query ActionVariableBrowser($browserScope: ActionVariableBrowserScope!, $filter: ActionVariableBrowserFilter) {
        actionVariableBrowser(browserScope: $browserScope, filter: $filter) {
          results {
            id name kind category
            clickThrough { type value path { kind name } }
          }
        }
      }`,
      {
        browserScope: "STEP",
        filter: {
          field: {
            actionId: { eq: actionId },
            ...(stepId ? { actionStepId: { eq: stepId } } : {}),
          },
        },
      },
    );
    return data.actionVariableBrowser?.results || [];
  }

  function matchNextgenExternalActionVariable(source, visibleVariables) {
    const exact = visibleVariables.find((variable) => variable.id === source.id);
    if (exact) return exact;
    if (!source.name || !source.kind) return null;
    const matches = visibleVariables.filter(
      (variable) =>
        variable.name === source.name && variable.kind === source.kind,
    );
    if (matches.length === 1) return matches[0];
    const scopedMatches = matches.filter(
      (variable) => variable.category === source.scope,
    );
    return scopedMatches.length === 1 ? scopedMatches[0] : null;
  }

  async function resolveNextgenScopeExternalVariableReplacements(
    clipboard,
    context,
  ) {
    const externalIds = getNextgenScopeExternalVariableIds(clipboard.snapshots);
    if (!externalIds.length) return new Map();
    const visibleVariables = await fetchNextgenVisibleActionVariables(
      context.actionId,
      context.stepId,
    );
    const storedDescriptors = new Map(
      (clipboard.externalVariables || []).map((variable) => [
        variable.id,
        variable,
      ]),
    );
    const replacements = new Map();
    const unresolved = [];
    for (const variableId of externalIds) {
      let source = storedDescriptors.get(variableId);
      if (!source?.name) {
        try {
          source = await fetchNextgenActionVariableDescriptor(variableId);
        } catch {
          source = source || { id: variableId };
        }
      }
      const match = matchNextgenExternalActionVariable(
        source || { id: variableId },
        visibleVariables,
      );
      if (!match) {
        unresolved.push(source?.name || variableId);
      } else if (match.id !== variableId) {
        replacements.set(variableId, match.id);
      }
    }
    if (unresolved.length) {
      throw new Error(
        `Paste unavailable here: ${unresolved.join(", ")} ${unresolved.length === 1 ? "is" : "are"} not available at the destination step.`,
      );
    }
    console.info("[Power Browser] External scope variables resolved.", {
      referencedCount: externalIds.length,
      remappedCount: replacements.size,
    });
    return replacements;
  }

  async function copyNextgenActionScope(button, context) {
    button.disabled = true;
    button.classList.add("is-loading");
    try {
      const snapshots = await captureNextgenActionStepTree(
        context.actionId,
        context.stepId,
      );
      if (snapshots.length < 2) {
        throw new Error("This action step no longer contains nested steps.");
      }
      const root = snapshots.find(
        (snapshot) => snapshot.actionStep.id === context.stepId,
      );
      nextgenActionStepClipboard = {
        schemaVersion: 2,
        kind: "scope",
        copiedAt: Date.now(),
        sourceActionId: context.actionId,
        sourceStepId: context.stepId,
        rootLabel: root?.actionStep?.label || "Action scope",
        snapshots: structuredClone(snapshots),
        actionFunctions: getNextgenScopeActionFunctions(snapshots),
        externalVariables: await getNextgenScopeExternalVariables(snapshots),
      };
      GM_setValue(NEXTGEN_ACTION_STEP_CLIPBOARD_KEY, nextgenActionStepClipboard);
      nextgenPasteFunctionMatchCache.clear();
      refreshNextgenPasteButtons();
      announcePowerBrowser(
        `${nextgenActionStepClipboard.rootLabel} scope copied (${snapshots.length} steps).`,
      );
      console.info("[Power Browser] Action scope copied.", {
        ...context,
        stepCount: snapshots.length,
      });
    } catch (error) {
      console.error("[Power Browser] Unable to copy action scope.", {
        ...context,
        error,
      });
      window.alert(
        `Unable to copy this action scope: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  function cloneNextgenActionScopeSnapshots(
    snapshots,
    actionId,
    insertionStepId,
    action,
    functionMatches = null,
    initialReplacements = new Map(),
    placementPosition = "after",
  ) {
    const clones = structuredClone(snapshots);
    const replacements = new Map(initialReplacements);
    for (const snapshot of clones) {
      replacements.set(snapshot.actionStep.id, createPowerBrowserUuid());
      for (const path of snapshot.actionStep.actionStepPaths || []) {
        replacements.set(path.id, createPowerBrowserUuid());
      }
      for (const variable of snapshot.actionStepVariables?.results || []) {
        if (variable.scope !== "LOCAL") {
          replacements.set(variable.id, createPowerBrowserUuid());
        }
      }
    }

    for (const snapshot of clones) {
      const sourceStepId = snapshot.actionStep.id;
      const newStepId = replacements.get(sourceStepId);
      snapshot.actionStep.id = newStepId;
      snapshot.position.id = newStepId;
      snapshot.position.parentId =
        replacements.get(snapshot.position.parentId) ||
        snapshot.position.parentId ||
        null;
      snapshot.position.actionStepPathId =
        replacements.get(snapshot.position.actionStepPathId) ||
        snapshot.position.actionStepPathId ||
        null;
      for (const path of snapshot.actionStep.actionStepPaths || []) {
        path.id = replacements.get(path.id) || path.id;
        if (path.actionStepId) path.actionStepId = newStepId;
      }
      for (const variable of snapshot.actionStepVariables?.results || []) {
        variable.actionId = actionId;
        variable.actionStepId = newStepId;
        if (variable.scope !== "LOCAL") {
          variable.id = replacements.get(variable.id) || variable.id;
          if (
            (variable.scope === "OUTPUT" || variable.scope === "YIELDED") &&
            !String(variable.name || "").endsWith("_duplicate")
          ) {
            variable.name = `${variable.name}_duplicate`;
          }
        }
      }
      if (functionMatches) {
        const descriptor = getNextgenActionStepFunctionDescriptor(
          snapshot.actionStep,
        );
        const match = functionMatches.get(
          getNextgenActionFunctionSignature({
            type: descriptor?.type,
            name: descriptor?.value?.name,
            version: descriptor?.value?.version,
          }),
        );
        if (!descriptor || !match) {
          throw new Error("A function required by the copied scope is unavailable.");
        }
        descriptor.value.id = match.id;
        descriptor.value.name = match.name;
        descriptor.value.version = match.version;
      }
    }

    const root = clones.find(
      (snapshot) => snapshot.position.id === replacements.get(snapshots[0].actionStep.id),
    );
    if (!root) throw new Error("The copied scope root could not be resolved.");
    const placement = getNextgenDuplicatePlacement(
      action.actionSteps || [],
      insertionStepId,
      root.actionStep.id,
      placementPosition,
      action.actionStepPaths || [],
    );
    root.position = {
      ...root.position,
      ...placement.duplicate,
    };
    return { clones, replacements, rootStepId: root.actionStep.id };
  }

  function recordNextgenScopeHistory(actionId, stepId, snapshots, operationName) {
    if (!getSettingValue("nextgenActionStepHistory")) return;
    const state = getNextgenActionHistoryState(actionId);
    state.undo.push({
      actionId,
      stepId,
      mutationType: "scope-create",
      operationName,
      before: [],
      after: structuredClone(snapshots),
      recordedAt: Date.now(),
    });
    state.undo.splice(
      0,
      Math.max(0, state.undo.length - getNextgenActionHistoryLimit()),
    );
    state.redo.length = 0;
    persistNextgenActionHistoryState(actionId, state);
    updateNextgenActionHistoryControls();
    renderNextgenActionHistoryDialog();
  }

  async function createNextgenActionScope(
    button,
    context,
    snapshots,
    functionMatches,
    operationName,
    initialReplacements = new Map(),
    placementPosition = "after",
  ) {
    button.disabled = true;
    button.classList.add("is-loading");
    const bridge = getNextgenActionRuntimeBridge();
    if (!bridge) {
      button.disabled = false;
      button.classList.remove("is-loading");
      throw new Error("The action-canvas runtime bridge was not found.");
    }
    const historyState = getSettingValue("nextgenActionStepHistory")
      ? getNextgenActionHistoryState(context.actionId)
      : null;
    const historyCheckpoint = historyState
      ? {
          undo: structuredClone(historyState.undo),
          redo: structuredClone(historyState.redo),
        }
      : null;
    bridge.suppressActionHistory = (bridge.suppressActionHistory || 0) + 1;
    let rollbackStepId = null;
    try {
      const action = await fetchNextgenActionForScope(context.actionId);
      if (!action) throw new Error("The destination action was not returned.");
      const { clones, replacements, rootStepId } =
        cloneNextgenActionScopeSnapshots(
          snapshots,
          context.actionId,
          context.stepId,
          action,
          functionMatches,
          initialReplacements,
          placementPosition,
        );
      const snapshotsById = new Map(
        clones.map((snapshot) => [snapshot.actionStep.id, snapshot]),
      );
      const ordered = [...clones].sort(
        (left, right) =>
          getNextgenHistorySnapshotDepth(left, snapshotsById) -
            getNextgenHistorySnapshotDepth(right, snapshotsById) ||
          Number(left.position.index) - Number(right.position.index),
      );
      const actionSteps = structuredClone(action.actionSteps || []);
      for (const snapshot of ordered) {
        if (snapshot.actionStep.id === rootStepId) rollbackStepId = rootStepId;
        await createNextgenActionStepFromHistory(
          context.actionId,
          snapshot,
          actionSteps,
          replacements,
        );
      }
      const createdSnapshots = await captureNextgenActionStepTree(
        context.actionId,
        rootStepId,
      );
      recordNextgenScopeHistory(
        context.actionId,
        rootStepId,
        createdSnapshots,
        operationName,
      );
      console.info("[Power Browser] Action scope mutation completed.", {
        actionId: context.actionId,
        returnedStepId: rootStepId,
        stepCount: createdSnapshots.length,
        operationName,
      });
      await refreshNextgenActionCanvas(
        context.actionId,
        rootStepId,
        "added",
        false,
      );
      announcePowerBrowser(
        `Action scope created (${createdSnapshots.length} steps).`,
      );
      return rootStepId;
    } catch (error) {
      if (historyState && historyCheckpoint) {
        historyState.undo = historyCheckpoint.undo;
        historyState.redo = historyCheckpoint.redo;
        persistNextgenActionHistoryState(context.actionId, historyState);
        updateNextgenActionHistoryControls();
        renderNextgenActionHistoryDialog();
      }
      if (rollbackStepId) {
        try {
          await requestNextgenActionStepGraphql(
            "DeleteActionStep",
            `mutation DeleteActionStep($deleteActionStepInput: DeleteActionStepInput, $moveActionStepsInput: [MoveActionStepsInput]) {
              deleteActionStep(input: $deleteActionStepInput)
              moveActionSteps(input: $moveActionStepsInput)
            }`,
            {
              deleteActionStepInput: { id: rollbackStepId },
              moveActionStepsInput: [],
            },
          );
          console.info("[Power Browser] Partial action scope rolled back.", {
            actionId: context.actionId,
            rootStepId: rollbackStepId,
          });
        } catch (rollbackError) {
          console.error("[Power Browser] Unable to roll back partial action scope.", {
            actionId: context.actionId,
            rootStepId: rollbackStepId,
            error: rollbackError,
          });
        }
      }
      throw error;
    } finally {
      bridge.suppressActionHistory = Math.max(
        0,
        (bridge.suppressActionHistory || 1) - 1,
      );
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  async function duplicateNextgenActionScope(button, context) {
    try {
      const snapshots = await captureNextgenActionStepTree(
        context.actionId,
        context.stepId,
      );
      if (snapshots.length < 2) {
        throw new Error("This action step no longer contains nested steps.");
      }
      await createNextgenActionScope(
        button,
        context,
        snapshots,
        null,
        "PowerBrowserDuplicateActionScope",
      );
    } catch (error) {
      console.error("[Power Browser] Unable to duplicate action scope.", {
        ...context,
        error,
      });
      window.alert(
        `Unable to duplicate this action scope: ${error instanceof Error ? error.message : String(error)}`,
      );
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  async function deleteNextgenActionScope(button, context, scopeInfo) {
    if (
      !window.confirm(
        `Delete ${scopeInfo.label} and its ${scopeInfo.stepCount - 1} nested action step${scopeInfo.stepCount === 2 ? "" : "s"}?`,
      )
    ) {
      return;
    }
    button.disabled = true;
    button.classList.add("is-loading");
    try {
      await requestNextgenActionStepGraphql(
        "DeleteActionStep",
        `mutation DeleteActionStep($deleteActionStepInput: DeleteActionStepInput, $moveActionStepsInput: [MoveActionStepsInput]) {
          deleteActionStep(input: $deleteActionStepInput)
          moveActionSteps(input: $moveActionStepsInput)
        }`,
        {
          deleteActionStepInput: { id: context.stepId },
          moveActionStepsInput: [],
        },
      );
      console.info("[Power Browser] Delete action scope mutation completed.", {
        ...context,
        stepCount: scopeInfo.stepCount,
      });
      await refreshNextgenActionCanvas(
        context.actionId,
        context.stepId,
        "removed",
        false,
      );
      announcePowerBrowser(`Action scope deleted (${scopeInfo.stepCount} steps).`);
    } catch (error) {
      console.error("[Power Browser] Unable to delete action scope.", {
        ...context,
        error,
      });
      window.alert(
        `Unable to delete this action scope: ${error instanceof Error ? error.message : String(error)}`,
      );
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  async function pasteNextgenActionStepAtPlacement(
    button,
    context,
    placement,
  ) {
    const clipboard = nextgenActionStepClipboard;
    if (!isValidNextgenActionStepClipboard(clipboard)) {
      await updateNextgenPasteButtonAvailability(button);
      return;
    }
    button.disabled = true;
    button.classList.add("is-loading");
    const placementContext = {
      ...context,
      stepId: placement.stepId,
    };
    try {
      if (clipboard.schemaVersion === 2) {
        const matches = await resolveNextgenPasteActionFunctions(clipboard);
        if (!matches) {
          await updateNextgenPasteButtonAvailability(button);
          return;
        }
        const externalVariableReplacements =
          await resolveNextgenScopeExternalVariableReplacements(
            clipboard,
            placementContext,
          );
        const pastedStepId = await createNextgenActionScope(
          button,
          placementContext,
          clipboard.snapshots,
          matches,
          "PowerBrowserPasteActionScope",
          externalVariableReplacements,
          placement,
        );
        if (pastedStepId) {
          console.info("[Power Browser] Copied action scope pasted.", {
            destinationActionId: context.actionId,
            placementStepId: placement.stepId,
            placementPosition: placement.position,
            pastedStepId,
            stepCount: clipboard.snapshots.length,
          });
        }
        return;
      }
      const match = await resolveNextgenPasteActionFunction(clipboard);
      if (!match) {
        await updateNextgenPasteButtonAvailability(button);
        return;
      }
      const destination = await fetchNextgenActionStepForDuplication(
        context.actionId,
        placement.stepId,
      );
      if (
        !destination.action ||
        (placement.position !== "empty" && !destination.actionStep)
      ) {
        throw new Error("The destination action step was not returned.");
      }
      const pastedActionStep = structuredClone(clipboard.actionStep);
      setNextgenPastedActionFunction(pastedActionStep, match);
      const source = {
        action: destination.action,
        actionStep: pastedActionStep,
        actionStepVariables: structuredClone(
          clipboard.actionStepVariables || { results: [] },
        ),
      };
      const pastedStepId = await duplicateNextgenActionStep(
        button,
        placementContext,
        source,
        placement.stepId,
        placement,
      );
      if (!pastedStepId) return;
      console.info("[Power Browser] Copied action step pasted.", {
        destinationActionId: context.actionId,
        placementStepId: placement.stepId,
        placementPosition: placement.position,
        pastedStepId,
        functionType: match.type,
        functionName: match.name,
        functionVersion: match.version,
      });
    } catch (error) {
      console.error("[Power Browser] Unable to paste action step.", {
        ...context,
        error,
      });
      window.alert(
        `Unable to paste this action step: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      button.classList.remove("is-loading");
      await updateNextgenPasteButtonAvailability(button);
    }
  }

  async function duplicateNextgenActionStep(
    button,
    requestedContext = null,
    sourceOverride = null,
    placementStepId = null,
    placementPosition = "after",
  ) {
    const context = requestedContext || getNextgenEditedActionStepContext();
    if (!context) throw new Error("No edited action step was found.");
    const isQuickAction = button.closest(
      `.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}, .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS}`,
    );
    button.disabled = true;
    if (isQuickAction) {
      button.classList.add("is-loading");
    } else {
      button.textContent = "Duplicating…";
    }

    try {
      const source =
        sourceOverride ||
        (await fetchNextgenActionStepForDuplication(
          context.actionId,
          context.stepId,
        ));
      if (!source.actionStep) throw new Error("The source step was not returned.");
      const newStepId = createPowerBrowserUuid();
      const replacements = new Map();
      const variableCopies = await getNextgenDuplicateVariables(
        source,
        context.actionId,
        newStepId,
        replacements,
      );
      const pathTemplates = (source.actionStep.actionStepPaths || []).map((path) => ({
        id: createPowerBrowserUuid(),
        index: path.index,
        isElse: Boolean(path.isElse),
        label: path.label,
        options: path.options,
      }));
      const placement = getNextgenDuplicatePlacement(
        source.action.actionSteps || [],
        placementStepId || context.stepId,
        newStepId,
        placementPosition,
        source.action.actionStepPaths || [],
      );
      const actionFunction = getNextgenActionStepFunctionDescriptor(
        source.actionStep,
      )?.value;
      if (!actionFunction) {
        throw new Error("The source action function was not returned.");
      }
      const createFunctionOptions = structuredClone(
        source.actionStep.functionOptions,
      );
      const localVariableIds = new Set(
        variableCopies.localVariables.map((variable) => variable.id),
      );
      (actionFunction?.options || [])
        .filter(
          (option) =>
            option?.meta?.output ||
            hasNextgenActionStepValueId(
              createFunctionOptions[option.name],
              localVariableIds,
            ),
        )
        .forEach((option) => {
          createFunctionOptions[option.name] = null;
        });
      const createPaths = pathTemplates.map((path) => ({
        ...path,
        options:
          typeof path.options === "string"
            ? path.options
            : JSON.stringify(path.options || {}),
      }));
      const functionIdKey = source.actionStep.nativeFunction
        ? "nativeFunctionId"
        : source.actionStep.applicationFunction
          ? "applicationFunctionId"
          : "blockStoreFunctionId";

      await requestNextgenActionStepGraphql(
        "PowerBrowserCreateDuplicateActionStep",
        `mutation PowerBrowserCreateDuplicateActionStep($createInput: CreateActionStepInput, $moveInput: [MoveActionStepsInput]) {
          createActionStep(input: $createInput) { id }
          moveActionSteps(input: $moveInput)
        }`,
        {
          createInput: {
            actionStepPaths: createPaths,
            parentId: placement.duplicate.parentId,
            actionStepPathId: placement.duplicate.actionStepPathId,
            actionId: context.actionId,
            index: placement.duplicate.index,
            id: newStepId,
            functionOptions: JSON.stringify(createFunctionOptions),
            [functionIdKey]: actionFunction.id,
          },
          moveInput: placement.moveActionStepInput,
        },
      );
      for (const variable of variableCopies.localVariables) {
        const data = await requestNextgenActionStepGraphql(
          "PowerBrowserCreateDuplicateLocalVariable",
          `mutation PowerBrowserCreateDuplicateLocalVariable($input: CreateActionVariableInput) {
            createActionVariable(input: $input) { id }
          }`,
          {
            input: {
              name: variable.name,
              kind: variable.kind,
              scope: "LOCAL",
              actionId: context.actionId,
              hideFromLogs: Boolean(variable.hideFromLogs),
              actionStepId: newStepId,
              options:
                typeof variable.options === "string"
                  ? variable.options
                  : JSON.stringify(variable.options || {}),
            },
          },
        );
        const newVariableId = data.createActionVariable?.id;
        if (!newVariableId) {
          throw new Error(`Local variable ${variable.name} was not created.`);
        }
        replacements.set(variable.id, newVariableId);
      }
      const functionOptions = replaceNextgenActionStepValueIds(
        source.actionStep.functionOptions,
        replacements,
      );
      const paths = pathTemplates.map((path) => {
        const options = replaceNextgenActionStepValueIds(
          path.options,
          replacements,
        );
        return {
          ...path,
          options:
            typeof options === "string"
              ? options
              : JSON.stringify(options || {}),
        };
      });
      await requestNextgenActionStepGraphql(
        "PowerBrowserConfigureDuplicateActionStep",
        `mutation PowerBrowserConfigureDuplicateActionStep($updateInput: UpdateActionStepInput!, $toggleSyncInput: ToggleSyncActionStepWithPageComponentInput) {
          updateActionStep(input: $updateInput) { id }
          toggleSyncActionStepWithPageComponent(input: $toggleSyncInput)
        }`,
        {
          updateInput: {
            id: newStepId,
            label: source.actionStep.label,
            variables: variableCopies.variables,
            functionOptions: JSON.stringify(functionOptions),
            actionStepPaths: paths,
          },
          toggleSyncInput: null,
        },
      );
      console.info("[Power Browser] Duplicate mutation completed.", {
        actionId: context.actionId,
        returnedStepId: newStepId,
      });
      await refreshNextgenActionCanvas(
        context.actionId,
        newStepId,
        "added",
        !requestedContext,
      );
      return newStepId;
    } catch (error) {
      if (!isQuickAction) {
        button.textContent = "Duplicate";
      }
      console.error("[Power Browser] Unable to duplicate action step.", {
        actionId: context.actionId,
        stepId: context.stepId,
        error,
      });
      console.error(
        `[Power Browser] Duplicate action step GraphQL error:\n${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
      window.alert(
        `Unable to duplicate this action step: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      button.disabled = false;
      button.classList.remove("is-loading");
    }
  }

  function closeNextgenActionStepDeleteDialog() {
    const state = nextgenActionStepDeleteDialogState;
    if (!state || state.busy) return;
    state.overlay.setAttribute("aria-hidden", "true");
    state.dialog.setAttribute("aria-hidden", "true");
    state.context = null;
    state.sourceButton = null;
    closePowerBrowserModal(state.dialog);
  }

  function ensureNextgenActionStepDeleteDialog() {
    if (nextgenActionStepDeleteDialogState?.dialog.isConnected) {
      return nextgenActionStepDeleteDialogState;
    }
    const overlay = document.createElement("div");
    overlay.className = "power-browser-quick-delete-overlay";
    overlay.setAttribute("aria-hidden", "true");
    const dialog = document.createElement("section");
    dialog.className = "power-browser-quick-delete-dialog";
    dialog.dataset.test = "power-browser-quick-delete-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-hidden", "true");
    dialog.setAttribute("aria-labelledby", "power-browser-quick-delete-title");
    dialog.setAttribute(
      "aria-describedby",
      "power-browser-quick-delete-description",
    );
    const heading = document.createElement("h2");
    heading.id = "power-browser-quick-delete-title";
    heading.textContent = "You are about to delete this step";
    const description = document.createElement("p");
    description.id = "power-browser-quick-delete-description";
    description.textContent =
      "Are you sure you want to delete this step? This can't be undone.";
    const actions = document.createElement("div");
    actions.className = "power-browser-quick-delete-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "power-browser-quick-delete-cancel";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "power-browser-quick-delete-confirm";
    confirm.dataset.test = "power-browser-confirm-delete-step";
    confirm.textContent = "Delete";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "power-browser-quick-delete-close";
    close.setAttribute("aria-label", "Close dialog");
    close.innerHTML =
      '<svg aria-hidden="true" viewBox="0 0 14 14"><path d="M2.006 3.244a.875.875 0 0 1 1.238-1.238L7 5.763l3.756-3.757a.875.875 0 0 1 1.238 1.238L8.237 7l3.757 3.756a.875.875 0 0 1-1.238 1.238L7 8.237l-3.756 3.757a.875.875 0 0 1-1.238-1.238L5.763 7 2.006 3.244Z"></path></svg>';
    actions.append(cancel, confirm);
    dialog.append(heading, description, actions, close);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    nextgenActionStepDeleteDialogState = {
      overlay,
      dialog,
      cancel,
      confirm,
      close,
      context: null,
      sourceButton: null,
      busy: false,
    };
    cancel.addEventListener("click", closeNextgenActionStepDeleteDialog);
    close.addEventListener("click", closeNextgenActionStepDeleteDialog);
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) closeNextgenActionStepDeleteDialog();
    });
    confirm.addEventListener("click", () =>
      void confirmNextgenActionStepDeletion(),
    );
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.repeat || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmNextgenActionStepDeletion();
    });
    return nextgenActionStepDeleteDialogState;
  }

  function openNextgenActionStepDeleteDialog(button, context) {
    const state = ensureNextgenActionStepDeleteDialog();
    state.context = { ...context };
    state.sourceButton = button;
    state.overlay.setAttribute("aria-hidden", "false");
    state.dialog.setAttribute("aria-hidden", "false");
    openPowerBrowserModal({
      dialog: state.dialog,
      overlay: state.overlay,
      close: closeNextgenActionStepDeleteDialog,
      initialFocus: () => state.confirm,
      announcement: "Delete action step confirmation opened.",
    });
    state.confirm.focus();
  }

  async function confirmNextgenActionStepDeletion() {
    const state = nextgenActionStepDeleteDialogState;
    const context = state?.context;
    if (!state || !context || state.busy) return;
    state.busy = true;
    state.cancel.disabled = true;
    state.confirm.disabled = true;
    state.close.disabled = true;
    if (state.sourceButton?.isConnected) state.sourceButton.disabled = true;
    try {
      await requestNextgenActionStepGraphql(
        "DeleteActionStep",
        `mutation DeleteActionStep($deleteActionStepInput: DeleteActionStepInput, $moveActionStepsInput: [MoveActionStepsInput]) {
          deleteActionStep(input: $deleteActionStepInput)
          moveActionSteps(input: $moveActionStepsInput)
        }`,
        {
          deleteActionStepInput: { id: context.stepId },
          moveActionStepsInput: [],
        },
      );
      console.info("[Power Browser] Delete action step mutation completed.", context);
      await refreshNextgenActionCanvas(
        context.actionId,
        context.stepId,
        "removed",
        false,
      );
      state.busy = false;
      closeNextgenActionStepDeleteDialog();
    } catch (error) {
      console.error("[Power Browser] Unable to delete action step.", {
        ...context,
        error,
      });
      window.alert(
        `Unable to delete this action step: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      state.busy = false;
      state.cancel.disabled = false;
      state.confirm.disabled = false;
      state.close.disabled = false;
      if (state.sourceButton?.isConnected) state.sourceButton.disabled = false;
    }
  }

  function deleteNextgenActionStep(button, context) {
    openNextgenActionStepDeleteDialog(button, context);
  }

  function ensureNextgenActionStepQuickActionStyles() {
    if (document.getElementById(NEXTGEN_ACTION_STEP_QUICK_ACTIONS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = NEXTGEN_ACTION_STEP_QUICK_ACTIONS_STYLE_ID;
    style.textContent = `
      .react-flow__node-step,.react-flow__node-yieldsAll{overflow:visible!important}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}{position:absolute;left:0;bottom:calc(100% + 3px);z-index:20;display:flex;align-items:center;gap:2px;padding:3px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;box-shadow:0 2px 8px rgba(15,23,42,.14);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(2px);transition:opacity .12s,transform .12s,visibility 0s linear .12s}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}::after{content:"";position:absolute;left:0;right:0;bottom:-4px;height:4px}
      .react-flow__node-step:hover>.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS},.react-flow__node-yieldsAll:hover>.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS},.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}:hover,.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}:focus-within{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0);transition-delay:0s}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:4px;background:transparent;opacity:.75;cursor:pointer;transition:opacity .2s,background .2s}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button:hover,.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button:focus-visible{opacity:1;background:#f3f4f6;outline:none}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button[data-test="power-browser-quick-delete-step"]:hover{background:#fef2f2}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button:disabled{cursor:wait;opacity:.4}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button.is-unavailable,.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button.is-unavailable:disabled{cursor:not-allowed;opacity:.32;background:transparent}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button.is-unavailable svg{fill:#9ca3af}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button.is-loading{background:#f3f4f6;opacity:1}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button.is-loading svg{fill:#9ca3af}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} svg{display:inline-block;flex:0 0 auto;width:.75rem;height:.75rem;fill:#374151}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button[data-test="power-browser-quick-delete-step"]:hover svg{fill:#ef4444}
      .power-browser-quick-delete-overlay{position:fixed;inset:0;z-index:2147483004;display:flex;align-items:flex-start;justify-content:center;padding:112px 24px 24px;background:rgba(17,24,39,.45);box-sizing:border-box}
      .power-browser-quick-delete-overlay[aria-hidden="true"]{display:none}
      .power-browser-quick-delete-dialog{position:relative;display:grid;width:min(600px,calc(100vw - 48px));min-height:190px;gap:16px;padding:32px;border-radius:4px;background:#fff;box-shadow:0 20px 50px rgba(15,23,42,.24);color:#111827;box-sizing:border-box}
      .power-browser-quick-delete-dialog[aria-hidden="true"]{display:none}
      .power-browser-quick-delete-dialog h2{width:calc(100% - 40px);margin:0;font-size:20px;font-weight:700;line-height:1.25}
      .power-browser-quick-delete-dialog p{margin:0;color:#4b5563;font-size:14px;line-height:1.5}
      .power-browser-quick-delete-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .power-browser-quick-delete-actions button{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 16px;border:1px solid;border-radius:4px;font-family:inherit;font-size:14px;font-weight:400;cursor:pointer}
      .power-browser-quick-delete-cancel{border-color:#f3f4f6!important;background:#f9fafb;color:#111827}
      .power-browser-quick-delete-cancel:hover{border-color:#e5e7eb!important;background:#f3f4f6}
      .power-browser-quick-delete-confirm{border-color:#ef4444!important;background:#ef4444;color:#fff}
      .power-browser-quick-delete-confirm:hover{border-color:#b91c1c!important;background:#b91c1c}
      .power-browser-quick-delete-close{position:absolute;top:32px;right:32px;display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;border-radius:4px;background:transparent;cursor:pointer}
      .power-browser-quick-delete-close:hover{background:#f9fafb}
      .power-browser-quick-delete-close svg{width:12px;height:12px;fill:#374151}
      .power-browser-quick-delete-dialog button:disabled{cursor:wait;opacity:.5}
      .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} .power-browser-action-scope-trigger{margin-left:2px;border-left:1px solid #e5e7eb;border-radius:0 4px 4px 0}
      .power-browser-action-scope-menu{position:fixed;z-index:2147483646;display:flex;flex-direction:column;width:230px;padding:6px;border:1px solid #e5e7eb;border-radius:7px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.18);color:#111827;font-family:inherit;box-sizing:border-box}
      .power-browser-action-scope-menu[hidden]{display:none!important}
      .power-browser-action-scope-menu header{display:flex;flex-direction:column;gap:2px;padding:6px 8px 8px;border-bottom:1px solid #f3f4f6}
      .power-browser-action-scope-menu header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600}
      .power-browser-action-scope-menu header span{color:#6b7280;font-size:11px}
      .power-browser-action-scope-menu button{display:flex;align-items:center;justify-content:flex-start;width:100%;height:32px;margin-top:2px;padding:0 8px;gap:8px;border:0;border-radius:4px;background:transparent;color:#374151;font-family:inherit;font-size:12px;font-weight:500;opacity:1;white-space:nowrap;cursor:pointer}
      .power-browser-action-scope-menu button:hover,.power-browser-action-scope-menu button:focus-visible{background:#f3f4f6;outline:none}
      .power-browser-action-scope-menu button:disabled{cursor:wait;opacity:.4}
      .power-browser-action-scope-menu button svg{display:inline-block;flex:0 0 auto;width:13px;height:13px;fill:#374151}
      .power-browser-action-scope-menu button.is-loading svg{fill:#9ca3af}
      .power-browser-action-scope-menu button[data-test="power-browser-delete-action-scope"]{color:#dc2626}
      .power-browser-action-scope-menu button[data-test="power-browser-delete-action-scope"] svg{fill:#dc2626}
      .power-browser-action-scope-menu button[data-test="power-browser-delete-action-scope"]:hover{background:#fef2f2}
    `;
    document.head.appendChild(style);
  }

  function cleanupNextgenActionStepEdgePasteButtons() {
    document
      .querySelectorAll(`.${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS}`)
      .forEach((control) => control.remove());
    document
      .getElementById(NEXTGEN_ACTION_STEP_EDGE_PASTE_STYLE_ID)
      ?.remove();
  }

  function setNextgenActionStepPasteShortcutActive(active) {
    nextgenActionStepPasteShortcutActive = Boolean(active);
    document.documentElement.classList.toggle(
      NEXTGEN_ACTION_STEP_EDGE_PASTE_ACTIVE_CLASS,
      nextgenActionStepPasteShortcutActive,
    );
    if (nextgenActionStepPasteShortcutActive) {
      void installNextgenActionStepEdgePasteButtons();
    } else {
      cleanupNextgenActionStepEdgePasteButtons();
    }
  }

  function getNextgenActionStepPasteShortcutParts() {
    return String(
      getSettingValue("nextgenActionStepPasteShortcut") || "",
    )
      .split("+")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
  }

  function nextgenActionStepPasteShortcutIncludesReleasedKey(event) {
    const shortcutParts = getNextgenActionStepPasteShortcutParts();
    const releasedKeyAliases = {
      control: ["control", "ctrl"],
      meta: ["meta", "cmd", "command"],
      alt: ["alt", "option"],
      shift: ["shift"],
    };
    const releasedKey = event.key.toLowerCase();
    const aliases = releasedKeyAliases[releasedKey] || [releasedKey];
    if (aliases.some((key) => shortcutParts.includes(key))) return true;

    const isMac = window.navigator.platform.toLowerCase().includes("mac");
    const expectsCtrl =
      shortcutParts.includes("ctrl") || shortcutParts.includes("control");
    const expectsMeta = ["meta", "cmd", "command"].some((key) =>
      shortcutParts.includes(key),
    );
    return isMac && releasedKey === "meta" && expectsCtrl && !expectsMeta;
  }

  function handleNextgenActionStepPasteShortcutKeydown(event) {
    if (
      !nextgenActionStepPasteShortcutActive &&
      shortcutMatchesEvent(
        String(getSettingValue("nextgenActionStepPasteShortcut") || ""),
        event,
      )
    ) {
      setNextgenActionStepPasteShortcutActive(true);
    }
  }

  function handleNextgenActionStepPasteShortcutKeyup(event) {
    if (
      nextgenActionStepPasteShortcutActive &&
      nextgenActionStepPasteShortcutIncludesReleasedKey(event)
    ) {
      setNextgenActionStepPasteShortcutActive(false);
    }
  }

  function installNextgenActionStepPasteShortcut() {
    if (nextgenActionStepPasteShortcutInstalled) return;
    document.addEventListener(
      "keydown",
      handleNextgenActionStepPasteShortcutKeydown,
    );
    document.addEventListener(
      "keyup",
      handleNextgenActionStepPasteShortcutKeyup,
    );
    window.addEventListener("blur", resetNextgenActionStepPasteShortcut);
    nextgenActionStepPasteShortcutInstalled = true;
  }

  function resetNextgenActionStepPasteShortcut() {
    setNextgenActionStepPasteShortcutActive(false);
  }

  function cleanupNextgenActionStepPasteShortcut() {
    if (nextgenActionStepPasteShortcutInstalled) {
      document.removeEventListener(
        "keydown",
        handleNextgenActionStepPasteShortcutKeydown,
      );
      document.removeEventListener(
        "keyup",
        handleNextgenActionStepPasteShortcutKeyup,
      );
      window.removeEventListener("blur", resetNextgenActionStepPasteShortcut);
      nextgenActionStepPasteShortcutInstalled = false;
    }
    resetNextgenActionStepPasteShortcut();
  }

  function ensureNextgenActionStepEdgePasteStyles() {
    if (document.getElementById(NEXTGEN_ACTION_STEP_EDGE_PASTE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = NEXTGEN_ACTION_STEP_EDGE_PASTE_STYLE_ID;
    style.textContent = `
      .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS}{display:none;overflow:visible;pointer-events:none}
      html.${NEXTGEN_ACTION_STEP_EDGE_PASTE_ACTIVE_CLASS} .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS}{display:block;pointer-events:all}
      .react-flow__edge:not(.inactive)>.${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS},.react-flow__edge:has(circle.scale-100)>.${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS}{display:none;pointer-events:none}
      .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS}>div{display:flex;width:32px;height:32px;align-items:center;justify-content:center;transform-origin:center}
      .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS}>div.is-new{animation:power-browser-edge-paste-in .18s ease-out}
      .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS} button{display:flex;width:26px;height:26px;align-items:center;justify-content:center;padding:0;border:2px dashed #5597ed;border-radius:999px;background:#fff;box-shadow:0 2px 7px rgba(15,23,42,.18);cursor:pointer;transition:transform .15s,background .15s,border-color .15s}
      .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS} button:hover,.${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS} button:focus-visible{transform:scale(1.12);background:#eff6ff;border-color:#2563eb;outline:none}
      .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS} button:disabled{cursor:wait;opacity:.55}
      .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS} button.is-loading{background:#f3f4f6;border-color:#9ca3af}
      .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS} svg{width:12px;height:12px;fill:#2563eb}
      .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS} button.is-loading svg{fill:#9ca3af}
      @keyframes power-browser-edge-paste-in{from{opacity:0;transform:scale(.65)}to{opacity:1;transform:scale(1)}}
    `;
    document.head.appendChild(style);
  }

  function getNextgenActionStepEdgePlacement(
    edge,
    actionStepIds,
    yieldsAllStepIds,
    actionStepPathOwners,
    edgeEndpoints,
  ) {
    const label = edge.getAttribute("aria-label") || "";
    const endpoints = label.match(/^Edge from (.+?) to (.+)$/);
    if (!endpoints) return null;
    const [, sourceId, targetId] = endpoints;
    if (
      actionStepIds.size === 0 &&
      sourceId === "start" &&
      targetId === "finish"
    ) {
      return { stepId: null, position: "empty" };
    }
    if (yieldsAllStepIds.has(sourceId) && targetId.startsWith("phantom-")) {
      return {
        stepId: sourceId,
        position: "scope-empty",
        parentId: sourceId,
        actionStepPathId: null,
      };
    }
    if (actionStepIds.has(targetId)) {
      return { stepId: targetId, position: "before" };
    }
    if (actionStepIds.has(sourceId)) {
      return { stepId: sourceId, position: "after" };
    }
    const pathOwnerId = actionStepPathOwners.get(sourceId);
    if (pathOwnerId && targetId.startsWith("junction-")) {
      return {
        stepId: pathOwnerId,
        position: "path-empty",
        pathOwnerId,
        parentId: null,
        actionStepPathId: sourceId,
      };
    }
    if (targetId === "finish" && sourceId.startsWith("junction-")) {
      const ownerIds = new Set(
        edgeEndpoints
          .filter(
            (candidate) =>
              candidate.targetId === sourceId &&
              actionStepPathOwners.has(candidate.sourceId),
          )
          .map((candidate) => actionStepPathOwners.get(candidate.sourceId)),
      );
      if (ownerIds.size === 1) {
        return { stepId: ownerIds.values().next().value, position: "after" };
      }
    }
    return null;
  }

  async function installNextgenActionStepEdgePasteButtons() {
    if (
      !nextgenActionStepPasteShortcutActive ||
      !getSettingValue("nextgenActionStepCopyPaste") ||
      !isValidNextgenActionStepClipboard(nextgenActionStepClipboard)
    ) {
      cleanupNextgenActionStepEdgePasteButtons();
      return;
    }
    const actionId = location.pathname.match(/\/app\/actions\/([^/?#]+)/i)?.[1];
    if (!actionId) {
      cleanupNextgenActionStepEdgePasteButtons();
      return;
    }
    const clipboard = nextgenActionStepClipboard;
    const signature = getNextgenActionStepClipboardSignature(clipboard);
    const clipboardAnimationKey = [
      actionId,
      clipboard.schemaVersion,
      clipboard.sourceActionId,
      clipboard.sourceStepId,
      clipboard.copiedAt,
      signature,
    ].join(":");
    if (clipboardAnimationKey !== nextgenEdgePasteClipboardKey) {
      nextgenEdgePasteClipboardKey = clipboardAnimationKey;
      nextgenAnimatedEdgePasteKeys.clear();
    }
    let compatible = false;
    try {
      compatible = Boolean(
        clipboard.schemaVersion === 2
          ? await resolveNextgenPasteActionFunctions(clipboard)
          : await resolveNextgenPasteActionFunction(clipboard),
      );
    } catch (error) {
      console.error(
        "[Power Browser] Unable to check edge-paste compatibility.",
        error,
      );
    }
    if (
      !compatible ||
      signature !==
        getNextgenActionStepClipboardSignature(nextgenActionStepClipboard)
    ) {
      cleanupNextgenActionStepEdgePasteButtons();
      return;
    }
    ensureNextgenActionStepEdgePasteStyles();
    const actionStepIds = new Set(
      Array.from(
        document.querySelectorAll(
          ".react-flow__node-step[data-id], .react-flow__node-yieldsAll[data-id]",
        ),
        (node) => node.getAttribute("data-id"),
      ).filter(
        (stepId) =>
          stepId && !NEXTGEN_RESERVED_ACTION_STEP_IDS.has(stepId.toLowerCase()),
      ),
    );
    const yieldsAllStepIds = new Set(
      Array.from(
        document.querySelectorAll(".react-flow__node-yieldsAll[data-id]"),
        (node) => node.getAttribute("data-id"),
      ).filter(Boolean),
    );
    const edges = Array.from(document.querySelectorAll(".react-flow__edge"));
    const edgeEndpoints = edges
      .map((edge) => {
        const label = edge.getAttribute("aria-label") || "";
        const match = label.match(/^Edge from (.+?) to (.+)$/);
        return match
          ? { edge, sourceId: match[1], targetId: match[2] }
          : null;
      })
      .filter(Boolean);
    const actionStepPathIds = new Set(
      Array.from(
        document.querySelectorAll(".react-flow__node-path[data-id]"),
        (node) => node.getAttribute("data-id"),
      ).filter(Boolean),
    );
    const actionStepPathOwners = new Map();
    edgeEndpoints.forEach(({ sourceId, targetId }) => {
      if (actionStepIds.has(sourceId) && actionStepPathIds.has(targetId)) {
        actionStepPathOwners.set(targetId, sourceId);
      }
    });
    edges.forEach((edge) => {
      if (edge.querySelector(`:scope > .${NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS}`)) {
        return;
      }
      const placement = getNextgenActionStepEdgePlacement(
        edge,
        actionStepIds,
        yieldsAllStepIds,
        actionStepPathOwners,
        edgeEndpoints,
      );
      const midpoint = Array.from(edge.children).find(
        (child) =>
          child.localName === "g" && child.hasAttribute("transform"),
      );
      if (!placement || !midpoint) return;
      const foreignObject = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "foreignObject",
      );
      foreignObject.classList.add(NEXTGEN_ACTION_STEP_EDGE_PASTE_CLASS);
      foreignObject.setAttribute("x", "-16");
      foreignObject.setAttribute("y", "-16");
      foreignObject.setAttribute("width", "32");
      foreignObject.setAttribute("height", "32");
      foreignObject.setAttribute("transform", midpoint.getAttribute("transform"));
      const wrapper = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "div",
      );
      const edgeAnimationKey = [
        actionId,
        placement.stepId,
        placement.position,
        placement.actionStepPathId,
      ].join(":");
      if (!nextgenAnimatedEdgePasteKeys.has(edgeAnimationKey)) {
        wrapper.classList.add("is-new");
        nextgenAnimatedEdgePasteKeys.add(edgeAnimationKey);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.title = "Paste action step here";
      button.dataset.test = "power-browser-edge-paste-step";
      button.setAttribute("aria-label", "Paste action step here");
      button.innerHTML =
        '<svg data-testid="icon_paste" aria-hidden="true" focusable="false" viewBox="0 0 14 14"><path d="M5.25 0A1.75 1.75 0 0 0 3.5 1.75H2.625A1.75 1.75 0 0 0 .875 3.5v8.75A1.75 1.75 0 0 0 2.625 14h5.25v-1.75h-5.25V3.5H3.5v.875h7V3.5h.875v3.063h1.75V3.5a1.75 1.75 0 0 0-1.75-1.75H10.5A1.75 1.75 0 0 0 8.75 0h-3.5Zm0 1.75h3.5v.875h-3.5V1.75Z"></path><path d="M10.5 7v2.625H7.875v1.75H10.5V14h1.75v-2.625h2.625v-1.75H12.25V7H10.5Z"></path></svg>';
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void pasteNextgenActionStepAtPlacement(
          button,
          { actionId, stepId: placement.stepId },
          placement,
        );
      });
      wrapper.appendChild(button);
      foreignObject.appendChild(wrapper);
      edge.appendChild(foreignObject);
    });
  }

  function createNextgenActionStepQuickAction(title, testId, iconMarkup) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = title;
    button.dataset.test = testId;
    button.setAttribute("aria-label", title);
    button.innerHTML = iconMarkup;
    return button;
  }

  function closeNextgenActionScopeMenus(exceptMenu = null) {
    document
      .querySelectorAll(".power-browser-action-scope-menu:not([hidden])")
      .forEach((menu) => {
        if (menu === exceptMenu) return;
        menu.hidden = true;
        menu.powerBrowserScopeTrigger?.setAttribute("aria-expanded", "false");
      });
  }

  function positionNextgenActionScopeMenu(menu) {
    const trigger = menu.powerBrowserScopeTrigger;
    if (!trigger?.isConnected) {
      menu.remove();
      return;
    }
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    const gap = 7;
    let top = triggerRect.top - menuRect.height - gap;
    if (top < margin) top = triggerRect.bottom + gap;
    top = Math.min(
      Math.max(margin, top),
      Math.max(margin, window.innerHeight - menuRect.height - margin),
    );
    const left = Math.min(
      Math.max(margin, triggerRect.left),
      Math.max(margin, window.innerWidth - menuRect.width - margin),
    );
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
  }

  function removeNextgenActionScopeMenuForToolbar(toolbar) {
    const menuId = toolbar?.dataset.scopeMenuId;
    if (menuId) document.getElementById(menuId)?.remove();
    toolbar
      ?.querySelector('[data-test="power-browser-quick-scope-step"]')
      ?.remove();
    if (toolbar) {
      delete toolbar.dataset.scopeMenuId;
      delete toolbar.dataset.scopeSignature;
    }
  }

  function createNextgenActionScopeMenu(toolbar, context, scopeInfo) {
    if (
      !toolbar.isConnected ||
      toolbar.querySelector('[data-test="power-browser-quick-scope-step"]')
    ) {
      return;
    }
    const trigger = createNextgenActionStepQuickAction(
      "Scope actions",
      "power-browser-quick-scope-step",
      '<svg data-testid="icon_scope" aria-hidden="true" focusable="false" viewBox="0 0 14 14"><path d="M1 1h4v4H1V1Zm1.4 1.4v1.2h1.2V2.4H2.4ZM9 1h4v4H9V1Zm1.4 1.4v1.2h1.2V2.4h-1.2ZM9 9h4v4H9V9Zm1.4 1.4v1.2h1.2v-1.2h-1.2ZM3.7 5.8h1.4v1.5h4.2V5.8h1.4v2.9H7.8V10H6.4V8.7H3.7V5.8ZM1 9h4v4H1V9Zm1.4 1.4v1.2h1.2v-1.2H2.4Z"></path></svg>',
    );
    trigger.classList.add("power-browser-action-scope-trigger");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");

    const menu = document.createElement("div");
    menu.id = `power-browser-action-scope-menu-${createPowerBrowserUuid()}`;
    menu.className = "power-browser-action-scope-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    menu.powerBrowserScopeTrigger = trigger;
    toolbar.dataset.scopeMenuId = menu.id;
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = scopeInfo.label;
    const meta = document.createElement("span");
    meta.textContent = `${scopeInfo.stepCount} steps · ${scopeInfo.pathCount} path${scopeInfo.pathCount === 1 ? "" : "s"}`;
    header.append(title, meta);

    const copyScope = createNextgenActionStepQuickAction(
      "Copy entire scope",
      "power-browser-copy-action-scope",
      '<svg aria-hidden="true" viewBox="0 0 14 14"><path d="M4.4 0A1.8 1.8 0 0 0 2.6 1.8v.8h1.8v-.8h7.8v7.8h-.8v1.8h.8A1.8 1.8 0 0 0 14 9.6V1.8A1.8 1.8 0 0 0 12.2 0H4.4Z"></path><path d="M1.8 3.5A1.8 1.8 0 0 0 0 5.3v7A1.8 1.8 0 0 0 1.8 14h7a1.8 1.8 0 0 0 1.7-1.8v-7a1.8 1.8 0 0 0-1.7-1.7h-7Zm0 1.8h7v7h-7v-7Z"></path></svg>',
    );
    copyScope.textContent = "Copy entire scope";
    copyScope.insertAdjacentHTML(
      "afterbegin",
      '<svg aria-hidden="true" viewBox="0 0 14 14"><path d="M4.4 0A1.8 1.8 0 0 0 2.6 1.8v.8h1.8v-.8h7.8v7.8h-.8v1.8h.8A1.8 1.8 0 0 0 14 9.6V1.8A1.8 1.8 0 0 0 12.2 0H4.4Z"></path><path d="M1.8 3.5A1.8 1.8 0 0 0 0 5.3v7A1.8 1.8 0 0 0 1.8 14h7a1.8 1.8 0 0 0 1.7-1.8v-7a1.8 1.8 0 0 0-1.7-1.7h-7Zm0 1.8h7v7h-7v-7Z"></path></svg>',
    );
    const duplicateScope = createNextgenActionStepQuickAction(
      "Duplicate entire scope",
      "power-browser-duplicate-action-scope",
      '<svg aria-hidden="true" viewBox="0 0 14 14"><path d="M5.4 1.6A1.6 1.6 0 0 1 7 0v3.1H5.4V1.6ZM12.4 8.6A1.6 1.6 0 0 0 14 7h-3.1v1.6h1.5ZM1.6 4.7A1.6 1.6 0 0 0 0 6.2v6.2A1.6 1.6 0 0 0 1.6 14h6.2a1.6 1.6 0 0 0 1.5-1.6V6.2a1.6 1.6 0 0 0-1.5-1.5H1.6Zm0 1.5h6.2v6.2H1.6V6.2ZM8.9 0h1.6v1.6H8.9V0Zm3.5 3.5H14v1.6h-1.6V3.5ZM12.4 0A1.6 1.6 0 0 1 14 1.6h-1.6V0Z"></path></svg>',
    );
    duplicateScope.textContent = "Duplicate entire scope";
    duplicateScope.insertAdjacentHTML(
      "afterbegin",
      '<svg aria-hidden="true" viewBox="0 0 14 14"><path d="M5.4 1.6A1.6 1.6 0 0 1 7 0v3.1H5.4V1.6ZM12.4 8.6A1.6 1.6 0 0 0 14 7h-3.1v1.6h1.5ZM1.6 4.7A1.6 1.6 0 0 0 0 6.2v6.2A1.6 1.6 0 0 0 1.6 14h6.2a1.6 1.6 0 0 0 1.5-1.6V6.2a1.6 1.6 0 0 0-1.5-1.5H1.6Zm0 1.5h6.2v6.2H1.6V6.2ZM8.9 0h1.6v1.6H8.9V0Zm3.5 3.5H14v1.6h-1.6V3.5ZM12.4 0A1.6 1.6 0 0 1 14 1.6h-1.6V0Z"></path></svg>',
    );
    const deleteScope = createNextgenActionStepQuickAction(
      "Delete entire scope",
      "power-browser-delete-action-scope",
      '<svg aria-hidden="true" viewBox="0 0 14 14"><path d="M3.5.9v.9H.9a.9.9 0 0 0 0 1.7h12.2a.9.9 0 0 0 0-1.7h-2.6V.9a.9.9 0 0 0-.9-.9H4.4a.9.9 0 0 0-.9.9ZM12.3 5.3H1.8l.7 7.1A1.8 1.8 0 0 0 4.2 14h5.6a1.8 1.8 0 0 0 1.7-1.6l.8-7.1Z"></path></svg>',
    );
    deleteScope.textContent = "Delete entire scope";
    deleteScope.insertAdjacentHTML(
      "afterbegin",
      '<svg aria-hidden="true" viewBox="0 0 14 14"><path d="M3.5.9v.9H.9a.9.9 0 0 0 0 1.7h12.2a.9.9 0 0 0 0-1.7h-2.6V.9a.9.9 0 0 0-.9-.9H4.4a.9.9 0 0 0-.9.9ZM12.3 5.3H1.8l.7 7.1A1.8 1.8 0 0 0 4.2 14h5.6a1.8 1.8 0 0 0 1.7-1.6l.8-7.1Z"></path></svg>',
    );

    const menuButtons = getSettingValue("nextgenActionStepCopyPaste")
      ? [copyScope, duplicateScope, deleteScope]
      : [duplicateScope, deleteScope];
    menuButtons.forEach((button) => {
      button.setAttribute("role", "menuitem");
      button.addEventListener("pointerdown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    copyScope.addEventListener("click", () =>
      void copyNextgenActionScope(copyScope, context),
    );
    duplicateScope.addEventListener("click", () =>
      void duplicateNextgenActionScope(duplicateScope, context),
    );
    deleteScope.addEventListener("click", () =>
      void deleteNextgenActionScope(deleteScope, context, scopeInfo),
    );
    trigger.addEventListener("pointerdown", (event) => event.stopPropagation());
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = menu.hidden;
      closeNextgenActionScopeMenus(willOpen ? menu : null);
      menu.hidden = !willOpen;
      trigger.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) positionNextgenActionScopeMenu(menu);
    });
    menu.append(header, ...menuButtons);
    toolbar.appendChild(trigger);
    document.body.appendChild(menu);

    if (!nextgenScopeMenuDocumentListenerInstalled) {
      nextgenScopeMenuDocumentListenerInstalled = true;
      document.addEventListener("pointerdown", (event) => {
        if (!event.target.closest?.(".power-browser-action-scope-menu")) {
          closeNextgenActionScopeMenus();
        }
      });
      window.addEventListener("resize", () => {
        document
          .querySelectorAll(".power-browser-action-scope-menu:not([hidden])")
          .forEach(positionNextgenActionScopeMenu);
      });
      document.addEventListener(
        "scroll",
        (event) => {
          if (event.target.closest?.(".power-browser-action-scope-menu")) return;
          document
            .querySelectorAll(".power-browser-action-scope-menu:not([hidden])")
            .forEach(positionNextgenActionScopeMenu);
        },
        true,
      );
    }
  }

  async function installNextgenActionScopeMenu(toolbar, context) {
    const revision = String(nextgenActionScopeRevision);
    if (
      toolbar.dataset.scopeRevision === revision ||
      toolbar.dataset.scopeCheckRevision === revision
    ) {
      return;
    }
    const checkSequence = String(++nextgenScopeMenuCheckSequence);
    toolbar.dataset.scopeCheckSequence = checkSequence;
    toolbar.dataset.scopeCheckRevision = revision;
    try {
      const action = await fetchNextgenActionForScope(context.actionId);
      if (
        !toolbar.isConnected ||
        toolbar.dataset.scopeCheckSequence !== checkSequence ||
        revision !== String(nextgenActionScopeRevision)
      ) {
        return;
      }
      const scopeInfo = getNextgenActionScopeInfo(action, context.stepId);
      if (!scopeInfo) {
        removeNextgenActionScopeMenuForToolbar(toolbar);
        toolbar.dataset.scopeRevision = revision;
        delete toolbar.dataset.scopeCheckRevision;
        return;
      }
      const scopeSignature = [
        scopeInfo.label,
        scopeInfo.pathCount,
        ...Array.from(scopeInfo.stepIds).sort(),
      ].join(":");
      const existingTrigger = toolbar.querySelector(
        '[data-test="power-browser-quick-scope-step"]',
      );
      const existingMenu = toolbar.dataset.scopeMenuId
        ? document.getElementById(toolbar.dataset.scopeMenuId)
        : null;
      if (
        toolbar.dataset.scopeSignature === scopeSignature &&
        existingTrigger &&
        existingMenu
      ) {
        toolbar.dataset.scopeRevision = revision;
        delete toolbar.dataset.scopeCheckRevision;
        return;
      }
      removeNextgenActionScopeMenuForToolbar(toolbar);
      createNextgenActionScopeMenu(toolbar, context, scopeInfo);
      toolbar.dataset.scopeSignature = scopeSignature;
      toolbar.dataset.scopeRevision = revision;
      delete toolbar.dataset.scopeCheckRevision;
    } catch (error) {
      if (toolbar.dataset.scopeCheckRevision === revision) {
        delete toolbar.dataset.scopeCheckRevision;
      }
      console.debug("[Power Browser] Scope quick action unavailable.", {
        ...context,
        error,
      });
    }
  }

  function getNextgenActionStepNodes(roots = null) {
    const selector =
      ".react-flow__node-step[data-id], .react-flow__node-yieldsAll[data-id]";
    if (!roots) return Array.from(document.querySelectorAll(selector));
    const nodes = new Set();
    roots.forEach((root) => {
      if (!(root instanceof Element)) return;
      if (root.matches(selector)) nodes.add(root);
      root.querySelectorAll(selector).forEach((node) => nodes.add(node));
    });
    return Array.from(nodes);
  }

  function cleanupDetachedNextgenActionScopeMenus() {
    document.querySelectorAll(".power-browser-action-scope-menu").forEach((menu) => {
      if (!menu.powerBrowserScopeTrigger?.isConnected) menu.remove();
    });
  }

  function installNextgenActionStepQuickActions(roots = null) {
    if (!getSettingValue("nextgenActionStepQuickActions")) return;
    const copyPasteEnabled = Boolean(
      getSettingValue("nextgenActionStepCopyPaste"),
    );
    const actionId = location.pathname.match(/\/app\/actions\/([^/?#]+)/i)?.[1];
    if (!actionId) return;
    ensureNextgenActionStepQuickActionStyles();
    if (!roots) cleanupDetachedNextgenActionScopeMenus();
    getNextgenActionStepNodes(roots).forEach((node) => {
        const existingToolbar = node.querySelector(
          `:scope > .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}`,
        );
        const stepId = node.getAttribute("data-id");
        if (
          !stepId ||
          NEXTGEN_RESERVED_ACTION_STEP_IDS.has(stepId.toLowerCase())
        ) {
          removeNextgenActionScopeMenuForToolbar(existingToolbar);
          existingToolbar?.remove();
          return;
        }
        const context = { actionId, stepId };
        if (existingToolbar) {
          existingToolbar
            .querySelector('[data-test="power-browser-quick-paste-step"]')
            ?.remove();
          void installNextgenActionScopeMenu(existingToolbar, context);
          return;
        }
        const toolbar = document.createElement("div");
        toolbar.className = NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS;
        const duplicate = createNextgenActionStepQuickAction(
          "Duplicate action step",
          "power-browser-quick-duplicate-step",
          '<svg data-testid="icon_duplicate" aria-hidden="true" focusable="false" viewBox="0 0 14 14" stroke-width="0"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.44444 1.55556C5.44444 0.69645 6.14089 0 6.99999 0V3.11111H5.44444V1.55556ZM12.44443 8.55556C13.30359 8.55556 14 7.85911 14 7H10.88885V8.55556H12.44443ZM8.94443 0H10.5V1.55556H8.94443V0ZM12.44443 3.5H14V5.05556H12.44443V3.5ZM12.44443 0C13.30359 0 14 0.69645 14 1.55556H12.44443V0ZM1.55556 4.66664C0.69645 4.66664 0 5.36308 0 6.2222V12.44443C0 13.3035 0.69645 14 1.55556 14H7.77778C8.63689 14 9.33336 13.3035 9.33336 12.44443V6.2222C9.33336 5.36308 8.63689 4.66664 7.77778 4.66664H1.55556ZM1.55556 6.2222H7.77778V12.44443H1.55556V6.2222Z"></path></svg>',
        );
        const copy = createNextgenActionStepQuickAction(
          "Copy action step",
          "power-browser-quick-copy-step",
          '<svg data-testid="icon_copy" aria-hidden="true" focusable="false" viewBox="0 0 14 14" stroke-width="0"><path d="M4.375 0A1.75 1.75 0 0 0 2.625 1.75v.875h1.75V1.75h7.875v7.875h-.875v1.75h.875A1.75 1.75 0 0 0 14 9.625V1.75A1.75 1.75 0 0 0 12.25 0H4.375Z"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M1.75 3.5A1.75 1.75 0 0 0 0 5.25v7A1.75 1.75 0 0 0 1.75 14h7a1.75 1.75 0 0 0 1.75-1.75v-7A1.75 1.75 0 0 0 8.75 3.5h-7Zm0 1.75h7v7h-7v-7Z"></path></svg>',
        );
        const remove = createNextgenActionStepQuickAction(
          "Delete action step",
          "power-browser-quick-delete-step",
          '<svg data-testid="icon_trash" aria-hidden="true" focusable="false" viewBox="0 0 14 14" stroke-width="0"><path d="M3.5 0.875V1.75H0.875C0.39175 1.75 0 2.14175 0 2.625C0 3.10825 0.39175 3.5 0.875 3.5H13.125C13.60826 3.5 14 3.10825 14 2.625C14 2.14175 13.60826 1.75 13.125 1.75H10.5V0.875C10.5 0.39175 10.10826 0 9.625 0H4.375C3.89175 0 3.5 0.39175 3.5 0.875Z"></path><path d="M12.25 5.25H1.75L2.48031 12.40846C2.56225 13.3098 3.31802 14 4.22313 14H9.7769C10.682 14 11.43774 13.3098 11.51972 12.40846L12.25 5.25Z"></path></svg>',
        );
        const actionButtons = copyPasteEnabled
          ? [copy, duplicate, remove]
          : [duplicate, remove];
        actionButtons.forEach((button) => {
          button.addEventListener("pointerdown", (event) => event.stopPropagation());
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
          });
        });
        duplicate.addEventListener("click", () =>
          void duplicateNextgenActionStep(duplicate, context),
        );
        if (copyPasteEnabled) {
          copy.addEventListener("click", () =>
            void copyNextgenActionStep(copy, context),
          );
        }
        remove.addEventListener("click", () =>
          void deleteNextgenActionStep(remove, context),
        );
        toolbar.append(...actionButtons);
        node.appendChild(toolbar);
        void installNextgenActionScopeMenu(toolbar, context);
    });
  }

  function nodeContainsNextgenActionElement(node, selector) {
    return (
      node instanceof Element &&
      (node.matches(selector) || Boolean(node.querySelector(selector)))
    );
  }

  function scheduleNextgenActionStepEnhancements(mutations) {
    const actionNodeSelector =
      ".react-flow__node-step[data-id], .react-flow__node-yieldsAll[data-id]";
    const drawerSelector =
      '[role="dialog"] button[data-test="cancel-step"], [role="dialog"] button[data-test="save-step"]';
    for (const mutation of mutations) {
      const targetActionNode =
        mutation.target instanceof Element
          ? mutation.target.closest(actionNodeSelector)
          : mutation.target.parentElement?.closest(actionNodeSelector);
      if (targetActionNode && mutation.removedNodes.length) {
        nextgenPendingActionStepNodes.add(targetActionNode);
      }
      mutation.addedNodes.forEach((node) => {
        if (nodeContainsNextgenActionElement(node, actionNodeSelector)) {
          if (node instanceof Element && node.matches(actionNodeSelector)) {
            nextgenPendingActionStepNodes.add(node);
          } else if (node instanceof Element) {
            node
              .querySelectorAll(actionNodeSelector)
              .forEach((actionNode) => nextgenPendingActionStepNodes.add(actionNode));
          }
        }
        if (nodeContainsNextgenActionElement(node, drawerSelector)) {
          nextgenActionStepDrawerRefreshPending = true;
        }
        if (
          nextgenActionStepPasteShortcutActive &&
          nodeContainsNextgenActionElement(node, ".react-flow__edge")
        ) {
          nextgenActionStepEdgeRefreshPending = true;
        }
      });
      mutation.removedNodes.forEach((node) => {
        if (nodeContainsNextgenActionElement(node, actionNodeSelector)) {
          nextgenActionStepMenuCleanupPending = true;
        }
      });
    }
    if (
      nextgenPendingActionStepNodes.size === 0 &&
      !nextgenActionStepDrawerRefreshPending &&
      !nextgenActionStepEdgeRefreshPending &&
      !nextgenActionStepMenuCleanupPending
    ) {
      return;
    }
    if (nextgenActionStepEnhancementFrame) return;
    nextgenActionStepEnhancementFrame = window.requestAnimationFrame(() => {
      nextgenActionStepEnhancementFrame = 0;
      const actionNodes = Array.from(nextgenPendingActionStepNodes);
      nextgenPendingActionStepNodes.clear();
      if (nextgenActionStepMenuCleanupPending) {
        nextgenActionStepMenuCleanupPending = false;
        cleanupDetachedNextgenActionScopeMenus();
      }
      if (nextgenActionStepDrawerRefreshPending) {
        nextgenActionStepDrawerRefreshPending = false;
        installNextgenDuplicateActionStepButton();
      }
      if (actionNodes.length) installNextgenActionStepQuickActions(actionNodes);
      if (nextgenActionStepEdgeRefreshPending) {
        nextgenActionStepEdgeRefreshPending = false;
        void installNextgenActionStepEdgePasteButtons();
      }
    });
  }

  function installNextgenActionStepEnhancements() {
    if (getSettingValue("nextgenDuplicateActionStep")) {
      installNextgenDuplicateActionStepButton();
    } else {
      document
        .querySelectorAll(`[data-test="${NEXTGEN_DUPLICATE_STEP_BUTTON_TEST_ID}"]`)
        .forEach((button) => button.remove());
    }
    if (getSettingValue("nextgenActionStepQuickActions")) {
      const copyPasteEnabled = Boolean(
        getSettingValue("nextgenActionStepCopyPaste"),
      );
      document
        .querySelectorAll(`.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}`)
        .forEach((toolbar) => {
          const hasCopyPaste = Boolean(
            toolbar.querySelector(
              'button[data-test="power-browser-quick-copy-step"]',
            ),
          );
          if (hasCopyPaste !== copyPasteEnabled) {
            removeNextgenActionScopeMenuForToolbar(toolbar);
            toolbar.remove();
          }
        });
      installNextgenActionStepQuickActions();
    } else {
      document
        .querySelectorAll(`.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}`)
        .forEach((toolbar) => {
          removeNextgenActionScopeMenuForToolbar(toolbar);
          toolbar.remove();
        });
      document
        .getElementById(NEXTGEN_ACTION_STEP_QUICK_ACTIONS_STYLE_ID)
        ?.remove();
    }
    if (getSettingValue("nextgenActionStepCopyPaste")) {
      installNextgenActionStepPasteShortcut();
      if (nextgenActionStepPasteShortcutActive) {
        void installNextgenActionStepEdgePasteButtons();
      }
    } else {
      cleanupNextgenActionStepPasteShortcut();
      cleanupNextgenActionStepEdgePasteButtons();
    }
  }

  function installNextgenDuplicateActionStepButton() {
    if (!getNextgenEditedActionStepContext()) {
      document
        .querySelectorAll(`[data-test="${NEXTGEN_DUPLICATE_STEP_BUTTON_TEST_ID}"]`)
        .forEach((button) => button.remove());
      return;
    }
    const cancel = document.querySelector(
      '[role="dialog"] button[data-test="cancel-step"]',
    );
    const save = document.querySelector(
      '[role="dialog"] button[data-test="save-step"]',
    );
    if (!cancel || !save || document.querySelector(`[data-test="${NEXTGEN_DUPLICATE_STEP_BUTTON_TEST_ID}"]`)) return;
    const button = cancel.cloneNode(true);
    button.dataset.test = NEXTGEN_DUPLICATE_STEP_BUTTON_TEST_ID;
    button.textContent = "Duplicate";
    button.addEventListener("click", () => void duplicateNextgenActionStep(button));
    cancel.parentElement.insertBefore(button, cancel);
  }

  function cleanupNextgenDuplicateActionStep() {
    nextgenDuplicateActionStepObserver?.disconnect();
    nextgenDuplicateActionStepObserver = null;
    if (nextgenActionStepEnhancementFrame) {
      window.cancelAnimationFrame(nextgenActionStepEnhancementFrame);
      nextgenActionStepEnhancementFrame = 0;
    }
    nextgenPendingActionStepNodes.clear();
    nextgenActionStepDrawerRefreshPending = false;
    nextgenActionStepEdgeRefreshPending = false;
    nextgenActionStepMenuCleanupPending = false;
    document
      .querySelectorAll(`[data-test="${NEXTGEN_DUPLICATE_STEP_BUTTON_TEST_ID}"]`)
      .forEach((button) => button.remove());
    document
      .querySelectorAll(`.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}`)
      .forEach((toolbar) => {
        removeNextgenActionScopeMenuForToolbar(toolbar);
        toolbar.remove();
      });
    document
      .querySelectorAll(".power-browser-action-scope-menu")
      .forEach((menu) => menu.remove());
    if (nextgenActionStepDeleteDialogState) {
      nextgenActionStepDeleteDialogState.busy = false;
      closeNextgenActionStepDeleteDialog();
      nextgenActionStepDeleteDialogState.overlay.remove();
      nextgenActionStepDeleteDialogState = null;
    }
    document.getElementById(NEXTGEN_ACTION_STEP_QUICK_ACTIONS_STYLE_ID)?.remove();
    cleanupNextgenActionStepPasteShortcut();
    cleanupNextgenActionStepEdgePasteButtons();
  }

  function applyNextgenDuplicateActionStepSetting() {
    const bridge = getNextgenActionRuntimeBridge();
    if (
      bridge &&
      getSettingValue("nextgenActionStepQuickActions") &&
      !nextgenActionScopeHooksInstalled
    ) {
      if (!bridge.actionMutationHooks.includes(nextgenActionScopeMutationHook)) {
        bridge.actionMutationHooks.push(nextgenActionScopeMutationHook);
      }
      if (
        !bridge.graphqlResponseHooks.includes(
          nextgenActionScopeGraphqlResponseHook,
        )
      ) {
        bridge.graphqlResponseHooks.push(nextgenActionScopeGraphqlResponseHook);
      }
      nextgenActionScopeHooksInstalled = true;
    }
    if (
      !getSettingValue("nextgenDuplicateActionStep") &&
      !getSettingValue("nextgenActionStepQuickActions") &&
      !getSettingValue("nextgenActionStepCopyPaste")
    ) {
      cleanupNextgenDuplicateActionStep();
      return;
    }
    installNextgenActionStepEnhancements();
    if (!nextgenDuplicateActionStepObserver) {
      nextgenDuplicateActionStepObserver = new MutationObserver(
        scheduleNextgenActionStepEnhancements,
      );
      nextgenDuplicateActionStepObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }
