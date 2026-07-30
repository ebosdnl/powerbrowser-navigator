export type ContextSubscriber<TContext extends object> = (
  snapshot: Readonly<TContext>,
  previous: Readonly<TContext>,
) => void;

export interface ApplicationContext<TContext extends object> {
  readonly current: Readonly<TContext>;
  update(patch: Partial<TContext>): Readonly<TContext>;
  subscribe(subscriber: ContextSubscriber<TContext>): () => boolean;
}

export function createApplicationContext<TContext extends object>(
  initial = {} as TContext,
): Readonly<ApplicationContext<TContext>> {
  let snapshot: Readonly<TContext> = Object.freeze({ ...initial });
  const subscribers = new Set<ContextSubscriber<TContext>>();

  return Object.freeze({
    get current() {
      return snapshot;
    },
    update(patch: Partial<TContext>) {
      const previous = snapshot;
      snapshot = Object.freeze({ ...snapshot, ...patch });
      subscribers.forEach((subscriber) => {
        subscriber(snapshot, previous);
      });
      return snapshot;
    },
    subscribe(subscriber: ContextSubscriber<TContext>) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  });
}
