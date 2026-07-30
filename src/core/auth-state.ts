import type { AuthSnapshot, AuthStatus, AuthSubscriber } from "./types.js";

export const AUTH_STATES = Object.freeze<AuthStatus[]>([
  "idle",
  "loading",
  "reauthenticating",
  "ready",
  "manual-login-required",
]);

export interface AuthStateMachineOptions {
  initialState?: AuthStatus;
  onTransition?: AuthSubscriber;
  clock?: () => string;
}

export interface AuthStateMachine {
  readonly current: AuthSnapshot;
  transition(
    status: AuthStatus,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ): AuthSnapshot;
  subscribe(
    subscriber: AuthSubscriber,
    options?: { immediate?: boolean },
  ): () => boolean;
}

export function createAuthStateMachine({
  initialState = "idle",
  onTransition,
  clock = () => new Date().toISOString(),
}: AuthStateMachineOptions = {}): Readonly<AuthStateMachine> {
  if (!AUTH_STATES.includes(initialState)) {
    throw new Error(`Unknown authentication state "${initialState}".`);
  }

  let snapshot: AuthSnapshot = Object.freeze({
    status: initialState,
    message: "",
    updatedAt: clock(),
  });
  const subscribers = new Set<AuthSubscriber>();

  return Object.freeze({
    get current() {
      return snapshot;
    },
    transition(
      status: AuthStatus,
      message: string,
      details: Readonly<Record<string, unknown>> = {},
    ) {
      if (!AUTH_STATES.includes(status)) {
        throw new Error(`Unknown authentication state "${status}".`);
      }
      const previous = snapshot;
      snapshot = Object.freeze({
        status,
        message: String(message || ""),
        updatedAt: clock(),
        ...details,
      });
      onTransition?.(snapshot, previous);
      subscribers.forEach((subscriber) => {
        subscriber(snapshot, previous);
      });
      return snapshot;
    },
    subscribe(
      subscriber: AuthSubscriber,
      { immediate = true }: { immediate?: boolean } = {},
    ) {
      subscribers.add(subscriber);
      if (immediate) subscriber(snapshot, null);
      return () => subscribers.delete(subscriber);
    },
  });
}
