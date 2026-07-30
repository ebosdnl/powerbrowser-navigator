import type { Feature, Logger } from "./types.js";

type FeatureHook = "start" | "sync" | "stop";

export interface FeatureRegistry<TContext> {
  register(feature: Feature<TContext>): Feature<TContext>;
  start(context: TContext): Promise<void>;
  sync(context: TContext): Promise<void>;
  stop(context: TContext): Promise<void>;
  names(): string[];
}

export function createFeatureRegistry<TContext = unknown>(
  logger?: Pick<Logger, "error">,
): Readonly<FeatureRegistry<TContext>> {
  const features = new Map<string, Feature<TContext>>();

  async function invoke(
    feature: Feature<TContext>,
    method: FeatureHook,
    context: TContext,
  ) {
    const hook = feature[method];
    if (typeof hook !== "function") return;
    try {
      await hook(context);
    } catch (error) {
      logger?.error(`${feature.name}.${method} failed`, error);
    }
  }

  return Object.freeze({
    register(feature: Feature<TContext>) {
      if (!feature?.name)
        throw new TypeError("Features require a unique name.");
      if (features.has(feature.name)) {
        throw new Error(`Feature "${feature.name}" is already registered.`);
      }
      features.set(feature.name, feature);
      return feature;
    },
    async start(context: TContext) {
      for (const feature of features.values())
        await invoke(feature, "start", context);
    },
    async sync(context: TContext) {
      for (const feature of features.values())
        await invoke(feature, "sync", context);
    },
    async stop(context: TContext) {
      for (const feature of [...features.values()].reverse()) {
        await invoke(feature, "stop", context);
      }
    },
    names: () => [...features.keys()],
  });
}
