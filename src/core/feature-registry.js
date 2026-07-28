export function createFeatureRegistry(logger) {
  const features = new Map();

  async function invoke(feature, method, context) {
    if (typeof feature[method] !== "function") return;
    try {
      await feature[method](context);
    } catch (error) {
      logger?.error(`${feature.name}.${method} failed`, error);
    }
  }

  return Object.freeze({
    register(feature) {
      if (!feature?.name)
        throw new TypeError("Features require a unique name.");
      if (features.has(feature.name)) {
        throw new Error(`Feature "${feature.name}" is already registered.`);
      }
      features.set(feature.name, feature);
      return feature;
    },
    async start(context) {
      for (const feature of features.values())
        await invoke(feature, "start", context);
    },
    async sync(context) {
      for (const feature of features.values())
        await invoke(feature, "sync", context);
    },
    async stop(context) {
      for (const feature of [...features.values()].reverse()) {
        await invoke(feature, "stop", context);
      }
    },
    names: () => [...features.keys()],
  });
}
