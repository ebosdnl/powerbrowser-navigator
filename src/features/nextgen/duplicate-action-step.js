  const NEXTGEN_DUPLICATE_STEP_BUTTON_TEST_ID =
    "power-browser-duplicate-step";
  const NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS =
    "power-browser-action-step-quick-actions";
  const NEXTGEN_ACTION_STEP_QUICK_ACTIONS_STYLE_ID =
    "power-browser-action-step-quick-actions-style";
  const NEXTGEN_ACTION_STEP_CLIPBOARD_KEY =
    "powerBrowserNextgenActionStepClipboardV1";
  let nextgenActionStepClipboard = GM_getValue(
    NEXTGEN_ACTION_STEP_CLIPBOARD_KEY,
    null,
  );
  const nextgenPasteFunctionMatchCache = new Map();
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
    return match ? { actionId: match[1], stepId: match[2] } : null;
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
    const response = await fetch(`${location.origin}/api/meta/graphql`, {
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

  async function refreshNextgenActionCanvas(
    actionId,
    stepId,
    mode = "added",
    closeDrawer = true,
  ) {
    const bridge = getNextgenActionRuntimeBridge();
    const clients = bridge?.apolloClients || [];
    console.info("[Power Browser] Apollo client found.", {
      found: clients.length > 0,
      clientCount: clients.length,
    });

    let action = null;
    let refetched = false;
    for (const client of clients) {
      try {
        const results = await client.refetchQueries({ include: ["Action"] });
        const resultList = Array.isArray(results) ? results : [];
        action = resultList.find((result) => result?.data?.action)?.data?.action || null;
        if (action?.id === actionId) {
          refetched = true;
          break;
        }
      } catch (error) {
        console.debug("[Power Browser] Action query refetch skipped for an Apollo client.", error);
      }
    }

    if (!action) {
      const data = await requestNextgenActionStepGraphql(
        "Action",
        NEXTGEN_ACTION_CANVAS_QUERY,
        { input: { id: actionId } },
      );
      action = data.action || null;
    }
    const containsStep = action?.actionSteps?.some((step) => step.id === stepId);
    if (mode === "added" ? !containsStep : containsStep) {
      throw new Error(
        mode === "added"
          ? "The refreshed Action query did not return the duplicated step."
          : "The refreshed Action query still returned the deleted step.",
      );
    }

    const store = getNextgenActionReduxStore(bridge, actionId);
    if (!store) {
      throw new Error("The action-canvas Redux store was not found.");
    }
    store.dispatch({ type: "action/setAction", payload: action });
    console.info("[Power Browser] Action canvas query refreshed and state updated.", {
      operationName: "Action",
      apolloRefetched: refetched,
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
    return requestNextgenActionStepGraphql(
      "PowerBrowserDuplicateActionStepSource",
      `query PowerBrowserDuplicateActionStepSource($actionInput: ActionInput!, $stepInput: ActionStepInput, $variablesInput: ActionStepVariablesInput) {
        action(input: $actionInput) {
          actionSteps { id index parentId actionStepPathId }
        }
        actionStep(input: $stepInput) {
          id label functionOptions
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

  function getNextgenDuplicatePlacement(actionSteps, sourceStepId, newStepId) {
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
    orderedSiblings.splice(sourcePosition + 1, 0, duplicateTemplate);
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
    return Boolean(
      clipboard?.schemaVersion === 1 &&
        clipboard.sourceStepId &&
        clipboard.actionStep?.id &&
        clipboard.actionFunction?.type &&
        clipboard.actionFunction?.name &&
        clipboard.actionFunction?.version,
    );
  }

  function getNextgenActionStepClipboardSignature(clipboard) {
    return isValidNextgenActionStepClipboard(clipboard)
      ? [
          clipboard.actionFunction.type,
          clipboard.actionFunction.name,
          clipboard.actionFunction.version,
        ].join(":")
      : "empty";
  }

  async function resolveNextgenPasteActionFunction(clipboard) {
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
        .then((data) =>
          (data.listActionFunctions?.results || []).find(
            (actionFunction) =>
              actionFunction.type === clipboard.actionFunction.type &&
              actionFunction.name === clipboard.actionFunction.name &&
              String(actionFunction.version) ===
                String(clipboard.actionFunction.version),
          ) || null,
        )
        .catch((error) => {
          nextgenPasteFunctionMatchCache.delete(cacheKey);
          throw error;
        });
      nextgenPasteFunctionMatchCache.set(cacheKey, lookup);
    }
    return nextgenPasteFunctionMatchCache.get(cacheKey);
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
      const match = await resolveNextgenPasteActionFunction(clipboard);
      if (
        !button.isConnected ||
        button.dataset.clipboardSignature !== signature
      ) {
        return;
      }
      if (!match) {
        button.title = `Paste unavailable: ${clipboard.actionFunction.name} ${clipboard.actionFunction.version} is not available`;
        button.setAttribute("aria-label", button.title);
        return;
      }
      button.disabled = false;
      button.classList.remove("is-unavailable");
      button.title = `Paste ${clipboard.actionFunction.name} ${clipboard.actionFunction.version}`;
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
    document
      .querySelectorAll(
        `.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS} button[data-test="power-browser-quick-paste-step"]`,
      )
      .forEach((button) => void updateNextgenPasteButtonAvailability(button));
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

  async function pasteNextgenActionStep(button, context) {
    const clipboard = nextgenActionStepClipboard;
    if (!isValidNextgenActionStepClipboard(clipboard)) {
      await updateNextgenPasteButtonAvailability(button);
      return;
    }
    button.disabled = true;
    button.classList.add("is-loading");
    try {
      const match = await resolveNextgenPasteActionFunction(clipboard);
      if (!match) {
        await updateNextgenPasteButtonAvailability(button);
        return;
      }
      const destination = await fetchNextgenActionStepForDuplication(
        context.actionId,
        context.stepId,
      );
      if (!destination.action || !destination.actionStep) {
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
        context,
        source,
        context.stepId,
      );
      if (!pastedStepId) return;
      console.info("[Power Browser] Copied action step pasted.", {
        destinationActionId: context.actionId,
        afterStepId: context.stepId,
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
  ) {
    const context = requestedContext || getNextgenEditedActionStepContext();
    if (!context) throw new Error("No edited action step was found.");
    const isQuickAction = button.closest(
      `.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}`,
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

  async function deleteNextgenActionStep(button, context) {
    if (!window.confirm("Delete this action step?")) return;
    button.disabled = true;
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
    } catch (error) {
      button.disabled = false;
      console.error("[Power Browser] Unable to delete action step.", {
        ...context,
        error,
      });
      window.alert(
        `Unable to delete this action step: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    `;
    document.head.appendChild(style);
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

  function installNextgenActionStepQuickActions() {
    if (!getSettingValue("nextgenActionStepQuickActions")) return;
    const copyPasteEnabled = Boolean(
      getSettingValue("nextgenActionStepCopyPaste"),
    );
    const actionId = location.pathname.match(/\/app\/actions\/([^/?#]+)/i)?.[1];
    if (!actionId) return;
    ensureNextgenActionStepQuickActionStyles();
    document
      .querySelectorAll(
        ".react-flow__node-step[data-id], .react-flow__node-yieldsAll[data-id]",
      )
      .forEach((node) => {
        if (node.querySelector(`:scope > .${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}`)) return;
        const stepId = node.getAttribute("data-id");
        if (!stepId) return;
        const context = { actionId, stepId };
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
        const paste = createNextgenActionStepQuickAction(
          "Paste unavailable: copy an action step first",
          "power-browser-quick-paste-step",
          '<svg data-testid="icon_paste" aria-hidden="true" focusable="false" viewBox="0 0 14 14" stroke-width="0"><path d="M5.25 0A1.75 1.75 0 0 0 3.5 1.75H2.625A1.75 1.75 0 0 0 .875 3.5v8.75A1.75 1.75 0 0 0 2.625 14h5.25v-1.75h-5.25V3.5H3.5v.875h7V3.5h.875v3.063h1.75V3.5a1.75 1.75 0 0 0-1.75-1.75H10.5A1.75 1.75 0 0 0 8.75 0h-3.5Zm0 1.75h3.5v.875h-3.5V1.75Z"></path><path d="M10.5 7v2.625H7.875v1.75H10.5V14h1.75v-2.625h2.625v-1.75H12.25V7H10.5Z"></path></svg>',
        );
        const remove = createNextgenActionStepQuickAction(
          "Delete action step",
          "power-browser-quick-delete-step",
          '<svg data-testid="icon_trash" aria-hidden="true" focusable="false" viewBox="0 0 14 14" stroke-width="0"><path d="M3.5 0.875V1.75H0.875C0.39175 1.75 0 2.14175 0 2.625C0 3.10825 0.39175 3.5 0.875 3.5H13.125C13.60826 3.5 14 3.10825 14 2.625C14 2.14175 13.60826 1.75 13.125 1.75H10.5V0.875C10.5 0.39175 10.10826 0 9.625 0H4.375C3.89175 0 3.5 0.39175 3.5 0.875Z"></path><path d="M12.25 5.25H1.75L2.48031 12.40846C2.56225 13.3098 3.31802 14 4.22313 14H9.7769C10.682 14 11.43774 13.3098 11.51972 12.40846L12.25 5.25Z"></path></svg>',
        );
        const actionButtons = copyPasteEnabled
          ? [copy, paste, duplicate, remove]
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
          paste.addEventListener("click", () =>
            void pasteNextgenActionStep(paste, context),
          );
        }
        remove.addEventListener("click", () =>
          void deleteNextgenActionStep(remove, context),
        );
        toolbar.append(...actionButtons);
        node.appendChild(toolbar);
        if (copyPasteEnabled) {
          void updateNextgenPasteButtonAvailability(paste);
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
          if (hasCopyPaste !== copyPasteEnabled) toolbar.remove();
        });
      installNextgenActionStepQuickActions();
    } else {
      document
        .querySelectorAll(`.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}`)
        .forEach((toolbar) => toolbar.remove());
      document
        .getElementById(NEXTGEN_ACTION_STEP_QUICK_ACTIONS_STYLE_ID)
        ?.remove();
    }
  }

  function installNextgenDuplicateActionStepButton() {
    if (!getNextgenEditedActionStepContext()) return;
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
    document
      .querySelectorAll(`[data-test="${NEXTGEN_DUPLICATE_STEP_BUTTON_TEST_ID}"]`)
      .forEach((button) => button.remove());
    document
      .querySelectorAll(`.${NEXTGEN_ACTION_STEP_QUICK_ACTIONS_CLASS}`)
      .forEach((toolbar) => toolbar.remove());
    document.getElementById(NEXTGEN_ACTION_STEP_QUICK_ACTIONS_STYLE_ID)?.remove();
  }

  function applyNextgenDuplicateActionStepSetting() {
    if (
      !getSettingValue("nextgenDuplicateActionStep") &&
      !getSettingValue("nextgenActionStepQuickActions")
    ) {
      cleanupNextgenDuplicateActionStep();
      return;
    }
    installNextgenActionStepEnhancements();
    if (!nextgenDuplicateActionStepObserver) {
      nextgenDuplicateActionStepObserver = new MutationObserver(
        installNextgenActionStepEnhancements,
      );
      nextgenDuplicateActionStepObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }
