export const AUTH_STATES = Object.freeze([
  "idle",
  "loading",
  "reauthenticating",
  "ready",
  "manual-login-required",
]);

export function createAuthStateMachine({
  initialState = "idle",
  onTransition,
  clock = () => new Date().toISOString(),
} = {}) {
  if (!AUTH_STATES.includes(initialState)) {
    throw new Error(`Unknown authentication state "${initialState}".`);
  }

  let snapshot = Object.freeze({
    status: initialState,
    message: "",
    updatedAt: clock(),
  });
  const subscribers = new Set();

  return Object.freeze({
    get current() {
      return snapshot;
    },
    transition(status, message, details = {}) {
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
    subscribe(subscriber, { immediate = true } = {}) {
      subscribers.add(subscriber);
      if (immediate) subscriber(snapshot, null);
      return () => subscribers.delete(subscriber);
    },
  });
}
